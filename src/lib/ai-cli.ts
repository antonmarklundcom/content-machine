import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Subscription mode (§1.38): instead of paying per token through the Gemini
 * API, hand a prompt to the Claude Code or Codex CLI already installed and
 * logged in on Anton's PC, and read the answer back. Only works where the app
 * runs next to a logged-in CLI — i.e. locally, which is how it runs (§1.27).
 *
 * Nothing here knows about scripts or titles: it takes a system prompt, a user
 * prompt and a JSON schema, and returns the model's JSON text.
 */

/** Only the keys read here; keeps tests free of NODE_ENV. */
type Env = Record<string, string | undefined>;

export type AiProvider = "gemini" | "claude-cli" | "codex-cli";

export function aiProvider(env: Env = process.env): AiProvider {
  const v = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (v === "claude" || v === "claude-cli") return "claude-cli";
  if (v === "codex" || v === "codex-cli") return "codex-cli";
  return "gemini";
}

/** A CLI run is slow (it may search the web); a hung one must still end. */
export const CLI_TIMEOUT_MS = 10 * 60 * 1000;

export function buildCliPrompt(
  system: string,
  prompt: string,
  schema: unknown,
  webSearch: boolean,
): string {
  return `${system}

${
  webSearch
    ? "Use your web search tool to research facts. Put the full URL of every page you rely on in the sources."
    : "Do not browse the web; answer from the brief."
}
Do not edit or create any files. Reply with ONE JSON object that matches this JSON Schema, and nothing else — no prose, no code fences:
${JSON.stringify(schema)}

---

${prompt}`;
}

/**
 * Pulls the JSON object out of a CLI reply. Models sometimes wrap it in a code
 * fence or a sentence despite being told not to; take the outermost {…}.
 */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The CLI reply contained no JSON object.");
  const candidate = body.slice(start, end + 1);
  JSON.parse(candidate); // throws a readable SyntaxError if it is not JSON
  return candidate;
}

export interface CliCommand {
  bin: string;
  args: string[];
  /** Codex writes its final answer to a file; Claude prints a JSON envelope. */
  outputFile?: string;
}

export function claudeCommand(webSearch: boolean, env: Env = process.env): CliCommand {
  const args = ["-p", "--output-format", "json"];
  if (env.CLAUDE_CLI_MODEL) args.push("--model", env.CLAUDE_CLI_MODEL);
  if (webSearch) args.push("--allowedTools", "WebSearch", "WebFetch");
  return { bin: env.CLAUDE_CLI_BIN || "claude", args };
}

export function codexCommand(outputFile: string, env: Env = process.env): CliCommand {
  const extra = (env.CODEX_CLI_ARGS ?? "").split(" ").filter(Boolean);
  const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", ...extra];
  if (env.CODEX_CLI_MODEL) args.push("--model", env.CODEX_CLI_MODEL);
  args.push("--output-last-message", outputFile, "-");
  return { bin: env.CODEX_CLI_BIN || "codex", args, outputFile };
}

/** Claude's `--output-format json` envelope carries the answer in `result`. */
export function unwrapClaudeEnvelope(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
    if (parsed.is_error)
      throw new Error(`Claude CLI reported an error: ${String(parsed.result ?? "")}`);
    if (typeof parsed.result === "string") return parsed.result;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Claude CLI")) throw err;
  }
  return stdout;
}

function run(cmd: CliCommand, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.bin, cmd.args, {
      // npm-installed CLIs are .cmd shims on Windows, which need a shell.
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(`${cmd.bin} did not answer within ${Math.round(timeoutMs / 60000)} minutes.`),
      );
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not start "${cmd.bin}" (${err.message}). Is it installed and logged in? See docs/SUBSCRIPTION-MODE.md.`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `${cmd.bin} exited with code ${code}: ${(stderr || stdout).trim().slice(0, 400)}`,
          ),
        );
      } else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

/**
 * Runs one structured request through the configured CLI and returns the JSON
 * text. Throws with a message the UI can show as-is.
 */
export async function runCliJson(opts: {
  provider: Exclude<AiProvider, "gemini">;
  system: string;
  prompt: string;
  schema: unknown;
  webSearch: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const input = buildCliPrompt(opts.system, opts.prompt, opts.schema, opts.webSearch);
  const timeoutMs = opts.timeoutMs ?? CLI_TIMEOUT_MS;

  if (opts.provider === "claude-cli") {
    const stdout = await run(claudeCommand(opts.webSearch), input, timeoutMs);
    return extractJson(unwrapClaudeEnvelope(stdout));
  }

  const dir = await mkdtemp(path.join(tmpdir(), "ce-codex-"));
  const outFile = path.join(dir, "answer.txt");
  try {
    const stdout = await run(codexCommand(outFile), input, timeoutMs);
    const answer = await readFile(outFile, "utf8").catch(() => stdout);
    return extractJson(answer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

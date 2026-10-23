import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertOnPc } from "@/lib/pc-only";
import { killChildTree, spawnCli } from "@/lib/higgsfield/process";
import { CONTAINMENT_FAILED_EXIT, CONTAINMENT_FAILED_MARKER } from "@/lib/higgsfield/win-job";

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
export const MAX_CLI_OUTPUT_BYTES = 2 * 1024 * 1024;

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

/** The error shown when the CLI ended with a non-zero code. */
export function exitError(bin: string, code: number | null, stderr: string, stdout: string): Error {
  if (code === CONTAINMENT_FAILED_EXIT && stderr.includes(CONTAINMENT_FAILED_MARKER)) {
    return new Error(
      `${bin} was not allowed to run: Windows could not place it in an owned process job, so it could not be cancelled reliably. Try again; if this repeats, start Content Machine outside any tool that restricts child process jobs.`,
    );
  }
  return new Error(`${bin} exited with code ${code}: ${(stderr || stdout).trim().slice(0, 400)}`);
}

function run(
  cmd: CliCommand,
  input: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(cmd.bin, cmd.args, { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let settled = false;
    const stop = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killChildTree(child);
      reject(error);
    };
    const timer = setTimeout(
      () =>
        stop(
          new Error(
            `${cmd.bin} did not answer within ${Math.round(timeoutMs / 60000)} minutes. Cancellation was requested for its owned process tree.`,
          ),
        ),
      timeoutMs,
    );
    const collect = (value: Buffer, target: "stdout" | "stderr") => {
      if (settled) return;
      bytes += value.length;
      if (bytes > maxOutputBytes)
        return stop(
          new Error(
            "The CLI exceeded its output limit. Cancellation was requested for its owned process tree.",
          ),
        );
      if (target === "stdout") stdout += value.toString();
      else stderr += value.toString();
    };
    child.stdout?.on("data", (d: Buffer) => collect(d, "stdout"));
    child.stderr?.on("data", (d: Buffer) => collect(d, "stderr"));
    child.on("error", (err) => {
      stop(
        new Error(
          `Could not start "${cmd.bin}" (${err.message}). Is it installed and logged in? See docs/SUBSCRIPTION-MODE.md.`,
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(exitError(cmd.bin, code, stderr, stdout));
      else resolve(stdout);
    });
    child.stdin?.on("error", (error) => stop(error));
    child.stdin?.end(input);
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
  maxOutputBytes?: number;
}): Promise<string> {
  assertOnPc("Subscription CLI generation");
  const input = buildCliPrompt(opts.system, opts.prompt, opts.schema, opts.webSearch);
  const timeoutMs = opts.timeoutMs ?? CLI_TIMEOUT_MS;
  const maxOutputBytes = Math.min(
    MAX_CLI_OUTPUT_BYTES,
    Math.max(1, opts.maxOutputBytes ?? MAX_CLI_OUTPUT_BYTES),
  );

  if (opts.provider === "claude-cli") {
    const stdout = await run(claudeCommand(opts.webSearch), input, timeoutMs, maxOutputBytes);
    return extractJson(unwrapClaudeEnvelope(stdout));
  }

  const dir = await mkdtemp(path.join(tmpdir(), "ce-codex-"));
  const outFile = path.join(dir, "answer.txt");
  try {
    const stdout = await run(codexCommand(outFile), input, timeoutMs, maxOutputBytes);
    const info = await stat(outFile).catch(() => null);
    if (info && info.size > maxOutputBytes)
      throw new Error("The CLI answer file exceeded its output limit.");
    const answer = await readFile(outFile, "utf8").catch(() => stdout);
    return extractJson(answer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

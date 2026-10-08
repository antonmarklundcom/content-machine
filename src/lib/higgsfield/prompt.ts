import path from "node:path";
import type { HiggsfieldJobKind } from "@/db/schema";

import { COMMAND_FOR } from "./config";

/**
 * The server-side prompt and argv for one headless Claude Code run (build 4 §1.14):
 * the brief text is generated server-side by brief.ts and passed in, so the
 * CLI never needs a session cookie to fetch it.
 *
 * The machine-readable lines the run prints (parsed by stream.ts):
 *
 *   HF_BALANCE before <credits>   balance before the first generation
 *   HF_JOB <id>                   every Higgsfield job submitted
 *   HF_FILE <relative path>       every media file saved, relative to MEDIA_ROOT
 *   HF_BALANCE after <credits>    balance at the end
 *   HF_CREDITS <used>             credits this run spent
 */

/** The trusted downloader stages and validates bytes before exposing a final name. */
export function downloadCommand(mediaRoot: string): string {
  const script = forwardSlashes(path.resolve(process.cwd(), "scripts/media-download.mjs"));
  return `node "${script}" "${forwardSlashes(mediaRoot)}"`;
}

/** An absolute path with forward slashes (`E:\\ContentEngine` → `E:/ContentEngine`), no trailing slash. */
export function forwardSlashes(absolute: string): string {
  return absolute.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

/**
 * An absolute path as a Claude Code permission-rule path. `//` marks an
 * absolute path in a rule; a Windows drive becomes its POSIX form
 * (`E:\\ContentEngine` → `//e/ContentEngine`).
 */
export function rulePath(absolute: string): string {
  const fwd = forwardSlashes(absolute);
  const drive = /^([a-zA-Z]):(\/.*)?$/.exec(fwd);
  if (drive) return `//${drive[1].toLowerCase()}${drive[2] ?? ""}`;
  return `/${fwd.startsWith("/") ? fwd : `/${fwd}`}`;
}

/** An MCP server name as it appears in tool names (`claude.ai Higgsfield` → `claude_ai_Higgsfield`). */
export function mcpToolPrefix(serverName: string): string {
  return `mcp__${serverName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * The narrowest `--allowedTools` set the commands work with: every tool of the
 * Higgsfield MCP server(s) (`mcp__<server>` allows all of one server's tools),
 * Read/Write/Edit under MEDIA_ROOT only, Read of the command files themselves
 * (the fallback when a slash command is not expanded), and the staged downloader writing into
 * MEDIA_ROOT. Nothing else is pre-approved, and a headless run cannot ask, so
 * every other tool call is denied.
 */
export function allowedTools(opts: {
  mediaRoot: string;
  mcpServers: string[];
  recoveryOnly?: boolean;
}): string[] {
  const root = rulePath(opts.mediaRoot);
  const servers = opts.mcpServers.length ? opts.mcpServers : ["higgsfield"];
  return [
    ...[...new Set(servers.map(mcpToolPrefix))].flatMap((prefix) =>
      opts.recoveryOnly
        ? ["balance", "jobs_wait", "show_generations"].map((tool) => `${prefix}__${tool}`)
        : [prefix],
    ),
    `Read(${root}/**)`,
    `Write(${root}/**)`,
    `Edit(${root}/**)`,
    "Read(.claude/commands/higgsfield-*.md)",
    `Bash(${downloadCommand(opts.mediaRoot)} :*)`,
  ];
}

/** argv for `claude` (the prompt goes on stdin). */
export function claudeRunArgs(opts: {
  mediaRoot: string;
  mcpServers: string[];
  model?: string;
  recoveryOnly?: boolean;
}): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (opts.model) args.push("--model", opts.model);
  args.push("--allowedTools", allowedTools(opts).join(","));
  return args;
}

export type PromptInput = {
  kind: HiggsfieldJobKind;
  jobId: number;
  /** What follows the slash command: the inline brief, a range, a description. */
  argument: string;
  maxCredits: number;
  /** Absolute MEDIA_ROOT. */
  mediaRoot: string;
};

/** The hard credit instruction, verbatim in every prompt. */
export function ceilingText(maxCredits: number): string {
  if (maxCredits <= 0) {
    return "Spend at most 0 credits: this run must not generate anything. Check balance first and report balance before/after.";
  }
  return (
    `Spend at most ${maxCredits} credits: check balance first, preflight with get_cost ` +
    `(or the MCP's quote/price for each generation; pass max_credits where a tool takes it), ` +
    `stop before exceeding ${maxCredits} credits; report balance before/after.`
  );
}

const RULES_HEADING = "\n\n---\n\n## Run rules (content-engine job #";

/** The argument part of a stored prompt (for a retry of a `free`/`import` run), or null. */
export function extractArgument(prompt: string): string | null {
  const m = /^\/[a-z-]+ ?/.exec(prompt);
  const end = prompt.indexOf(RULES_HEADING);
  if (!m || end === -1) return null;
  return prompt.slice(m[0].length, end);
}

/** The whole prompt handed to `claude -p`: slash command + inline brief + run rules. */
export function buildRunPrompt(input: PromptInput): string {
  const command = COMMAND_FOR[input.kind];
  const root = forwardSlashes(input.mediaRoot);
  return `/${command} ${input.argument.trim()}${RULES_HEADING}${input.jobId}, headless)

- **${ceilingText(input.maxCredits)}** This is a hard ceiling set by Anton: if the next generation would take the total past it, stop, do not generate it, and say so in the report.
- Nobody is watching this run and nobody can answer a question. Wherever the command says "stop and ask Anton", stop instead and explain why in the report.
- MEDIA_ROOT is \`${root}\` (the drive is connected). Every \`targetFile\`, \`targetVideoFile\`, \`file\`, \`folder\` and \`variants\` path is relative to it; a path starting with \`media/\` means \`${root}/\` followed by the rest. Write nothing outside MEDIA_ROOT.
- Download each result with exactly: \`${downloadCommand(root)} "<path relative to MEDIA_ROOT>" "<result url>"\` — no other shell command is allowed.
- Do not run \`npm run media:scan\`; content-engine registers the files when this run ends.
- Print each of these on a line of its own, with nothing else on the line, as it happens:
  - \`HF_BALANCE before <credits>\` after checking the balance, before any generation
  - \`HF_JOB <higgsfield job id>\` for every Higgsfield job you submit
  - \`HF_FILE <path relative to MEDIA_ROOT>\` for every media file you save (not the manifest)
  - \`HF_BALANCE after <credits>\` at the end
  - \`HF_CREDITS <credits spent in this run>\` at the end
- If the \`/${command}\` command above was not expanded, read \`.claude/commands/${command}.md\` and follow it with the input above.
`;
}

export type RecoveryInput = {
  sourceJobId: number;
  externalJobIds: string[];
  voiceJobs?: Record<number, string>;
};

/** Retain exact input lineage; recovery has no permission to submit paid work. */
export function buildRecoveryRunPrompt(input: PromptInput & { recovery: RecoveryInput }): string {
  const base = buildRunPrompt({ ...input, maxCredits: 0 });
  return `${base}

## Recovery only — replaces every generation step above

Source content-engine job: #${input.recovery.sourceJobId}.
Known Higgsfield jobs: ${JSON.stringify([...new Set(input.recovery.externalJobIds)])}.
Voice line to remote job: ${JSON.stringify(input.recovery.voiceJobs ?? {})}.

The exact original request above is immutable lineage, not authorization to generate.
Use jobs_wait and history to inspect every retained remote ID, and download completed
results to the original intended paths. Preserve every known ID in the report and print
HF_JOB for it (include the original line ID for voice). Keep completed files.
Never call a generation, submission, edit, or paid provider tool. Its permissions are
disabled for this run. Pending, failed, missing, unknown, or unverifiable remote state
must stop recovery and be reported; it never authorizes a replacement submission.
If a result cannot be matched to its original target, stop and report it. A fresh
generation requires a separate owner-started attempt with the prior job still visible.
Spend at most 0 credits. Print HF_CREDITS 0.
`;
}

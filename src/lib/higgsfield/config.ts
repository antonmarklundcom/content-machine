import type { HiggsfieldJobKind } from "@/db/schema";

/**
 * Settings for the Higgsfield bridge (build 4 §1.14), all from the
 * environment. Pure: every function takes the env so tests need no globals.
 */

type Env = Record<string, string | undefined>;

/** The logged-in Claude Code CLI: `CLAUDE_CLI_PATH`, else `CLAUDE_CLI_BIN` (ai-cli.ts), else `claude` on PATH. */
export function claudeBin(env: Env = process.env): string {
  return env.CLAUDE_CLI_PATH?.trim() || env.CLAUDE_CLI_BIN?.trim() || "claude";
}

/** `HIGGSFIELD_JOB_TIMEOUT_MIN` (default 30) — a run past it is killed and failed. */
export function jobTimeoutMs(env: Env = process.env): number {
  const min = Number(env.HIGGSFIELD_JOB_TIMEOUT_MIN);
  return (Number.isFinite(min) && min > 0 ? min : 30) * 60 * 1000;
}

/** `HIGGSFIELD_DEFAULT_MAX_CREDITS` (default 20) — the ceiling the buttons suggest. */
export function defaultMaxCredits(env: Env = process.env): number {
  const n = Number(env.HIGGSFIELD_DEFAULT_MAX_CREDITS);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/** No single run may be given more than this, whatever is typed. */
export const MAX_CREDITS_LIMIT = 2000;

/**
 * Names of the MCP servers that carry the Higgsfield tools, when set by hand
 * (`HIGGSFIELD_MCP_SERVER=higgsfield`, or a comma list). Empty = detect them
 * from `claude mcp list` (preflight.ts).
 */
export function configuredMcpServers(env: Env = process.env): string[] {
  return (env.HIGGSFIELD_MCP_SERVER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The slash command each kind runs (`.claude/commands/<name>.md`). */
export const COMMAND_FOR: Record<HiggsfieldJobKind, string> = {
  post: "higgsfield-post",
  script_shots: "higgsfield-shots",
  script_thumbnails: "higgsfield-thumbnails",
  import: "higgsfield-import",
  free: "higgsfield-free",
  voice: "higgsfield-voice",
};

/** Kinds that generate for one post or script, and so need a `targetRef`. */
export const TARGETED_KINDS: readonly HiggsfieldJobKind[] = [
  "post",
  "script_shots",
  "script_thumbnails",
];

/** `post:12` / `script:7` — what `targetRef` holds for a kind. */
export function targetRefFor(kind: HiggsfieldJobKind, id: number): string {
  return `${kind === "post" ? "post" : "script"}:${id}`;
}

/** The numeric id in a `targetRef`, or null. */
export function targetId(targetRef: string | null | undefined): number | null {
  const m = /^(?:post|script):(\d+)$/.exec(targetRef ?? "");
  return m ? Number(m[1]) : null;
}

/** Where a target's page lives in the app. */
export function targetHref(kind: HiggsfieldJobKind, targetRef: string | null): string | null {
  // Build 5 voice batches: `voice:story:<slug>:<lang>` and `voice:script:<id>`.
  if (kind === "voice" && targetRef) {
    const story = /^voice:story:([a-z0-9][a-z0-9-]*):([A-Za-z-]+)$/.exec(targetRef);
    if (story) return `/stories/${story[1]}?lang=${story[2]}`;
    const script = /^voice:script:(\d+)$/.exec(targetRef);
    if (script) return `/studio/${script[1]}/voice`;
    return null;
  }
  const id = targetId(targetRef);
  if (!id) return null;
  if (kind === "post") return `/posts/${id}`;
  if (kind === "script_thumbnails") return `/studio/${id}/thumbnails`;
  return `/studio/${id}`;
}

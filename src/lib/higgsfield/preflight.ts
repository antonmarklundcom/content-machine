import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { mediaRoot, mediaRootStatus } from "@/lib/storage/root";

import { claudeBin, configuredMcpServers } from "./config";
import { execCli } from "./process";

/**
 * Can this machine run a Higgsfield job? (build 4 §1.14) Four checks, each
 * with a plain fix the page shows:
 *
 * 1. MEDIA_ROOT is connected and writable.
 * 2. The `claude` binary runs (`claude --version`).
 * 3. It is logged in: a one-line `claude -p` ping (costs a sliver of the
 *    subscription, so it only runs when asked for, never on page load).
 * 4. A Higgsfield MCP server is configured and connected: `claude mcp list`,
 *    which lists local/user/project servers and — in the CLI versions that
 *    show them — claude.ai connectors (`claude.ai Higgsfield: … ✓ Connected`).
 */

export type PreflightCheckId = "media_root" | "claude_binary" | "claude_login" | "higgsfield_mcp";

/** A dictionary key suffix under `higgsfield.fix.` — the plain fix shown to Anton. */
export type PreflightFix =
  | "media_missing"
  | "media_unwritable"
  | "claude_missing"
  | "claude_logged_out"
  | "claude_api_key"
  | "mcp_missing"
  | "mcp_failed"
  | "mcp_auth";

export type PreflightCheck = {
  id: PreflightCheckId;
  ok: boolean;
  /** Technical detail: a version, a path, the CLI's own words. */
  detail: string;
  fix?: PreflightFix;
};

export type Preflight = {
  ok: boolean;
  checks: PreflightCheck[];
  /** MCP server names that carry Higgsfield (for `--allowedTools`). */
  mcpServers: string[];
  checkedAt: string;
};

export type McpServerLine = { name: string; target: string; status: string; connected: boolean };

/** Parse `claude mcp list`: `name: target - ✓ Connected` per line. */
export function parseMcpList(output: string): McpServerLine[] {
  const out: McpServerLine[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(.+?):\s+(.*?)\s+-\s+(.+)$/.exec(line);
    if (!m) continue;
    const status = m[3].replace(/^[✓✔✗✘⚠!×\s]+/u, "").trim();
    const connected = /connected/i.test(status) && !/fail|not connected|disconnected/i.test(status);
    out.push({ name: m[1].trim(), target: m[2].trim(), status, connected });
  }
  return out;
}

/** The lines that look like Higgsfield (by name or URL). */
export function higgsfieldServers(lines: McpServerLine[]): McpServerLine[] {
  return lines.filter((l) => /higgsfield/i.test(l.name) || /higgsfield/i.test(l.target));
}

/** Check 4 from `claude mcp list` output (pure, for tests). */
export function mcpCheck(
  list: { code: number | null; stdout: string; stderr: string; spawnError?: string },
  configured: string[],
): { check: PreflightCheck; servers: string[] } {
  const lines = parseMcpList(`${list.stdout}\n${list.stderr}`);
  const found = higgsfieldServers(lines);
  const connected = found.filter((l) => l.connected);
  if (connected.length) {
    return {
      check: {
        id: "higgsfield_mcp",
        ok: true,
        detail: connected.map((l) => `${l.name} — ${l.status}`).join("; "),
      },
      servers: connected.map((l) => l.name),
    };
  }
  if (configured.length) {
    // Set by hand (HIGGSFIELD_MCP_SERVER): trusted, but say it was not seen.
    return {
      check: {
        id: "higgsfield_mcp",
        ok: true,
        detail: `HIGGSFIELD_MCP_SERVER=${configured.join(",")} (not seen as connected in \`claude mcp list\`)`,
      },
      servers: configured,
    };
  }
  if (found.length) {
    const needsAuth = found.some((l) => /auth/i.test(l.status));
    return {
      check: {
        id: "higgsfield_mcp",
        ok: false,
        detail: found.map((l) => `${l.name} — ${l.status}`).join("; "),
        fix: needsAuth ? "mcp_auth" : "mcp_failed",
      },
      servers: [],
    };
  }
  return {
    check: {
      id: "higgsfield_mcp",
      ok: false,
      detail: lines.length
        ? `No Higgsfield server among: ${lines.map((l) => l.name).join(", ")}`
        : (list.spawnError ?? (list.stdout.trim() || "No MCP servers configured.")).slice(0, 300),
      fix: "mcp_missing",
    },
    servers: [],
  };
}

/** Check 3 from the ping's `--output-format json` envelope (pure, for tests). */
export function loginCheck(
  ping: {
    code: number | null;
    stdout: string;
    stderr: string;
    spawnError?: string;
    timedOut?: boolean;
  },
  env: Record<string, string | undefined> = process.env,
): PreflightCheck {
  let isError = ping.code !== 0;
  let text = (ping.stderr || ping.stdout).trim();
  try {
    const envelope = JSON.parse(ping.stdout) as { is_error?: boolean; result?: unknown };
    if (envelope.is_error) isError = true;
    if (typeof envelope.result === "string") text = envelope.result;
  } catch {
    /* not JSON: keep the raw output */
  }
  if (ping.timedOut) {
    return {
      id: "claude_login",
      ok: false,
      detail: "No answer within a minute.",
      fix: "claude_logged_out",
    };
  }
  if (isError) {
    return { id: "claude_login", ok: false, detail: text.slice(0, 300), fix: "claude_logged_out" };
  }
  if (env.ANTHROPIC_API_KEY) {
    // It works, but runs bill the API key instead of the subscription.
    return {
      id: "claude_login",
      ok: true,
      detail: "Logged in — but ANTHROPIC_API_KEY is set, so runs bill that key.",
      fix: "claude_api_key",
    };
  }
  return { id: "claude_login", ok: true, detail: "Logged in." };
}

function credentialsFile(): string {
  return path.join(homedir(), ".claude", ".credentials.json");
}

/** Every check, in order. A failed binary check skips the two that need it. */
export async function runPreflight(opts: { ping?: boolean } = {}): Promise<Preflight> {
  const checks: PreflightCheck[] = [];
  const root = mediaRoot();
  const status = await mediaRootStatus(root);
  checks.push(
    status === "ok"
      ? { id: "media_root", ok: true, detail: root }
      : {
          id: "media_root",
          ok: false,
          detail: root,
          fix: status === "missing" ? "media_missing" : "media_unwritable",
        },
  );

  const bin = claudeBin();
  const version = await execCli(bin, ["--version"], { timeoutMs: 30_000 });
  const binOk = !version.spawnError && version.code === 0;
  checks.push(
    binOk
      ? { id: "claude_binary", ok: true, detail: `${bin} ${version.stdout.trim()}`.trim() }
      : {
          id: "claude_binary",
          ok: false,
          detail: `${bin}: ${(version.spawnError ?? version.stderr ?? "").trim().slice(0, 200) || `exit ${version.code}`}`,
          fix: "claude_missing",
        },
  );

  let servers: string[] = [];
  if (!binOk) {
    checks.push({ id: "claude_login", ok: false, detail: "Needs the CLI.", fix: "claude_missing" });
    checks.push({
      id: "higgsfield_mcp",
      ok: false,
      detail: "Needs the CLI.",
      fix: "claude_missing",
    });
  } else {
    if (opts.ping === false) {
      const has = existsSync(credentialsFile());
      checks.push(
        has
          ? { id: "claude_login", ok: true, detail: `Found ${credentialsFile()} (not pinged).` }
          : {
              id: "claude_login",
              ok: true,
              detail: "Not pinged; no credentials file (normal on macOS, which uses the keychain).",
            },
      );
    } else {
      const ping = await execCli(
        bin,
        ["-p", "Reply with the single word OK.", "--output-format", "json", "--max-turns", "1"],
        { timeoutMs: 60_000 },
      );
      checks.push(loginCheck(ping));
    }
    const list = await execCli(bin, ["mcp", "list"], { timeoutMs: 60_000 });
    const mcp = mcpCheck(list, configuredMcpServers());
    checks.push(mcp.check);
    servers = mcp.servers;
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    mcpServers: servers,
    checkedAt: new Date().toISOString(),
  };
}

let cached: { at: number; value: Preflight } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/** The last preflight in this process if it is fresh (page render), else null. */
export function cachedPreflight(): Preflight | null {
  return cached && Date.now() - cached.at < CACHE_MS ? cached.value : null;
}

/** Run the preflight and remember it. */
export async function refreshPreflight(opts: { ping?: boolean } = {}): Promise<Preflight> {
  const value = await runPreflight(opts);
  cached = { at: Date.now(), value };
  return value;
}

/** Forget the cache (tests). */
export function resetPreflightCache(): void {
  cached = null;
}

/**
 * The MCP server names a run allows: `HIGGSFIELD_MCP_SERVER`, else the ones a
 * fresh-enough preflight saw, else `claude mcp list` now, else `higgsfield`.
 */
export async function resolveMcpServers(): Promise<string[]> {
  const configured = configuredMcpServers();
  if (configured.length) return configured;
  const fromCache = cachedPreflight()?.mcpServers;
  if (fromCache?.length) return fromCache;
  const list = await execCli(claudeBin(), ["mcp", "list"], { timeoutMs: 60_000 });
  const found = mcpCheck(list, []).servers;
  return found.length ? found : ["higgsfield"];
}

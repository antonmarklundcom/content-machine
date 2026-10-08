import path from "node:path";

/**
 * Incremental parser for `claude -p --output-format stream-json --verbose`
 * (build 4 §1.14). The CLI prints one JSON object per line:
 *
 *   {"type":"system","subtype":"init","mcp_servers":[{"name":…,"status":…}],…}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":…},{"type":"tool_use","name":…}]}}
 *   {"type":"user","message":{"content":[{"type":"tool_result","is_error":…,"content":…}]}}
 *   {"type":"result","subtype":"success"|"error_…","is_error":…,"result":…,"permission_denials":[…]}
 *
 * Text the model writes is scanned for the `HF_*` lines the prompt asks for
 * (prompt.ts). Everything becomes a short human log line, kept as a bounded
 * tail. Chunks may split lines anywhere; `feed` buffers the remainder.
 */

/** The job row keeps at most this much log. */
export const LOG_TAIL_CHARS = 12_000;

export type StreamState = {
  externalJobIds: string[];
  /** Relative to MEDIA_ROOT, forward slashes. */
  outputPaths: string[];
  /** From `HF_CREDITS`, else before − after. */
  creditsUsed: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  /** The `result` event arrived. */
  finished: boolean;
  /** The `result` event said the run failed. */
  isError: boolean;
  /** The final report text (or error) from the `result` event. */
  resultText: string | null;
  /** Tools the CLI refused because they were not allowed. */
  permissionDenials: string[];
  /** MCP servers reported by the init event, `name: status`. */
  mcpServers: string[];
  log: string;
};

const MARKER = /^[\s>*`-]*HF_(JOB|FILE|CREDITS|BALANCE)[:\s]+(.+?)[\s`*]*$/;

function num(text: string): number | null {
  const m = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * A reported file as a safe path relative to MEDIA_ROOT, or null. Absolute
 * paths inside the root are made relative; a `media/` prefix (the build 2
 * script paths, relative to the repo) is dropped when the root is `<repo>/media`.
 */
export function normaliseOutputPath(reported: string, mediaRoot: string): string | null {
  let p = reported.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!p) return null;
  const fwdRoot = mediaRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  p = p.replace(/\\/g, "/");
  if (p.toLowerCase().startsWith(`${fwdRoot.toLowerCase()}/`)) p = p.slice(fwdRoot.length + 1);
  else if (path.isAbsolute(p) || /^[a-zA-Z]:\//.test(p)) return null;
  if (p.startsWith("media/") && path.basename(fwdRoot) === "media") p = p.slice("media/".length);
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (!parts.length || parts.some((s) => s === ".." || /[\0]/.test(s) || /^[a-zA-Z]:$/.test(s)))
    return null;
  return parts.join("/");
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "",
      )
      .join("\n");
  }
  return "";
}

function clip(text: string, max = 300): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export class StreamParser {
  private buffer = "";
  readonly state: StreamState = {
    externalJobIds: [],
    outputPaths: [],
    creditsUsed: null,
    balanceBefore: null,
    balanceAfter: null,
    finished: false,
    isError: false,
    resultText: null,
    permissionDenials: [],
    mcpServers: [],
    log: "",
  };
  private reportedCredits: number | null = null;

  constructor(private readonly mediaRoot: string) {}

  /** Feed a raw stdout chunk; returns true when the state changed. */
  feed(chunk: string): boolean {
    this.buffer += chunk;
    let changed = false;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (this.line(line)) changed = true;
    }
    return changed;
  }

  /** Flush a final unterminated line. */
  end(): boolean {
    const rest = this.buffer;
    this.buffer = "";
    return rest.trim() ? this.line(rest) : false;
  }

  /** Append a line to the bounded log (also used for the runner's own notes). */
  note(text: string): void {
    const next = `${this.state.log}${text}\n`;
    this.state.log =
      next.length > LOG_TAIL_CHARS ? `…${next.slice(next.length - LOG_TAIL_CHARS + 1)}` : next;
  }

  private line(raw: string): boolean {
    const line = raw.trim();
    if (!line) return false;
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      event = parsed as Record<string, unknown>;
    } catch {
      this.note(clip(line));
      this.scanText(line);
      return true;
    }
    this.event(event);
    return true;
  }

  private event(event: Record<string, unknown>): void {
    const type = event.type;
    if (type === "system" && event.subtype === "init") {
      const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
      this.state.mcpServers = servers.map((s) => {
        const o = (s ?? {}) as { name?: unknown; status?: unknown };
        return `${String(o.name ?? "?")}: ${String(o.status ?? "?")}`;
      });
      this.note(
        `[init] MCP ${this.state.mcpServers.length ? this.state.mcpServers.join(", ") : "none"}`,
      );
      return;
    }
    if (type === "assistant" || type === "user") {
      const message = (event.message ?? {}) as { content?: unknown };
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const b of blocks) {
        const block = (b ?? {}) as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") {
          this.scanText(block.text);
          this.note(clip(block.text, 600));
        } else if (block.type === "tool_use") {
          this.note(`→ ${String(block.name ?? "tool")}`);
        } else if (block.type === "tool_result" && block.is_error) {
          this.note(`✗ tool error: ${clip(textOf(block.content))}`);
        }
      }
      return;
    }
    if (type === "result") {
      this.state.finished = true;
      this.state.isError = event.is_error === true || String(event.subtype ?? "") !== "success";
      const text = typeof event.result === "string" ? event.result : null;
      this.state.resultText =
        text ?? (this.state.isError ? String(event.subtype ?? "error") : null);
      if (text) this.scanText(text);
      const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
      for (const d of denials) {
        const o = (d ?? {}) as { tool_name?: unknown };
        const name = String(o.tool_name ?? "tool");
        if (!this.state.permissionDenials.includes(name)) this.state.permissionDenials.push(name);
      }
      if (this.state.permissionDenials.length)
        this.note(`[denied] ${this.state.permissionDenials.join(", ")}`);
      this.note(
        `[result] ${this.state.isError ? "error" : "success"}${text ? `: ${clip(text, 800)}` : ""}`,
      );
      return;
    }
  }

  private scanText(text: string): void {
    for (const raw of text.split(/\r?\n/)) {
      const m = MARKER.exec(raw);
      if (!m) continue;
      const [, kind, value] = m;
      if (kind === "JOB") {
        const id = value
          .trim()
          .split(/\s+/)[0]
          .replace(/[`"',;]+$/g, "");
        if (id && !this.state.externalJobIds.includes(id)) this.state.externalJobIds.push(id);
      } else if (kind === "FILE") {
        const rel = normaliseOutputPath(value, this.mediaRoot);
        if (rel && !this.state.outputPaths.includes(rel)) this.state.outputPaths.push(rel);
      } else if (kind === "CREDITS") {
        const n = num(value);
        if (n !== null) this.reportedCredits = n;
      } else if (kind === "BALANCE") {
        const n = num(value);
        if (n === null) continue;
        if (/after/i.test(value)) this.state.balanceAfter = n;
        else this.state.balanceBefore = n;
      }
      this.updateCredits();
    }
  }

  private updateCredits(): void {
    const { balanceBefore, balanceAfter } = this.state;
    if (this.reportedCredits !== null) this.state.creditsUsed = this.reportedCredits;
    else if (balanceBefore !== null && balanceAfter !== null)
      this.state.creditsUsed = Math.max(0, Math.round((balanceBefore - balanceAfter) * 100) / 100);
  }
}

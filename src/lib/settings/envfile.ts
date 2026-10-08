/**
 * Reading and rewriting the local `.env` file from the Settings page (local
 * mode, §1.27). Pure string functions so they are testable; the one place that
 * touches the disk is `settings.actions.ts`.
 *
 * Rules: existing lines and comments are kept in place; a key that is set
 * replaces its line; a new key is appended; an empty value removes the line.
 */

const LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;

export function readEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Quotes a value when dotenv would otherwise misread it (spaces, #, quotes). */
export function formatValue(value: string): string {
  if (/^[A-Za-z0-9_\-.:/@+=,?&%]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function writeEnv(text: string, updates: Record<string, string | null>): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const next: string[] = [];
  for (const line of lines) {
    const m = LINE.exec(line);
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1]);
      pending.delete(m[1]);
      if (v === null || v === "") continue;
      next.push(`${m[1]}=${formatValue(v as string)}`);
    } else next.push(line);
  }
  while (next.length && next[next.length - 1] === "") next.pop();
  for (const [k, v] of pending) if (v !== null && v !== "") next.push(`${k}=${formatValue(v)}`);
  return next.join(eol) + eol;
}

/** "AIza…Xy9Q" — enough to recognise a key without showing it. */
export function maskValue(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

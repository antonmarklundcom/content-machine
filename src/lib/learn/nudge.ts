/**
 * The weekly "implement one thing" nudge (docs/PLAN-build4.md §1.13), ported
 * from aiinsights' `nudge.ts`: one unimplemented learn item a week, no model
 * call. Committed-but-not-done comes first (that is the promise being asked
 * about); otherwise the oldest item not nudged recently, so the offer rotates.
 *
 * Pure and dependency-free: the Cloudflare Worker's cron bundles this file
 * (like src/lib/clips/telegram.ts), and `npm run learn:nudge` uses it too.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** An item nudged this recently is skipped while anything else is left. */
export const RENUDGE_AFTER_MS = 14 * DAY_MS;

/**
 * Nudge cooldowns are stored as rows in `leases` named `learn-nudged:<clip
 * id>` that expire `RENUDGE_AFTER_MS` after the nudge (no `last_nudged_at`
 * column on clips yet). Both senders write it with this statement.
 */
export const NUDGE_MARK_PREFIX = "learn-nudged:";
export const NUDGE_MARK_SQL = `insert into leases (name, holder, expires_at)
values (?, 'learn-nudge', date_add(now(), interval 14 day))
on duplicate key update holder = values(holder), expires_at = values(expires_at)`;

/**
 * One read of every open learn item with its last-nudged time (the lease's
 * expiry minus the cooldown). Also the Worker's single select.
 */
export const NUDGE_CANDIDATES_SQL = `select c.id, c.url, c.title, c.summary, c.how_to_start,
  c.learn_category, c.committed_at, c.saved_at,
  date_sub(l.expires_at, interval 14 day) as last_nudged_at
from clips c
left join leases l on l.name = concat('${NUDGE_MARK_PREFIX}', c.id)
where c.purpose = 'learn' and c.implemented_at is null
order by c.saved_at asc, c.id asc
limit 500`;

export type NudgeItem = {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
  howToStart: string[] | null;
  learnCategory: string | null;
  implementedAt?: Date | null;
  committedAt: Date | null;
  savedAt: Date;
  lastNudgedAt: Date | null;
};

const time = (d: Date | null | undefined) => (d ? d.getTime() : null);

/**
 * The one item to nudge about, or null when nothing is open.
 *
 * 1. Committed and not done: the most recent commitment.
 * 2. Else summarised items not nudged within `RENUDGE_AFTER_MS`, oldest saved first.
 * 3. Else (everything nudged lately) the least recently nudged.
 * Unsummarised items count only when no summarised one is open.
 */
export function pickNudge<T extends NudgeItem>(items: readonly T[], now: Date): T | null {
  const open = items.filter((i) => !i.implementedAt);
  if (open.length === 0) return null;

  const committed = open
    .filter((i) => i.committedAt)
    .sort((a, b) => time(b.committedAt)! - time(a.committedAt)! || a.id - b.id);
  if (committed[0]) return committed[0];

  const summarised = open.filter((i) => i.learnCategory);
  const pool = summarised.length ? summarised : open;
  const t = now.getTime();
  const fresh = pool
    .filter((i) => {
      const last = time(i.lastNudgedAt);
      return last === null || t - last >= RENUDGE_AFTER_MS;
    })
    .sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime() || a.id - b.id);
  if (fresh[0]) return fresh[0];

  return (
    [...pool].sort(
      (a, b) => (time(a.lastNudgedAt) ?? 0) - (time(b.lastNudgedAt) ?? 0) || a.id - b.id,
    )[0] ?? null
  );
}

/** Escapes the three characters Telegram's HTML parse mode cares about. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The pseudo-URL a linkless capture gets is not worth showing. */
function shownUrl(url: string): string | null {
  return /^https:\/\/telegram\.invalid\//.test(url) ? null : url;
}

/**
 * The Telegram message (HTML parse mode). `appUrl`, when set, adds a link to
 * the /learn page. Stays well under Telegram's 4096-character limit.
 */
export function formatNudgeMessage(item: NudgeItem, appUrl?: string | null): string {
  const title = item.title?.trim() || shownUrl(item.url) || `Learn item ${item.id}`;
  const lines = [
    item.committedAt
      ? "<b>You committed to this one. Did it happen?</b>"
      : "<b>This week: implement one thing</b>",
    "",
    `<b>${escapeHtml(title.slice(0, 200))}</b>`,
  ];
  if (item.learnCategory) lines.push(`<i>${escapeHtml(item.learnCategory)}</i>`);
  if (item.summary?.trim()) lines.push("", escapeHtml(item.summary.trim().slice(0, 1200)));
  const steps = (item.howToStart ?? []).filter((s) => s.trim()).slice(0, 6);
  if (steps.length) {
    lines.push("", "<b>How to start:</b>");
    steps.forEach((s, i) => lines.push(`${i + 1}. ${escapeHtml(s.trim().slice(0, 300))}`));
  }
  const url = shownUrl(item.url);
  if (url) lines.push("", escapeHtml(url));
  lines.push(
    "",
    item.committedAt
      ? `Reply /done ${item.id} when it is done.`
      : `Reply /commit ${item.id} to take it on this week, /done ${item.id} if it is already done.`,
  );
  const base = appUrl?.trim().replace(/\/+$/, "");
  if (base && /^https?:\/\//.test(base)) lines.push(`${escapeHtml(base)}/learn`);
  return lines.join("\n");
}

/** A raw MariaDB/bridge row from `NUDGE_CANDIDATES_SQL` → `NudgeItem`. */
export function nudgeItemFromRow(row: Record<string, unknown>): NudgeItem {
  const date = (v: unknown): Date | null => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    const text = String(v);
    const zoned = /(z|[+-]\d\d(:?\d\d)?)$/i.test(text);
    return new Date(zoned ? text : `${text.replace(" ", "T")}Z`);
  };
  const rawSteps = row.how_to_start;
  const steps: unknown = typeof rawSteps === "string" ? JSON.parse(rawSteps) : rawSteps;
  return {
    id: Number(row.id),
    url: String(row.url),
    title: (row.title as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    howToStart: Array.isArray(steps) ? steps.map(String) : null,
    learnCategory: (row.learn_category as string | null) ?? null,
    committedAt: date(row.committed_at),
    savedAt: date(row.saved_at) ?? new Date(0),
    lastNudgedAt: date(row.last_nudged_at),
  };
}

/** `/done 12`, `/commit 12` (also `/done@MyBot 12`) → the command, or null. */
export function parseLearnCommand(
  text: string | null | undefined,
): { command: "done" | "commit"; id: number } | null {
  const m = /^\/(done|commit)(?:@\w+)?\s+#?(\d{1,9})\s*$/i.exec((text ?? "").trim());
  return m ? { command: m[1]!.toLowerCase() as "done" | "commit", id: Number(m[2]) } : null;
}

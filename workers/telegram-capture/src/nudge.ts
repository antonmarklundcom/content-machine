/**
 * The weekly learn nudge as a Cron Trigger (build 4 §3.E, docs/LEARN.md):
 * one select, `pickNudge`, one Bot API `sendMessage`, one insert recording
 * the nudge. Same pick and same message as `npm run learn:nudge` — both
 * import src/lib/learn/nudge.ts. Use one sender or the other, not both.
 *
 * Free of Cloudflare and database driver types, like handler.ts, so the unit tests run
 * it with a mocked `query` and `fetch`.
 */

import {
  formatNudgeMessage,
  NUDGE_CANDIDATES_SQL,
  NUDGE_MARK_PREFIX,
  NUDGE_MARK_SQL,
  nudgeItemFromRow,
  pickNudge,
} from "../../../src/lib/learn/nudge";
import type { Env, Query } from "./handler";

export type NudgeResult =
  | { status: "sent"; clipId: number }
  | { status: "nothing" }
  | { status: "failed"; error: string };

function firstChat(env: Env): string | null {
  return (
    (env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .find(Boolean) ?? null
  );
}

export async function runScheduledNudge(
  env: Env,
  query: Query,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<NudgeResult> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = firstChat(env);
  if (!token) return { status: "failed", error: "TELEGRAM_BOT_TOKEN is not set" };
  if (!chatId) return { status: "failed", error: "TELEGRAM_ALLOWED_CHAT_IDS is empty" };

  const item = pickNudge((await query(NUDGE_CANDIDATES_SQL, [])).map(nudgeItemFromRow), now);
  if (!item) return { status: "nothing" };

  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatNudgeMessage(item, env.APP_URL),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !body?.ok) {
    // Never log the URL: it carries the bot token.
    return { status: "failed", error: `sendMessage failed: ${body?.description ?? res.status}` };
  }
  await query(NUDGE_MARK_SQL, [`${NUDGE_MARK_PREFIX}${item.id}`]);
  return { status: "sent", clipId: item.id };
}

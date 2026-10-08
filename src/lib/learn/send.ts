import { queryRows, upsertReturning } from "@/db/mutations";
import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/db";

import { leases } from "@/db/schema";

import {
  formatNudgeMessage,
  NUDGE_CANDIDATES_SQL,
  NUDGE_MARK_PREFIX,
  nudgeItemFromRow,
  pickNudge,
  type NudgeItem,
} from "./nudge";

/**
 * The PC side of the weekly nudge (`npm run learn:nudge`, for Windows Task
 * Scheduler). The Worker's cron uses the authenticated MariaDB bridge; use
 * one or the other, not both (docs/LEARN.md).
 */

function apiBase(): string {
  return (process.env.TELEGRAM_API_BASE?.trim() || "https://api.telegram.org").replace(/\/+$/, "");
}

/** The first chat id in `TELEGRAM_ALLOWED_CHAT_IDS`, or null. */
export function nudgeChatId(env: Record<string, string | undefined> = process.env): string | null {
  return (
    (env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .find(Boolean) ?? null
  );
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set." };
  try {
    const res = await fetch(`${apiBase()}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string };
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        error: `Telegram sendMessage failed: ${body?.description ?? res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    // Never echo the URL: it carries the bot token.
    return { ok: false, error: `Telegram sendMessage failed: ${(err as Error).name}` };
  }
}

export async function nudgeCandidates(): Promise<NudgeItem[]> {
  const result = await queryRows<Record<string, unknown>>(db, sql.raw(NUDGE_CANDIDATES_SQL));
  return result.map(nudgeItemFromRow);
}

/** Record the nudge, so the next pick rotates past it for 14 days. */
export async function markNudged(clipId: number): Promise<void> {
  await upsertReturning(
    db,
    leases,
    {
      name: `${NUDGE_MARK_PREFIX}${clipId}`,
      holder: "learn-nudge",
      expiresAt: sql`date_add(current_timestamp(3), interval 14 day)`,
    },
    {
      target: leases.name,
      set: {
        holder: "learn-nudge",
        expiresAt: sql`date_add(current_timestamp(3), interval 14 day)`,
      },
    },
  );
}

export type NudgeRun =
  | { status: "sent" | "dry-run"; item: NudgeItem; text: string }
  | { status: "nothing" }
  | { status: "failed"; error: string };

export async function runWeeklyNudge(
  options: { now?: Date; dryRun?: boolean; send?: typeof sendTelegramMessage } = {},
): Promise<NudgeRun> {
  const item = pickNudge(await nudgeCandidates(), options.now ?? new Date());
  if (!item) return { status: "nothing" };
  const text = formatNudgeMessage(item, process.env.APP_URL);
  if (options.dryRun) return { status: "dry-run", item, text };
  const chatId = nudgeChatId();
  if (!chatId) return { status: "failed", error: "TELEGRAM_ALLOWED_CHAT_IDS is not set." };
  const sent = await (options.send ?? sendTelegramMessage)(chatId, text);
  if (!sent.ok) return { status: "failed", error: sent.error };
  await markNudged(item.id);
  return { status: "sent", item, text };
}

/**
 * Telegram capture request handling, with database access injected through the
 * parameterized query seam. Production connects to MariaDB via mysql2 and
 * Cloudflare Hyperdrive; unit tests use an in-memory query fake.
 */

import { parseCaptureMessage, type CapturePurpose } from "../../../src/lib/clips/telegram";
import { CLIP_URL_LIMIT, platformForUrl } from "../../../src/lib/clips/url";
import { parseLearnCommand } from "../../../src/lib/learn/nudge";
import { secretsMatch } from "./secret";

export type Env = {
  HYPERDRIVE?: { host: string; user: string; password: string; database: string; port: number };
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Comma-separated chat ids. Empty or missing serves nobody. */
  TELEGRAM_ALLOWED_CHAT_IDS?: string;
  /** Optional JSON object, alias → brand id, e.g. `{"guia":"guide"}`. */
  TELEGRAM_BRAND_ALIASES?: string;
  /** Only the weekly learn nudge (the cron) needs it: the webhook answers in its response. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Optional: the app's public URL, for a /learn link in the nudge. */
  APP_URL?: string;
};

/** Parameterised SQL operation returning row data; mysql2 adapts packet results at its boundary. */
export type Query = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

type TelegramFile = { file_id: string; file_unique_id: string; mime_type?: string };
type TelegramMessage = {
  message_id: number;
  chat: { id: number | string };
  text?: string;
  caption?: string;
  photo?: TelegramFile[];
  video?: TelegramFile;
  document?: TelegramFile;
};
type TelegramUpdate = { update_id?: number; message?: TelegramMessage };

/** `clips.note` limit in saveClip(). */
const NOTE_LIMIT = 500;

const BRANDS_SQL = "select id from brands where active = true";

/**
 * The one write. Same semantics as saveClip(): insert, or on a re-save of the
 * same canonical URL keep the row and only replace the note — and keep the old
 * note when the new message has none. LAST_INSERT_ID exposes the conflict row;
 * the mysql2 adapter uses affectedRows to preserve the creation reply.
 */
export const SAVE_SQL = `insert into clips (url, platform, note, brand_id, purpose, tags, source, telegram_file_id)
values (?, ?, ?, ?, ?, ?, 'telegram', ?)
on duplicate key update id = last_insert_id(id), note = if(url = values(url), coalesce(values(note), clips.note), clips.note)`;

/**
 * `/done <id>` and `/commit <id>` from the weekly learn nudge (build 4 §3.E):
 * one UPDATE each, learn clips only. `/done` keeps an earlier implemented date.
 */
export const LEARN_DONE_SQL = `update clips set implemented_at = coalesce(implemented_at, current_timestamp(3))
where id = ? and purpose = 'learn'`;
export const LEARN_COMMIT_SQL = `update clips set committed_at = current_timestamp(3)
where id = ? and purpose = 'learn'`;

const PURPOSE_LABEL: Record<CapturePurpose, string> = {
  inspo: "inspo",
  competitor: "competitor",
  fact_check: "fact-check",
  own: "own",
  learn: "learn",
  other: "no purpose",
};

let brandCache: { at: number; ids: string[] } | null = null;
const BRAND_TTL_MS = 5 * 60 * 1000;

/** Tests reset the per-isolate brand cache between cases. */
export function resetBrandCache(): void {
  brandCache = null;
}

async function brandAliases(env: Env, query: Query): Promise<Record<string, string>> {
  if (!brandCache || Date.now() - brandCache.at > BRAND_TTL_MS) {
    const rows = await query(BRANDS_SQL, []);
    brandCache = { at: Date.now(), ids: rows.map((r) => String(r.id)) };
  }
  const aliases: Record<string, string> = {};
  for (const id of brandCache.ids) aliases[id] = id;
  if (env.TELEGRAM_BRAND_ALIASES) {
    try {
      const extra = JSON.parse(env.TELEGRAM_BRAND_ALIASES) as Record<string, unknown>;
      for (const [alias, id] of Object.entries(extra)) {
        // An alias to a brand that is gone or inactive is dropped, not guessed.
        if (typeof id === "string" && brandCache.ids.includes(id)) aliases[alias] = id;
      }
    } catch {
      // A malformed alias var must not stop captures; brand ids still work.
    }
  }
  return aliases;
}

function allowedChats(env: Env): Set<string> {
  return new Set(
    (env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** A photo or video sent to the bot; S17 downloads it later by `file_id`. */
function attachedFile(message: TelegramMessage): TelegramFile | null {
  if (message.video) return message.video;
  const doc = message.document;
  if (doc && /^(image|video)\//.test(doc.mime_type ?? "")) return doc;
  // Telegram sends every size of a compressed photo; the last is the largest.
  if (message.photo?.length) return message.photo[message.photo.length - 1]!;
  return null;
}

function reply(message: TelegramMessage, text: string): Response {
  // Answering inside the webhook response saves a second request and needs no
  // bot token in the Worker.
  return Response.json({
    method: "sendMessage",
    chat_id: message.chat.id,
    text,
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
  });
}

const ok = () => new Response(null, { status: 200 });

export async function handleWebhook(request: Request, env: Env, query: Query): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("TELEGRAM_WEBHOOK_SECRET is not set", { status: 500 });
  }
  const presented = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!(await secretsMatch(presented, env.TELEGRAM_WEBHOOK_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const message = update.message;
  // Edits, channel posts, callbacks: nothing to save. Answer 200 so Telegram stops retrying.
  if (!message?.chat) return ok();
  // Strangers are ignored silently — no reply tells them the bot does anything.
  if (!allowedChats(env).has(String(message.chat.id))) return ok();

  const text = message.text ?? message.caption ?? "";
  const file = attachedFile(message);

  const command = file ? null : parseLearnCommand(text);
  if (command) {
    try {
      const sqlText = command.command === "done" ? LEARN_DONE_SQL : LEARN_COMMIT_SQL;
      const row = (await query(sqlText, [command.id]))[0];
      if (!row) return reply(message, `No learn item ${command.id}.`);
      const name = row.title ? `"${String(row.title).slice(0, 120)}"` : `learn item ${command.id}`;
      return reply(
        message,
        command.command === "done"
          ? `Marked ${name} implemented ✓`
          : `Committed to ${name} this week. Reply /done ${command.id} when it is done.`,
      );
    } catch (err) {
      console.error("telegram-capture: learn command failed", err);
      return reply(message, "Not saved: the database did not answer. Send it again in a minute.");
    }
  }

  try {
    const parsed = parseCaptureMessage(text, await brandAliases(env, query));
    // A file with no link still needs a unique http(s) URL (clips.url is the
    // dedupe key): a reserved `.invalid` host keyed by Telegram's stable file id.
    const url =
      parsed.url ??
      (file ? `https://telegram.invalid/file/${encodeURIComponent(file.file_unique_id)}` : null);

    if (!url) {
      return reply(message, "No link found. Send a link, or a photo/video as a file.");
    }
    if (url.length > CLIP_URL_LIMIT) {
      return reply(message, `Not saved: the link is longer than ${CLIP_URL_LIMIT} characters.`);
    }

    const note = parsed.note ? parsed.note.slice(0, NOTE_LIMIT) : null;
    const purpose: CapturePurpose = parsed.purpose ?? "other";
    const rows = await query(SAVE_SQL, [
      url,
      platformForUrl(url),
      note,
      parsed.brandId,
      purpose,
      JSON.stringify(parsed.tags),
      file?.file_id ?? null,
    ]);

    const created = rows[0]?.created === true;
    if (!created) return reply(message, "Already saved, note updated");
    return reply(message, `Saved ✓ (${parsed.brandId ?? "no brand"}, ${PURPOSE_LABEL[purpose]})`);
  } catch (err) {
    console.error("telegram-capture: save failed", err);
    return reply(message, "Not saved: the database did not answer. Send it again in a minute.");
  }
}

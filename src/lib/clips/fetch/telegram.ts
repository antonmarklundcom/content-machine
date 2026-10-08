import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Download a photo/video that was sent to the capture bot *as a file*
 * (PLAN.md §1.43): the Worker stored its `file_id`; this turns it into bytes
 * with the Bot API's `getFile` + file endpoint. The Bot API serves files up to
 * 20 MB, which is why the Worker only stores the id.
 *
 * `TELEGRAM_API_BASE` exists for tests (a local stub); production leaves it unset.
 */

export const TELEGRAM_MAX_BYTES = 20 * 1024 * 1024;

export type TelegramResult = { ok: true; file: string } | { ok: false; error: string };

function apiBase(): string {
  return (process.env.TELEGRAM_API_BASE?.trim() || "https://api.telegram.org").replace(/\/+$/, "");
}

export async function downloadTelegramFile(fileId: string, dir: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      error: "TELEGRAM_BOT_TOKEN is not set, so the Telegram file cannot be downloaded.",
    };
  }
  try {
    const meta = await fetch(
      `${apiBase()}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const body = (await meta.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { file_path?: string; file_size?: number };
    } | null;
    const filePath = body?.result?.file_path;
    if (!meta.ok || !body?.ok || !filePath) {
      return { ok: false, error: `Telegram getFile failed: ${body?.description ?? meta.status}` };
    }
    if ((body.result?.file_size ?? 0) > TELEGRAM_MAX_BYTES) {
      return { ok: false, error: "The Telegram file is over the Bot API's 20 MB limit." };
    }
    const res = await fetch(`${apiBase()}/file/bot${token}/${filePath}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { ok: false, error: `Telegram file download failed: HTTP ${res.status}` };
    const data = Buffer.from(await res.arrayBuffer());
    const ext =
      path
        .extname(filePath)
        .replace(/[^.a-z0-9]/gi, "")
        .toLowerCase() || ".bin";
    const file = path.join(dir, `media${ext}`);
    await writeFile(file, data);
    return { ok: true, file };
  } catch (err) {
    // Never echo the URL: it carries the bot token.
    return { ok: false, error: `Telegram download failed: ${(err as Error).name}` };
  }
}

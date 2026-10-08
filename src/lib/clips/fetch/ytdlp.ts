import { execFile } from "node:child_process";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { binaryAvailable, binaryPath, MISSING_MESSAGE } from "./binaries";

/**
 * Download one reel/post with yt-dlp (PLAN.md §1.44, §6.S17) into a folder
 * under `captures/<clip-id>/`, as `media.<ext>` plus yt-dlp's `media.info.json`
 * (the caption lives there, and helps the transcript read the screen text).
 *
 * Bounded three ways: `--max-filesize` (default 200 MB, checked again after),
 * a wall-clock timeout, and `--no-playlist` so a carousel URL or a profile URL
 * never turns into a hundred downloads. Instagram often wants a login:
 * `YTDLP_COOKIES_FILE` (a Netscape cookies.txt exported from the browser) is
 * passed when set.
 */

export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type YtDlpResult =
  | { ok: true; file: string; caption: string | null; title: string | null; author: string | null }
  | { ok: false; error: string };

export function maxBytes(): number {
  const mb = Number(process.env.CLIP_FETCH_MAX_MB);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : DEFAULT_MAX_BYTES;
}

export function timeoutMs(): number {
  const sec = Number(process.env.YTDLP_TIMEOUT_SEC);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : DEFAULT_TIMEOUT_MS;
}

/** The downloaded file: `media.<ext>`, never a `.part`, the info json or a leftover stream. */
async function findMedia(dir: string): Promise<string | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const media = names.filter(
    (n) =>
      n.startsWith("media.") &&
      !n.endsWith(".part") &&
      !n.endsWith(".json") &&
      !n.endsWith(".ytdl") &&
      !/\.f\d+\./.test(n) &&
      !n.includes(".small."),
  );
  return media.length ? path.join(dir, media.sort()[0]) : null;
}

async function readInfo(
  dir: string,
): Promise<{ caption: string | null; title: string | null; author: string | null }> {
  try {
    const info = JSON.parse(await readFile(path.join(dir, "media.info.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      caption: str(info.description),
      title: str(info.title),
      author: str(info.uploader) ?? str(info.channel),
    };
  } catch {
    return { caption: null, title: null, author: null };
  }
}

export async function downloadWithYtDlp(
  url: string,
  dir: string,
  options: { ffmpeg: boolean },
): Promise<YtDlpResult> {
  if (!(await binaryAvailable("yt-dlp"))) return { ok: false, error: MISSING_MESSAGE["yt-dlp"] };

  const limit = maxBytes();
  const args = [
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--restrict-filenames",
    "--write-info-json",
    "--max-filesize",
    String(limit),
    "-o",
    path.join(dir, "media.%(ext)s"),
    // Without ffmpeg only a single-file format can be taken (no stream merge).
    "-f",
    options.ffmpeg ? "bv*[height<=1080]+ba/b[height<=1080]/b" : "b[ext=mp4]/b",
  ];
  if (options.ffmpeg) {
    args.push("--merge-output-format", "mp4");
    const ffmpeg = process.env.FFMPEG_PATH?.trim();
    if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);
  }
  const cookies = process.env.YTDLP_COOKIES_FILE?.trim();
  if (cookies) args.push("--cookies", cookies);
  args.push("--", url);

  const run = await new Promise<{ error: Error | null; stderr: string; killed: boolean }>(
    (resolve) => {
      execFile(
        binaryPath("yt-dlp"),
        args,
        { timeout: timeoutMs(), windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (error, _stdout, stderr) =>
          resolve({
            error,
            stderr: String(stderr ?? ""),
            killed: Boolean(error && (error as { killed?: boolean }).killed),
          }),
      );
    },
  );
  if (run.killed) {
    return { ok: false, error: `yt-dlp timed out after ${Math.round(timeoutMs() / 1000)} s.` };
  }
  if (run.error) {
    const line = run.stderr
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("ERROR"))
      .pop();
    return { ok: false, error: `yt-dlp failed: ${line ?? run.error.message}`.slice(0, 900) };
  }

  const file = await findMedia(dir);
  if (!file) {
    // yt-dlp exits 0 when --max-filesize skips the download.
    return {
      ok: false,
      error: `yt-dlp downloaded nothing (larger than ${Math.round(limit / 1024 / 1024)} MB, or no media at that URL).`,
    };
  }
  const { size } = await stat(file);
  if (size > limit) {
    await rm(file, { force: true });
    return {
      ok: false,
      error: `The download is ${Math.round(size / 1024 / 1024)} MB, over the ${Math.round(limit / 1024 / 1024)} MB cap.`,
    };
  }
  return { ok: true, file, ...(await readInfo(dir)) };
}

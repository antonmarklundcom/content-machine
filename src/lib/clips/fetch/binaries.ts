import { execFile } from "node:child_process";

/**
 * The two external programs clip fetch needs (PLAN.md §6.S17): `yt-dlp` to
 * download a reel, `ffmpeg` to merge its streams and to shrink a file past the
 * transcription limit. Neither is an npm dependency. Each is looked up once per
 * process — `YTDLP_PATH` / `FFMPEG_PATH`, else the bare name on PATH — and a
 * missing one fails the clip with a message that says what to install, rather
 * than a spawn error.
 */

export type Binary = "yt-dlp" | "ffmpeg";

const ENV: Record<Binary, string> = { "yt-dlp": "YTDLP_PATH", ffmpeg: "FFMPEG_PATH" };

export const MISSING_MESSAGE: Record<Binary, string> = {
  "yt-dlp":
    "yt-dlp is not installed. Install it (winget install yt-dlp, or pip install yt-dlp) or set YTDLP_PATH.",
  ffmpeg: "ffmpeg is not installed. Install it (winget install ffmpeg) or set FFMPEG_PATH.",
};

const cache = new Map<string, Promise<boolean>>();

export function binaryPath(name: Binary): string {
  return process.env[ENV[name]]?.trim() || name;
}

/** Whether `name` runs here. Cached per resolved path, so changing the env var re-checks. */
export function binaryAvailable(name: Binary): Promise<boolean> {
  const bin = binaryPath(name);
  const flag = name === "ffmpeg" ? "-version" : "--version";
  let found = cache.get(bin);
  if (!found) {
    found = new Promise((resolve) => {
      execFile(bin, [flag], { timeout: 10_000, windowsHide: true }, (error) => resolve(!error));
    });
    cache.set(bin, found);
  }
  return found;
}

/** Forget what was detected (tests swap binaries between cases). */
export function resetBinaries(): void {
  cache.clear();
}

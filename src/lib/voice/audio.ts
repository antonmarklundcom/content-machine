import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

import { binaryAvailable, binaryPath, MISSING_MESSAGE } from "@/lib/clips/fetch/binaries";
import { probeDuration } from "@/lib/media/probe";

import { parseWav } from "./wav";

/**
 * The ffmpeg half of the voice pipeline (docs/VOICE.md): WAV → MP3 playback
 * copies, any uploaded audio → a WAV master, and the measured duration.
 * ffmpeg comes from `FFMPEG_PATH` or PATH (the clip-fetch lookup).
 */

export const MASTER_SAMPLE_RATE = 48_000;

export class FfmpegMissingError extends Error {
  constructor() {
    super(MISSING_MESSAGE.ffmpeg);
    this.name = "FfmpegMissingError";
  }
}

export function ffmpegAvailable(): Promise<boolean> {
  return binaryAvailable("ffmpeg");
}

function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath("ffmpeg"),
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `ffmpeg failed: ${String(stderr || error.message)
                .trim()
                .slice(0, 500)}`,
            ),
          );
        else resolve();
      },
    );
  });
}

/** MP3 playback copy (mono, 128 kbit/s). */
export async function encodeMp3(input: string, output: string): Promise<void> {
  if (!(await ffmpegAvailable())) throw new FfmpegMissingError();
  await runFfmpeg([
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    output,
  ]);
}

/** Any ffmpeg-readable audio (or a video's audio track) → WAV 48 kHz mono s16. */
export async function normaliseToWav(input: string, output: string): Promise<void> {
  if (!(await ffmpegAvailable())) throw new FfmpegMissingError();
  await runFfmpeg([
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(MASTER_SAMPLE_RATE),
    "-c:a",
    "pcm_s16le",
    output,
  ]);
}

/** Measured length: ffprobe, else the WAV header; null when neither can tell. */
export async function measureDurationMs(file: string): Promise<number | null> {
  const seconds = await probeDuration(file);
  if (seconds !== null) return Math.round(seconds * 1000);
  try {
    const info = parseWav(await readFile(file));
    return info ? info.durationMs : null;
  } catch {
    return null;
  }
}

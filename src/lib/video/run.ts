import { execFile, spawn } from "node:child_process";

import { binaryPath } from "@/lib/clips/fetch/binaries";

import { probeDurationArgs } from "./ffmpeg-args";

/**
 * The ffmpeg/ffprobe seam: `FFMPEG_PATH` / `FFPROBE_PATH`, else the bare
 * names on PATH (the same lookup clip fetch and the media library use).
 */

export function ffmpegBin(): string {
  return binaryPath("ffmpeg");
}

export function ffprobeBin(): string {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

/** Runs ffmpeg with `args` in `cwd`; rejects with the tail of stderr. */
export function runFfmpeg(args: string[], cwd: string, timeoutMs = 60 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { cwd, windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new FfmpegError(
          `ffmpeg could not start (${err.message}). Install ffmpeg or set FFMPEG_PATH.`,
          "",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        const tail = stderr.trim().split(/\r?\n/).slice(-4).join(" | ");
        reject(new FfmpegError(`ffmpeg exited with ${code}: ${tail || "no output"}`, stderr));
      }
    });
  });
}

function capture(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** Whether ffmpeg and ffprobe both run here. */
export async function renderToolsAvailable(): Promise<boolean> {
  try {
    await Promise.all([
      capture(ffmpegBin(), ["-hide_banner", "-version"], 10_000),
      capture(ffprobeBin(), ["-hide_banner", "-version"], 10_000),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Whether this ffmpeg has the libass `subtitles` filter (needed to burn captions). */
export async function hasSubtitlesFilter(): Promise<boolean> {
  try {
    const out = await capture(ffmpegBin(), ["-hide_banner", "-filters"], 10_000);
    return /^\s*\S+\s+subtitles\s/m.test(out);
  } catch {
    return false;
  }
}

/** Container duration in ms, via ffprobe; throws when it cannot be read. */
export async function probeDurationMs(file: string): Promise<number> {
  const out = await capture(ffprobeBin(), probeDurationArgs(file), 60_000);
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read the duration of ${file}`);
  return Math.round(seconds * 1000);
}

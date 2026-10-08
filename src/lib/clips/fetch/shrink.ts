import { execFile } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";

import { binaryAvailable, binaryPath, MISSING_MESSAGE } from "./binaries";

/**
 * Transcription sends the file inline, up to `TRANSCRIBE_MAX_INLINE_BYTES`
 * (O11 known issue: no Files API). A longer reel is re-encoded small — 480p,
 * low bitrate, mono audio — into `.media.small.mp4` (a dot-name, so `media:scan` skips it) beside the original. Only
 * the transcript reads that copy; the registered asset stays the original.
 */

export type ShrinkResult = { ok: true; file: string } | { ok: false; error: string };

export async function shrinkForTranscript(file: string, limitBytes: number): Promise<ShrinkResult> {
  const { size } = await stat(file);
  if (size <= limitBytes) return { ok: true, file };
  if (!(await binaryAvailable("ffmpeg"))) {
    return {
      ok: false,
      error: `The file is ${Math.round(size / 1024 / 1024)} MB and must be shrunk to transcribe. ${MISSING_MESSAGE.ffmpeg}`,
    };
  }
  const out = path.join(path.dirname(file), ".media.small.mp4");
  await rm(out, { force: true });
  const error = await new Promise<Error | null>((resolve) => {
    execFile(
      binaryPath("ffmpeg"),
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        file,
        "-vf",
        "scale=-2:480",
        "-r",
        "24",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "34",
        "-c:a",
        "aac",
        "-b:a",
        "48k",
        "-ac",
        "1",
        "-movflags",
        "+faststart",
        out,
      ],
      { timeout: 10 * 60 * 1000, windowsHide: true },
      (err) => resolve(err),
    );
  });
  if (error)
    return { ok: false, error: `ffmpeg could not shrink the file: ${error.message}`.slice(0, 900) };
  const small = await stat(out).catch(() => null);
  if (!small || small.size > limitBytes) {
    return {
      ok: false,
      error: `Even shrunk, the file is over ${Math.round(limitBytes / 1024 / 1024)} MB; too long to transcribe inline.`,
    };
  }
  return { ok: true, file: out };
}

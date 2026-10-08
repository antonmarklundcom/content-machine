/**
 * The two ffmpeg jobs the story studio does itself (build 4 §3.C.5): join a
 * scene's lines with short gaps into one WAV master, and make its MP3
 * playback copy. Everything else (video) is phase B's renderer.
 */
import { execFile } from "node:child_process";

export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function ffprobeBin(): string {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

function run(bin: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(`${error.message}\n${String(stderr).slice(-600)}`))
          : resolve(String(stdout)),
    );
  });
}

let available: Promise<boolean> | undefined;

/** ffmpeg and ffprobe both run here (cached). */
export function ffmpegAvailable(): Promise<boolean> {
  available ??= Promise.all([
    run(ffmpegBin(), ["-version"], 10_000),
    run(ffprobeBin(), ["-version"], 10_000),
  ]).then(
    () => true,
    () => false,
  );
  return available;
}

/** Measured length in ms (ffprobe), never an estimate. */
export async function probeMs(file: string): Promise<number> {
  const out = await run(ffprobeBin(), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error(`ffprobe could not measure ${file}`);
  return Math.round(seconds * 1000);
}

export const SAMPLE_RATE = 48_000;

/**
 * `inputs[0]`, gap, `inputs[1]`, gap, … → one mono 48 kHz 16-bit WAV. No
 * time-stretching, no normalising: the takes are joined as recorded.
 */
export async function concatWithGaps(
  inputs: string[],
  gapMs: number,
  outWav: string,
): Promise<void> {
  if (!inputs.length) throw new Error("concatWithGaps: no inputs");
  const args: string[] = ["-y", "-v", "error"];
  for (const f of inputs) args.push("-i", f);
  const parts: string[] = [];
  const order: string[] = [];
  inputs.forEach((_, i) => {
    parts.push(
      `[${i}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`,
    );
    order.push(`[a${i}]`);
    if (i < inputs.length - 1 && gapMs > 0) {
      parts.push(
        `anullsrc=r=${SAMPLE_RATE}:cl=mono,atrim=duration=${(gapMs / 1000).toFixed(3)},aformat=sample_fmts=s16:channel_layouts=mono[g${i}]`,
      );
      order.push(`[g${i}]`);
    }
  });
  parts.push(`${order.join("")}concat=n=${order.length}:v=0:a=1[out]`);
  args.push("-filter_complex", parts.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", outWav);
  await run(ffmpegBin(), args);
}

/** WAV master → MP3 playback copy. */
export async function encodeMp3(inWav: string, outMp3: string): Promise<void> {
  await run(ffmpegBin(), [
    "-y",
    "-v",
    "error",
    "-i",
    inWav,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "4",
    outMp3,
  ]);
}

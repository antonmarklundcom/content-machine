import { execFile } from "node:child_process";

/**
 * Video and audio duration via `ffprobe`, which is optional (PLAN.md §5.O10):
 * detected once per process, and when it is not on PATH (or `FFPROBE_PATH`)
 * durations are simply left null.
 */

let available: Promise<boolean> | undefined;

function ffprobeBin(): string {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

function run(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ffprobeBin(), args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

/** Whether ffprobe can be run here. Cached; `resetFfprobe()` forgets it (tests). */
export function ffprobeAvailable(): Promise<boolean> {
  available ??= run(["-version"], 5_000).then(
    () => true,
    () => false,
  );
  return available;
}

export function resetFfprobe(): void {
  available = undefined;
}

/** Seconds, or null when ffprobe is missing or cannot read the file. */
export async function probeDuration(file: string): Promise<number | null> {
  if (!(await ffprobeAvailable())) return null;
  try {
    const out = await run(
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      30_000,
    );
    const seconds = Number.parseFloat(out.trim());
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  } catch {
    return null;
  }
}

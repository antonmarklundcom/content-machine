import { updateReturning } from "@/db/mutations";
import "server-only";
import { execFile } from "node:child_process";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { voiceProfiles } from "@/db/schema";
import { binaryPath } from "@/lib/clips/fetch/binaries";
import { VOICE_DIR } from "@/lib/storage/paths";
import { ffmpegAvailable, FfmpegMissingError } from "@/lib/voice/audio";

/**
 * Chatterbox reference samples (docs/CHATTERBOX.md): the ~10 s voice a
 * Chatterbox profile clones. Stored under `voice/_references/` (a `_` folder no
 * slug can produce), never registered as media assets — like consents, they are
 * a person's voice on file, not content.
 */

export const REFERENCE_DIR = `${VOICE_DIR}/_references`;
export const MAX_REFERENCE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const REFERENCE_SAMPLE_RATE = 24_000;
export const REFERENCE_MAX_SECONDS = 30;
export const REFERENCE_MIN_SECONDS = 3;

/** ffmpeg could not read the upload: the caller answers 415. */
export class UnreadableAudioError extends Error {
  constructor(detail: string) {
    super(`That file is not audio ffmpeg can read. ${detail}`.trim().slice(0, 400));
    this.name = "UnreadableAudioError";
  }
}

/**
 * Any audio (a phone memo, the browser's webm/ogg) → WAV 24 kHz mono s16,
 * leading silence trimmed, cut to the first 30 s.
 */
export async function normaliseReference(input: string, output: string): Promise<void> {
  if (!(await ffmpegAvailable())) throw new FfmpegMissingError();
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vn",
    "-af",
    "silenceremove=start_periods=1:start_threshold=-50dB",
    "-ac",
    "1",
    "-ar",
    String(REFERENCE_SAMPLE_RATE),
    "-t",
    String(REFERENCE_MAX_SECONDS),
    "-c:a",
    "pcm_s16le",
    output,
  ];
  await new Promise<void>((resolve, reject) => {
    execFile(
      binaryPath("ffmpeg"),
      args,
      { timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) =>
        error ? reject(new UnreadableAudioError(String(stderr || "").trim())) : resolve(),
    );
  });
}

/**
 * Point the profile's `settings.chatterbox.referencePath` at `relPath`,
 * merging in SQL so every other settings key (and the other chatterbox
 * fields) stays as it is; `mode` defaults to `local` when unset.
 */
export async function setChatterboxReference(id: number, relPath: string): Promise<boolean> {
  const rows = await updateReturning(
    db,
    voiceProfiles,
    {
      settings: sql`json_set(coalesce(${voiceProfiles.settings}, json_object()),
        '$.chatterbox', json_merge_patch(json_object('mode', 'local'), coalesce(json_extract(${voiceProfiles.settings}, '$.chatterbox'), json_object()), json_object('referencePath', ${relPath})))`,
      updatedAt: new Date(),
    },
    eq(voiceProfiles.id, id),
    { id: voiceProfiles.id },
  );
  return rows.length > 0;
}

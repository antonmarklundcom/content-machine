/**
 * What a story studio action or route hands back to the UI: a dictionary key
 * (shown in the viewer's language) plus English detail lines.
 */
import type { TranslationKey } from "@/lib/i18n";
import { NarrationRefusedError } from "@/lib/voice/contract";
import { CuentosRootError } from "./book";
import { StoryError } from "./studio";

export type StoryActionResult =
  | { ok: true; message: TranslationKey; vars?: Record<string, string | number>; lines?: string[] }
  | { ok: false; error: TranslationKey; detail?: string; lines?: string[] };

const ERROR_KEYS: Record<StoryError["code"], TranslationKey> = {
  not_found: "stories.error.notFound",
  bad_language: "stories.error.language",
  text_refused: "stories.error.textRefused",
  upload_only: "stories.error.uploadOnly",
  no_profile: "stories.error.noProfile",
  not_ready: "stories.error.notReady",
  ffmpeg_missing: "stories.error.ffmpeg",
  cuentos_missing: "stories.error.cuentos",
  file_missing: "stories.error.file",
};

/** An expected refusal as a result; anything else as `failed` with its message. */
export function storyErrorResult(err: unknown): StoryActionResult {
  if (err instanceof StoryError) {
    return {
      ok: false,
      error: ERROR_KEYS[err.code],
      detail: err.message,
      lines: err.missing?.map((m) => `${m.sceneRef}: ${m.reasons.join("; ")}`),
    };
  }
  if (err instanceof NarrationRefusedError)
    return { ok: false, error: "stories.error.refused", detail: err.message };
  if (err instanceof CuentosRootError)
    return { ok: false, error: "stories.error.cuentos", detail: err.message };
  return {
    ok: false,
    error: "stories.error.failed",
    detail: (err instanceof Error ? err.message : String(err)).slice(0, 600),
  };
}

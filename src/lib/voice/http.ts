import "server-only";
import { NextResponse } from "next/server";

import { SpendCapExceededError } from "@/lib/spend";
import { VOICE_DIR } from "@/lib/storage/paths";

import { NarrationRefusedError } from "./contract";
import { FfmpegMissingError } from "./audio";
import { InvalidVoiceInputError } from "./store";

/** Signed consents live apart from takes: `voice/_consent/` (a `_` folder no slug can produce). */
export const CONSENT_DIR = `${VOICE_DIR}/_consent`;

/** Largest upload the voice routes accept (a recording or a consent scan). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** One error shape for the voice routes: `{ error, reason? }` with a status that says whose fault it is. */
export function voiceErrorResponse(error: unknown): NextResponse {
  if (error instanceof NarrationRefusedError) {
    return NextResponse.json({ error: error.message, reason: error.reason }, { status: 422 });
  }
  if (error instanceof InvalidVoiceInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof SpendCapExceededError) {
    return NextResponse.json({ error: error.message, reason: "spend_cap" }, { status: 402 });
  }
  if (error instanceof FfmpegMissingError) {
    return NextResponse.json({ error: error.message, reason: "ffmpeg_missing" }, { status: 503 });
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message.slice(0, 500) }, { status: 500 });
}

export function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

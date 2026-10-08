import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import { ownerOnly } from "@/lib/media/serve";
import {
  importRecording,
  NARRATION_OWNER_KINDS,
  VOICE_LANGUAGES,
  type NarrationOwnerKind,
  type VoiceLanguage,
} from "@/lib/voice";
import { MAX_UPLOAD_BYTES, str, voiceErrorResponse } from "@/lib/voice/http";

export const maxDuration = 300;

/**
 * POST /api/voice/recordings — an uploaded recording becomes a `manual` take
 * (docs/VOICE.md; how Guaraní is voiced, PLAN-build4 §1.4). Multipart:
 * `file`, `ownerKind`, `ownerRef`, `sceneRef?`, `language`, `speaker?`,
 * `text`, `voiceProfileId?`. Owner-only. 201 `{ narrationId, durationMs,
 * playbackPath }`; 422 `{ error, reason }` for a refusal (consent, language).
 */
export async function POST(request: Request): Promise<Response> {
  const denied = await ownerOnly();
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send multipart/form-data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach the recording as `file`." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "The recording is larger than 100 MB." }, { status: 413 });
  }
  const ownerKind = str(form, "ownerKind") as NarrationOwnerKind;
  const language = str(form, "language") as VoiceLanguage;
  if (!NARRATION_OWNER_KINDS.includes(ownerKind)) {
    return NextResponse.json({ error: "Unknown ownerKind." }, { status: 400 });
  }
  if (!VOICE_LANGUAGES.includes(language)) {
    return NextResponse.json({ error: "Unknown language." }, { status: 400 });
  }
  const profileRaw = str(form, "voiceProfileId");
  const voiceProfileId = profileRaw ? Number(profileRaw) : null;
  if (voiceProfileId !== null && !(Number.isInteger(voiceProfileId) && voiceProfileId > 0)) {
    return NextResponse.json({ error: "voiceProfileId is not an id." }, { status: 400 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "voice-upload-"));
  const ext = (path.extname(file.name || "").replace(/[^.a-zA-Z0-9]/g, "") || ".audio").slice(0, 8);
  const filePath = path.join(dir, `upload${ext}`);
  try {
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
    const result = await importRecording({
      ownerKind,
      ownerRef: str(form, "ownerRef"),
      sceneRef: str(form, "sceneRef") || null,
      language,
      speaker: str(form, "speaker") || null,
      text: str(form, "text"),
      voiceProfileId,
      filePath,
    });
    return NextResponse.json(
      {
        narrationId: result.narrationId,
        durationMs: result.durationMs,
        playbackPath: result.playbackPath,
      },
      { status: 201 },
    );
  } catch (error) {
    return voiceErrorResponse(error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

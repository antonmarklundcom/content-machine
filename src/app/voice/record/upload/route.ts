import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import { ownerOnly } from "@/lib/media/serve";
import { MAX_UPLOAD_BYTES, str, voiceErrorResponse } from "@/lib/voice/http";
import { parseSourceKey } from "@/lib/voice/record/lines";
import { RecordError, saveRecordedLine } from "@/lib/voice/record/save";

export const maxDuration = 300;

/**
 * POST /voice/record/upload — the recording studio's Keep (build 5 §3.B,
 * docs/RECORDING.md). Multipart: `file` (the browser's WebM/Ogg/MP4 take),
 * `source` (`story:<slug>:<lang>` | `script:<id>`), `slot`, `voiceProfileId`,
 * `text` (what the narrator read; must still be the line's text), `autoSelect`
 * (`1` = select the take when the slot has none). The line is rebuilt on the
 * server and saved with `importRecording`. Owner-only. 201 `{ narrationId,
 * durationMs, selected, notes }`; 422 `{ error, reason }` for a refusal
 * (consent, language, locked line, changed text); 404 for an unknown line.
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
    return NextResponse.json({ error: "Attach the take as `file`." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "The take is larger than 100 MB." }, { status: 413 });
  }
  const source = parseSourceKey(str(form, "source"));
  if (!source) return NextResponse.json({ error: "Unknown source." }, { status: 400 });
  const slot = str(form, "slot");
  if (!slot) return NextResponse.json({ error: "Which line? Send `slot`." }, { status: 400 });
  const profileRaw = str(form, "voiceProfileId");
  const voiceProfileId = /^\d{1,9}$/.test(profileRaw) ? Number(profileRaw) : null;
  // The text is compared verbatim, so it is not trimmed.
  const rawText = form.get("text");

  const dir = await mkdtemp(path.join(tmpdir(), "voice-record-"));
  const ext = (path.extname(file.name || "").replace(/[^.a-zA-Z0-9]/g, "") || ".webm").slice(0, 8);
  const filePath = path.join(dir, `take${ext}`);
  try {
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
    const result = await saveRecordedLine({
      source,
      slot,
      voiceProfileId,
      filePath,
      expectedText: typeof rawText === "string" ? rawText : null,
      autoSelect: str(form, "autoSelect") === "1",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RecordError) {
      return NextResponse.json(
        { error: error.message, reason: error.reason },
        { status: error.reason === "not_found" ? 404 : 422 },
      );
    }
    return voiceErrorResponse(error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

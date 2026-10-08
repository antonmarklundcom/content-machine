import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import { notFound, ownerOnly, serveMediaFile } from "@/lib/media/serve";
import { isOnlineDeploy, PcOnlyError } from "@/lib/pc-only";
import { mediaRoot, mediaRootMessage, mediaRootStatus } from "@/lib/storage/root";
import { voiceErrorResponse } from "@/lib/voice/http";
import { assertConsent } from "@/lib/voice/refusals";
import { getProfile } from "@/lib/voice/store";
import { parseWav } from "@/lib/voice/wav";

import {
  MAX_REFERENCE_UPLOAD_BYTES,
  normaliseReference,
  REFERENCE_DIR,
  REFERENCE_MAX_SECONDS,
  REFERENCE_MIN_SECONDS,
  setChatterboxReference,
  UnreadableAudioError,
} from "../reference";

export const maxDuration = 120;

type Context = { params: Promise<{ profileId: string }> };

async function profileFrom(context: Context) {
  const { profileId } = await context.params;
  if (!/^\d{1,9}$/.test(profileId)) return null;
  return getProfile(Number(profileId));
}

/**
 * POST /api/voice/reference/<profile id> — the Chatterbox reference sample
 * (docs/CHATTERBOX.md). Multipart `file` (any audio, ≤ 20 MB). Owner-only.
 * Refused (422 `consent_missing`) unless the profile's consent is `signed`
 * (and current) or `not_needed`. Normalised to WAV 24 kHz mono, trimmed to
 * ≤ 30 s, stored under `voice/_references/<key>-<stamp>.wav`; the path goes
 * into `settings.chatterbox.referencePath`. Older samples are kept on disk.
 * 201 `{ path, durationMs }`.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  const denied = await ownerOnly();
  if (denied) return denied;
  if (isOnlineDeploy()) {
    return NextResponse.json(
      { error: new PcOnlyError("Uploading a Chatterbox reference sample").message },
      { status: 503 },
    );
  }

  const profile = await profileFrom(context);
  if (!profile) return NextResponse.json({ error: "No such voice profile." }, { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send multipart/form-data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach the voice sample as `file`." }, { status: 400 });
  }
  if (file.size > MAX_REFERENCE_UPLOAD_BYTES) {
    return NextResponse.json({ error: "The sample is larger than 20 MB." }, { status: 413 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "voice-reference-"));
  try {
    // Cloning a person's voice needs their consent (PLAN-build5 §1.4).
    assertConsent(profile);
    const root = mediaRoot();
    const status = await mediaRootStatus(root);
    if (status !== "ok") {
      return NextResponse.json(
        { error: mediaRootMessage(status), code: "missing" },
        { status: 503 },
      );
    }
    const ext = (path.extname(file.name || "").replace(/[^.a-zA-Z0-9]/g, "") || ".audio").slice(
      0,
      8,
    );
    const input = path.join(dir, `upload${ext}`);
    const output = path.join(dir, "reference.wav");
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    try {
      await normaliseReference(input, output);
    } catch (error) {
      if (error instanceof UnreadableAudioError) {
        return NextResponse.json({ error: error.message }, { status: 415 });
      }
      throw error;
    }
    const wav = await readFile(output);
    const info = parseWav(wav);
    if (!info || info.durationMs < REFERENCE_MIN_SECONDS * 1000) {
      const secs = info ? (info.durationMs / 1000).toFixed(1) : "0";
      return NextResponse.json(
        {
          error: `The sample is ${secs} s of sound; record at least ${REFERENCE_MIN_SECONDS} s (about 10 s is ideal, ${REFERENCE_MAX_SECONDS} s at most).`,
        },
        { status: 400 },
      );
    }
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 18);
    const rel = `${REFERENCE_DIR}/${profile.key}-${stamp}.wav`;
    await mkdir(path.join(root, ...REFERENCE_DIR.split("/")), { recursive: true });
    await writeFile(path.join(root, ...rel.split("/")), wav, { flag: "wx" });
    await setChatterboxReference(profile.id, rel);
    return NextResponse.json({ path: rel, durationMs: info.durationMs }, { status: 201 });
  } catch (error) {
    return voiceErrorResponse(error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** GET /api/voice/reference/<profile id> — the current reference sample (WAV). Owner-only; 404 when none. */
export async function GET(request: Request, context: Context): Promise<Response> {
  const denied = await ownerOnly();
  if (denied) return denied;
  const profile = await profileFrom(context);
  const rel = profile?.settings?.chatterbox?.referencePath;
  if (!rel) return notFound();
  return serveMediaFile(request, rel, "audio/wav");
}

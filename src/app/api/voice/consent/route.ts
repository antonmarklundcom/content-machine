import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { ownerOnly } from "@/lib/media/serve";
import { sniffMime } from "@/lib/media/sniff";
import { mediaRoot, mediaRootMessage, mediaRootStatus } from "@/lib/storage/root";
import { CONSENT_DIR, MAX_UPLOAD_BYTES, str, voiceErrorResponse } from "@/lib/voice/http";
import { getProfile, setConsentDocument } from "@/lib/voice/store";

/**
 * POST /api/voice/consent — store the signed consent for a voice profile
 * (PLAN-build4 §1.5) under MEDIA_ROOT `voice/_consent/`. Multipart:
 * `profileId`, `file` (PDF or image). Owner-only. Not registered as a media
 * asset on purpose: it is a contract, not content. 201 `{ path }`.
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
  const id = Number(str(form, "profileId"));
  const profile = Number.isInteger(id) && id > 0 ? await getProfile(id) : null;
  if (!profile) return NextResponse.json({ error: "No such voice profile." }, { status: 404 });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach the signed consent as `file`." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "The file is larger than 100 MB." }, { status: 413 });
  }
  const data = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(data.subarray(0, 64));
  if (!sniffed || (sniffed.kind !== "document" && sniffed.kind !== "image")) {
    return NextResponse.json({ error: "The consent must be a PDF or an image." }, { status: 415 });
  }

  try {
    const root = mediaRoot();
    const status = await mediaRootStatus(root);
    if (status !== "ok") {
      return NextResponse.json(
        { error: mediaRootMessage(status), code: "missing" },
        { status: 503 },
      );
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
    const rel = `${CONSENT_DIR}/${profile.key}-${stamp}.${sniffed.ext}`;
    await mkdir(path.join(root, ...CONSENT_DIR.split("/")), { recursive: true });
    await writeFile(path.join(root, ...rel.split("/")), data, { flag: "wx" });
    await setConsentDocument(profile.id, rel);
    return NextResponse.json({ path: rel }, { status: 201 });
  } catch (error) {
    return voiceErrorResponse(error);
  }
}

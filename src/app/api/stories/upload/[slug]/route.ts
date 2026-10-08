import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import { ownerOnly } from "@/lib/media/serve";
import { isSafeSlug } from "@/lib/stories/book";
import { storyErrorResult } from "@/lib/stories/result";
import { uploadSceneRecording } from "@/lib/stories/studio";

/** One recording, at most. */
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

/**
 * POST /api/stories/upload/<slug> — multipart `file`, `sceneRef`, `lang`,
 * `slot`, optional `profile`: an uploaded recording becomes a `manual` take
 * for one line (build 4 §1.4 — how Guaraní is voiced). A route rather than a
 * server action because recordings are larger than the server-action body
 * limit. Owner-only. Answers a `StoryActionResult` as JSON.
 */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const denied = await ownerOnly();
  if (denied) return denied;
  const { slug } = await context.params;
  if (!isSafeSlug(slug))
    return NextResponse.json({ ok: false, error: "stories.error.notFound" }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "stories.upload.noFile" }, { status: 400 });
  }
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "stories.upload.noFile" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "stories.upload.tooBig" }, { status: 413 });
  }
  const profile = /^\d{1,9}$/.test(text("profile")) ? Number(text("profile")) : null;

  const dir = await mkdtemp(path.join(tmpdir(), "story-upload-"));
  try {
    const ext =
      (file.name.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const tmp = path.join(dir, `upload.${ext}`);
    await writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    const r = await uploadSceneRecording({
      slug,
      sceneRef: text("sceneRef"),
      lang: text("lang"),
      slot: text("slot") || text("sceneRef"),
      filePath: tmp,
      voiceProfileId: profile || null,
    });
    return NextResponse.json({
      ok: true,
      message: "stories.upload.done",
      vars: { seconds: Math.round(r.result.durationMs / 100) / 10 },
      lines: r.notes,
    });
  } catch (err) {
    return NextResponse.json(storyErrorResult(err), { status: 422 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

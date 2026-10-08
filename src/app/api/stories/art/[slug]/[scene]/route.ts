import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { notFound, ownerOnly } from "@/lib/media/serve";
import { cuentosRoot, isSafeSlug, resolveCuentosFile } from "@/lib/stories/book";
import { getScene, getStory } from "@/lib/stories/data";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/**
 * GET /api/stories/art/<slug>/<scene>[?size=thumb] — a scene's selected art
 * from CUENTOS_ROOT (build 4 §3.C.8). Owner-only: unpublished book art.
 *
 * The path is never taken from the URL: it is the scene's `art_path` from the
 * last import, and it must still resolve to a regular file inside
 * `CUENTOS_ROOT/books/<slug>/` (no `..`, no absolute path, no symlink out).
 * Anything else is the same 404 as an unknown scene.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; scene: string }> },
) {
  const denied = await ownerOnly();
  if (denied) return denied;
  const { slug, scene: sceneRef } = await context.params;
  if (!isSafeSlug(slug) || !sceneRef || sceneRef.length > 64) return notFound();

  const root = cuentosRoot();
  if (!root)
    return NextResponse.json(
      { error: "CUENTOS_ROOT is not set.", code: "missing" },
      { status: 503 },
    );
  const story = await getStory(slug);
  const scene = story ? await getScene(story.id, sceneRef) : null;
  const rel = scene?.artPath;
  if (!rel || !rel.startsWith(`books/${slug}/`)) return notFound();
  const file = await resolveCuentosFile(root, rel);
  if (!file) return notFound();
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext];
  if (!type) return notFound();

  const headers = { "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" };
  if (new URL(request.url).searchParams.get("size") === "thumb") {
    const body = await sharp(file, { animated: false })
      .rotate()
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return new NextResponse(new Uint8Array(body), {
      headers: { ...headers, "content-type": "image/webp" },
    });
  }
  const body = await readFile(file);
  return new NextResponse(new Uint8Array(body), { headers: { ...headers, "content-type": type } });
}

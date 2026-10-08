import { getAsset } from "@/lib/bridge/assets";
import { assetOriginal } from "@/lib/media/originals";
import { mediaRootStatus, mediaRootMessage, splitRelative } from "@/lib/storage/root";
import { NextResponse } from "next/server";
import { authoringOnly, notFound, serveMediaFile } from "@/lib/media/serve";

/**
 * GET /api/media/asset/<id> — a media library file by asset id (PLAN.md
 * §5.O10.5). Authenticated authoring access; a 404 for an unknown id, an asset with no file on the
 * drive, or a path that no longer resolves inside `MEDIA_ROOT`; a 503 with
 * `code: "missing"` while the media drive is not connected.
 *
 * Build 2's `/api/media/<script id>/<…>` paths are a separate route and keep
 * working: a script id is a number, never the literal `asset`.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await authoringOnly();
  if (denied) return denied;

  const { id } = await context.params;
  if (!/^\d{1,9}$/.test(id)) return notFound();
  const asset = await getAsset(Number(id));
  if (!asset?.localPath) return notFound();
  if (!splitRelative(asset.localPath)) return notFound();
  const drive = await mediaRootStatus();
  if (drive === "missing")
    return NextResponse.json({ error: mediaRootMessage(drive), code: "missing" }, { status: 503 });
  const original = await assetOriginal(asset).catch(() => null);
  if (!original)
    return NextResponse.json({ error: "Original bytes changed or missing. Scan the library and restore/review this asset.", code: "identity_changed" }, { status: 409 });
  return serveMediaFile(request, original.rel, asset.mime);
}

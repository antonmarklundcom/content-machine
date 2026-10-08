import { getAsset } from "@/lib/bridge/assets";
import { authoringOnly, notFound, serveMediaFile } from "@/lib/media/serve";

/**
 * GET /api/media/asset/<id>/thumb — the asset's webp thumbnail (PLAN.md
 * §5.O10.5), made by `registerFile` under `_thumbs/`. Same rules as the file
 * route; a 404 when the asset has no thumbnail (videos, audio, documents).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await authoringOnly();
  if (denied) return denied;

  const { id } = await context.params;
  if (!/^\d{1,9}$/.test(id)) return notFound();
  const asset = await getAsset(Number(id));
  if (!asset?.thumbPath) return notFound();
  return serveMediaFile(request, asset.thumbPath, "image/webp");
}

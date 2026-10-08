import { authoringOnly, notFound, serveMediaFile } from "@/lib/media/serve";
import { isSafeSegment, mediaContentType } from "@/lib/studio/media";

/**
 * GET /api/media/<script id>/<…> — a file Claude Code saved under `media/`
 * (build 2b, idea 10), so the studio can show generated thumbnails.
 *
 * Authenticated authoring access: these are unpublished assets. Only files under the media root
 * are served — `..`, absolute or drive paths, separators inside a segment and
 * symlinks that resolve outside the root are all a 404, the same answer as a
 * missing file, so the route says nothing about what exists elsewhere. Only
 * images, videos and manifests; anything else is a 404 too.
 *
 * [O10] Served through the media library's `serveMediaFile`, so the rules are
 * shared with `/api/media/asset/<id>`, videos can seek, and an unplugged drive
 * is a 503 `missing` rather than a 404.
 */
export async function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const denied = await authoringOnly();
  if (denied) return denied;

  const segments = (await context.params).path ?? [];
  if (!segments.length || !segments.every(isSafeSegment)) return notFound();
  const type = mediaContentType(segments[segments.length - 1]);
  if (!type) return notFound();
  return serveMediaFile(request, segments.join("/"), type);
}

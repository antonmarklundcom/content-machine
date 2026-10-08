import { open } from "node:fs/promises";

import { notFound, ownerOnly, serveMediaFile } from "@/lib/media/serve";
import { sniffMime } from "@/lib/media/sniff";
import { mediaRoot, resolveMediaFile, splitRelative } from "@/lib/storage/root";
import { getProfile } from "@/lib/voice/store";

/**
 * GET /api/voice/consent/<profile id> — the profile's signed consent
 * document. Owner-only; 404 when there is none or it left the media root.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await ownerOnly();
  if (denied) return denied;

  const { id } = await context.params;
  if (!/^\d{1,9}$/.test(id)) return notFound();
  const profile = await getProfile(Number(id));
  const rel = profile?.consentDocPath;
  if (!rel) return notFound();
  const segments = splitRelative(rel);
  const file = segments ? await resolveMediaFile(segments, mediaRoot()) : null;
  let mime = "application/octet-stream";
  if (file) {
    const handle = await open(file, "r");
    try {
      const buf = Buffer.alloc(64);
      const { bytesRead } = await handle.read(buf, 0, 64, 0);
      mime = sniffMime(buf.subarray(0, bytesRead))?.mime ?? mime;
    } finally {
      await handle.close();
    }
  }
  return serveMediaFile(request, rel, mime);
}

"use server";

/**
 * "Use this one" on `/studio/[id]/thumbnails` (build 2b, idea 10). Spends
 * nothing, but the images are the owner's (the media route is owner-only), so
 * picking one is too.
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/session";
import { setScriptThumbnail } from "@/lib/bridge/thumbnails";
import { listThumbnails, thumbnailDir } from "@/lib/studio/media";

/**
 * Set `scripts.thumbnail_file` to `media/<id>/thumbnails/<name>`, or clear it
 * with null. Only a file that is in that folder right now can be picked — the
 * name is checked against the listing, never joined into a path as given.
 * Returns the stored path.
 */
export async function chooseThumbnail(
  scriptId: number,
  name: string | null,
): Promise<string | null> {
  await requireOwner("choose a thumbnail");
  if (!Number.isInteger(scriptId) || scriptId <= 0) throw new Error("That is not a script id.");
  let file: string | null = null;
  if (name !== null) {
    if (typeof name !== "string" || !(await listThumbnails(scriptId)).includes(name)) {
      throw new Error("That thumbnail is not in this script's thumbnails folder.");
    }
    file = `${thumbnailDir(scriptId)}/${name}`;
  }
  const row = await setScriptThumbnail(scriptId, file);
  if (!row) throw new Error("That script no longer exists.");
  revalidatePath(`/studio/${scriptId}`);
  revalidatePath(`/studio/${scriptId}/thumbnails`);
  return row.thumbnailFile;
}

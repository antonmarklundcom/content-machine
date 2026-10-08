"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { upsertChannelSource, upsertPlaylistSource } from "@/lib/ingest/store";
import { YouTubeDataClient } from "@/lib/youtube/data-api";
import { parseYouTubeUrl } from "@/lib/youtube/url";

export type AddSourceResult = { ok: true } | { ok: false; error: string };

/**
 * Tracks a channel or playlist without walking its uploads — that is the
 * poller's job (scripts/poll-sources.ts) and the ingest form's job (PR-12),
 * not this form's. Adding a source here only needs the sources row.
 */
export async function addSource(
  _prev: AddSourceResult | null,
  formData: FormData,
): Promise<AddSourceResult> {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { ok: false, error: "Paste a channel or playlist URL." };

  const ref = parseYouTubeUrl(url);
  if (!ref) return { ok: false, error: "Not a recognisable YouTube URL." };
  if (ref.kind === "video") {
    return { ok: false, error: "That is a single video — add it from Ingest instead." };
  }

  try {
    const client = new YouTubeDataClient();
    const resolved = await client.resolve(ref);
    if (!resolved) return { ok: false, error: "YouTube returned no such channel or playlist." };

    if (resolved.kind === "channel") await upsertChannelSource(resolved.channel);
    else if (resolved.kind === "playlist") await upsertPlaylistSource(resolved.playlist);
    else return { ok: false, error: "That is a single video — add it from Ingest instead." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add source." };
  }

  revalidatePath("/youtube/sources");
  return { ok: true };
}

/**
 * Rename a tracked source.
 *
 * The title comes from YouTube at ingest time and is overwritten by
 * upsertChannelSource/upsertPlaylistSource on the next poll, so this is a
 * local label that survives until then — worth having for channels whose own
 * title is unhelpful, not a permanent rename.
 */
export async function renameSource(id: number, formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await db
    .update(sources)
    .set({ title: title.slice(0, 512) })
    .where(eq(sources.id, id));
  revalidatePath("/youtube/sources");
}

/** Pause = active=false, never delete. Preserves last_polled_at as the poll cursor. */
export async function setSourceActive(id: number, active: boolean): Promise<void> {
  await db.update(sources).set({ active }).where(eq(sources.id, id));
  revalidatePath("/youtube/sources");
}

/**
 * Removing a source does not remove its videos: the analyses are paid for and
 * the digest is the product. The videos keep their now-dangling source_id,
 * which is harmless — no foreign keys are declared (schema.ts) and nothing
 * reads source_id except the per-source count.
 */
export async function removeSource(id: number): Promise<void> {
  // Adding and pausing sources are free and stay open to an employee; removing
  // one throws away the poll cursor and the tracking itself, so it does not.
  await requireOwner("remove a source");
  await db.delete(sources).where(eq(sources.id, id));
  revalidatePath("/youtube/sources");
}

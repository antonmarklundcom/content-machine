"use server";

/** The ideas workflow's writes (PLAN.md §6.S6). */

import { revalidatePath } from "next/cache";
import { deleteRejectedIdea, getIdea, isIdeaStatus, updateIdea, type Idea } from "@/lib/bridge";
import { requireOwner, requireUser } from "@/lib/auth/session";
import type { IdeaStatus } from "@/db/schema";

// A "use server" file may export only async functions, so the errors here are
// plain Errors; their messages are what the UI shows.

function assertId(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new Error("That is not an idea id.");
}

function revalidateFor(idea: Pick<Idea, "brandId">) {
  revalidatePath(`/brand/${idea.brandId}`);
}

/**
 * Move an idea between statuses. Any signed-in user (PLAN.md §1.20: reading
 * and editing ideas is open); `posted` stamps `posted_at` via `updateIdea`,
 * the same rule `PATCH /api/ideas/[id]` applies.
 */
export async function setIdeaStatus(id: number, status: IdeaStatus): Promise<Idea> {
  await requireUser();
  assertId(id);
  // A server action is a public endpoint: the status is checked, not trusted.
  if (!isIdeaStatus(status)) throw new Error(`Unknown status "${String(status)}".`);
  const row = await updateIdea(id, { status });
  if (!row) throw new Error("That idea no longer exists.");
  revalidateFor(row);
  return row;
}

export type IdeaEdits = { title?: string; angle?: string; draftCopy?: string };

/** Save edits to the title, angle and caption. Any signed-in user. */
export async function saveIdeaEdits(id: number, edits: IdeaEdits): Promise<Idea> {
  await requireUser();
  assertId(id);
  const update: IdeaEdits = {};
  for (const key of ["title", "angle", "draftCopy"] as const) {
    const value = edits[key];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new Error(`${key} must be text.`);
    // title and angle are NOT NULL and render as headings; a blank one reads
    // as a broken card, so it is refused rather than saved.
    if (key !== "draftCopy" && !value.trim()) throw new Error(`${key} cannot be empty.`);
    update[key] = key === "draftCopy" ? value : value.trim();
  }
  const row = await updateIdea(id, update);
  if (!row) throw new Error("That idea no longer exists.");
  revalidateFor(row);
  return row;
}

/**
 * Delete a rejected idea. Owner only: an idea is paid-for generation output,
 * and destroying paid work is the owner's call (PR-24). Only `rejected` —
 * anything else has to be rejected first, so a stray click cannot remove an
 * approved or posted idea.
 */
export async function deleteIdea(id: number): Promise<void> {
  await requireOwner("delete ideas");
  assertId(id);
  const idea = await getIdea(id);
  if (!idea) throw new Error("That idea no longer exists.");
  if (!(await deleteRejectedIdea(id))) {
    throw new Error("Only a rejected idea can be deleted — reject it first.");
  }
  revalidateFor(idea);
}

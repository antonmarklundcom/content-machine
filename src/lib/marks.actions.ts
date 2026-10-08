"use server";
import { upsertReturning } from "@/db/mutations";

/** [PR-37] Marking one content unit of an analysis as interesting. */

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { videoUnitMarks } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { isUnitType, type UnitType } from "@/lib/listen/units";
import { truncateUnitText } from "@/lib/marks";

export type UnitMarkInput = {
  videoId: number;
  unitType: UnitType;
  unitIndex: number;
  /** The unit as it currently reads. Stored as a snapshot — see schema.ts. */
  unitText: string;
};

/**
 * requireUser, not requireOwner (PR-24): the permission boundary is spend, and
 * marking a passage costs nothing. An employee reading the corpus keeps their
 * own marks, on the same argument PR-25 made for read state.
 */
async function assertMarkable(input: UnitMarkInput): Promise<number> {
  const user = await requireUser();
  // A server action is a public endpoint, so the shape is checked here rather
  // than trusted from the caller: unitType lands in an enum column and a bad
  // value would be a database error rather than a rejection.
  if (!Number.isInteger(input.videoId) || input.videoId <= 0) {
    throw new Error("A mark needs a video.");
  }
  if (!isUnitType(input.unitType) || !Number.isInteger(input.unitIndex) || input.unitIndex < 0) {
    throw new Error("A mark needs a content unit to point at.");
  }
  return user.id;
}

function revalidateFor(videoId: number) {
  revalidatePath(`/youtube/video/${videoId}`);
  revalidatePath("/youtube/marks");
  // The feed's "Marked" filter counts videos, so the first and last mark on a
  // video change what it lists.
  revalidatePath("/youtube");
}

/**
 * Star a unit. Idempotent — pressing it twice is not an error, and the text is
 * refreshed so a mark made before a re-analysis picks up the current wording
 * when it is marked again.
 */
export async function markUnit(input: UnitMarkInput): Promise<void> {
  const userId = await assertMarkable(input);
  const unitText = truncateUnitText(input.unitText);
  await upsertReturning(
    db,
    videoUnitMarks,
    {
      videoId: input.videoId,
      userId,
      unitType: input.unitType,
      unitIndex: input.unitIndex,
      unitText,
    },
    {
      target: [
        videoUnitMarks.videoId,
        videoUnitMarks.userId,
        videoUnitMarks.unitType,
        videoUnitMarks.unitIndex,
      ],
      set: { unitText },
    },
  );
  revalidateFor(input.videoId);
}

export async function unmarkUnit(input: UnitMarkInput): Promise<void> {
  const userId = await assertMarkable(input);
  await db
    .delete(videoUnitMarks)
    .where(
      and(
        eq(videoUnitMarks.videoId, input.videoId),
        eq(videoUnitMarks.userId, userId),
        eq(videoUnitMarks.unitType, input.unitType),
        eq(videoUnitMarks.unitIndex, input.unitIndex),
      ),
    );
  revalidateFor(input.videoId);
}

/**
 * One entry point for the star buttons, which are toggles.
 *
 * `marked` is what the caller currently believes, so the action does the
 * opposite. Deriving it here with a SELECT first would be a race the UI cannot
 * lose anyway — nobody double-clicks their own star from two tabs — and would
 * make every toggle two round trips.
 */
export async function toggleUnitMark(input: UnitMarkInput, marked: boolean): Promise<void> {
  if (marked) await unmarkUnit(input);
  else await markUnit(input);
}

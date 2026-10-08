import { POST_STATUSES, type PostStatus } from "@/db/schema";

/**
 * Which status a post may move to from which (PLAN.md §5.O11.2). Pure, so the
 * table is unit-tested and the UI (S15) can grey out the moves it refuses.
 *
 * - `idea` → `drafting` once a body exists; `drafting` ↔ `ready` while it is
 *   worked on.
 * - `ready` → `scheduled` needs a `scheduled_for`; `ready`/`scheduled` →
 *   `published` is the manual post pack's "mark posted" (§1.49).
 * - `publishing` and `failed` belong to O13's publisher; a failed post can be
 *   retried, rescheduled or sent back to `ready`.
 * - Anything but `publishing` can be archived; an archived post comes back as
 *   a draft.
 */
export const POST_TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  idea: ["drafting", "archived"],
  drafting: ["idea", "ready", "archived"],
  ready: ["drafting", "scheduled", "publishing", "published", "archived"],
  scheduled: ["ready", "drafting", "publishing", "published", "archived"],
  publishing: ["published", "failed"],
  published: ["archived"],
  failed: ["ready", "scheduled", "publishing", "published", "archived"],
  archived: ["drafting"],
};

export function isPostStatus(value: unknown): value is PostStatus {
  return typeof value === "string" && (POST_STATUSES as readonly string[]).includes(value);
}

export type TransitionCheck = { ok: true } | { ok: false; error: string };

/**
 * Whether `from` → `to` is legal for a post in this state. Staying put is
 * always fine (a PATCH that re-sends the status is not an error).
 */
export function checkTransition(
  from: PostStatus,
  to: PostStatus,
  post: { hasBody: boolean; scheduledFor: Date | null },
): TransitionCheck {
  if (from === to) return { ok: true };
  if (!POST_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      error: `A ${from} post cannot become ${to}; from ${from} it can become ${POST_TRANSITIONS[from].join(", ")}.`,
    };
  }
  if (!post.hasBody && ["ready", "scheduled", "publishing", "published"].includes(to)) {
    return { ok: false, error: `A post needs a draft before it can be ${to}.` };
  }
  if (to === "scheduled" && !post.scheduledFor) {
    return { ok: false, error: "Set a date and time (scheduledFor) before scheduling the post." };
  }
  return { ok: true };
}

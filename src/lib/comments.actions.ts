"use server";

/**
 * `/comments` from the UI (build 4 §3.G). Drafting spends, so it is owner
 * only; editing, approving and marking are free for any signed-in user.
 * Nothing here posts a reply — "Approve" and "Mark replied" only change the
 * row; the person copies the text and replies on Instagram (PLAN-build4 §1.11).
 */

import { revalidatePath } from "next/cache";

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner, requireUser } from "@/lib/auth/session";
import {
  CommentDraftError,
  draftComment,
  draftComments,
  patchComment,
  type CommentPatch,
} from "@/lib/comments/draft";
import { newCommentIds } from "@/lib/comments/sync";
import { formatUsd, SpendCapExceededError } from "@/lib/spend";

export type CommentActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function refusal(error: unknown): { ok: false; error: string } {
  if (
    error instanceof CommentDraftError ||
    error instanceof SpendCapExceededError ||
    error instanceof ForbiddenError
  ) {
    return { ok: false, error: error.message };
  }
  throw error;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Draft (or re-draft) one comment's reply. */
export async function draftCommentAction(
  id: number,
): Promise<CommentActionResult<{ draft: string; needsHuman: boolean; cost: string }>> {
  try {
    await requireOwner("draft a comment reply");
    if (!isId(id)) return { ok: false, error: "That is not a comment id." };
    const out = await draftComment(id);
    revalidatePath("/comments");
    return {
      ok: true,
      draft: out.row.draft ?? "",
      needsHuman: out.needsHuman,
      cost: formatUsd(out.costUsd),
    };
  } catch (error) {
    return refusal(error);
  }
}

/** "Draft all new": every `new` comment of the given accounts (all when empty), up to 50. */
export async function draftAllNewAction(
  accountIds: number[],
): Promise<
  CommentActionResult<{ drafted: number; needsHuman: number; cost: string; errors: string[] }>
> {
  try {
    await requireOwner("draft comment replies");
    const ids = await newCommentIds(Array.isArray(accountIds) ? accountIds.filter(isId) : []);
    const r = await draftComments(ids);
    revalidatePath("/comments");
    return {
      ok: true,
      drafted: r.drafted,
      needsHuman: r.needsHuman,
      cost: formatUsd(r.costUsd),
      errors: r.errors,
    };
  } catch (error) {
    revalidatePath("/comments");
    return refusal(error);
  }
}

const KINDS = ["edit", "approve", "replied", "dismissed", "reopen"] as const;

/** Edit the draft, approve it, or mark the comment replied / dismissed / reopened. */
export async function patchCommentAction(
  id: number,
  kind: (typeof KINDS)[number],
  draft?: string,
): Promise<CommentActionResult<{ status: string; draft: string }>> {
  try {
    await requireUser();
    if (!isId(id)) return { ok: false, error: "That is not a comment id." };
    if (!KINDS.includes(kind)) return { ok: false, error: "Unknown change." };
    if (draft !== undefined && typeof draft !== "string") {
      return { ok: false, error: "The reply must be text." };
    }
    const patch: CommentPatch =
      kind === "edit"
        ? { kind, draft: draft ?? "" }
        : kind === "approve"
          ? { kind, draft }
          : { kind };
    const row = await patchComment(id, patch);
    revalidatePath("/comments");
    return { ok: true, status: row.status, draft: row.draft ?? "" };
  } catch (error) {
    return refusal(error);
  }
}

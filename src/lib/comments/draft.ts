import { updateReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { commentDrafts, posts, type CommentDraft } from "@/db/schema";
import { structuredJson } from "@/lib/ai";
import { costUsdAtRates, ideationRates } from "@/lib/analysis/pricing";
import { getAccount, getBrand, getBrandKit, getPost, listFamilyFacts } from "@/lib/bridge";
import { listFacts } from "@/lib/bridge/facts";
import { languageName, loadPostStyleGuide } from "@/lib/posts/guides";

import {
  buildReplyPrompt,
  NEEDS_HUMAN_PREFIX,
  parseReply,
  rankFacts,
  REPLY_JSON_SCHEMA,
  REPLY_SYSTEM,
  type ReplyFact,
  type ReplyInput,
} from "./prompt";

/**
 * Drafting a reply to one comment (build 4 §3.G). The draft is stored with
 * status `drafted`; a person edits, approves, copies and posts it by hand —
 * nothing here or anywhere else sends it (PLAN-build4 §1.11).
 */

/** The model seam: `structuredJson` from src/lib/ai.ts, or a test fake with its signature. */
export type ModelCall = typeof structuredJson;

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";
const REPLY_MAX_OUTPUT_TOKENS = 1_000;
/** Style guide + kit + facts + caption + comment, rounded up. */
const REPLY_PROMPT_TOKENS = 6_000;
const REPLY_THINKING_TOKENS = 1_500;

export function estimateReplyCostUsd(): number {
  return costUsdAtRates(ideationRates(MODEL), {
    inputTokens: REPLY_PROMPT_TOKENS,
    outputTokens: REPLY_MAX_OUTPUT_TOKENS + REPLY_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export class CommentDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentDraftError";
  }
}

/** Family facts in the account's language (or its base), then the brand's own sheet. */
async function factsFor(
  brandId: string,
  familyId: string | null,
  language: string,
): Promise<ReplyFact[]> {
  const base = language.split("-")[0];
  const family = familyId
    ? (await listFamilyFacts(familyId)).filter(
        (f) => f.language === language || f.language === base,
      )
    : [];
  const own = await listFacts(brandId);
  return [...family, ...own].map((f) => ({
    topic: f.topic,
    claim: f.claim,
    verified: f.verified,
    sourceUrl: f.sourceUrl,
  }));
}

/** Everything the prompt for one comment needs. */
export async function replyInput(row: CommentDraft): Promise<ReplyInput> {
  const account = await getAccount(row.accountId);
  if (!account) throw new CommentDraftError("The comment's account no longer exists.");
  const brand = await getBrand(account.brandId);
  if (!brand) throw new CommentDraftError(`Account @${account.handle} has no brand on file.`);
  const language = row.language || account.effectiveLanguage;
  const [kit, post, styleGuide] = await Promise.all([
    getBrandKit(brand.id),
    row.postId ? getPost(row.postId) : null,
    loadPostStyleGuide(language),
  ]);
  const caption = post?.caption ?? "";
  const facts = rankFacts(
    await factsFor(brand.id, account.familyId, language),
    row.commentText,
    caption,
  );
  return {
    brand: { name: brand.name, niche: brand.niche, voice: brand.voice },
    platform: account.platform,
    handle: account.handle,
    language,
    languageName: languageName(language),
    styleGuide,
    kit: kit ? { ctas: kit.ctas, dos: kit.dos, donts: kit.donts } : null,
    caption,
    comment: { author: row.author, text: row.commentText },
    facts,
    leadUrl: post?.leadUrl ?? null,
  };
}

export type DraftOutcome = { row: CommentDraft; costUsd: number; needsHuman: boolean };

/**
 * Draft (or re-draft) one comment. Refuses a comment already replied to or
 * dismissed. Spends: the caller gates who may run it.
 */
export async function draftComment(
  id: number,
  deps: { model?: ModelCall } = {},
): Promise<DraftOutcome> {
  const [row] = await db.select().from(commentDrafts).where(eq(commentDrafts.id, id)).limit(1);
  if (!row) throw new CommentDraftError("No such comment.");
  if (row.status === "replied" || row.status === "dismissed") {
    throw new CommentDraftError(`This comment is ${row.status}; there is nothing to draft.`);
  }
  const input = await replyInput(row);
  const model = deps.model ?? structuredJson;
  const { text, costUsd } = await model({
    system: REPLY_SYSTEM,
    prompt: buildReplyPrompt(input),
    schema: REPLY_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimateReplyCostUsd(),
    maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
    thinkingLow: true,
  });
  let draft;
  try {
    draft = parseReply(text, row.commentText);
  } catch (err) {
    await db
      .update(commentDrafts)
      .set({ error: (err as Error).message.slice(0, 1024), updatedAt: new Date() })
      .where(eq(commentDrafts.id, id));
    throw new CommentDraftError((err as Error).message);
  }
  const [updated] = await updateReturning(
    db,
    commentDrafts,
    {
      draft: draft.reply,
      language: input.language.slice(0, 8),
      status: "drafted",
      error: draft.needsHuman ? `${NEEDS_HUMAN_PREFIX}${draft.humanReason}`.slice(0, 1024) : null,
      updatedAt: new Date(),
    },
    eq(commentDrafts.id, id),
  );
  return { row: updated, costUsd, needsHuman: draft.needsHuman };
}

export type DraftAllReport = {
  drafted: number;
  needsHuman: number;
  costUsd: number;
  errors: string[];
};

/**
 * Draft every `new` comment given (oldest first), one call each. Stops at the
 * spend cap (the error propagates after the ones already drafted are kept);
 * any other failure is reported per comment and the rest carry on.
 */
export async function draftComments(
  ids: number[],
  deps: { model?: ModelCall } = {},
): Promise<DraftAllReport> {
  const report: DraftAllReport = { drafted: 0, needsHuman: 0, costUsd: 0, errors: [] };
  for (const id of ids) {
    try {
      const out = await draftComment(id, deps);
      report.drafted++;
      report.costUsd += out.costUsd;
      if (out.needsHuman) report.needsHuman++;
    } catch (err) {
      if (err instanceof CommentDraftError) {
        report.errors.push(`#${id}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// free edits — never sends anything
// ---------------------------------------------------------------------------

export type CommentPatch =
  | { kind: "edit"; draft: string }
  | { kind: "approve"; draft?: string }
  | { kind: "replied" }
  | { kind: "dismissed" }
  | { kind: "reopen" };

/** Apply a person's edit or status move. Returns the row, or throws `CommentDraftError`. */
export async function patchComment(id: number, patch: CommentPatch): Promise<CommentDraft> {
  const [row] = await db.select().from(commentDrafts).where(eq(commentDrafts.id, id)).limit(1);
  if (!row) throw new CommentDraftError("No such comment.");
  const set: Partial<typeof commentDrafts.$inferInsert> = { updatedAt: new Date() };
  switch (patch.kind) {
    case "edit": {
      const draft = patch.draft.trim();
      if (row.status === "replied" || row.status === "dismissed") {
        throw new CommentDraftError(`This comment is ${row.status}. Reopen it to edit.`);
      }
      set.draft = draft.slice(0, 2_000) || null;
      if (row.status === "new" && draft) set.status = "drafted";
      break;
    }
    case "approve": {
      const draft = (patch.draft ?? row.draft ?? "").trim();
      if (!draft) throw new CommentDraftError("Write or draft a reply before approving it.");
      if (row.status === "replied" || row.status === "dismissed") {
        throw new CommentDraftError(`This comment is ${row.status}. Reopen it first.`);
      }
      set.draft = draft.slice(0, 2_000);
      set.status = "approved";
      break;
    }
    case "replied":
      set.status = "replied";
      break;
    case "dismissed":
      set.status = "dismissed";
      break;
    case "reopen":
      set.status = row.draft ? "drafted" : "new";
      break;
  }
  const [updated] = await updateReturning(db, commentDrafts, set, eq(commentDrafts.id, id));
  return updated;
}

/** Status counts for the given accounts (all when none), zeros included. */
export async function commentCounts(
  accountIds: number[] | undefined,
): Promise<Record<CommentDraft["status"], number>> {
  const rows = await db
    .select({ status: commentDrafts.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(commentDrafts)
    .where(accountIds?.length ? inArray(commentDrafts.accountId, accountIds) : undefined)
    .groupBy(commentDrafts.status);
  const counts = { new: 0, drafted: 0, approved: 0, replied: 0, dismissed: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  return counts;
}

/** One status page of comments for the given accounts, newest comment first. */
export async function listComments(query: {
  accountIds?: number[];
  status: CommentDraft["status"];
  limit?: number;
}): Promise<CommentDraft[]> {
  return db
    .select()
    .from(commentDrafts)
    .where(
      and(
        eq(commentDrafts.status, query.status),
        query.accountIds?.length ? inArray(commentDrafts.accountId, query.accountIds) : undefined,
      ),
    )
    .orderBy(desc(commentDrafts.commentedAt), desc(commentDrafts.id))
    .limit(query.limit ?? 100);
}

/** Title and permalink of the posts comments sit under, for the list. */
export async function commentPosts(
  postIds: number[],
): Promise<Map<number, { title: string; permalink: string | null }>> {
  if (postIds.length === 0) return new Map();
  const rows = await db
    .select({ id: posts.id, title: posts.title, permalink: posts.permalink })
    .from(posts)
    .where(inArray(posts.id, postIds));
  return new Map(rows.map((r) => [r.id, { title: r.title, permalink: r.permalink }]));
}

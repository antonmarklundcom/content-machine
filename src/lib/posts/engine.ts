import { insertReturning, updateReturning } from "@/db/mutations";
import "server-only";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import {
  lessons,
  POST_FORMATS,
  posts,
  type Post,
  type PostFormat,
  type PostStatus,
} from "@/db/schema";
import {
  adaptPost,
  draftPost,
  PostGenerationError,
  type PostSeed,
  type PostTarget,
  type PromptLesson,
  type PromptPostFact,
} from "@/lib/ai";
import {
  getAccount,
  getBrand,
  getBrandKit,
  getIdea,
  getPost,
  listFamilyFacts,
  listPostAssets,
  listSiblingAccounts,
  type AccountWithBrand,
} from "@/lib/bridge";
import { listFacts } from "@/lib/bridge/facts";
import { SpendCapExceededError } from "@/lib/spend";

import { mergeSection, partForFormat, type PostSection } from "./assemble";
import { validatePostDraft, type PostDraft } from "./contract";
import { loadPlaybook, loadPostStyleGuide } from "./guides";
import {
  briefMarkdown,
  buildBrief,
  buildPack,
  captionText,
  packMarkdown,
  type PostBrief,
  type PostPack,
} from "./export";
import { checkTransition } from "./status";
import { publicationBlock } from "@/lib/publish/safety";
import { sendSnapshot, SendRefusal, verifyOwner } from "@/lib/publish/preflight";
import { whatWorked } from "./what-worked";

/**
 * The post engine (PLAN.md §1.46–§1.47, §5.O11.2): drafting a post for one
 * account from an idea or a topic, rewriting one section, adapting a post to
 * every sibling account in its family, and the free edits around them. The
 * routes under `src/app/api/posts/` and S15's actions call these; nothing here
 * checks who is asking — spending is gated by the caller (§1.20).
 */

/** A refusal the caller can show as-is: `status` is the HTTP status it maps to. */
export class PostEngineError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "PostEngineError";
  }
}

/** More than this and the prompt is a fact dump; the first ones by topic go. */
export const MAX_POST_FACTS = 40;
export const MAX_POST_LESSONS = 30;
/** Lesson kinds a post prompt learns from (§1.46): hooks, CTAs and caption patterns. */
const POST_LESSON_KINDS = ["hook", "cta", "caption_pattern"] as const;

/** The format a post gets when neither the idea nor the caller names one. */
export function defaultFormat(platform: string): PostFormat {
  switch (platform) {
    case "instagram":
      return "carousel";
    case "tiktok":
    case "youtube":
      return "reel";
    case "facebook":
      return "image_post";
    default:
      return "text";
  }
}

/**
 * Facts for a post on `account` (§1.48): the family's shared facts in the
 * account's language (falling back to the base language, `pt-BR` → `pt`),
 * then the brand's own sheet. Unverified facts travel flagged, so the prompt
 * can only hedge them.
 */
async function factsFor(account: AccountWithBrand): Promise<PromptPostFact[]> {
  const language = account.effectiveLanguage;
  const base = language.split("-")[0];
  const family = account.familyId
    ? (await listFamilyFacts(account.familyId)).filter(
        (f) => f.language === language || f.language === base,
      )
    : [];
  const own = await listFacts(account.brandId);
  return [...family, ...own].slice(0, MAX_POST_FACTS).map((f) => ({
    topic: f.topic,
    claim: f.claim,
    sourceUrl: f.sourceUrl,
    verified: f.verified,
  }));
}

/** The brand's, the family's and the portfolio-wide hook/CTA/caption lessons, newest first. */
async function lessonsFor(account: AccountWithBrand): Promise<PromptLesson[]> {
  return db
    .select({ kind: lessons.kind, text: lessons.text, sourceUrl: lessons.sourceUrl })
    .from(lessons)
    .where(
      and(
        inArray(lessons.kind, [...POST_LESSON_KINDS]),
        or(
          eq(lessons.brandId, account.brandId),
          account.familyId ? eq(lessons.familyId, account.familyId) : undefined,
          and(isNull(lessons.brandId), isNull(lessons.familyId)),
        ),
      ),
    )
    .orderBy(lessons.createdAt)
    .then((rows) => rows.reverse().slice(0, MAX_POST_LESSONS));
}

/** Everything a post prompt for `account` needs besides the seed. */
export async function postTarget(
  account: AccountWithBrand,
  format: PostFormat,
): Promise<PostTarget> {
  const brand = await getBrand(account.brandId);
  if (!brand) throw new PostEngineError(`Account @${account.handle} has no brand on file.`, 409);
  const [kit, facts, promptLessons, playbook, styleGuide, worked] = await Promise.all([
    getBrandKit(brand.id),
    factsFor(account),
    lessonsFor(account),
    loadPlaybook(account.platform),
    loadPostStyleGuide(account.effectiveLanguage),
    whatWorked(account.id),
  ]);
  return {
    brand,
    platform: account.platform,
    handle: account.handle,
    language: account.effectiveLanguage,
    format,
    kit: kit
      ? {
          ctas: kit.ctas,
          hashtags: kit.hashtags,
          dos: kit.dos,
          donts: kit.donts,
          styleNotes: kit.higgsfield?.styleNotes ?? "",
        }
      : null,
    facts,
    lessons: promptLessons,
    playbook,
    styleGuide,
    whatWorked: worked,
  };
}

function isPostFormat(value: unknown, formats: readonly string[]): value is PostFormat {
  return typeof value === "string" && formats.includes(value);
}

export type CreatePostInput = {
  accountId: number;
  ideaId?: number | null;
  topic?: string | null;
  format?: string | null;
  title?: string | null;
};

/**
 * Draft a post from an idea or a topic and save it as `drafting` (§5.O11.2).
 * Everything that can be refused for free is refused before the paid call.
 */
export async function createPostFromIdea(
  input: CreatePostInput,
): Promise<{ post: Post; costUsd: number }> {
  const account = await getAccount(input.accountId);
  if (!account) throw new PostEngineError(`No account ${input.accountId}.`, 404);

  const topic = input.topic?.trim() ?? "";
  if (!input.ideaId && !topic) throw new PostEngineError("Give an ideaId or a topic.");
  if (input.ideaId && topic) throw new PostEngineError("Give an ideaId or a topic, not both.");

  let seed: PostSeed;
  let ideaFormat: PostFormat | null = null;
  let title = input.title?.trim() ?? "";
  if (input.ideaId) {
    const idea = await getIdea(input.ideaId);
    if (!idea) throw new PostEngineError(`No idea ${input.ideaId}.`, 404);
    seed = {
      idea: {
        title: idea.title,
        angle: idea.angle,
        draftCopy: idea.draftCopy,
        visualNotes: idea.visualNotes,
        citations: idea.citations ?? null,
      },
    };
    ideaFormat = idea.format;
    title ||= idea.title;
  } else {
    seed = { topic };
    title ||= topic.slice(0, 120);
  }

  if (input.format != null && !isPostFormat(input.format, POST_FORMATS)) {
    throw new PostEngineError(`format must be one of ${POST_FORMATS.join(", ")}`);
  }
  const format: PostFormat =
    (input.format as PostFormat | null | undefined) ??
    ideaFormat ??
    defaultFormat(account.platform);

  const target = await postTarget(account, format);
  const { body, costUsd } = await draftPost(seed, target);

  const [post] = await insertReturning(db, posts, {
    accountId: account.id,
    brandId: account.brandId,
    ideaId: input.ideaId ?? null,
    format,
    status: "drafting",
    title,
    body,
    caption: captionText(body),
    firstComment: body.firstComment ?? null,
  });
  return { post, costUsd };
}

async function requirePost(postId: number) {
  const post = await getPost(postId);
  if (!post) throw new PostEngineError(`No post ${postId}.`, 404);
  return post;
}

function storedDraft(post: Post): PostDraft {
  const verdict = validatePostDraft(post.body);
  if (!verdict.ok) {
    throw new PostEngineError(
      `Post ${post.id} has no valid draft to work from.`,
      409,
      verdict.errors,
    );
  }
  return post.body as PostDraft;
}

/**
 * Rewrite one section of a post's draft and keep the rest (§5.O11.2). The
 * model sees the whole draft; only `section` (and any new sources) is taken.
 */
export async function regenerateSection(
  postId: number,
  section: PostSection,
): Promise<{ post: Post; costUsd: number }> {
  const post = await requirePost(postId);
  assertPostEditable(post);
  const current = storedDraft(post);
  const part = partForFormat(current.format);
  if (["slides", "shots", "storyFrames"].includes(section) && section !== part) {
    throw new PostEngineError(`A ${current.format} has no ${section}.`);
  }
  const account = await getAccount(post.accountId);
  if (!account) throw new PostEngineError(`Post ${postId}'s account is gone.`, 409);

  const target = await postTarget(account, current.format);
  const { body: fresh, costUsd } = await draftPost(
    { topic: post.title || current.hook },
    { ...target, language: current.language },
    { current, section },
  );
  const next = mergeSection(current, fresh, section);
  const verdict = validatePostDraft(next);
  if (!verdict.ok) {
    throw new PostGenerationError(
      "The rewritten section does not fit the post contract.",
      verdict.errors,
    );
  }
  const saved = await updatePost(
    postId,
    {
      body: next,
      // The posted caption and first comment may have been edited by hand;
      // only a rewrite of what they are made of replaces them.
      ...(section === "caption" || section === "hashtags" ? { caption: captionText(next) } : {}),
      ...(section === "firstComment" ? { firstComment: next.firstComment ?? null } : {}),
    },
    { expectedRevision: post.revision },
  );
  return { post: saved, costUsd };
}

export type AdaptResult = {
  created: Post[];
  /** Accounts that already have a version of this post, or failed to adapt. */
  skipped: { accountId: number; handle: string; reason: string }[];
  costUsd: number;
};

/**
 * "Adapt to family" (§1.47): one sibling post per other active account in the
 * same family and platform, rewritten for that brand's language, voice and
 * audience. Re-runnable: an account that already has a version of this post
 * (anywhere in its tree) is skipped, so a second click only fills the gaps.
 * One target failing does not undo the others; the spend cap stops the run.
 */
export async function adaptToFamily(postId: number): Promise<AdaptResult> {
  const post = await requirePost(postId);
  const source = storedDraft(post);
  const rootId = post.parentPostId ?? post.id;

  const targets = await listSiblingAccounts(post.accountId);
  const tree = await db
    .select({ accountId: posts.accountId })
    .from(posts)
    .where(or(eq(posts.id, rootId), eq(posts.parentPostId, rootId)));
  const covered = new Set(tree.map((r) => r.accountId));

  const result: AdaptResult = { created: [], skipped: [], costUsd: 0 };
  for (const account of targets) {
    if (covered.has(account.id)) {
      result.skipped.push({
        accountId: account.id,
        handle: account.handle,
        reason: "already has a version of this post",
      });
      continue;
    }
    try {
      const target = await postTarget(account, source.format);
      const { body, costUsd } = await adaptPost(source, target);
      result.costUsd += costUsd;
      const [sibling] = await insertReturning(db, posts, {
        accountId: account.id,
        brandId: account.brandId,
        ideaId: post.ideaId,
        parentPostId: rootId,
        format: source.format,
        status: "drafting",
        title: post.title,
        body,
        caption: captionText(body),
        firstComment: body.firstComment ?? null,
      });
      result.created.push(sibling);
    } catch (error) {
      if (error instanceof SpendCapExceededError && result.created.length === 0) throw error;
      if (error instanceof PostGenerationError || error instanceof SpendCapExceededError) {
        result.skipped.push({
          accountId: account.id,
          handle: account.handle,
          reason: error.message,
        });
        if (error instanceof SpendCapExceededError) break;
        continue;
      }
      throw error;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// free edits
// ---------------------------------------------------------------------------

/** Editorial writes use one revision comparison and never overwrite a publishing attempt. */
export async function setStatus(
  postId: number,
  status: PostStatus,
  options: PostEditOptions = {},
): Promise<Post> {
  return updatePost(postId, { status }, options);
}

export type PostEditOptions = {
  expectedRevision?: number;
  authorizeSend?: { ownerId: number };
};

export type PostPatch = {
  title?: string;
  body?: unknown;
  caption?: string | null;
  firstComment?: string | null;
  notes?: string | null;
  scheduledFor?: Date | null;
  permalink?: string | null;
  leadUrl?: string | null;
  publishOptions?: Record<string, unknown> | null;
  status?: PostStatus;
};

export function assertPostEditable(post: Post): void {
  if (post.status === "publishing" || post.publishState === "sending")
    throw new PostEngineError(
      "This post is being published; its content and attachments are locked.",
      409,
    );
  if (publicationBlock(post))
    throw new PostEngineError(
      "This post has a confirmed or uncertain send; reconcile it before creating a new post.",
      409,
    );
}

/** Content, date and status change atomically; material edits cancel prior send approval. */
export async function updatePost(
  postId: number,
  patch: PostPatch,
  options: PostEditOptions = {},
): Promise<Post> {
  try {
    return await db.transaction(async (tx) => {
      const [post] = await tx
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1)
        .for("update");
      if (!post) throw new PostEngineError(`No post ${postId}.`, 404);
      if (options.expectedRevision !== undefined && post.revision !== options.expectedRevision)
        throw new PostEngineError(
          "This post changed since you loaded it; reload before saving.",
          409,
        );
      const material = [
        "title",
        "body",
        "caption",
        "firstComment",
        "leadUrl",
        "publishOptions",
        "scheduledFor",
      ].some((k) => k in patch);
      if (material) assertPostEditable(post);
      if (patch.status === "publishing" || patch.status === "failed")
        throw new PostEngineError("Only the publisher can set this status.", 409);
      if (
        patch.status !== undefined &&
        !["published", "archived", post.status].includes(patch.status)
      )
        assertPostEditable(post);
      if (post.status === "publishing" && patch.status !== undefined)
        throw new PostEngineError("A publishing post cannot be changed by an editor.", 409);

      let status = patch.status ?? post.status;
      if (material && post.status === "scheduled" && !options.authorizeSend)
        status = patch.status ?? "ready";
      if (
        status === "scheduled" &&
        (material || patch.status !== undefined) &&
        !options.authorizeSend
      )
        throw new PostEngineError("Only the owner can authorize scheduling.", 409);
      const check = checkTransition(post.status, status, {
        hasBody: patch.body !== undefined || post.body != null,
        scheduledFor: patch.scheduledFor !== undefined ? patch.scheduledFor : post.scheduledFor,
      });
      if (!check.ok) throw new PostEngineError(check.error, 409);
      const set: Partial<typeof posts.$inferInsert> = {
        status,
        revision: post.revision + 1,
        updatedAt: new Date(),
      };
      if (patch.title !== undefined) set.title = patch.title.trim();
      if (patch.body !== undefined) {
        const verdict = validatePostDraft(patch.body);
        if (!verdict.ok)
          throw new PostEngineError("body does not match the post contract", 400, verdict.errors);
        const body = patch.body as PostDraft;
        if (body.format !== post.format)
          throw new PostEngineError(`body.format must stay "${post.format}"`);
        set.body = body;
        set.caption = captionText(body);
        set.firstComment = body.firstComment ?? null;
      }
      for (const key of [
        "caption",
        "firstComment",
        "notes",
        "scheduledFor",
        "permalink",
        "leadUrl",
        "publishOptions",
      ] as const) {
        if (patch[key] !== undefined) Object.assign(set, { [key]: patch[key] });
      }
      if (status === "published" && !post.publishedAt) {
        set.publishedAt = new Date();
        set.publishState = "confirmed";
      }
      if (material || patch.status !== undefined) {
        set.publishApprovedRevision = null;
        set.publishApprovedBy = null;
        set.publishApprovedAt = null;
        if (!post.publishAttemptId) set.publishTarget = null;
      } else if (post.publishApprovedRevision === post.revision) {
        set.publishApprovedRevision = post.revision + 1;
      }
      if (status === "scheduled" && options.authorizeSend) {
        assertPostEditable(post);
        await verifyOwner(options.authorizeSend.ownerId, tx);
        const snapshot = await sendSnapshot(post, tx, true);
        set.publishTarget = snapshot.target;
        set.publishApprovedBy = options.authorizeSend.ownerId;
        set.publishApprovedAt = new Date();
        set.publishApprovedRevision = post.revision + 1;
      }
      const [saved] = await updateReturning(
        tx,
        posts,
        set,
        and(eq(posts.id, postId), eq(posts.revision, post.revision), eq(posts.status, post.status)),
      );
      if (!saved)
        throw new PostEngineError("This post changed before the edit was saved; reload.", 409);
      return saved;
    });
  } catch (error) {
    if (error instanceof SendRefusal) throw new PostEngineError(error.message, 409);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

/** The generation brief (§1.45): Markdown for a person, JSON for `/higgsfield-post`. */
export async function exportBrief(postId: number): Promise<{ markdown: string; json: PostBrief }> {
  const post = await requirePost(postId);
  const draft = storedDraft(post);
  const json = buildBrief(post, draft, await getBrandKit(post.brandId));
  return { markdown: briefMarkdown(json), json };
}

/** The phone post pack (§1.49): caption, first comment and the files in order. */
export async function exportPack(postId: number): Promise<{ markdown: string; json: PostPack }> {
  const post = await requirePost(postId);
  const draft = storedDraft(post);
  const json = buildPack(post, draft, await listPostAssets(postId));
  return { markdown: packMarkdown(json), json };
}

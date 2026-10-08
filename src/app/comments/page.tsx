import type { Metadata } from "next";

import { CommentCard, type CommentCardData } from "@/components/CommentCard";
import { CommentDraftAllButton } from "@/components/CommentDraftAllButton";
import { COMMENT_DRAFT_STATUSES, type CommentDraftStatus } from "@/db/schema";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listAccounts } from "@/lib/bridge";
import {
  commentCounts,
  commentPosts,
  estimateReplyCostUsd,
  listComments,
} from "@/lib/comments/draft";
import { commentPermalink } from "@/lib/comments/flatten";
import { needsHumanNote } from "@/lib/comments/prompt";
import { formatDate } from "@/lib/format";
import { translator, type TranslationKey } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { formatUsd } from "@/lib/spend";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("growth.comments.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

const STATUS_KEY: Record<CommentDraftStatus, TranslationKey> = {
  new: "growth.comments.status.new",
  drafted: "growth.comments.status.drafted",
  approved: "growth.comments.status.approved",
  replied: "growth.comments.status.replied",
  dismissed: "growth.comments.status.dismissed",
};

/** Most "Draft all new" handles in one click; the rest wait for the next. */
const DRAFT_ALL_LIMIT = 50;

/**
 * `/comments?account=<id>&status=<status>` — Instagram comments on our posts
 * with reply drafts (build 4 §3.G). Replies are never sent from here
 * (PLAN-build4 §1.11): approve, copy, reply on Instagram, mark replied.
 */
export default async function CommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; status?: string }>;
}) {
  const [params, user, locale] = await Promise.all([searchParams, requireUser(), getLocale()]);
  const t = translator(locale);
  const owner = isOwner(user);
  const accounts = await listAccounts({ platform: "instagram" });
  const account = accounts.find((a) => String(a.id) === params.account);
  const status = (COMMENT_DRAFT_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as CommentDraftStatus)
    : "new";
  const accountIds = account ? [account.id] : accounts.map((a) => a.id);

  const [counts, rows] = accountIds.length
    ? await Promise.all([commentCounts(accountIds), listComments({ accountIds, status })])
    : [{ new: 0, drafted: 0, approved: 0, replied: 0, dismissed: 0 }, []];
  const postIds = [...new Set(rows.map((r) => r.postId).filter((id): id is number => id !== null))];
  const postById = await commentPosts(postIds);
  const handleById = new Map(accounts.map((a) => [a.id, a.handle]));

  const cards: CommentCardData[] = rows.map((r) => {
    const post = r.postId ? postById.get(r.postId) : undefined;
    const note = needsHumanNote(r.error);
    return {
      id: r.id,
      status: r.status,
      author: r.author,
      commentText: r.commentText,
      commentedAt: r.commentedAt ? formatDate(r.commentedAt, locale) : null,
      draft: r.draft,
      needsHuman: note,
      error: note ? null : r.error,
      handle: handleById.get(r.accountId) ?? "?",
      postTitle: post?.title || null,
      link: commentPermalink(post?.permalink ?? null, r.externalCommentId),
    };
  });

  const href = (q: { account?: number; status?: string }) => {
    const p = new URLSearchParams();
    if (q.account) p.set("account", String(q.account));
    if (q.status && q.status !== "new") p.set("status", q.status);
    const s = p.toString();
    return s ? `/comments?${s}` : "/comments";
  };
  const toDraft = Math.min(counts.new, DRAFT_ALL_LIMIT);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("growth.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
        {t("growth.comments.title")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("growth.comments.intro")}
      </p>

      {accounts.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
          {t("growth.comments.noAccounts")}
        </p>
      ) : (
        <>
          <nav aria-label={t("growth.account")} className="mt-6 flex flex-wrap gap-2">
            <a
              href={href({ status })}
              aria-current={!account ? "page" : undefined}
              className={!account ? CHIP_ON : CHIP_OFF}
            >
              {t("growth.all")}
            </a>
            {accounts.map((a) => (
              <a
                key={a.id}
                href={href({ account: a.id, status })}
                aria-current={account?.id === a.id ? "page" : undefined}
                className={account?.id === a.id ? CHIP_ON : CHIP_OFF}
              >
                @{a.handle}
              </a>
            ))}
          </nav>
          <nav aria-label={t("growth.status")} className="mt-3 flex flex-wrap gap-2">
            {COMMENT_DRAFT_STATUSES.map((s) => (
              <a
                key={s}
                href={href({ account: account?.id, status: s })}
                aria-current={s === status ? "page" : undefined}
                className={s === status ? CHIP_ON : CHIP_OFF}
              >
                {t(STATUS_KEY[s])} ({counts[s]})
              </a>
            ))}
          </nav>

          {owner && status === "new" ? (
            <div className="mt-6">
              <CommentDraftAllButton
                accountIds={account ? [account.id] : []}
                count={toDraft}
                estimate={formatUsd(estimateReplyCostUsd() * toDraft)}
              />
            </div>
          ) : null}
          <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
            {t("growth.comments.syncHint")}
          </p>

          {cards.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
              {t("growth.comments.none")}
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {cards.map((c) => (
                <CommentCard key={c.id} comment={c} canDraft={owner} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

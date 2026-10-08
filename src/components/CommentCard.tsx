"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { draftCommentAction, patchCommentAction } from "@/lib/comments.actions";
import { useTranslator } from "@/lib/i18n/client";

import { CopyTextButton } from "./CopyTextButton";
import { ResultMessage, type ResultTone } from "./ResultMessage";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_PRIMARY, STUDIO_VERIFY_BADGE } from "./StudioStyles";

export type CommentCardData = {
  id: number;
  status: "new" | "drafted" | "approved" | "replied" | "dismissed";
  author: string | null;
  commentText: string;
  commentedAt: string | null;
  draft: string | null;
  /** The needs-a-person note, when the drafter flagged one. */
  needsHuman: string | null;
  /** Any other error from the last draft attempt. */
  error: string | null;
  handle: string;
  postTitle: string | null;
  link: string | null;
};

/**
 * One comment on `/comments` (build 4 §3.G): the comment, its reply draft
 * (editable), and the moves a person makes. "Copy" puts the reply on the
 * clipboard; replying happens on Instagram — nothing here sends anything.
 */
export function CommentCard({
  comment,
  canDraft,
}: {
  comment: CommentCardData;
  canDraft: boolean;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [draft, setDraft] = useState(comment.draft ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);
  const closed = comment.status === "replied" || comment.status === "dismissed";

  const patch = (kind: "edit" | "approve" | "replied" | "dismissed" | "reopen") =>
    startTransition(async () => {
      setResult(null);
      const res = await patchCommentAction(
        comment.id,
        kind,
        kind === "edit" || kind === "approve" ? draft : undefined,
      );
      if (res.ok) {
        setResult({ tone: "success", text: t("growth.comments.saved") });
        router.refresh();
      } else setResult({ tone: "error", text: res.error });
    });

  return (
    <li className="surface-border rounded-[var(--radius-sm)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--color-ink-muted)]">
        <span>
          <span className="font-medium text-[var(--color-ink)]">
            {comment.author ? `@${comment.author}` : t("growth.comments.someone")}
          </span>{" "}
          {t("growth.comments.on")} @{comment.handle}
          {comment.postTitle ? ` · ${comment.postTitle}` : ""}
          {comment.commentedAt ? ` · ${comment.commentedAt}` : ""}
        </span>
        {comment.link ? (
          <a
            href={comment.link}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-[var(--color-accent)]"
          >
            {t("growth.comments.open")}
          </a>
        ) : null}
      </div>
      <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--color-ink)]">
        {comment.commentText}
      </p>

      {comment.needsHuman ? (
        <p className="mt-2">
          <span className={STUDIO_VERIFY_BADGE}>{t("growth.comments.needsHuman")}</span>{" "}
          <span className="text-xs text-[var(--color-ink-muted)]">{comment.needsHuman}</span>
        </p>
      ) : null}
      {comment.error ? (
        <p className="mt-2 text-xs text-[var(--color-danger)]">{comment.error}</p>
      ) : null}

      <textarea
        aria-label={t("growth.comments.reply")}
        value={draft}
        rows={3}
        maxLength={2000}
        disabled={closed || pending}
        placeholder={t("growth.comments.replyPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        className={`${STUDIO_INPUT} mt-3`}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!closed ? (
          <>
            {canDraft ? (
              <button
                type="button"
                disabled={pending}
                className={STUDIO_BUTTON}
                onClick={() =>
                  startTransition(async () => {
                    setResult(null);
                    const res = await draftCommentAction(comment.id);
                    if (res.ok) {
                      setDraft(res.draft);
                      setResult({
                        tone: res.needsHuman ? "info" : "success",
                        text: `${t(res.needsHuman ? "growth.comments.draftedHuman" : "growth.comments.drafted")} (${res.cost})`,
                      });
                      router.refresh();
                    } else setResult({ tone: "error", text: res.error });
                  })
                }
              >
                {comment.draft ? t("growth.comments.redraft") : t("growth.comments.draft")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              className={STUDIO_BUTTON}
              onClick={() => patch("edit")}
            >
              {t("growth.comments.save")}
            </button>
            <button
              type="button"
              disabled={pending || !draft.trim()}
              className={STUDIO_PRIMARY}
              onClick={() => patch("approve")}
            >
              {t("growth.comments.approve")}
            </button>
          </>
        ) : null}
        {draft.trim() ? <CopyTextButton text={draft} label={t("growth.copy")} /> : null}
        {!closed ? (
          <>
            <button
              type="button"
              disabled={pending}
              className={STUDIO_BUTTON}
              onClick={() => patch("replied")}
            >
              {t("growth.comments.markReplied")}
            </button>
            <button
              type="button"
              disabled={pending}
              className={STUDIO_BUTTON}
              onClick={() => patch("dismissed")}
            >
              {t("growth.comments.dismiss")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            className={STUDIO_BUTTON}
            onClick={() => patch("reopen")}
          >
            {t("growth.comments.reopen")}
          </button>
        )}
      </div>
      {result ? (
        <div className="mt-2">
          <ResultMessage tone={result.tone}>{result.text}</ResultMessage>
        </div>
      ) : null}
    </li>
  );
}

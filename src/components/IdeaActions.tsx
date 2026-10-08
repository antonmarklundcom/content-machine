"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { IdeaStatus } from "@/db/schema";
import type { TranslationKey } from "@/lib/i18n";
import { useLocale, useTranslator } from "@/lib/i18n/client";
import { formatDate } from "@/lib/format";
import { deleteIdea, setIdeaStatus } from "@/lib/ideas.actions";
import { CopyTextButton } from "./CopyTextButton";

const BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50";

/** Which status moves each status offers — the workflow, in one table. */
const MOVES: Record<IdeaStatus, { to: IdeaStatus; label: TranslationKey }[]> = {
  proposed: [
    { to: "approved", label: "ideas.action.approve" },
    { to: "rejected", label: "ideas.action.reject" },
  ],
  approved: [
    { to: "posted", label: "ideas.action.markPosted" },
    { to: "rejected", label: "ideas.action.reject" },
  ],
  posted: [{ to: "approved", label: "ideas.action.backToApproved" }],
  rejected: [{ to: "proposed", label: "ideas.action.reopen" }],
};

/**
 * One idea's buttons (PLAN.md §6.S6): approve, reject, mark posted, copy the
 * caption, and — for the owner, on a rejected idea — delete. The server actions
 * check the same rules; hiding a button here is presentation only.
 */
export function IdeaActions({
  ideaId,
  status,
  draftCopy,
  canDelete,
  postedAt,
}: {
  ideaId: number;
  status: IdeaStatus;
  draftCopy: string;
  /** The viewer is the owner. Delete still only shows on a rejected idea. */
  canDelete: boolean;
  postedAt?: Date | string | null;
}) {
  const t = useTranslator();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function run(action: () => Promise<unknown>) {
    setFailed(false);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "posted" && postedAt && (
        <span className="text-xs text-[var(--color-ink-muted)]">
          {t("ideas.postedAt", { date: formatDate(postedAt, locale) })}
        </span>
      )}
      {MOVES[status].map((move) => (
        <button
          key={move.to}
          type="button"
          className={BUTTON}
          disabled={pending}
          onClick={() => run(() => setIdeaStatus(ideaId, move.to))}
        >
          {t(move.label)}
        </button>
      ))}
      <CopyTextButton text={draftCopy} label={t("ideas.action.copyCaption")} />
      {canDelete && status === "rejected" && (
        <button
          type="button"
          className={`${BUTTON} text-[var(--color-danger)]`}
          disabled={pending}
          onClick={() => {
            if (window.confirm(t("ideas.action.deleteConfirm"))) run(() => deleteIdea(ideaId));
          }}
        >
          {t("ideas.action.delete")}
        </button>
      )}
      {failed && (
        <span role="alert" className="text-xs text-[var(--color-danger)]">
          {t("ideas.action.failed")}
        </span>
      )}
    </div>
  );
}

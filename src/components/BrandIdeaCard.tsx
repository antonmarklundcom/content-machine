"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { translator, type Locale } from "@/lib/i18n";
import { saveIdeaEdits } from "@/lib/ideas.actions";
import { IdeaActions } from "./IdeaActions";
import { BUTTON_SECONDARY } from "./BrandStyles";

export type BrandIdea = {
  id: number;
  title: string;
  angle: string;
  format: string;
  platform: string;
  draftCopy: string;
  visualNotes: string | null;
  // Model-written JSON: `sources` is typed as an array but is not guaranteed one.
  citations: { claim: string; sources?: string[] | null }[] | null;
  status: "proposed" | "approved" | "rejected" | "posted";
  createdAt: Date | string;
  postedAt?: Date | string | null;
};

const TAG =
  "surface-border inline-block rounded-full px-2 py-0.5 text-[11px] tracking-wide uppercase";

const STATUS_TAG: Record<BrandIdea["status"], string> = {
  proposed: "text-[var(--color-ink-muted)]",
  approved: "border-[var(--color-accent)] text-[var(--color-accent)]",
  rejected: "border-[var(--color-danger)] text-[var(--color-danger)]",
  posted: "border-[var(--color-accent)] text-[var(--color-accent)]",
};

/** One idea: editable caption, then S6's `IdeaActions` (status moves, copy, delete). */
export function BrandIdeaCard({
  idea,
  locale,
  canDelete,
}: {
  idea: BrandIdea;
  locale: Locale;
  canDelete: boolean;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [copy, setCopy] = useState(idea.draftCopy);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);

  return (
    <article className="surface-border surface-card p-5">
      <div className="flex flex-wrap gap-1.5">
        <span className={`${TAG} ${STATUS_TAG[idea.status]}`}>
          {t(`brands.status.${idea.status}`)}
        </span>
        <span className={`${TAG} text-[var(--color-ink-muted)]`}>{idea.format}</span>
        <span className={`${TAG} text-[var(--color-ink-muted)]`}>{idea.platform}</span>
      </div>
      <h2 className="mt-3 text-base font-semibold text-[var(--color-ink)]">{idea.title}</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{idea.angle}</p>

      <textarea
        rows={6}
        value={copy}
        onChange={(e) => {
          setCopy(e.target.value);
          setDirty(true);
        }}
        className="surface-border mt-4 w-full resize-y rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-3 text-sm leading-relaxed text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      />

      {idea.visualNotes && (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          <strong className="text-[var(--color-ink)]">{t("brands.visual")}</strong>{" "}
          {idea.visualNotes}
        </p>
      )}

      {idea.citations && idea.citations.length > 0 && (
        <details className="mt-2 text-sm text-[var(--color-ink-muted)]">
          <summary className="cursor-pointer">
            {t("brands.sources", { count: idea.citations.length })}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {idea.citations.map((c, i) => (
              <li key={i} className="break-words">
                {c.claim} — {(c.sources ?? []).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dirty && (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={saving}
            onClick={() => {
              setSaveFailed(false);
              startSaving(async () => {
                try {
                  await saveIdeaEdits(idea.id, { draftCopy: copy });
                  setDirty(false);
                  router.refresh();
                } catch {
                  setSaveFailed(true);
                }
              });
            }}
          >
            {t("brands.saveCopy")}
          </button>
        )}
        {saveFailed && (
          <span role="alert" className="text-xs text-[var(--color-danger)]">
            {t("ideas.action.failed")}
          </span>
        )}
        {idea.status !== "rejected" && (
          <Link href={`/posts/new?idea=${idea.id}`} className={BUTTON_SECONDARY}>
            {t("links.makePost")}
          </Link>
        )}
        <IdeaActions
          ideaId={idea.id}
          status={idea.status}
          draftCopy={copy}
          canDelete={canDelete}
          postedAt={idea.postedAt}
        />
      </div>
    </article>
  );
}

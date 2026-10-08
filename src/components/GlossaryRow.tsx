"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import {
  deleteGlossaryAction,
  reviewGlossaryAction,
  sendToPronunciationsAction,
  updateGlossaryAction,
  type GlossaryActionResult,
} from "@/lib/glossary.actions";
import { translator, type Locale } from "@/lib/i18n";
import { GLOSSARY_FIELD } from "@/lib/glossary/ui";
import { GlossaryForm, type GlossaryFormValues } from "./GlossaryForm";
import { ResultMessage } from "./ResultMessage";

export type GlossaryRowData = GlossaryFormValues & {
  id: number;
  language: string;
  reviewStatus: "proposed" | "approved" | "rejected";
  reviewedBy: string | null;
  /** ISO string. */
  reviewedAt: string | null;
};

const SMALL =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50";

const STATUS_CLASS: Record<GlossaryRowData["reviewStatus"], string> = {
  proposed: "border-[var(--color-border-subtle)] text-[var(--color-ink-muted)]",
  approved: "border-[var(--color-accent)] text-[var(--color-accent)]",
  rejected: "border-[var(--color-danger)] text-[var(--color-danger)]",
};

/** One term: details, review (reviewer name + date), edit, send to pronunciations, delete. */
export function GlossaryRow({ term, locale }: { term: GlossaryRowData; locale: Locale }) {
  const t = translator(locale);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [reviewer, setReviewer] = useState(term.reviewedBy ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<GlossaryActionResult | null>(null);

  const run = (action: () => Promise<GlossaryActionResult>) =>
    startTransition(async () => {
      const r = await action();
      setResult(r);
      if (r.ok) router.refresh();
    });
  const done = useCallback(() => {
    setEditing(false);
    router.refresh();
  }, [router]);

  if (editing) {
    return (
      <li className="surface-border surface-card p-4">
        <GlossaryForm
          action={updateGlossaryAction.bind(null, term.id)}
          initial={term}
          idPrefix={`glossary-${term.id}`}
          submitLabel={t("glossary.save")}
          locale={locale}
          onDone={done}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const meaning = [term.meaningEs, term.meaningEn].filter(Boolean).join(" · ");
  return (
    <li className="surface-border surface-card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-semibold text-[var(--color-ink)]">{term.term}</span>
        {term.sayAs && (
          <span className="text-xs text-[var(--color-ink-muted)]">
            {t("glossary.sayAsShort", { sayAs: term.sayAs })}
          </span>
        )}
        <span
          className={`rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[term.reviewStatus]}`}
        >
          {t(`glossary.status.${term.reviewStatus}`)}
        </span>
        <span className="text-xs text-[var(--color-ink-muted)]">
          {t(`glossary.register.${term.register}`)}
        </span>
        {term.joparaOk && (
          <span className="text-xs font-medium text-[var(--color-accent)]">
            {t("glossary.joparaOk")}
          </span>
        )}
      </div>
      {meaning && <p className="text-sm text-[var(--color-ink)]">{meaning}</p>}
      {term.example && (
        <p className="text-sm text-[var(--color-ink-muted)] italic">
          {term.example}
          {term.exampleTranslation ? ` — ${term.exampleTranslation}` : ""}
        </p>
      )}
      <p className="text-xs text-[var(--color-ink-muted)]">
        {term.reviewedBy && term.reviewedAt
          ? t("glossary.reviewedBy", {
              name: term.reviewedBy,
              date: formatDate(term.reviewedAt, locale),
            })
          : t("glossary.notReviewed")}
        {term.source ? ` · ${t("glossary.sourceShort", { source: term.source })}` : ""}
      </p>
      {term.notes && (
        <p className="text-xs whitespace-pre-line text-[var(--color-ink-muted)]">{term.notes}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={t("glossary.reviewer")}
          placeholder={t("glossary.reviewer")}
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          className={`${GLOSSARY_FIELD} max-w-48 py-1.5 text-xs`}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => reviewGlossaryAction(term.id, "approved", reviewer))}
          className={`${SMALL} text-[var(--color-accent)] hover:border-[var(--color-accent)]`}
        >
          {t("glossary.approve")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => reviewGlossaryAction(term.id, "rejected", reviewer))}
          className={`${SMALL} text-[var(--color-danger)] hover:border-[var(--color-danger)]`}
        >
          {t("glossary.reject")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditing(true)}
          className={`${SMALL} text-[var(--color-ink)] hover:border-[var(--color-accent)]`}
        >
          {t("glossary.edit")}
        </button>
        {term.sayAs && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => sendToPronunciationsAction(term.id))}
            className={`${SMALL} text-[var(--color-ink)] hover:border-[var(--color-accent)]`}
          >
            {t("glossary.sendToPronunciations")}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(t("glossary.deleteConfirm")))
              run(() => deleteGlossaryAction(term.id));
          }}
          className={`${SMALL} text-[var(--color-danger)] hover:border-[var(--color-danger)]`}
        >
          {t("glossary.delete")}
        </button>
      </div>
      {result && !result.ok && (
        <ResultMessage tone="error">
          {t(result.error)}
          {result.detail ? ` (${result.detail})` : ""}
        </ResultMessage>
      )}
    </li>
  );
}

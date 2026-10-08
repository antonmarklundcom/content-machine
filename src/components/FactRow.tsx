"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import {
  deleteFactAction,
  markFactCheckedAction,
  updateFactAction,
  type FactActionResult,
} from "@/lib/facts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { FactForm } from "./FactForm";
import { ResultMessage } from "./ResultMessage";

/** What the row needs of a fact — dates as ISO strings, since this crosses into the client. */
export type FactRowData = {
  id: number;
  topic: string;
  claim: string;
  sourceUrl: string | null;
  notes: string | null;
  lastCheckedAt: string;
  stale: boolean;
  /** False for an imported fact that is not signed off: the claim is its hedged wording (§1.48). */
  verified?: boolean;
  /** Set for family facts, which come one row per language. */
  language?: string;
  externalKey?: string | null;
};

const SMALL_BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50";

/** One fact on the sheet, with the owner's edit / checked today / delete. */
export function FactRow({
  fact,
  topics,
  canEdit,
  staleDays,
  locale,
}: {
  fact: FactRowData;
  topics: string[];
  canEdit: boolean;
  staleDays: number;
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<FactActionResult | null>(null);

  const run = (action: () => Promise<FactActionResult>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : result);
      if (result.ok) router.refresh();
    });
  const done = useCallback(() => {
    setEditing(false);
    router.refresh();
  }, [router]);

  if (editing) {
    return (
      <li className="surface-border surface-card p-4">
        <FactForm
          action={updateFactAction.bind(null, fact.id)}
          initial={{
            topic: fact.topic,
            claim: fact.claim,
            sourceUrl: fact.sourceUrl ?? "",
            notes: fact.notes ?? "",
          }}
          topics={topics}
          locale={locale}
          idPrefix={`fact-${fact.id}`}
          submitLabel={t("facts.save")}
          onDone={done}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="surface-border surface-card flex flex-col gap-2 p-4">
      <p className="text-sm leading-relaxed text-[var(--color-ink)]">{fact.claim}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-muted)]">
        {fact.sourceUrl ? (
          <a
            href={fact.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="max-w-full truncate text-[var(--color-accent)] hover:underline"
          >
            {fact.sourceUrl}
          </a>
        ) : (
          <span>{t("facts.noSource")}</span>
        )}
        {fact.verified === false && (
          <span
            title={t("facts.unverifiedTitle")}
            className="rounded-[var(--radius-sm)] border border-[var(--color-danger)] px-2 py-0.5 font-medium text-[var(--color-danger)]"
          >
            {t("facts.unverified")}
          </span>
        )}
        {fact.language && <span className="font-mono uppercase">{fact.language}</span>}
        {fact.externalKey && (
          <span className="font-mono">{t("facts.key", { key: fact.externalKey })}</span>
        )}
        <span>{t("facts.checked", { date: formatDate(fact.lastCheckedAt, locale) })}</span>
        {fact.stale && (
          <span
            title={t("facts.staleTitle", { days: staleDays })}
            className="rounded-[var(--radius-sm)] border border-[var(--color-danger)] px-2 py-0.5 font-medium text-[var(--color-danger)]"
          >
            {t("facts.stale")}
          </span>
        )}
      </div>
      {fact.notes && (
        <p className="text-xs text-[var(--color-ink-muted)] whitespace-pre-line">{fact.notes}</p>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => markFactCheckedAction(fact.id))}
            className={`${SMALL_BUTTON} text-[var(--color-ink)] hover:border-[var(--color-accent)]`}
          >
            {t("facts.checkedToday")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing(true)}
            className={`${SMALL_BUTTON} text-[var(--color-ink)] hover:border-[var(--color-accent)]`}
          >
            {t("facts.edit")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("facts.deleteConfirm"))) run(() => deleteFactAction(fact.id));
            }}
            className={`${SMALL_BUTTON} text-[var(--color-danger)] hover:border-[var(--color-danger)]`}
          >
            {t("facts.delete")}
          </button>
        </div>
      )}
      {error && !error.ok && (
        <ResultMessage tone="error">
          {t(error.error)}
          {error.detail ? ` (${error.detail})` : ""}
        </ResultMessage>
      )}
    </li>
  );
}

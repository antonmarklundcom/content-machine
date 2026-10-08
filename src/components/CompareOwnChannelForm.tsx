"use client";

import { useActionState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import { addCompetitorChannel, type ResearchActionResult } from "@/lib/research.actions";
import { ResultMessage } from "./ResultMessage";

const FIELD =
  "surface-border min-w-0 flex-1 basis-64 rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * Link Anton's own channel to a brand (build 2b, idea 4). The research
 * page's link action with role `own`: the same track-and-link path, so a
 * channel already tracked (or linked as a competitor) is only re-roled.
 */
export function CompareOwnChannelForm({ brandId, locale }: { brandId: string; locale: Locale }) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(
    addCompetitorChannel.bind(null, brandId),
    null as ResearchActionResult | null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="role" value="own" />
      <div className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="compare-own-url">
          {t("compare.linkOwnPlaceholder")}
        </label>
        <input
          id="compare-own-url"
          type="text"
          name="url"
          required
          placeholder={t("compare.linkOwnPlaceholder")}
          className={FIELD}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {pending ? t("compare.linking") : t("compare.linkOwn")}
        </button>
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
      {state?.ok && <ResultMessage tone="success">{t("compare.linked")}</ResultMessage>}
    </form>
  );
}

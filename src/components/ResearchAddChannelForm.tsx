"use client";

import { useActionState } from "react";
import type { BrandSourceRole } from "@/db/schema";
import { translator, type Locale } from "@/lib/i18n";
import { addCompetitorChannel, type ResearchActionResult } from "@/lib/research.actions";
import { ResultMessage } from "./ResultMessage";

// Spelled out rather than imported: the schema module is not client code.
const ROLES: readonly BrandSourceRole[] = ["competitor", "inspiration"];

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/** Paste a channel URL → tracked as a source and linked to this brand (PLAN.md §6.S10.1). */
export function ResearchAddChannelForm({ brandId, locale }: { brandId: string; locale: Locale }) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(
    addCompetitorChannel.bind(null, brandId),
    null as ResearchActionResult | null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="research-channel-url">
          {t("research.addPlaceholder")}
        </label>
        <input
          id="research-channel-url"
          type="text"
          name="url"
          required
          placeholder={t("research.addPlaceholder")}
          className={`${FIELD} min-w-0 flex-1 basis-64 placeholder:text-[var(--color-ink-muted)]`}
        />
        <label className="sr-only" htmlFor="research-channel-role">
          {t("research.roleLabel")}
        </label>
        <select id="research-channel-role" name="role" defaultValue="competitor" className={FIELD}>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`research.role.${role}`)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {pending ? t("research.adding") : t("research.add")}
        </button>
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
      {state && state.ok && <ResultMessage tone="success">{t("research.added")}</ResultMessage>}
    </form>
  );
}

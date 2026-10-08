"use client";

import { useCallback, useState } from "react";
import type { Brand, BrandFamily } from "@/db/schema";
import { translator, type Locale } from "@/lib/i18n";
import { CARD, SECONDARY } from "./AccountFields";
import { FamilyForm } from "./FamilyForm";

/** One family on /families: its brands, and an inline edit for the owner. */
export function FamilyCard({
  family,
  brands,
  locale,
  canEdit,
}: {
  family: BrandFamily;
  brands: Pick<Brand, "id" | "name" | "language" | "active">[];
  locale: Locale;
  canEdit: boolean;
}) {
  const t = translator(locale);
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">{family.name}</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">{family.id}</p>
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={SECONDARY}>
            {t("accounts.edit")}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-3">
          <FamilyForm initial={family} locale={locale} onDone={close} onCancel={close} />
        </div>
      ) : (
        family.notes && (
          <p className="mt-2 text-sm whitespace-pre-line text-[var(--color-ink-muted)]">
            {family.notes}
          </p>
        )
      )}
      {brands.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          {t("accounts.families.noBrands")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {brands.map((b) => (
            <li key={b.id}>
              <a
                href={`/brands/${b.id}`}
                className={`surface-border inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm hover:border-[var(--color-accent)] ${
                  b.active
                    ? "text-[var(--color-ink)]"
                    : "text-[var(--color-ink-muted)] line-through"
                }`}
              >
                {b.name}
                <span className="text-xs text-[var(--color-ink-muted)]">{b.language}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

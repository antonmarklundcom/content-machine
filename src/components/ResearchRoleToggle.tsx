"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { BrandSourceRole } from "@/db/schema";
import { translator, type Locale } from "@/lib/i18n";
import { setCompetitorRole } from "@/lib/research.actions";

// Spelled out rather than imported: the schema module is not client code.
const ROLES: readonly BrandSourceRole[] = ["competitor", "inspiration"];

/** Competitor ⇄ inspiration for one linked channel; a two-button segmented control. */
export function ResearchRoleToggle({
  brandId,
  sourceId,
  role,
  locale,
}: {
  brandId: string;
  sourceId: number;
  role: BrandSourceRole;
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="group"
      aria-label={t("research.roleLabel")}
      className="surface-border inline-flex overflow-hidden rounded-[var(--radius-sm)]"
    >
      {ROLES.map((option) => {
        const active = option === role;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            disabled={pending || active}
            onClick={() =>
              startTransition(async () => {
                const res = await setCompetitorRole(brandId, sourceId, option);
                if (res.ok) router.refresh();
              })
            }
            className={`px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
                : "text-[var(--color-ink)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            }`}
          >
            {t(`research.role.${option}`)}
          </button>
        );
      })}
    </div>
  );
}

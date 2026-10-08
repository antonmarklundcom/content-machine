"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { translator, type Locale } from "@/lib/i18n";
import type { AnalyzedVideoOption } from "@/app/brand/[id]/BrandIdeas";
import { BrandGenerateForm } from "./BrandGenerateForm";
import { BrandIdeaCard, type BrandIdea } from "./BrandIdeaCard";

/** The brand page's ideas: generate/seed controls above, status tabs, the brand's ideas below, newest first. */
export function BrandIdeaBoard({
  brandId,
  analyzedVideos,
  locale,
  ideas,
  canDelete,
  canGenerate,
  tabs,
}: {
  brandId: string;
  analyzedVideos: AnalyzedVideoOption[];
  locale: Locale;
  ideas: BrandIdea[];
  canDelete: boolean;
  /** Generating spends money, so it is owner-only (PLAN.md §1.20); employees do not see the form. */
  canGenerate: boolean;
  tabs: ReactNode;
}) {
  const t = translator(locale);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      {canGenerate && (
        <BrandGenerateForm
          brandId={brandId}
          analyzedVideos={analyzedVideos}
          locale={locale}
          onGenerated={() => router.refresh()}
        />
      )}

      {tabs}

      {ideas.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("brands.empty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {ideas.map((idea) => (
            <BrandIdeaCard key={idea.id} idea={idea} locale={locale} canDelete={canDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

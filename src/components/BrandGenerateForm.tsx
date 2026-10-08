"use client";

import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import type { AnalyzedVideoOption } from "@/app/brand/[id]/BrandIdeas";
import { ResultMessage } from "./ResultMessage";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD } from "./BrandStyles";

/**
 * Generate ideas for a brand — from a fresh web search, or seeded from a video
 * already analysed in the YouTube tool. Both go to `/api/generate`, which is
 * owner-only (PLAN.md §1.20): an employee sees its 403 message here.
 */
export function BrandGenerateForm({
  brandId,
  analyzedVideos,
  locale,
  onGenerated,
}: {
  brandId: string;
  analyzedVideos: AnalyzedVideoOption[];
  locale: Locale;
  onGenerated: () => void;
}) {
  const t = translator(locale);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState("");

  async function generate(seedAnalysisId?: number) {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          seedAnalysisId === undefined ? { brandId } : { brandId, analysisId: seedAnalysisId },
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("brands.requestFailed", { status: res.status }));
      }
      onGenerated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("brands.somethingWrong"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={() => generate()}
          disabled={generating}
          className={BUTTON_PRIMARY}
        >
          {generating ? t("brands.generating") : t("brands.generate")}
        </button>
        {generating && (
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t("brands.generatingHint")}</p>
        )}
      </div>

      {analyzedVideos.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-[var(--color-ink-muted)]">{t("brands.seedIntro")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={analysisId}
              onChange={(e) => setAnalysisId(e.target.value)}
              className={`${FIELD} max-w-full`}
            >
              <option value="">{t("brands.seedChoose")}</option>
              {analyzedVideos.map((v) => (
                <option key={v.analysisId} value={v.analysisId}>
                  {v.title}
                  {v.channelTitle ? ` — ${v.channelTitle}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => generate(Number(analysisId))}
              disabled={generating || !analysisId}
              className={BUTTON_SECONDARY}
            >
              {generating ? t("brands.generating") : t("brands.seedButton")}
            </button>
          </div>
        </div>
      )}

      {error && <ResultMessage tone="error">{error}</ResultMessage>}
    </div>
  );
}

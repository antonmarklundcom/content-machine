"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslator } from "@/lib/i18n/client";
import { FORMATS, type Format } from "@/db/schema";
import type { UnitType } from "@/lib/listen/units";
import { ResultMessage } from "./ResultMessage";

/**
 * The promote touchpoint (PLAN.md §6.S3.1/2), used from both the inbox (one
 * clip → one analysis idea) and an analysis page (one starred unit → one
 * idea). One component because the endpoint and the shape of the ask are the
 * same either way — only how the source is picked differs, which `sources`
 * expresses as a list of one or more choices.
 */

export type PromoteSource =
  | { kind: "unit"; videoId: number; unitType: UnitType; unitIndex: number }
  | { kind: "analysis-idea"; analysisId: number; ideaIndex: number };

export type PromoteSourceOption = { label: string; source: PromoteSource };

export type PromoteBrand = { id: string; name: string; platforms: string[] };

const TRIGGER =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

const FORMAT_KEY: Record<Format, `format.${Format}`> = {
  reel: "format.reel",
  carousel: "format.carousel",
  image_post: "format.image_post",
  story: "format.story",
};

export function PromoteButton({
  sources,
  brands,
  canAdapt,
  clipId,
}: {
  /** One or more things this button can promote — a picker appears when there is more than one. */
  sources: PromoteSourceOption[];
  brands: PromoteBrand[];
  /** Owner-only (adapting spends money — see /api/ideas/promote). */
  canAdapt: boolean;
  /** The inbox clip this promote is wired to, if any — the endpoint marks it `promoted`. */
  clipId?: number;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sourceIndex, setSourceIndex] = useState(0);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [format, setFormat] = useState<Format>(FORMATS[0]);
  const [platform, setPlatform] = useState(brands[0]?.platforms[0] ?? "instagram");
  const [adapt, setAdapt] = useState(false);
  const [result, setResult] = useState<
    { ok: true; brandId: string } | { ok: false; error: string } | null
  >(null);

  if (sources.length === 0 || brands.length === 0) return null;

  function pickBrand(id: string) {
    setBrandId(id);
    const brand = brands.find((b) => b.id === id);
    if (brand?.platforms.length) setPlatform(brand.platforms[0]!);
  }

  function submit() {
    startTransition(async () => {
      setResult(null);
      const chosen = sources[sourceIndex]!.source;
      const res = await fetch("/api/ideas/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          format,
          platform,
          source: chosen,
          adapt,
          clipId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setResult({ ok: false, error: body.error ?? `Request failed (${res.status})` });
        return;
      }
      setResult({ ok: true, brandId });
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" className={TRIGGER} onClick={() => setOpen(true)}>
        {t("promote.trigger")}
      </button>
    );
  }

  return (
    <div className="surface-border surface-card flex flex-col gap-2 p-3 text-xs">
      {sources.length > 1 && (
        <label className="flex flex-col gap-1">
          <span className="text-[var(--color-ink-muted)]">{t("promote.source")}</span>
          <select
            className={FIELD}
            value={sourceIndex}
            onChange={(e) => setSourceIndex(Number(e.target.value))}
          >
            {sources.map((option, i) => (
              <option key={i} value={i}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[var(--color-ink-muted)]">{t("promote.brand")}</span>
        <select className={FIELD} value={brandId} onChange={(e) => pickBrand(e.target.value)}>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[var(--color-ink-muted)]">{t("promote.format")}</span>
        <select
          className={FIELD}
          value={format}
          onChange={(e) => setFormat(e.target.value as Format)}
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {t(FORMAT_KEY[f])}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[var(--color-ink-muted)]">{t("promote.platform")}</span>
        <input
          className={FIELD}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          list="promote-platform-options"
        />
        <datalist id="promote-platform-options">
          {brands
            .find((b) => b.id === brandId)
            ?.platforms.map((p) => (
              <option key={p} value={p} />
            ))}
        </datalist>
      </label>
      {canAdapt && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={adapt}
            onChange={(e) => setAdapt(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t("promote.adapt")}
            <span className="block text-[var(--color-ink-muted)]">{t("promote.adaptHint")}</span>
          </span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 font-medium text-[var(--color-accent-ink)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {pending ? t("promote.submitting") : t("promote.submit")}
        </button>
        <button type="button" className={TRIGGER} onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      {result &&
        (result.ok ? (
          <ResultMessage tone="success">
            {t("promote.success")}{" "}
            <a href={`/brand/${result.brandId}`} className="underline">
              {t("promote.viewBrand")}
            </a>
          </ResultMessage>
        ) : (
          <ResultMessage tone="error">{result.error}</ResultMessage>
        ))}
    </div>
  );
}

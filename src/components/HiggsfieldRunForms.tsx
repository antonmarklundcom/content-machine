"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startHiggsfieldJobAction } from "@/lib/higgsfield.actions";
import { useTranslator } from "@/lib/i18n/client";

import { ResultMessage } from "./ResultMessage";
import { STUDIO_INPUT, STUDIO_LABEL, STUDIO_PRIMARY } from "./StudioStyles";

type Outcome = { ok: true; jobId: number } | { ok: false; error: string } | null;

function Outcome({ outcome }: { outcome: Outcome }) {
  const t = useTranslator();
  if (!outcome) return null;
  return outcome.ok ? (
    <ResultMessage tone="success">{t("higgsfield.started", { id: outcome.jobId })}</ResultMessage>
  ) : (
    <ResultMessage tone="error">{outcome.error}</ResultMessage>
  );
}

/** "Free prompt" (kind `free`): describe what to make for a brand; files land in the inbox. */
export function HiggsfieldFreeForm({
  brands,
  defaultMaxCredits,
}: {
  brands: { id: string; name: string }[];
  defaultMaxCredits: number;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [brandId, setBrandId] = useState("");
  const [description, setDescription] = useState("");
  const [maxCredits, setMaxCredits] = useState(String(defaultMaxCredits));
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const result = await startHiggsfieldJobAction({
        kind: "free",
        brandId: brandId || null,
        description,
        maxCredits: Number(maxCredits),
      });
      setOutcome(result.ok ? { ok: true, jobId: result.jobId } : result);
      if (result.ok) {
        setDescription("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-[var(--color-ink)]">
        {t("higgsfield.free.title")}
      </h2>
      <p className="text-sm text-[var(--color-ink-muted)]">{t("higgsfield.free.intro")}</p>
      <label>
        <span className={STUDIO_LABEL}>{t("higgsfield.free.brand")}</span>
        <select
          className={STUDIO_INPUT}
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
        >
          <option value="">{t("higgsfield.free.noBrand")}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={STUDIO_LABEL}>{t("higgsfield.free.description")}</span>
        <textarea
          className={STUDIO_INPUT}
          rows={4}
          required
          minLength={5}
          maxLength={4000}
          value={description}
          placeholder={t("higgsfield.free.placeholder")}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-32">
          <span className={STUDIO_LABEL}>{t("higgsfield.maxCredits")}</span>
          <input
            type="number"
            min={1}
            step={1}
            className={STUDIO_INPUT}
            value={maxCredits}
            onChange={(e) => setMaxCredits(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className={STUDIO_PRIMARY}
          disabled={pending || description.trim().length < 5 || !(Number(maxCredits) > 0)}
        >
          {t("higgsfield.free.submit")}
        </button>
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">{t("higgsfield.maxCreditsHint")}</p>
      <Outcome outcome={outcome} />
    </form>
  );
}

/** "Import my Higgsfield history" (kind `import`, runs `/higgsfield-import`; spends nothing). */
export function HiggsfieldImportForm() {
  const t = useTranslator();
  const router = useRouter();
  const [range, setRange] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const result = await startHiggsfieldJobAction({ kind: "import", range, maxCredits: 0 });
      setOutcome(result.ok ? { ok: true, jobId: result.jobId } : result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-[var(--color-ink)]">
        {t("higgsfield.import.title")}
      </h2>
      <p className="text-sm text-[var(--color-ink-muted)]">{t("higgsfield.import.intro")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">
          <span className={STUDIO_LABEL}>{t("higgsfield.import.range")}</span>
          <input
            className={STUDIO_INPUT}
            value={range}
            placeholder={t("higgsfield.import.rangePlaceholder")}
            onChange={(e) => setRange(e.target.value)}
          />
        </label>
        <button type="submit" className={STUDIO_PRIMARY} disabled={pending}>
          {t("higgsfield.import.submit")}
        </button>
      </div>
      <Outcome outcome={outcome} />
    </form>
  );
}

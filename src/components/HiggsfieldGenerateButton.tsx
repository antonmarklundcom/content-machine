"use client";

import { useEffect, useState, useTransition } from "react";

import type { HiggsfieldJobKind, HiggsfieldJobStatus } from "@/db/schema";
import { startHiggsfieldJobAction } from "@/lib/higgsfield.actions";
import { useTranslator } from "@/lib/i18n/client";

import { ResultMessage } from "./ResultMessage";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL, STUDIO_PRIMARY } from "./StudioStyles";

const TERMINAL: HiggsfieldJobStatus[] = ["done", "failed", "cancelled"];

/**
 * "Generate with Higgsfield" (build 4 §3.H), for the post page
 * (`kind="post"`, `targetRef="post:<id>"`) and the script studio
 * (`script_shots` / `script_thumbnails`, `targetRef="script:<id>"`). Asks for
 * the credit ceiling before anything starts, then polls the run's status.
 */
export function HiggsfieldGenerateButton({
  kind,
  targetRef,
  brandId,
  defaultMaxCredits = 20,
}: {
  kind: HiggsfieldJobKind;
  targetRef: string | null;
  brandId?: string | null;
  defaultMaxCredits?: number;
}) {
  const t = useTranslator();
  const [open, setOpen] = useState(false);
  const [maxCredits, setMaxCredits] = useState(String(defaultMaxCredits));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<{ id: number; status: HiggsfieldJobStatus } | null>(null);

  useEffect(() => {
    if (!job || TERMINAL.includes(job.status)) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/higgsfield/jobs/${job.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { status: HiggsfieldJobStatus };
        setJob((j) => (j && j.status !== body.status ? { ...j, status: body.status } : j));
      } catch {
        /* next tick */
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [job]);

  function run() {
    setError(null);
    start(async () => {
      const result = await startHiggsfieldJobAction({
        kind,
        targetRef,
        brandId: brandId ?? null,
        maxCredits: Number(maxCredits),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setJob({ id: result.jobId, status: result.status as HiggsfieldJobStatus });
    });
  }

  const busy = pending || (job !== null && !TERMINAL.includes(job.status));

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <button
          type="button"
          className={STUDIO_BUTTON}
          onClick={() => setOpen(true)}
          disabled={busy}
        >
          {t("higgsfield.generate.button")}
        </button>
      ) : (
        <div className="surface-border flex flex-wrap items-end gap-3 rounded-[var(--radius-sm)] p-3">
          <label className="w-32">
            <span className={STUDIO_LABEL}>{t("higgsfield.maxCredits")}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={maxCredits}
              onChange={(e) => setMaxCredits(e.target.value)}
              className={STUDIO_INPUT}
            />
          </label>
          <button
            type="button"
            className={STUDIO_PRIMARY}
            onClick={run}
            disabled={pending || !(Number(maxCredits) > 0)}
          >
            {t("higgsfield.generate.start")}
          </button>
          <button
            type="button"
            className={STUDIO_BUTTON}
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t("higgsfield.generate.dismiss")}
          </button>
          <p className="w-full text-xs text-[var(--color-ink-muted)]">
            {t("higgsfield.maxCreditsHint")}
          </p>
        </div>
      )}
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
      {job && (
        <ResultMessage
          tone={job.status === "failed" ? "error" : job.status === "done" ? "success" : "info"}
        >
          {t("higgsfield.generate.status", {
            id: job.id,
            status: t(`higgsfield.status.${job.status}`),
          })}{" "}
          <a href="/higgsfield" className="underline">
            {t("higgsfield.generate.open")}
          </a>
        </ResultMessage>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { cancelHiggsfieldJobAction, retryHiggsfieldJobAction } from "@/lib/higgsfield.actions";
import { useTranslator } from "@/lib/i18n/client";

import { ResultMessage } from "./ResultMessage";
import { STUDIO_BUTTON } from "./StudioStyles";

/** Cancel (active runs) or run again (finished ones) — one row of /higgsfield. */
export function HiggsfieldJobActions({ id, active }: { id: number; active: boolean }) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    if (!window.confirm(t("higgsfield.cancelConfirm"))) return;
    start(async () => {
      const result = await cancelHiggsfieldJobAction(id);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function retry() {
    start(async () => {
      const result = await retryHiggsfieldJobAction(id);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {active ? (
        <button type="button" className={STUDIO_BUTTON} onClick={cancel} disabled={pending}>
          {t("higgsfield.cancel")}
        </button>
      ) : (
        <button type="button" className={STUDIO_BUTTON} onClick={retry} disabled={pending}>
          {t("higgsfield.retry")}
        </button>
      )}
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
    </div>
  );
}

/** Refreshes the server-rendered list every few seconds while any run is active. */
export function HiggsfieldAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}

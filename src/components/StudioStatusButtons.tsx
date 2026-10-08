"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ScriptStatus } from "@/db/schema";
import { STATUS_LABEL, STUDIO_STATUSES } from "@/app/studio/model";
import { useTranslator } from "@/lib/i18n/client";
import { setStudioScriptStatus } from "@/lib/studio.actions";
import { STUDIO_BUTTON } from "./StudioStyles";

/**
 * draft → ready → recorded → posted, as one row of buttons (PLAN.md §1.32).
 * Any move is allowed, backwards included; the bridge stamps and clears
 * `recorded_at` / `posted_at` to match.
 */
export function StudioStatusButtons({
  scriptId,
  status,
}: {
  scriptId: number;
  status: ScriptStatus;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t("studio.filter.status")}
    >
      {STUDIO_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={s === status}
          disabled={pending || s === status}
          className={`${STUDIO_BUTTON} ${s === status ? "border-[var(--color-accent)] text-[var(--color-accent)] disabled:opacity-100" : ""}`}
          onClick={() =>
            startTransition(async () => {
              setFailed(false);
              try {
                await setStudioScriptStatus(scriptId, s);
                router.refresh();
              } catch {
                setFailed(true);
              }
            })
          }
        >
          {t(STATUS_LABEL[s])}
        </button>
      ))}
      {failed && (
        <span className="text-xs text-[var(--color-danger)]">{t("studio.error.generic")}</span>
      )}
    </div>
  );
}

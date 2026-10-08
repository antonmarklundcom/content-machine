"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslator } from "@/lib/i18n/client";
import { makeShorts } from "@/lib/publish.actions";
import { STUDIO_PRIMARY } from "./StudioStyles";

/** "Make shorts": 3–5 new draft scripts linked to this one (idea 7). */
export function RepurposeShortsButton({ scriptId }: { scriptId: number }) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; lines: string[] } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`${STUDIO_PRIMARY} self-start`}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setNote(null);
              try {
                const r = await makeShorts(scriptId);
                if (r.ok) {
                  setNote({
                    ok: true,
                    lines: [
                      t("publish.repurpose.made", { count: r.ids.length }),
                      ...(r.rejected
                        ? [t("publish.repurpose.rejected", { count: r.rejected })]
                        : []),
                      t("publish.cost", { cost: r.costUsd.toFixed(4) }),
                    ],
                  });
                  router.refresh();
                } else setNote({ ok: false, lines: [r.error, ...(r.errors ?? []).slice(0, 8)] });
              } catch (error) {
                setNote({
                  ok: false,
                  lines: [error instanceof Error ? error.message : t("studio.error.generic")],
                });
              }
            })
          }
        >
          {t("publish.repurpose.makeShorts")}
        </button>
        {pending && (
          <span className="text-xs text-[var(--color-ink-muted)]">{t("publish.generating")}</span>
        )}
      </div>
      {note && (
        <div
          role="status"
          className={`text-sm ${note.ok ? "text-[var(--color-ink-muted)]" : "text-[var(--color-danger)]"}`}
        >
          {note.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
    </div>
  );
}

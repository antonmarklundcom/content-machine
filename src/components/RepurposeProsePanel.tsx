"use client";

import { useState, useTransition } from "react";
import type { ScriptDerivativeKind } from "@/db/schema";
import { useTranslator } from "@/lib/i18n/client";
import { makeProse } from "@/lib/publish.actions";
import { PublishCopyButton, PublishDownloadButton } from "./PublishCopyButton";
import { STUDIO_BUTTON } from "./StudioStyles";

/** A blog post or newsletter blurb: write (again), then copy or download the Markdown (idea 7). */
export function RepurposeProsePanel({
  scriptId,
  kind,
  canGenerate,
  initial,
  filename,
}: {
  scriptId: number;
  kind: ScriptDerivativeKind;
  canGenerate: boolean;
  initial: { content: string; writtenAt: string } | null;
  filename: string;
}) {
  const t = useTranslator();
  const [current, setCurrent] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="surface-border surface-card mt-6 flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          {t(kind === "blog" ? "publish.repurpose.blog" : "publish.repurpose.newsletter")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {current && (
            <>
              <PublishCopyButton text={current.content} />
              <PublishDownloadButton
                text={current.content}
                filename={filename}
                label={t("publish.download")}
              />
            </>
          )}
          {canGenerate && (
            <button
              type="button"
              className={STUDIO_BUTTON}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setNote(null);
                  try {
                    const r = await makeProse(scriptId, kind);
                    if (r.ok) {
                      setCurrent({ content: r.content, writtenAt: new Date().toLocaleString() });
                      setNote({
                        ok: true,
                        text: t("publish.cost", { cost: r.costUsd.toFixed(4) }),
                      });
                    } else setNote({ ok: false, text: r.error });
                  } catch (error) {
                    setNote({
                      ok: false,
                      text: error instanceof Error ? error.message : t("studio.error.generic"),
                    });
                  }
                })
              }
            >
              {t(current ? "publish.repurpose.rewrite" : "publish.repurpose.write")}
            </button>
          )}
        </div>
      </div>
      {pending && (
        <p className="text-xs text-[var(--color-ink-muted)]">{t("publish.generating")}</p>
      )}
      {note && (
        <p
          role="status"
          className={`text-xs ${note.ok ? "text-[var(--color-ink-muted)]" : "text-[var(--color-danger)]"}`}
        >
          {note.text}
        </p>
      )}
      {current ? (
        <>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {t("publish.repurpose.writtenAt", { date: current.writtenAt })}
          </p>
          <pre className="max-h-[32rem] overflow-auto text-sm whitespace-pre-wrap text-[var(--color-ink)]">
            {current.content}
          </pre>
        </>
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("publish.repurpose.none")}</p>
      )}
    </section>
  );
}

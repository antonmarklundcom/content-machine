"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ContentGapEvidence } from "@/db/schema";
import { dismissGapAction, makeIdeaFromGapAction } from "@/lib/gaps.actions";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslator } from "@/lib/i18n/client";

import { ResultMessage } from "./ResultMessage";
import { STUDIO_BUTTON, STUDIO_PRIMARY } from "./StudioStyles";

export type GapCardData = {
  id: number;
  brandId: string;
  topic: string;
  angle: string | null;
  score: number | null;
  status: "new" | "planned" | "dismissed";
  ideaId: number | null;
  evidence: (ContentGapEvidence & { href: string | null })[];
};

const KIND_KEY: Record<string, TranslationKey> = {
  competitor_post: "growth.gaps.kind.competitor_post",
  report: "growth.gaps.kind.report",
  question: "growth.gaps.kind.question",
  own_post: "growth.gaps.kind.own_post",
  idea: "growth.gaps.kind.idea",
  script: "growth.gaps.kind.script",
};

/** One gap on `/research/gaps` (build 4 §3.G): topic, angle, evidence, and Make idea / Dismiss. */
export function GapCard({ gap }: { gap: GapCardData }) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error);
    });

  return (
    <li className="surface-border rounded-[var(--radius-sm)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">{gap.topic}</h3>
          {gap.angle ? (
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{gap.angle}</p>
          ) : null}
        </div>
        <span
          className="shrink-0 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-ink)]"
          title={t("growth.gaps.scoreHint")}
        >
          {gap.score ?? "–"}/10
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
        {gap.evidence.map((e) => (
          <li key={e.ref}>
            <span className="font-medium text-[var(--color-ink)]">
              {KIND_KEY[e.kind] ? t(KIND_KEY[e.kind]) : e.kind}
            </span>{" "}
            {e.href ? (
              <a
                href={e.href}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-[var(--color-accent)]"
              >
                {e.note}
              </a>
            ) : (
              e.note
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {gap.ideaId ? (
          <a
            href={`/brand/${encodeURIComponent(gap.brandId)}?status=proposed`}
            className="text-xs underline text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
          >
            {t("growth.gaps.ideaMade", { id: gap.ideaId })}
          </a>
        ) : (
          <button
            type="button"
            disabled={pending}
            className={STUDIO_PRIMARY}
            onClick={() => run(() => makeIdeaFromGapAction(gap.id))}
          >
            {t("growth.gaps.makeIdea")}
          </button>
        )}
        {gap.status !== "dismissed" ? (
          <button
            type="button"
            disabled={pending}
            className={STUDIO_BUTTON}
            onClick={() => run(() => dismissGapAction(gap.id))}
          >
            {t("growth.gaps.dismiss")}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="mt-2">
          <ResultMessage tone="error">{error}</ResultMessage>
        </div>
      ) : null}
    </li>
  );
}

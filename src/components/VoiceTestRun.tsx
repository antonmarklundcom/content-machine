"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { translator, type Locale } from "@/lib/i18n";
import type { TakeView } from "@/lib/voice/views";
import { markWinnerAction } from "@/lib/voice.actions";

import { ResultMessage } from "./ResultMessage";
import {
  VOICE_BADGE_ON,
  VOICE_BADGE_WARN,
  VOICE_BUTTON,
  VOICE_INPUT,
  voiceAssetUrl,
  voiceDuration,
  voiceUsd,
} from "./VoiceStyles";

/** One voice-gate run: the takes side by side, with "Mark winner" (selected + approved + note). */
export function VoiceTestRun({
  ownerRef,
  takes,
  locale,
}: {
  ownerRef: string;
  takes: TakeView[];
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const total = takes.reduce((sum, take) => sum + take.costUsd, 0);
  const first = takes[0];

  const win = (id: number) =>
    start(async () => {
      const r = await markWinnerAction(id, notes[id] ?? "");
      setError(r.ok ? null : `${t(r.error)}${r.detail ? ` ${r.detail}` : ""}`);
      router.refresh();
    });

  return (
    <section className="surface-border surface-card flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-sm text-[var(--color-ink)]">{ownerRef}</h3>
        <span className="text-xs text-[var(--color-ink-muted)]">
          {first?.language} · {t("voice.test.total", { cost: voiceUsd(total) })}
        </span>
      </header>
      {first && (
        <p className="line-clamp-2 text-xs text-[var(--color-ink-muted)]">{first.inputText}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {takes.map((take) => (
          <div key={take.id} className="surface-border flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-[var(--color-ink)]">
                {take.profileName ?? take.provider}
              </span>
              {take.selected && <span className={VOICE_BADGE_ON}>{t("voice.test.winner")}</span>}
              {take.status !== "done" && (
                <span className={VOICE_BADGE_WARN}>{t(`voice.takes.status.${take.status}`)}</span>
              )}
            </div>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {t(`voice.provider.${take.provider}`)} · {voiceDuration(take.durationMs)} ·{" "}
              {voiceUsd(take.costUsd)}
            </p>
            {take.playbackAssetId ? (
              <audio
                controls
                preload="none"
                src={voiceAssetUrl(take.playbackAssetId)}
                className="w-full"
              />
            ) : (
              <p className="text-xs text-[var(--color-danger)]">
                {take.error ?? t("voice.noAudio")}
              </p>
            )}
            {take.reviewNote && (
              <p className="text-xs text-[var(--color-ink-muted)]">“{take.reviewNote}”</p>
            )}
            {take.status === "done" && !take.selected && (
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label={t("voice.test.winnerNote")}
                  placeholder={t("voice.test.winnerNote")}
                  value={notes[take.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [take.id]: e.target.value })}
                  className={`${VOICE_INPUT} flex-1`}
                />
                <button
                  type="button"
                  className={VOICE_BUTTON}
                  disabled={pending}
                  onClick={() => win(take.id)}
                >
                  {t("voice.test.markWinner")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
    </section>
  );
}

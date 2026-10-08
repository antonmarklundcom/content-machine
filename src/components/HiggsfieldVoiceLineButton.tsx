"use client";

import { useEffect, useState, useTransition } from "react";

import type { HiggsfieldJobStatus } from "@/db/schema";
import { estimateLineCredits } from "@/lib/higgsfield/voice";
import { higgsfieldVoiceProfilesAction, queueVoiceAction } from "@/lib/higgsfield-voice.actions";
import { translator, type Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/client";
import type { NarrationOwnerKind, VoiceLanguage } from "@/lib/voice/contract";
import type { HiggsfieldProfileOption } from "@/lib/voice/higgsfield-takes";

import { HiggsfieldVoiceStatus, type QueuedVoiceJob } from "./HiggsfieldVoiceStatus";
import { ResultMessage } from "./ResultMessage";
import { VOICE_BUTTON, VOICE_INPUT } from "./VoiceStyles";

export type HiggsfieldVoiceLineButtonProps = {
  ownerKind: NarrationOwnerKind;
  ownerRef: string;
  sceneRef?: string | null;
  language: VoiceLanguage;
  speaker?: string | null;
  /** The approved text, verbatim (pronunciations are applied when queued). */
  text: string;
  pronunciationScope?: string | null;
  /** Higgsfield profiles; loaded from the server when left out. */
  profiles?: HiggsfieldProfileOption[];
  defaultVoiceProfileId?: number | null;
  defaultMaxCredits?: number;
  locale?: Locale;
  /** Called when the job ends (NarrationTakes reloads through it). */
  onDone?: (jobId: number) => void;
};

/**
 * Queue one line as a Higgsfield take (build 5 §3.A): the NarrateButton for
 * Higgsfield profiles. The take arrives when the job ends (Claude Code on the
 * PC); the estimate is this app's, the run's get_cost is the truth.
 */
export function HiggsfieldVoiceLineButton(props: HiggsfieldVoiceLineButtonProps) {
  const cookieLocale = useLocale();
  const t = translator(props.locale ?? cookieLocale);
  const [loaded, setLoaded] = useState<HiggsfieldProfileOption[] | null>(props.profiles ?? null);
  const [profileId, setProfileId] = useState<number | null>(props.defaultVoiceProfileId ?? null);
  const [maxCredits, setMaxCredits] = useState(String(props.defaultMaxCredits ?? 5));
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<QueuedVoiceJob | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (props.profiles) {
      setLoaded(props.profiles);
      return;
    }
    let live = true;
    void higgsfieldVoiceProfilesAction().then((r) => {
      if (live) setLoaded(r.ok ? r.profiles : []);
    });
    return () => {
      live = false;
    };
  }, [props.profiles]);

  const usable = (loaded ?? []).filter(
    (p) => p.languages.length === 0 || p.languages.includes(props.language),
  );
  const chosen =
    usable.find((p) => p.id === profileId) ??
    usable.find((p) => props.speaker && p.characterKey === props.speaker) ??
    usable[0] ??
    null;

  if (loaded && !usable.length) return null;

  const estimate = chosen?.model
    ? estimateLineCredits(props.text, chosen.model, chosen.variant)
    : 0;

  const queue = () => {
    if (!chosen) return;
    setError(null);
    start(async () => {
      const r = await queueVoiceAction({
        ownerKind: props.ownerKind,
        ownerRef: props.ownerRef,
        sceneRef: props.sceneRef ?? null,
        language: props.language,
        voiceProfileId: chosen.id,
        text: props.text,
        speaker: props.speaker ?? null,
        pronunciationScope: props.pronunciationScope ?? null,
        maxCredits: Number(maxCredits),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setJob({
        id: r.jobId,
        status: r.status as HiggsfieldJobStatus,
        lines: r.lines,
        credits: r.estimateCredits,
      });
    });
  };

  const id = `hf-line-${props.ownerRef}-${props.sceneRef ?? ""}-${props.speaker ?? ""}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${id}-voice`}>
          {t("hfVoice.batch.voice")}
        </label>
        <select
          id={`${id}-voice`}
          className={`${VOICE_INPUT} w-auto`}
          value={chosen?.id ?? ""}
          onChange={(e) => setProfileId(Number(e.target.value) || null)}
          disabled={!loaded || pending}
        >
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {t("hfVoice.line.button")}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${id}-max`}>
          {t("hfVoice.batch.maxCredits")}
        </label>
        <input
          id={`${id}-max`}
          type="number"
          min={1}
          step={1}
          value={maxCredits}
          onChange={(e) => setMaxCredits(e.target.value)}
          title={t("hfVoice.batch.maxCredits")}
          className={`${VOICE_INPUT} w-20`}
        />
        <button
          type="button"
          className={VOICE_BUTTON}
          onClick={queue}
          disabled={!chosen || pending || !(Number(maxCredits) > 0)}
        >
          {t("hfVoice.batch.start")}
        </button>
        {chosen && (
          <span className="text-xs text-[var(--color-ink-muted)]">
            {t("hfVoice.line.estimate", { credits: estimate })}
          </span>
        )}
      </div>
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
      {job && (
        <HiggsfieldVoiceStatus
          job={job}
          t={t}
          onEnd={(status) => status === "done" && props.onDone?.(job.id)}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";

import { translator, type Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/client";
import type { NarrationOwnerKind, VoiceLanguage } from "@/lib/voice/contract";
import { narrateAction, voiceOptionsAction, type VoiceOption } from "@/lib/voice.actions";

import { ResultMessage } from "./ResultMessage";
import { VOICE_BUTTON, VOICE_INPUT, voiceUsd } from "./VoiceStyles";

export type NarrateButtonProps = {
  ownerKind: NarrationOwnerKind;
  ownerRef: string;
  sceneRef?: string | null;
  language: VoiceLanguage;
  speaker?: string | null;
  /** The approved text, verbatim (the engine applies pronunciations). */
  text: string;
  /** e.g. `story:<slug>` or `brand:<id>`, for scoped pronunciations. */
  pronunciationScope?: string | null;
  /** Preselect this profile (e.g. a character's voice). */
  defaultVoiceProfileId?: number | null;
  locale?: Locale;
  /** Called after a take is made (NarrationTakes reloads through it). */
  onDone?: (narrationId: number) => void;
};

/**
 * Pick a voice and make a take (build 4 phase A). Offers the active profiles
 * that list `language` (TTS ones only: a recording is uploaded instead).
 * Refusals (consent, Guaraní, a missing key) come back as the engine's message.
 */
export function NarrateButton(props: NarrateButtonProps) {
  const cookieLocale = useLocale();
  const t = translator(props.locale ?? cookieLocale);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voiceId, setVoiceId] = useState<number | null>(props.defaultVoiceProfileId ?? null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void voiceOptionsAction().then((r) => {
      if (!live || !r.ok) return;
      const usable = r.voices.filter(
        (v) =>
          v.provider !== "manual" &&
          (v.languages.length === 0 || v.languages.includes(props.language)),
      );
      setVoices(usable);
      setVoiceId((current) =>
        current && usable.some((v) => v.id === current)
          ? current
          : (usable.find((v) => props.speaker && v.characterKey === props.speaker)?.id ??
            usable[0]?.id ??
            null),
      );
    });
    return () => {
      live = false;
    };
  }, [props.language, props.speaker]);

  if (voices && voices.length === 0) {
    return <p className="text-xs text-[var(--color-ink-muted)]">{t("voice.narrate.noVoices")}</p>;
  }

  const make = () => {
    if (!voiceId) return;
    setMessage(null);
    start(async () => {
      const r = await narrateAction({
        ownerKind: props.ownerKind,
        ownerRef: props.ownerRef,
        sceneRef: props.sceneRef ?? null,
        speaker: props.speaker ?? null,
        language: props.language,
        voiceProfileId: voiceId,
        text: props.text,
        pronunciationScope: props.pronunciationScope ?? null,
      });
      if (r.ok) {
        setMessage({
          tone: "success",
          text: t("voice.narrate.made", { cost: voiceUsd(r.costUsd) }),
        });
        props.onDone?.(r.narrationId);
      } else {
        setMessage({
          tone: "error",
          text: `${t(r.error)}${r.detail ? ` ${r.detail}` : ""}`,
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`narrate-${props.ownerRef}-${props.sceneRef ?? ""}`}>
          {t("voice.narrate.voice")}
        </label>
        <select
          id={`narrate-${props.ownerRef}-${props.sceneRef ?? ""}`}
          className={`${VOICE_INPUT} w-auto`}
          value={voiceId ?? ""}
          onChange={(e) => setVoiceId(Number(e.target.value) || null)}
          disabled={!voices || pending}
        >
          {(voices ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} · {t(`voice.provider.${v.provider}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={VOICE_BUTTON}
          onClick={make}
          disabled={!voiceId || pending}
        >
          {pending ? t("voice.narrate.making") : t("voice.narrate.make")}
        </button>
      </div>
      {message && <ResultMessage tone={message.tone}>{message.text}</ResultMessage>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { translator, type Locale } from "@/lib/i18n";
import { VOICE_LANGUAGES } from "@/lib/voice/contract";
import { runVoiceTestAction, type VoiceTestResult } from "@/lib/voice.actions";

import { ResultMessage } from "./ResultMessage";
import { VOICE_INPUT, VOICE_LABEL, VOICE_PRIMARY } from "./VoiceStyles";

export type VoiceTestScript = { id: number; title: string; language: string; text: string };
export type VoiceTestProfile = { id: number; name: string; provider: string; languages: string[] };

/** The voice gate's input: a script, a language, 2–4 voices → "Render all". */
export function VoiceTestForm({
  scripts,
  profiles,
  locale,
}: {
  scripts: VoiceTestScript[];
  profiles: VoiceTestProfile[];
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    runVoiceTestAction,
    null as VoiceTestResult | null,
  );
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("es-PY");

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const usable = profiles.filter((p) => p.languages.length === 0 || p.languages.includes(language));
  const failures = state?.ok ? state.outcomes.filter((o) => !o.ok) : [];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {scripts.length > 0 && (
        <label className="flex flex-col gap-1" htmlFor="voice-test-script">
          <span className={VOICE_LABEL}>{t("voice.test.fromStudio")}</span>
          <select
            id="voice-test-script"
            className={VOICE_INPUT}
            defaultValue=""
            onChange={(e) => {
              const s = scripts.find((x) => String(x.id) === e.target.value);
              if (!s) return;
              setText(s.text);
              if ((VOICE_LANGUAGES as readonly string[]).includes(s.language))
                setLanguage(s.language);
            }}
          >
            <option value="">{t("voice.test.pickScript")}</option>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.language})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1" htmlFor="voice-test-text">
        <span className={VOICE_LABEL}>
          {t("voice.test.script")} · {t("voice.test.estimate", { chars: [...text].length })}
        </span>
        <textarea
          id="voice-test-text"
          name="text"
          rows={8}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("voice.test.scriptPlaceholder")}
          className={VOICE_INPUT}
        />
      </label>
      <label className="flex flex-col gap-1 sm:w-48" htmlFor="voice-test-language">
        <span className={VOICE_LABEL}>{t("voice.language")}</span>
        <select
          id="voice-test-language"
          name="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className={VOICE_INPUT}
        >
          {VOICE_LANGUAGES.filter((l) => l !== "gn").map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className={VOICE_LABEL}>{t("voice.test.voices")}</legend>
        {usable.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("voice.test.noProfiles")}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {usable.map((p) => (
              <label key={p.id} className="flex items-center gap-1 text-sm text-[var(--color-ink)]">
                <input type="checkbox" name="profiles" value={p.id} />
                {p.name}{" "}
                <span className="text-xs text-[var(--color-ink-muted)]">({p.provider})</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div>
        <button type="submit" className={VOICE_PRIMARY} disabled={pending || usable.length === 0}>
          {pending ? t("voice.test.running") : t("voice.test.run")}
        </button>
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
      {state?.ok && failures.length === 0 && (
        <ResultMessage tone="success">{t("voice.test.done")}</ResultMessage>
      )}
      {failures.map((f) => (
        <ResultMessage key={f.profileId} tone="error">
          {profiles.find((p) => p.id === f.profileId)?.name}: {!f.ok && t(f.error)}
          {!f.ok && f.detail ? ` ${f.detail}` : ""}
        </ResultMessage>
      ))}
    </form>
  );
}

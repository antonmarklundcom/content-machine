"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { creditsPerMinute, engineSpeaks } from "@/lib/higgsfield/voice";
import { saveVoiceProfileWithHiggsfieldAction } from "@/lib/higgsfield-voice.actions";
import { translator, type Locale } from "@/lib/i18n";
import {
  CONSENT_STATUSES,
  HIGGSFIELD_TTS_MODELS,
  HIGGSFIELD_TTS_VARIANTS,
  VOICE_LANGUAGES,
  VOICE_PROVIDERS,
  type HiggsfieldTtsModel,
  type HiggsfieldTtsVariant,
  type VoiceProvider,
  type VoiceSettings,
} from "@/lib/voice/contract";
import type { ProviderVoice } from "@/lib/voice/providers/types";
import { loadProviderVoicesAction, type VoiceActionResult } from "@/lib/voice.actions";

import { ResultMessage } from "./ResultMessage";
import { VOICE_BUTTON, VOICE_INPUT, VOICE_LABEL, VOICE_PRIMARY } from "./VoiceStyles";

export type VoiceProfileFormValues = {
  key: string;
  name: string;
  provider: VoiceProvider;
  providerVoiceId: string;
  languages: string[];
  role: "narrator" | "character";
  characterKey: string;
  brandId: string;
  settings: VoiceSettings;
  consentStatus: (typeof CONSENT_STATUSES)[number];
  consentPerson: string;
  consentScope: string;
  /** YYYY-MM-DD */
  consentSignedAt: string;
  consentExpiresAt: string;
  active: boolean;
  notes: string;
};

const EMPTY: VoiceProfileFormValues = {
  key: "",
  name: "",
  provider: "azure",
  providerVoiceId: "",
  languages: ["es-PY"],
  role: "narrator",
  characterKey: "",
  brandId: "",
  settings: {},
  consentStatus: "not_needed",
  consentPerson: "",
  consentScope: "",
  consentSignedAt: "",
  consentExpiresAt: "",
  active: true,
  notes: "",
};

/**
 * Create or edit a voice profile. "Load voices" lists the provider's voices
 * (ElevenLabs, Azure: es-PY first; Gemini: its prebuilt names). Guaraní is
 * only offered for a recorded (manual) voice.
 */
export function VoiceProfileForm({
  id,
  initial,
  brands,
  locale,
  onDone,
  onCancel,
}: {
  id: number | null;
  initial?: VoiceProfileFormValues;
  brands: Array<{ id: string; name: string }>;
  locale: Locale;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const t = translator(locale);
  const values = initial ?? EMPTY;
  const [state, formAction, pending] = useActionState(
    // Build 5: a wrapper that also stores `settings.higgsfield`; other providers pass through.
    saveVoiceProfileWithHiggsfieldAction.bind(null, id),
    null as VoiceActionResult | null,
  );
  const [provider, setProvider] = useState<VoiceProvider>(values.provider);
  const [role, setRole] = useState(values.role);
  const [consent, setConsent] = useState(values.consentStatus);
  const [voiceId, setVoiceId] = useState(values.providerVoiceId);
  const [voices, setVoices] = useState<ProviderVoice[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [hfModel, setHfModel] = useState<HiggsfieldTtsModel>(
    values.settings.higgsfield?.model ?? "text2speech_v2",
  );
  const [hfVariant, setHfVariant] = useState<HiggsfieldTtsVariant>(
    values.settings.higgsfield?.variant ?? "elevenlabs",
  );
  const [hfVoiceType, setHfVoiceType] = useState<"preset" | "element">(
    values.settings.higgsfield?.voiceType ?? "preset",
  );
  const [loading, startLoading] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const prefix = `voice-${id ?? "new"}`;
  const f = (name: string) => `${prefix}-${name}`;

  useEffect(() => {
    if (!state?.ok) return;
    if (onDone) onDone();
    else formRef.current?.reset();
  }, [state, onDone]);

  const loadVoices = () =>
    startLoading(async () => {
      setVoicesError(null);
      const r = await loadProviderVoicesAction(provider);
      if (r.ok) setVoices(r.voices);
      else setVoicesError(`${t(r.error)}${r.detail ? ` ${r.detail}` : ""}`);
    });

  const s = values.settings;
  const hf = provider === "higgsfield";
  // A cloned (element) voice is a person: its consent starts pending (build 5 §1.4).
  const pickVoiceType = (next: "preset" | "element") => {
    setHfVoiceType(next);
    if (next === "element" && consent === "not_needed") setConsent("pending");
    if (next === "preset" && consent === "pending") setConsent("not_needed");
  };
  const price = creditsPerMinute(hfModel, hfModel === "text2speech_v2" ? hfVariant : null);
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1" htmlFor={f("key")}>
          <span className={VOICE_LABEL}>{t("voice.field.key")}</span>
          <input
            id={f("key")}
            name="key"
            required
            pattern="[a-z0-9][a-z0-9-]*"
            defaultValue={values.key}
            placeholder={t("voice.field.keyHelp")}
            className={VOICE_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor={f("name")}>
          <span className={VOICE_LABEL}>{t("voice.field.name")}</span>
          <input
            id={f("name")}
            name="name"
            required
            defaultValue={values.name}
            className={VOICE_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor={f("provider")}>
          <span className={VOICE_LABEL}>{t("voice.provider")}</span>
          <select
            id={f("provider")}
            name="provider"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as VoiceProvider);
              setVoices(null);
            }}
            className={VOICE_INPUT}
          >
            {VOICE_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {t(`voice.provider.${p}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {provider !== "manual" && provider !== "chatterbox" && (
        <div className="flex flex-col gap-1">
          <label className={VOICE_LABEL} htmlFor={f("providerVoiceId")}>
            {t("voice.field.providerVoiceId")}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={f("providerVoiceId")}
              name="providerVoiceId"
              required
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder={hf ? t("hfVoice.field.voiceId") : t("voice.field.providerVoiceIdHelp")}
              className={`${VOICE_INPUT} flex-1`}
            />
            {!hf && (
              <button
                type="button"
                className={VOICE_BUTTON}
                onClick={loadVoices}
                disabled={loading}
              >
                {loading ? t("voice.field.loadingVoices") : t("voice.field.loadVoices")}
              </button>
            )}
          </div>
          {hf && (
            <p className="text-xs text-[var(--color-ink-muted)]">
              {t("hfVoice.field.voiceIdHelp")}
            </p>
          )}
          {voices && voices.length > 0 && (
            <select
              aria-label={t("voice.field.pickVoice")}
              className={VOICE_INPUT}
              value=""
              onChange={(e) => e.target.value && setVoiceId(e.target.value)}
            >
              <option value="">{t("voice.field.pickVoice")}</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.name, v.locale, v.gender, v.description].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          )}
          {voicesError && <ResultMessage tone="error">{voicesError}</ResultMessage>}
        </div>
      )}

      <fieldset className="flex flex-col gap-1">
        <legend className={VOICE_LABEL}>{t("voice.field.languages")}</legend>
        <div className="flex flex-wrap gap-3">
          {VOICE_LANGUAGES.filter((l) => l !== "gn" || provider === "manual").map((l) => (
            <label key={l} className="flex items-center gap-1 text-sm text-[var(--color-ink)]">
              <input
                type="checkbox"
                name="languages"
                value={l}
                defaultChecked={values.languages.includes(l)}
              />
              {l}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1" htmlFor={f("role")}>
          <span className={VOICE_LABEL}>{t("voice.field.role")}</span>
          <select
            id={f("role")}
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as "narrator" | "character")}
            className={VOICE_INPUT}
          >
            <option value="narrator">{t("voice.field.role.narrator")}</option>
            <option value="character">{t("voice.field.role.character")}</option>
          </select>
        </label>
        {role === "character" && (
          <label className="flex flex-col gap-1" htmlFor={f("characterKey")}>
            <span className={VOICE_LABEL}>{t("voice.field.characterKey")}</span>
            <input
              id={f("characterKey")}
              name="characterKey"
              defaultValue={values.characterKey}
              className={VOICE_INPUT}
            />
          </label>
        )}
        <label className="flex flex-col gap-1" htmlFor={f("brandId")}>
          <span className={VOICE_LABEL}>{t("voice.field.brand")}</span>
          <select
            id={f("brandId")}
            name="brandId"
            defaultValue={values.brandId}
            className={VOICE_INPUT}
          >
            <option value="">{t("voice.profiles.allBrands")}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hf && (
        <fieldset className="surface-border flex flex-col gap-3 p-3">
          <legend className={`${VOICE_LABEL} px-1`}>{t("hfVoice.settings")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1" htmlFor={f("hfModel")}>
              <span className={VOICE_LABEL}>{t("hfVoice.field.model")}</span>
              <select
                id={f("hfModel")}
                name="hfModel"
                value={hfModel}
                onChange={(e) => setHfModel(e.target.value as HiggsfieldTtsModel)}
                className={VOICE_INPUT}
              >
                {HIGGSFIELD_TTS_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {hfModel === "text2speech_v2" && (
              <label className="flex flex-col gap-1" htmlFor={f("hfVariant")}>
                <span className={VOICE_LABEL}>{t("hfVoice.field.variant")}</span>
                <select
                  id={f("hfVariant")}
                  name="hfVariant"
                  value={hfVariant}
                  onChange={(e) => setHfVariant(e.target.value as HiggsfieldTtsVariant)}
                  className={VOICE_INPUT}
                >
                  {HIGGSFIELD_TTS_VARIANTS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1" htmlFor={f("hfVoiceType")}>
              <span className={VOICE_LABEL}>{t("hfVoice.field.voiceType")}</span>
              <select
                id={f("hfVoiceType")}
                name="hfVoiceType"
                value={hfVoiceType}
                onChange={(e) => pickVoiceType(e.target.value as "preset" | "element")}
                className={VOICE_INPUT}
              >
                <option value="preset">{t("hfVoice.field.voiceType.preset")}</option>
                <option value="element">{t("hfVoice.field.voiceType.element")}</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {t(price.measured ? "hfVoice.field.price" : "hfVoice.field.priceUnmeasured", {
              credits: price.credits,
            })}
            {!engineSpeaks(hfModel, "es-PY") && ` ${t("hfVoice.field.noSpanish")}`}
          </p>
          {hfVoiceType === "element" && (
            <p className="text-xs text-[var(--color-warn)]">{t("hfVoice.field.elementNote")}</p>
          )}
        </fieldset>
      )}

      {provider === "chatterbox" && (
        <fieldset className="surface-border flex flex-col gap-3 p-3">
          <legend className={`${VOICE_LABEL} px-1`}>{t("chatterbox.settings")}</legend>
          <p className="text-xs text-[var(--color-ink-muted)]">{t("chatterbox.settings.help")}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1" htmlFor={f("cbMode")}>
              <span className={VOICE_LABEL}>{t("chatterbox.field.mode")}</span>
              <select
                id={f("cbMode")}
                name="cbMode"
                defaultValue={s.chatterbox?.mode ?? "local"}
                className={VOICE_INPUT}
              >
                <option value="local">{t("chatterbox.mode.local")}</option>
                <option value="replicate">{t("chatterbox.mode.replicate")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1" htmlFor={f("cbExaggeration")}>
              <span className={VOICE_LABEL}>{t("chatterbox.field.exaggeration")}</span>
              <input
                id={f("cbExaggeration")}
                name="cbExaggeration"
                type="number"
                step="0.05"
                min="0.25"
                max="2"
                defaultValue={s.chatterbox?.exaggeration ?? ""}
                placeholder="0.5"
                className={VOICE_INPUT}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor={f("cbCfgWeight")}>
              <span className={VOICE_LABEL}>{t("chatterbox.field.cfgWeight")}</span>
              <input
                id={f("cbCfgWeight")}
                name="cbCfgWeight"
                type="number"
                step="0.05"
                min="0"
                max="1"
                defaultValue={s.chatterbox?.cfgWeight ?? ""}
                placeholder="0.5"
                className={VOICE_INPUT}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor={f("cbLanguageId")}>
              <span className={VOICE_LABEL}>{t("chatterbox.field.languageId")}</span>
              <input
                id={f("cbLanguageId")}
                name="cbLanguageId"
                defaultValue={s.chatterbox?.languageId ?? ""}
                placeholder="es"
                className={VOICE_INPUT}
              />
            </label>
          </div>
        </fieldset>
      )}

      {provider !== "manual" && provider !== "chatterbox" && !hf && (
        <fieldset className="surface-border flex flex-col gap-3 p-3">
          <legend className={`${VOICE_LABEL} px-1`}>{t("voice.field.settings")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1" htmlFor={f("model")}>
              <span className={VOICE_LABEL}>{t("voice.field.model")}</span>
              <input
                id={f("model")}
                name="model"
                defaultValue={s.model ?? ""}
                placeholder={
                  provider === "elevenlabs"
                    ? "eleven_multilingual_v2"
                    : provider === "gemini"
                      ? "gemini-2.5-flash-preview-tts"
                      : ""
                }
                className={VOICE_INPUT}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor={f("speed")}>
              <span className={VOICE_LABEL}>{t("voice.field.speed")}</span>
              <input
                id={f("speed")}
                name="speed"
                type="number"
                step="0.05"
                min="0.7"
                max="1.2"
                defaultValue={s.speed ?? ""}
                className={VOICE_INPUT}
              />
            </label>
            {provider === "elevenlabs" &&
              (["stability", "similarity", "style"] as const).map((k) => (
                <label key={k} className="flex flex-col gap-1" htmlFor={f(k)}>
                  <span className={VOICE_LABEL}>{t(`voice.field.${k}`)}</span>
                  <input
                    id={f(k)}
                    name={k}
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    defaultValue={s[k] ?? ""}
                    className={VOICE_INPUT}
                  />
                </label>
              ))}
            {provider === "azure" && (
              <>
                <label className="flex flex-col gap-1" htmlFor={f("azureStyle")}>
                  <span className={VOICE_LABEL}>{t("voice.field.azureStyle")}</span>
                  <input
                    id={f("azureStyle")}
                    name="azureStyle"
                    defaultValue={s.azureStyle ?? ""}
                    className={VOICE_INPUT}
                  />
                </label>
                <label className="flex flex-col gap-1" htmlFor={f("pitch")}>
                  <span className={VOICE_LABEL}>{t("voice.field.pitch")}</span>
                  <input
                    id={f("pitch")}
                    name="pitch"
                    defaultValue={s.pitch ?? ""}
                    className={VOICE_INPUT}
                  />
                </label>
              </>
            )}
          </div>
          {provider === "gemini" && (
            <label className="flex flex-col gap-1" htmlFor={f("instructions")}>
              <span className={VOICE_LABEL}>{t("voice.field.instructions")}</span>
              <input
                id={f("instructions")}
                name="instructions"
                defaultValue={s.instructions ?? ""}
                placeholder={t("voice.field.instructionsPlaceholder")}
                className={VOICE_INPUT}
              />
            </label>
          )}
        </fieldset>
      )}

      <fieldset className="surface-border flex flex-col gap-3 p-3">
        <legend className={`${VOICE_LABEL} px-1`}>{t("voice.profiles.consent")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1" htmlFor={f("consentStatus")}>
            <span className={VOICE_LABEL}>{t("voice.field.consentStatus")}</span>
            <select
              id={f("consentStatus")}
              name="consentStatus"
              value={consent}
              onChange={(e) =>
                setConsent(e.target.value as VoiceProfileFormValues["consentStatus"])
              }
              className={VOICE_INPUT}
            >
              {CONSENT_STATUSES.map((c) => (
                <option key={c} value={c}>
                  {t(`voice.field.consent.${c}`)}
                </option>
              ))}
            </select>
          </label>
          {consent !== "not_needed" && (
            <label className="flex flex-col gap-1" htmlFor={f("consentPerson")}>
              <span className={VOICE_LABEL}>{t("voice.field.consentPerson")}</span>
              <input
                id={f("consentPerson")}
                name="consentPerson"
                required
                defaultValue={values.consentPerson}
                className={VOICE_INPUT}
              />
            </label>
          )}
        </div>
        {consent !== "not_needed" && (
          <>
            <label className="flex flex-col gap-1" htmlFor={f("consentScope")}>
              <span className={VOICE_LABEL}>{t("voice.field.consentScope")}</span>
              <textarea
                id={f("consentScope")}
                name="consentScope"
                rows={2}
                defaultValue={values.consentScope}
                placeholder={t("voice.field.consentScopePlaceholder")}
                className={VOICE_INPUT}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1" htmlFor={f("consentSignedAt")}>
                <span className={VOICE_LABEL}>{t("voice.field.consentSignedAt")}</span>
                <input
                  id={f("consentSignedAt")}
                  name="consentSignedAt"
                  type="date"
                  defaultValue={values.consentSignedAt}
                  className={VOICE_INPUT}
                />
              </label>
              <label className="flex flex-col gap-1" htmlFor={f("consentExpiresAt")}>
                <span className={VOICE_LABEL}>{t("voice.field.consentExpiresAt")}</span>
                <input
                  id={f("consentExpiresAt")}
                  name="consentExpiresAt"
                  type="date"
                  defaultValue={values.consentExpiresAt}
                  className={VOICE_INPUT}
                />
              </label>
            </div>
          </>
        )}
      </fieldset>

      <label className="flex flex-col gap-1" htmlFor={f("notes")}>
        <span className={VOICE_LABEL}>{t("voice.field.notes")}</span>
        <textarea
          id={f("notes")}
          name="notes"
          rows={1}
          defaultValue={values.notes}
          className={VOICE_INPUT}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
        <input type="checkbox" name="active" defaultChecked={values.active} />
        {t("voice.field.active")}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={VOICE_PRIMARY}>
          {pending ? t("voice.saving") : id === null ? t("voice.profiles.add") : t("voice.save")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={VOICE_BUTTON}>
            {t("voice.cancel")}
          </button>
        )}
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
      {state?.ok && !onDone && <ResultMessage tone="success">{t("voice.saved")}</ResultMessage>}
    </form>
  );
}

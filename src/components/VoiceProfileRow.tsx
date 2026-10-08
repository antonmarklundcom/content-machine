"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { translator, type Locale } from "@/lib/i18n";
import { setVoiceProfileActiveAction } from "@/lib/voice.actions";

import { ResultMessage } from "./ResultMessage";
import { VoiceProfileForm, type VoiceProfileFormValues } from "./VoiceProfileForm";
import { VOICE_BADGE, VOICE_BADGE_ON, VOICE_BADGE_WARN, VOICE_BUTTON } from "./VoiceStyles";

export type VoiceProfileRowData = VoiceProfileFormValues & {
  id: number;
  hasConsentDoc: boolean;
  /** The consent blocks takes right now (pending, revoked or expired). */
  consentBlocks: boolean;
};

/** One voice profile: summary, edit, on/off, and the signed-consent upload. */
export function VoiceProfileRow({
  profile,
  brands,
  locale,
}: {
  profile: VoiceProfileRowData;
  brands: Array<{ id: string; name: string }>;
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  if (editing) {
    return (
      <li className="surface-border surface-card p-4">
        <VoiceProfileForm
          id={profile.id}
          initial={profile}
          brands={brands}
          locale={locale}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const toggle = () =>
    start(async () => {
      const r = await setVoiceProfileActiveAction(profile.id, !profile.active);
      if (!r.ok) setMessage({ tone: "error", text: t(r.error) });
      router.refresh();
    });

  const uploadConsent = async (file: File) => {
    const form = new FormData();
    form.set("profileId", String(profile.id));
    form.set("file", file);
    setUploading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/voice/consent", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMessage({ tone: "success", text: t("voice.profiles.consentUploaded") });
        router.refresh();
      } else {
        setMessage({
          tone: "error",
          text: `${t("voice.error.upload")} ${json.error ?? res.status}`,
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const brand = brands.find((b) => b.id === profile.brandId)?.name ?? profile.brandId;
  return (
    <li className="surface-border surface-card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[var(--color-ink)]">{profile.name}</span>
        <span className="font-mono text-xs text-[var(--color-ink-muted)]">{profile.key}</span>
        <span className={VOICE_BADGE}>{t(`voice.provider.${profile.provider}`)}</span>
        {!profile.active && (
          <span className={VOICE_BADGE_WARN}>{t("voice.profiles.inactive")}</span>
        )}
        {profile.consentStatus !== "not_needed" && (
          <span className={profile.consentBlocks ? VOICE_BADGE_WARN : VOICE_BADGE_ON}>
            {t("voice.profiles.consent")}: {t(`voice.field.consent.${profile.consentStatus}`)}
            {profile.consentExpiresAt
              ? ` · ${t("voice.profiles.consentExpires", { date: profile.consentExpiresAt })}`
              : ""}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">
        {profile.providerVoiceId ? (
          <span className="font-mono">{profile.providerVoiceId}</span>
        ) : null}
        {profile.providerVoiceId ? " · " : ""}
        {profile.languages.join(", ")} · {t(`voice.field.role.${profile.role}`)}
        {profile.characterKey
          ? ` · ${t("voice.profiles.character", { key: profile.characterKey })}`
          : ""}
        {" · "}
        {brand ? t("voice.profiles.brand", { brand }) : t("voice.profiles.allBrands")}
      </p>
      {profile.consentStatus !== "not_needed" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-ink-muted)]">
            {t("voice.profiles.consentDoc")}
            {profile.consentPerson ? ` (${profile.consentPerson})` : ""}:
          </span>
          {profile.hasConsentDoc && (
            <a
              className="text-[var(--color-accent)] underline"
              href={`/api/voice/consent/${profile.id}`}
            >
              {t("voice.profiles.consentView")}
            </a>
          )}
          <label className={VOICE_BUTTON}>
            {uploading ? t("voice.takes.uploading") : t("voice.profiles.consentUpload")}
            <input
              type="file"
              accept="application/pdf,image/*"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadConsent(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={VOICE_BUTTON} onClick={() => setEditing(true)}>
          {t("voice.edit")}
        </button>
        <button type="button" className={VOICE_BUTTON} onClick={toggle} disabled={pending}>
          {profile.active ? t("voice.profiles.deactivate") : t("voice.profiles.activate")}
        </button>
      </div>
      {message && <ResultMessage tone={message.tone}>{message.text}</ResultMessage>}
    </li>
  );
}

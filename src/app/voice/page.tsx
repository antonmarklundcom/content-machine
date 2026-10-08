import { Fragment } from "react";
import type { Metadata } from "next";

import { VoiceProfileForm } from "@/components/VoiceProfileForm";
import { VoiceProfileRow, type VoiceProfileRowData } from "@/components/VoiceProfileRow";
import { ChatterboxReferencePanel } from "@/components/ChatterboxReferencePanel";
import { VoiceSubnav } from "@/components/VoiceSubnav";
import type { VoiceProfile } from "@/db/schema";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { listProfiles } from "@/lib/voice/store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("voice.profiles.title") };
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

function toRow(p: VoiceProfile, now: Date): VoiceProfileRowData {
  const expired = !!p.consentExpiresAt && p.consentExpiresAt.getTime() <= now.getTime();
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    provider: p.provider,
    providerVoiceId: p.providerVoiceId ?? "",
    languages: p.languages,
    role: p.role,
    characterKey: p.characterKey ?? "",
    brandId: p.brandId ?? "",
    settings: p.settings,
    consentStatus: p.consentStatus,
    consentPerson: p.consentPerson ?? "",
    consentScope: p.consentScope ?? "",
    consentSignedAt: day(p.consentSignedAt),
    consentExpiresAt: day(p.consentExpiresAt),
    active: p.active,
    notes: p.notes ?? "",
    hasConsentDoc: !!p.consentDocPath,
    consentBlocks: p.consentStatus !== "not_needed" && (p.consentStatus !== "signed" || expired),
  };
}

/**
 * Voice profiles (build 4 phase A): narrator and character voices per
 * provider, with consent on record for any cloned or recorded person.
 * Owner-only.
 */
export default async function VoicePage() {
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const t = translator(locale);
  const owner = isOwner(user);
  const [profiles, brands] = owner ? await Promise.all([listProfiles(), listBrands()]) : [[], []];
  const brandOptions = brands.map((b) => ({ id: b.id, name: b.name }));
  const now = new Date();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("voice.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
        {t("voice.profiles.title")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("voice.profiles.intro")}
      </p>
      <VoiceSubnav current="/voice" locale={locale} />

      {!owner ? (
        <p className="surface-card mt-6 p-4 text-sm">{t("voice.ownerOnly")}</p>
      ) : (
        <>
          {profiles.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
              {t("voice.profiles.empty")}
            </p>
          ) : (
            <ul className="mt-8 flex flex-col gap-3">
              {profiles.map((p) => (
                <Fragment key={p.id}>
                  <VoiceProfileRow profile={toRow(p, now)} brands={brandOptions} locale={locale} />
                  {p.provider === "chatterbox" && (
                    <li className="surface-border surface-card ml-6 p-4">
                      <ChatterboxReferencePanel
                        profileId={p.id}
                        referencePath={p.settings.chatterbox?.referencePath ?? null}
                        consentStatus={p.consentStatus}
                        locale={locale}
                      />
                    </li>
                  )}
                </Fragment>
              ))}
            </ul>
          )}
          <section className="surface-border surface-card mt-10 p-5">
            <h2 className="mb-4 text-lg font-semibold text-[var(--color-ink)]">
              {t("voice.profiles.add")}
            </h2>
            <VoiceProfileForm id={null} brands={brandOptions} locale={locale} />
          </section>
        </>
      )}
    </main>
  );
}

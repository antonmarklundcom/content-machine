import type { Metadata } from "next";

import { RecorderStudio } from "@/components/RecorderStudio";
import { RecorderTips } from "@/components/RecorderTips";
import { VoiceSubnav } from "@/components/VoiceSubnav";
import { VOICE_INPUT, VOICE_LABEL, VOICE_PRIMARY } from "@/components/VoiceStyles";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { isOnlineDeploy } from "@/lib/pc-only";
import { parseSourceKey } from "@/lib/voice/record/lines";
import {
  listRecordSources,
  listSpeakerProfiles,
  loadRecordSession,
  recordingMinutes,
} from "@/lib/voice/record/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("record.title") };
}

type Search = Promise<{ source?: string | string[]; profile?: string | string[] }>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * The recording studio (build 5 §3.B, docs/RECORDING.md): pick a story
 * language or a studio script and the speaker's voice profile, then read line
 * by line from a teleprompter; each kept take is a normal manual take
 * (`importRecording`, exact text). Owner-only, PC-only.
 */
export default async function RecordPage({ searchParams }: { searchParams: Search }) {
  const [user, locale, params] = await Promise.all([requireUser(), getLocale(), searchParams]);
  const t = translator(locale);
  const owner = isOwner(user);
  const sourceKey = one(params.source);
  const profileId = Number(one(params.profile)) || 0;

  const header = (
    <>
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("voice.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("record.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("record.intro")}
      </p>
      <VoiceSubnav current="/voice/record" locale={locale} />
    </>
  );

  if (!owner) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        {header}
        <p className="surface-card mt-6 p-4 text-sm">{t("record.ownerOnly")}</p>
      </main>
    );
  }
  if (isOnlineDeploy()) {
    return <main className="mx-auto max-w-5xl px-6 py-10">{header}</main>;
  }

  const [sources, profiles, minutes] = await Promise.all([
    listRecordSources(),
    listSpeakerProfiles(),
    recordingMinutes(),
  ]);
  const source = parseSourceKey(sourceKey);
  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const session = source && profile ? await loadRecordSession(source, sourceKey, profile) : null;
  const stories = sources.filter((s) => s.kind === "story");
  const scripts = sources.filter((s) => s.kind === "script");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {header}

      <form
        method="get"
        action="/voice/record"
        className="surface-border surface-card mt-6 grid gap-4 p-5 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
      >
        <label className="flex flex-col gap-1">
          <span className={VOICE_LABEL}>{t("record.setup.source")}</span>
          <select name="source" defaultValue={sourceKey} className={VOICE_INPUT} required>
            <option value="">{t("record.setup.pickSource")}</option>
            {stories.length > 0 && (
              <optgroup label={t("record.setup.stories")}>
                {stories.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            )}
            {scripts.length > 0 && (
              <optgroup label={t("record.setup.scripts")}>
                {scripts.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={VOICE_LABEL}>{t("record.setup.profile")}</span>
          <select
            name="profile"
            defaultValue={profile ? String(profile.id) : ""}
            className={VOICE_INPUT}
            required
          >
            <option value="">{t("record.setup.pickProfile")}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.provider}
                {p.consentStatus !== "not_needed" ? ` · ${p.consentStatus}` : ""})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={VOICE_PRIMARY}>
          {t("record.setup.start")}
        </button>
        {sources.length === 0 && (
          <p className="text-sm text-[var(--color-ink-muted)] sm:col-span-3">
            {t("record.setup.noSources")}
          </p>
        )}
        {profiles.length === 0 && (
          <p className="text-sm text-[var(--color-ink-muted)] sm:col-span-3">
            {t("record.setup.noProfiles")}
          </p>
        )}
      </form>

      {sourceKey && profileId > 0 && !session && (
        <p className="mt-6 text-sm text-[var(--color-danger)]">{t("record.error.notFound")}</p>
      )}

      {session ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
          <RecorderStudio
            key={`${session.sourceKey}|${session.profile.id}`}
            initial={session}
            locale={locale}
          />
          <RecorderTips initialMinutes={minutes} locale={locale} />
        </div>
      ) : (
        <div className="mt-6 max-w-md">
          <RecorderTips initialMinutes={minutes} locale={locale} />
        </div>
      )}
    </main>
  );
}

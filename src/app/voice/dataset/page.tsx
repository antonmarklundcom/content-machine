import type { Metadata } from "next";

import { DatasetExportButton } from "@/components/DatasetExportButton";
import { VoiceSubnav } from "@/components/VoiceSubnav";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { listExports } from "@/lib/voice/dataset/export";
import { datasetOverview } from "@/lib/voice/dataset/query";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("dataset.title") };
}

/** Training dataset export (build 5 §3.C, docs/DATASET.md). PC-only via the voice layout. */
export default async function DatasetPage() {
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const t = translator(locale);
  const owner = isOwner(user);
  const [rows, exports] = owner ? await Promise.all([datasetOverview(), listExports()]) : [[], []];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("voice.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("dataset.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("dataset.intro")}
      </p>
      <VoiceSubnav current="/voice/dataset" locale={locale} />

      {!owner ? (
        <p className="surface-card mt-6 p-4 text-sm">{t("dataset.ownerOnly")}</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--color-ink-muted)]">{t("dataset.empty")}</p>
          ) : (
            <div className="surface-border surface-card mt-8 overflow-x-auto p-4">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="py-2 pr-3">{t("dataset.col.voice")}</th>
                    <th className="py-2 pr-3">{t("dataset.col.language")}</th>
                    <th className="py-2 pr-3">{t("dataset.col.clips")}</th>
                    <th className="py-2 pr-3">{t("dataset.col.hours")}</th>
                    <th className="py-2 pr-3">{t("dataset.col.unreviewed")}</th>
                    <th className="py-2 pr-3">{t("dataset.col.consent")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const blocked = r.consentStatus === "pending" || r.consentStatus === "revoked";
                    return (
                      <tr
                        key={`${r.profileId}-${r.language}`}
                        className="border-t border-[var(--color-border-subtle)] align-top"
                      >
                        <td className="py-2 pr-3">{r.profileName}</td>
                        <td className="py-2 pr-3">{r.language}</td>
                        <td className="py-2 pr-3">{r.approvedClips}</td>
                        <td className="py-2 pr-3">{(r.approvedSeconds / 3600).toFixed(2)}</td>
                        <td className="py-2 pr-3">{r.unreviewed}</td>
                        <td className="py-2 pr-3">
                          {blocked ? t("dataset.consentBlocked") : r.consentStatus}
                        </td>
                        <td className="py-2">
                          <DatasetExportButton
                            profileKey={r.profileKey}
                            language={r.language}
                            disabled={blocked || r.approvedClips === 0}
                            locale={locale}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <h2 className="mt-10 text-lg font-semibold text-[var(--color-ink)]">
            {t("dataset.recent")}
          </h2>
          {exports.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t("dataset.noRecent")}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {exports.map((e) => (
                <li key={e.name} className="font-mono text-xs">
                  {e.folder}
                  {e.clipCount !== null && ` · ${e.clipCount}`}
                  {e.totalSeconds !== null && ` · ${(e.totalSeconds / 60).toFixed(1)} min`}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-8 text-xs text-[var(--color-ink-muted)]">{t("dataset.guide")}</p>
        </>
      )}
    </main>
  );
}

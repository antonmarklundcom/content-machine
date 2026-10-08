import type { Metadata } from "next";

import { PronunciationAddForm } from "@/components/PronunciationAddForm";
import { PronunciationRow } from "@/components/PronunciationRow";
import { VoiceSubnav } from "@/components/VoiceSubnav";
import { VOICE_CHIP_OFF, VOICE_CHIP_ON } from "@/components/VoiceStyles";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { translator, type TranslationKey } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { LEXICON_REVIEW_STATUSES, type LexiconReviewStatus } from "@/lib/voice/contract";
import { listProfiles, listPronunciations } from "@/lib/voice/store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("voice.pron.title") };
}

type SearchParams = Promise<{ lang?: string; scope?: string; status?: string }>;

/**
 * The pronunciation dictionary (build 4 phase A): respellings the engine
 * applies before synthesis. Filter by language, scope and status; approve or
 * reject with the reviewer's name; preview a short take with and without.
 */
export default async function PronunciationsPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, user, locale] = await Promise.all([searchParams, requireUser(), getLocale()]);
  const t = translator(locale);
  const owner = isOwner(user);
  const status = LEXICON_REVIEW_STATUSES.includes(params.status as LexiconReviewStatus)
    ? (params.status as LexiconReviewStatus)
    : undefined;
  const filter = { language: params.lang || undefined, scope: params.scope || undefined, status };

  const [all, rows, profiles] = owner
    ? await Promise.all([
        listPronunciations(),
        listPronunciations(filter),
        listProfiles({ activeOnly: true }),
      ])
    : [[], [], []];
  const languages = [...new Set(all.map((r) => r.language))].sort();
  const scopes = [...new Set(all.map((r) => r.scope))].sort();
  const voices = profiles
    .filter((p) => p.provider !== "manual")
    .map((p) => ({ id: p.id, name: p.name, languages: p.languages }));

  const href = (patch: Partial<Record<"lang" | "scope" | "status", string | undefined>>) => {
    const next = { lang: params.lang, scope: params.scope, status: params.status, ...patch };
    const q = new URLSearchParams(
      Object.entries(next).filter(
        (e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
      ),
    );
    return `/voice/pronunciations${q.size ? `?${q}` : ""}`;
  };
  const chips = (
    label: TranslationKey,
    allLabel: TranslationKey,
    key: "lang" | "scope" | "status",
    values: string[],
    show: (v: string) => string = (v) => v,
  ) => (
    <nav aria-label={t(label)} className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">{t(label)}</span>
      {[undefined, ...values].map((v) => (
        <a
          key={v ?? "all"}
          href={href({ [key]: v })}
          aria-current={params[key] === v || (!params[key] && !v) ? "page" : undefined}
          className={params[key] === v || (!params[key] && !v) ? VOICE_CHIP_ON : VOICE_CHIP_OFF}
        >
          {v ? show(v) : t(allLabel)}
        </a>
      ))}
    </nav>
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("voice.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
        {t("voice.pron.title")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("voice.pron.intro")}
      </p>
      <VoiceSubnav current="/voice/pronunciations" locale={locale} />

      {!owner ? (
        <p className="surface-card mt-6 p-4 text-sm">{t("voice.ownerOnly")}</p>
      ) : (
        <>
          <div className="mt-6">
            {chips("voice.language", "voice.allLanguages", "lang", languages)}
            {chips("voice.pron.scope", "voice.pron.allScopes", "scope", scopes)}
            {chips(
              "voice.pron.status",
              "voice.pron.allStatuses",
              "status",
              [...LEXICON_REVIEW_STATUSES],
              (v) => t(`voice.pron.status.${v as LexiconReviewStatus}`),
            )}
          </div>
          {rows.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("voice.pron.empty")}</p>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {rows.map((r) => (
                <PronunciationRow
                  key={r.id}
                  row={{
                    id: r.id,
                    term: r.term,
                    sayAs: r.sayAs,
                    language: r.language,
                    scope: r.scope,
                    notes: r.notes ?? "",
                    reviewStatus: r.reviewStatus,
                    reviewedBy: r.reviewedBy,
                  }}
                  voices={voices}
                  locale={locale}
                />
              ))}
            </ul>
          )}
          <section className="surface-border surface-card mt-10 p-5">
            <h2 className="mb-4 text-lg font-semibold text-[var(--color-ink)]">
              {t("voice.pron.add")}
            </h2>
            <PronunciationAddForm locale={locale} />
          </section>
        </>
      )}
    </main>
  );
}

import type { Metadata } from "next";
import { GlossaryForm } from "@/components/GlossaryForm";
import { GLOSSARY_FIELD, REGISTERS } from "@/lib/glossary/ui";
import { GlossaryImport } from "@/components/GlossaryImport";
import { GlossaryRow, type GlossaryRowData } from "@/components/GlossaryRow";
import type { GlossaryTerm } from "@/db/schema";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { createGlossaryAction } from "@/lib/glossary.actions";
import { isRegister, isReviewStatus, listGlossary } from "@/lib/glossary/store";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { LEXICON_REVIEW_STATUSES } from "@/lib/voice/contract";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("glossary.title") };
}

type GlossarySearchParams = { q?: string; status?: string; register?: string; jopara?: string };

function toRow(g: GlossaryTerm): GlossaryRowData {
  return {
    id: g.id,
    term: g.term,
    language: g.language,
    meaningEs: g.meaningEs ?? "",
    meaningEn: g.meaningEn ?? "",
    sayAs: g.sayAs ?? "",
    partOfSpeech: g.partOfSpeech ?? "",
    register: g.register,
    joparaOk: g.joparaOk,
    example: g.example ?? "",
    exampleTranslation: g.exampleTranslation ?? "",
    source: g.source ?? "",
    notes: g.notes ?? "",
    reviewStatus: g.reviewStatus,
    reviewedBy: g.reviewedBy,
    reviewedAt: g.reviewedAt?.toISOString() ?? null,
  };
}

/**
 * The Guaraní glossary (build 4 §3.D): words a native speaker reviews. Only
 * approved + Jopará-ok terms reach the script writer (§1.2). Owner only.
 */
export default async function GlossaryPage({
  searchParams,
}: {
  searchParams: Promise<GlossarySearchParams>;
}) {
  const [params, user, locale] = await Promise.all([searchParams, requireUser(), getLocale()]);
  const t = translator(locale);

  const header = (
    <>
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("glossary.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("glossary.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("glossary.intro")}
      </p>
    </>
  );

  if (!isOwner(user)) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        {header}
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("glossary.ownerOnly")}</p>
      </main>
    );
  }

  const status = isReviewStatus(params.status) ? params.status : undefined;
  const register = isRegister(params.register) ? params.register : undefined;
  const joparaOk = params.jopara === "yes" ? true : params.jopara === "no" ? false : undefined;
  const terms = await listGlossary({ q: params.q, status, register, joparaOk });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {header}

      <section className="surface-border surface-card mt-8 p-5">
        <GlossaryImport locale={locale} />
      </section>

      <section className="surface-border surface-card mt-6 p-5">
        <h2 className="mb-3 text-base font-semibold text-[var(--color-ink)]">
          {t("glossary.add")}
        </h2>
        <GlossaryForm
          action={createGlossaryAction}
          idPrefix="glossary-new"
          submitLabel={t("glossary.add")}
          locale={locale}
        />
      </section>

      <form method="get" className="mt-8 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          aria-label={t("glossary.search")}
          placeholder={t("glossary.search")}
          className={GLOSSARY_FIELD}
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label={t("glossary.filter.status")}
          className={GLOSSARY_FIELD}
        >
          <option value="">{t("glossary.filter.anyStatus")}</option>
          {LEXICON_REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`glossary.status.${s}`)}
            </option>
          ))}
        </select>
        <select
          name="register"
          defaultValue={register ?? ""}
          aria-label={t("glossary.field.register")}
          className={GLOSSARY_FIELD}
        >
          <option value="">{t("glossary.filter.anyRegister")}</option>
          {REGISTERS.map((r) => (
            <option key={r} value={r}>
              {t(`glossary.register.${r}`)}
            </option>
          ))}
        </select>
        <select
          name="jopara"
          defaultValue={params.jopara ?? ""}
          aria-label={t("glossary.field.joparaOk")}
          className={GLOSSARY_FIELD}
        >
          <option value="">{t("glossary.filter.anyJopara")}</option>
          <option value="yes">{t("glossary.filter.joparaYes")}</option>
          <option value="no">{t("glossary.filter.joparaNo")}</option>
        </select>
        <button
          type="submit"
          className="surface-border rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--color-ink)] hover:border-[var(--color-accent)]"
        >
          {t("glossary.filter.apply")}
        </button>
      </form>

      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        {t("glossary.count", { count: terms.length })}
      </p>
      {terms.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-ink-muted)]">{t("glossary.empty")}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {terms.map((g) => (
            <GlossaryRow key={g.id} term={toRow(g)} locale={locale} />
          ))}
        </ul>
      )}
    </main>
  );
}

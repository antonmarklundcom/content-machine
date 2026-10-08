import type { Metadata } from "next";
import Link from "next/link";
import { AUDIENCE_QUESTION_STATUSES, type AudienceQuestionStatus } from "@/db/schema";
import { QuestionMineButton } from "@/components/QuestionMineButton";
import { QuestionRow } from "@/components/QuestionRow";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import { isAudienceQuestionStatus, listAudienceQuestions } from "@/lib/bridge/questions";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("questions.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

/**
 * `/research/questions?brand=<id>[&status=new|used|dismissed|all]` — questions
 * mined from competitor comments (build 2b, idea 2), most asked first. Shows
 * `new` by default, so a used or dismissed question leaves the working list.
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; status?: string }>;
}) {
  const [params, brands, locale, user] = await Promise.all([
    searchParams,
    listBrands(),
    getLocale(),
    requireUser(),
  ]);
  const t = translator(locale);
  const brand = brands.find((b) => b.id === params.brand) ?? brands[0];
  const status: AudienceQuestionStatus | "all" =
    params.status === "all"
      ? "all"
      : isAudienceQuestionStatus(params.status)
        ? params.status
        : "new";
  const questions = brand
    ? await listAudienceQuestions(brand.id, status === "all" ? {} : { status })
    : [];
  const href = (q: Record<string, string>) => `/research/questions?${new URLSearchParams(q)}`;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("questions.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
        {t("questions.title")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("questions.intro")}
      </p>

      {!brand ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("report.noBrands")}</p>
      ) : (
        <>
          <nav aria-label={t("report.brand")} className="mt-6 flex flex-wrap gap-2">
            {brands.map((b) => (
              <a
                key={b.id}
                href={href({ brand: b.id })}
                aria-current={b.id === brand.id ? "page" : undefined}
                className={b.id === brand.id ? CHIP_ON : CHIP_OFF}
              >
                {b.name}
              </a>
            ))}
          </nav>

          <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              <span>{t("questions.filter")}</span>
              {(["all", ...AUDIENCE_QUESTION_STATUSES] as const).map((s) => (
                <a
                  key={s}
                  href={href({ brand: brand.id, status: s })}
                  aria-current={s === status ? "page" : undefined}
                  className={s === status ? CHIP_ON : CHIP_OFF}
                >
                  {s === "all" ? t("questions.all") : t(`questions.status.${s}`)}
                </a>
              ))}
              <Link
                href={`/research/report?${new URLSearchParams({ brand: brand.id })}`}
                className="ml-2 underline hover:text-[var(--color-accent)]"
              >
                {t("questions.toReport")}
              </Link>
            </div>
            {isOwner(user) ? (
              <QuestionMineButton brandId={brand.id} />
            ) : (
              <p className="text-xs text-[var(--color-ink-muted)]">{t("questions.ownerOnly")}</p>
            )}
          </div>

          {questions.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("questions.empty")}</p>
          ) : (
            <ol className="mt-6 flex flex-col gap-3">
              {questions.map((q) => (
                <QuestionRow
                  key={q.id}
                  q={{
                    id: q.id,
                    question: q.question,
                    askCount: q.askCount,
                    examples: q.examples ?? [],
                    videoCount: (q.videoIds ?? []).length,
                    status: q.status,
                  }}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </main>
  );
}

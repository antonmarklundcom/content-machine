import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listScripts, getScript } from "@/lib/bridge/scripts";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import { buildFilmingPlan, formatMinutes, type PlanScript } from "@/lib/studio/plan";
import { StudioPlanPrintButton } from "@/components/StudioPlanPrintButton";
import { STUDIO_PRIMARY } from "@/components/StudioStyles";

/**
 * Printed on paper and read on set: no header, no form, black on white.
 * The layout's header is not this page's file, so it is hidden from here.
 */
const PRINT_CSS = `@media print {
  header, .plan-form { display: none !important; }
  html, body, [data-youtube-section] { background: #fff !important; color: #000 !important; }
  .plan-sheet, .plan-sheet * { color: #000 !important; border-color: #999 !important; background: transparent !important; box-shadow: none !important; }
  .plan-sheet section { break-inside: avoid-page; }
  .plan-sheet li { break-inside: avoid; }
  @page { margin: 14mm; }
}`;

function idsFrom(value: string | string[] | undefined): number[] {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const ids: number[] = [];
  for (const v of raw.flatMap((r) => r.split(","))) {
    const id = Number(v.trim());
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** `/studio/plan?id=1&id=2` — tick ready scripts, get a printable filming day (build 2b, idea 5). */
export default async function FilmingPlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const t = translator(await getLocale());
  const selected = idsFrom((await searchParams).id);

  const ready = await listScripts({ status: "ready", limit: 500 });
  const rows = (await Promise.all(selected.map((id) => getScript(id)))).filter((r) => r !== null);
  const valid: PlanScript[] = [];
  const invalid: string[] = [];
  for (const r of rows) {
    if (validateScriptBody(r.body).ok)
      valid.push({ id: r.id, title: r.title, body: r.body as ScriptBodyV1 });
    else invalid.push(r.title);
  }
  const plan = valid.length ? buildFilmingPlan(valid) : null;

  // Picker: every ready script, plus any selected script that is no longer ready.
  const pickable = [...ready, ...rows.filter((r) => !ready.some((x) => x.id === r.id))];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <style>{PRINT_CSS}</style>
      <div className="plan-form">
        <Link
          href="/studio"
          className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
        >
          &larr; {t("studio.back")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
          {t("publish.plan.title")}
        </h1>

        {pickable.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--color-ink-muted)]">{t("publish.plan.none")}</p>
        ) : (
          <form
            method="get"
            action="/studio/plan"
            className="surface-border surface-card mt-6 flex flex-col gap-3 px-5 py-4"
          >
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {t("publish.plan.pick")}
            </p>
            <ul className="flex flex-col gap-1">
              {pickable.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                    <input
                      type="checkbox"
                      name="id"
                      value={s.id}
                      defaultChecked={selected.includes(s.id)}
                    />
                    {s.title}
                    <span className="text-xs text-[var(--color-ink-muted)]">· {s.language}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button type="submit" className={`${STUDIO_PRIMARY} self-start`}>
              {t("publish.plan.build")}
            </button>
          </form>
        )}
        {invalid.length > 0 && (
          <p className="mt-3 text-sm text-[var(--color-danger)]">
            {t("publish.plan.invalid", { titles: invalid.join(", ") })}
          </p>
        )}
      </div>

      {plan && (
        <article className="plan-sheet mt-8 flex flex-col gap-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold text-[var(--color-ink)]">
              {t("publish.plan.heading", { count: plan.items.length })}
            </h2>
            <StudioPlanPrintButton label={t("publish.plan.print")} />
          </div>
          <p className="text-sm font-medium text-[var(--color-ink)]">
            {t("publish.plan.total", {
              spoken: formatMinutes(plan.totalSpokenMinutes),
              withRetakes: formatMinutes(plan.totalWithRetakesMinutes),
            })}
          </p>

          <section>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              {t("publish.plan.order")}
            </h3>
            <ol className="flex flex-col gap-2">
              {plan.items.map((item, i) => (
                <li key={item.id} className="surface-border rounded-[var(--radius-sm)] px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--color-ink)]">
                      {i + 1}. {item.title}
                    </span>
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      {t("publish.plan.words", { words: item.words })} ·{" "}
                      {t("publish.plan.spoken", { minutes: formatMinutes(item.spokenMinutes) })} ·{" "}
                      {t("publish.plan.retakes", {
                        minutes: formatMinutes(item.withRetakesMinutes),
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    {item.group
                      ? t("publish.plan.group", { name: item.setup.join(", ") })
                      : t("publish.plan.noSetup")}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{t("publish.plan.method")}</p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              {t("publish.plan.onScreen")}
            </h3>
            {plan.onScreen.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">
                {t("publish.plan.onScreenNone")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {plan.onScreen.map((o, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                    <span
                      aria-hidden
                      className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 border border-current"
                    />
                    <span>
                      <strong>{o.text}</strong>{" "}
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        — {o.scriptTitle} · {o.part}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              {t("publish.plan.broll")}
            </h3>
            {plan.broll.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">{t("publish.plan.brollNone")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {plan.broll.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                    <span
                      aria-hidden
                      className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 border border-current"
                    />
                    <span>
                      {b.description}{" "}
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        ({b.aspectRatio}, {t(b.still ? "publish.plan.still" : "publish.plan.video")}
                        ) — {b.scriptTitle} · {b.part}: “{b.spokenLine}”
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </article>
      )}
    </div>
  );
}

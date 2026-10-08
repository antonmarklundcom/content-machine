import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listAccounts, listCalendarPosts, listFamilies } from "@/lib/bridge";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { CalendarGrid, type CalendarPost } from "@/components/CalendarGrid";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL } from "@/components/StudioStyles";
import { calendarGrid, dayOf, fetchRange, parseCalendarParams, type CalendarParams } from "./model";

/**
 * `/calendar` — week and month views of scheduled and posted posts, per
 * account or family (PLAN.md §6.S15). Drag a post to another day to
 * reschedule it; the editor's date field is the fallback.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const t = translator(await getLocale());
  const today = dayOf(new Date());
  const params = parseCalendarParams(await searchParams, today);

  const [accounts, families] = await Promise.all([listAccounts(), listFamilies()]);
  const account = accounts.some((a) => a.id === params.account) ? params.account : undefined;
  const family = families.some((f) => f.id === params.family) ? params.family : undefined;
  const grid = calendarGrid(params.view, params.date);
  const rows = await listCalendarPosts({
    accountId: account,
    familyId: family,
    ...fetchRange(grid.days),
  });
  const posts: CalendarPost[] = rows
    .filter((p) => p.status !== "archived")
    .map((p) => ({
      id: p.id,
      revision: p.revision,
      title: p.title,
      handle: p.handle,
      status: p.status,
      format: p.format,
      at: (p.publishedAt ?? p.scheduledFor)!.toISOString(),
      scheduledFor: p.scheduledFor?.toISOString() ?? null,
    }));

  const href = (next: Partial<CalendarParams>) => {
    const merged = { ...params, account, family, ...next };
    const q = new URLSearchParams({ view: merged.view, date: merged.date });
    if (merged.account) q.set("account", String(merged.account));
    if (merged.family) q.set("family", merged.family);
    return `/calendar?${q.toString()}`;
  };
  const tab = (active: boolean) =>
    `${STUDIO_BUTTON} ${active ? "border-[var(--color-accent)] text-[var(--color-accent)]" : ""}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            {t("calendar.title")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
            {params.view === "month" ? grid.month : `${grid.days[0]} – ${grid.days[6]}`}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ view: "week" })} className={tab(params.view === "week")}>
            {t("calendar.week")}
          </Link>
          <Link href={href({ view: "month" })} className={tab(params.view === "month")}>
            {t("calendar.month")}
          </Link>
          <Link href={href({ date: grid.prev })} className={STUDIO_BUTTON}>
            &larr; {t("calendar.prev")}
          </Link>
          <Link href={href({ date: today })} className={STUDIO_BUTTON}>
            {t("calendar.today")}
          </Link>
          <Link href={href({ date: grid.next })} className={STUDIO_BUTTON}>
            {t("calendar.next")} &rarr;
          </Link>
          <Link href="/posts" className={STUDIO_BUTTON}>
            {t("posts.title")}
          </Link>
        </div>
      </div>

      <form
        method="get"
        action="/calendar"
        className="surface-border surface-card mb-4 grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-[1fr_1fr_auto]"
      >
        <input type="hidden" name="view" value={params.view} />
        <input type="hidden" name="date" value={params.date} />
        <label>
          <span className={STUDIO_LABEL}>{t("posts.filter.account")}</span>
          <select name="account" defaultValue={account ?? ""} className={STUDIO_INPUT}>
            <option value="">{t("posts.filter.allAccounts")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle} · {a.platform} · {a.brandName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={STUDIO_LABEL}>{t("calendar.filter.family")}</span>
          <select name="family" defaultValue={family ?? ""} className={STUDIO_INPUT}>
            <option value="">{t("calendar.filter.allFamilies")}</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className={`${STUDIO_BUTTON} py-2`}>
            {t("posts.filter.apply")}
          </button>
        </div>
      </form>

      <p className="mb-4 text-xs text-[var(--color-ink-muted)]">{t("calendar.dragHint")}</p>
      <CalendarGrid days={grid.days} month={grid.month} posts={posts} />
    </div>
  );
}

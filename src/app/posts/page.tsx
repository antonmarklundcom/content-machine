import Link from "next/link";
import { POST_STATUSES } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { listAccounts, listPosts } from "@/lib/bridge";
import { formatDate } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { Pagination } from "@/components/Pagination";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL } from "@/components/StudioStyles";
import { dayRange, FORMAT_LABEL, parsePostListParams, STATUS_LABEL, statusTone } from "./model";

/** `/posts` — every post, filtered by account, status and date (PLAN.md §6.S15). */
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const filters = parsePostListParams(await searchParams);

  const accounts = await listAccounts();
  const account = accounts.some((a) => a.id === filters.account) ? filters.account : undefined;
  const { posts, total, page, totalPages } = await listPosts({
    accountId: account,
    status: filters.status,
    ...dayRange(filters),
    page: filters.page,
  });
  const filtered = Boolean(account || filters.status || filters.from || filters.to);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            {t("posts.title")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
            {total} {t(total === 1 ? "posts.countOne" : "posts.countMany")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/calendar"
            className="surface-border rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)]"
          >
            {t("posts.calendarLink")}
          </Link>
          <Link
            href={account ? `/posts/new?account=${account}` : "/posts/new"}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)]"
          >
            {t("posts.new")}
          </Link>
        </div>
      </div>

      <form
        method="get"
        action="/posts"
        className="surface-border surface-card mb-6 grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-5"
      >
        <label className="col-span-2 sm:col-span-1">
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
        <label className="col-span-2 sm:col-span-1">
          <span className={STUDIO_LABEL}>{t("posts.filter.status")}</span>
          <select name="status" defaultValue={filters.status ?? ""} className={STUDIO_INPUT}>
            <option value="">{t("posts.filter.allStatuses")}</option>
            {POST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(STATUS_LABEL[s])}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={STUDIO_LABEL}>{t("posts.filter.from")}</span>
          <input type="date" name="from" defaultValue={filters.from} className={STUDIO_INPUT} />
        </label>
        <label>
          <span className={STUDIO_LABEL}>{t("posts.filter.to")}</span>
          <input type="date" name="to" defaultValue={filters.to} className={STUDIO_INPUT} />
        </label>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
          <button type="submit" className={`${STUDIO_BUTTON} py-2`}>
            {t("posts.filter.apply")}
          </button>
          {filtered && (
            <Link href="/posts" className={`${STUDIO_BUTTON} py-2`}>
              {t("posts.filter.clear")}
            </Link>
          )}
        </div>
      </form>

      {posts.length === 0 ? (
        <div className="surface-border surface-card flex min-h-[30vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <h2 className="text-lg font-medium text-[var(--color-ink)]">
            {t(filtered ? "posts.noMatch.title" : "posts.empty.title")}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-[var(--color-ink-muted)]">
            {t("posts.empty.body")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((p) => (
            <li key={p.id} className="surface-border surface-card px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/posts/${p.id}`}
                  className="text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                >
                  {p.title || t("posts.untitled")}
                </Link>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  <span className={`font-medium ${statusTone(p.status)}`}>
                    {t(STATUS_LABEL[p.status])}
                  </span>
                  {" · "}
                  {t(FORMAT_LABEL[p.format])}
                  {" · "}
                  {p.handle ? `@${p.handle}` : p.brandId}
                  {p.platform ? ` (${p.platform})` : ""}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                {p.publishedAt
                  ? t("posts.publishedAt", { date: formatDate(p.publishedAt, locale) })
                  : p.scheduledFor
                    ? t("posts.scheduledFor", { date: formatDate(p.scheduledFor, locale) })
                    : t("posts.updated", { date: formatDate(p.updatedAt, locale) })}
                {p.status === "ready" || p.status === "scheduled" ? (
                  <>
                    {" · "}
                    <Link href={`/posts/${p.id}/pack`} className="hover:text-[var(--color-accent)]">
                      {t("posts.openPack")}
                    </Link>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/posts"
        locale={locale}
        searchParams={{
          account: account ? String(account) : undefined,
          status: filters.status,
          from: filters.from,
          to: filters.to,
        }}
      />
    </div>
  );
}

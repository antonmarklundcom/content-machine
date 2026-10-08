import type { Asset } from "@/db/schema";
import { listAccounts } from "@/lib/bridge/accounts";
import { getAsset, listAssets, listAssetTags, listAssetUses } from "@/lib/bridge/assets";
import { listAllBrands } from "@/lib/bridge/brands";
import { translator, type Locale } from "@/lib/i18n";
import { mediaRootStatus } from "@/lib/storage/root";
import {
  hasMediaFilters,
  mediaHref,
  mediaQueryFrom,
  positiveInt,
  type MediaSearchParams,
} from "@/app/media/query";
import { MediaDrawer } from "./MediaDrawer";
import { MediaFilters } from "./MediaFilters";
import { MediaGrid, type MediaGridItem } from "./MediaGrid";
import { MediaScanButton } from "./MediaScanButton";
import { Pagination } from "./Pagination";

/** The last path segment of a stored file, for a card's label. */
function fileLabel(asset: Asset): string {
  return asset.localPath?.split("/").pop() || asset.altText || `#${asset.id}`;
}

/**
 * `/media` and `/media/inbox` (PLAN.md §6.S14): one server view, two
 * scopes. The inbox is the library filtered to assets with no brand, which is
 * where `/higgsfield-import` lands; assigning a brand there moves the file.
 */
export async function MediaLibrary({
  locale,
  params,
  inbox,
}: {
  locale: Locale;
  params: MediaSearchParams;
  inbox: boolean;
}) {
  const t = translator(locale);
  const base = inbox ? "/media/inbox" : "/media";
  const query = mediaQueryFrom(params, inbox);
  const openId = positiveInt(params.asset);
  const [page, brands, accounts, tags, drive, unsortedCount, open] = await Promise.all([
    listAssets(query),
    listAllBrands(),
    listAccounts(),
    listAssetTags(),
    mediaRootStatus(),
    listAssets({ unsorted: true }).then((p) => p.total),
    openId ? getAsset(openId) : Promise.resolve(null),
  ]);
  const uses = open ? await listAssetUses(open.id) : [];

  const brandNames = new Map(brands.map((b) => [b.id, b.name]));
  const accountLabels = new Map(
    accounts.map((a) => [a.id, `@${a.handle.replace(/^@+/, "")} · ${a.platform}`]),
  );
  const ownerOf = (asset: Asset) =>
    asset.brandId
      ? [
          brandNames.get(asset.brandId) ?? asset.brandId,
          asset.accountId ? accountLabels.get(asset.accountId) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : t("media.unassigned");

  const items: MediaGridItem[] = page.assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    thumbUrl: asset.thumbPath ? `/api/media/asset/${asset.id}/thumb` : null,
    label: fileLabel(asset),
    owner: ownerOf(asset),
    tags: asset.tags,
    href: mediaHref(base, params, { asset: String(asset.id) }),
  }));

  const filtered = hasMediaFilters(params);
  const pageParams: Record<string, string | undefined> = { ...params, asset: undefined };
  const tab = (href: string, active: boolean, label: string) => (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`border-b-2 px-3 py-2 text-sm ${
        active
          ? "border-[var(--color-accent)] text-[var(--color-ink)]"
          : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      }`}
    >
      {label}
    </a>
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            {t("media.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
            {t(inbox ? "media.inbox.title" : "media.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {t(inbox ? "media.inbox.intro" : "media.intro")}
          </p>
        </div>
        <MediaScanButton disabled={drive === "missing"} />
      </div>

      {drive !== "ok" && (
        <div
          role="status"
          className="surface-border mb-4 rounded-[var(--radius-md)] border-[var(--color-danger)] bg-[var(--color-surface-raised)] px-4 py-3 text-sm"
        >
          <p className="font-medium text-[var(--color-danger)]">
            {t(drive === "missing" ? "media.drive.missing" : "media.drive.unwritable")}
          </p>
          <p className="text-[var(--color-ink-muted)]">{t("media.drive.hint")}</p>
        </div>
      )}

      <nav className="mb-4 flex gap-2 border-b border-[var(--color-border-subtle)]">
        {tab("/media", !inbox, t("media.tab.library"))}
        {tab("/media/inbox", inbox, `${t("media.tab.inbox")} (${unsortedCount})`)}
      </nav>

      <MediaFilters
        locale={locale}
        action={base}
        inbox={inbox}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        accounts={accounts.map((a) => ({
          id: a.id,
          label: `${a.brandName} · ${accountLabels.get(a.id)}`,
        }))}
        tags={tags}
        values={{
          brand: inbox ? "" : (params.brand?.trim() ?? ""),
          account: inbox ? "" : query.accountId ? String(query.accountId) : "",
          status: query.status ?? "",
          source: query.source ?? "",
          kind: query.kind ?? "",
          tag: query.tag ?? "",
          from: query.from ? (params.from?.trim() ?? "") : "",
          to: query.to ? (params.to?.trim() ?? "") : "",
        }}
      />

      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        {t("media.count", { n: page.total })}
      </p>

      {page.assets.length === 0 ? (
        <p className="surface-border mt-6 rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
          {t(filtered ? "media.emptyFiltered" : inbox ? "media.inbox.empty" : "media.empty")}
        </p>
      ) : (
        <MediaGrid
          items={items}
          brands={brands.map((b) => ({ id: b.id, name: b.name }))}
          accounts={accounts.map((a) => ({
            id: a.id,
            brandId: a.brandId,
            label: accountLabels.get(a.id) ?? String(a.id),
          }))}
        />
      )}

      <Pagination
        page={page.page}
        totalPages={page.totalPages}
        searchParams={pageParams}
        locale={locale}
        basePath={base}
      />

      {openId && (
        <MediaDrawer
          locale={locale}
          asset={open}
          owner={open ? ownerOf(open) : ""}
          uses={uses}
          closeHref={mediaHref(base, params, { asset: null })}
        />
      )}
    </main>
  );
}

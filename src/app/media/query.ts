import {
  ASSET_KINDS,
  ASSET_SOURCES,
  ASSET_STATUSES,
  type AssetKind,
  type AssetSource,
  type AssetStatus,
} from "@/db/schema";
import type { AssetsQuery } from "@/lib/bridge/assets";

/**
 * `/media` and `/media/inbox` read one filter from the URL (PLAN.md §6.S14):
 * `?brand=<id>` (or `none` for unsorted), `?account=<id>`, `?status=`,
 * `?source=`, `?kind=`, `?tag=`, `?from=YYYY-MM-DD`, `?to=YYYY-MM-DD`
 * (inclusive), `?page=`, and `?asset=<id>` for the open detail drawer.
 * Unknown values are dropped, not rejected — a stale link shows everything.
 */
export type MediaSearchParams = {
  brand?: string;
  account?: string;
  status?: string;
  source?: string;
  kind?: string;
  tag?: string;
  from?: string;
  to?: string;
  page?: string;
  asset?: string;
};

export const NO_BRAND = "none";

const FILTER_KEYS = ["brand", "account", "status", "source", "kind", "tag", "from", "to"] as const;

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return value && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function positiveInt(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,9}$/.test(value.trim())) return undefined;
  const n = Number(value.trim());
  return n > 0 ? n : undefined;
}

/** A `YYYY-MM-DD` day as UTC midnight, or undefined for anything else. */
export function parseDay(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return undefined;
  const date = new Date(`${value.trim()}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The URL's filter as a bridge query. `inbox` forces the unsorted view. */
export function mediaQueryFrom(params: MediaSearchParams, inbox = false): AssetsQuery {
  const brand = params.brand?.trim();
  const tag = params.tag?.trim().toLowerCase();
  const to = parseDay(params.to);
  return {
    brandId: inbox || !brand || brand === NO_BRAND ? undefined : brand,
    unsorted: inbox || brand === NO_BRAND ? true : undefined,
    accountId: inbox ? undefined : positiveInt(params.account),
    status: oneOf<AssetStatus>(ASSET_STATUSES, params.status),
    source: oneOf<AssetSource>(ASSET_SOURCES, params.source),
    kind: oneOf<AssetKind>(ASSET_KINDS, params.kind),
    tag: tag || undefined,
    from: parseDay(params.from),
    // Inclusive: "to 2026-09-27" means before the 28th.
    to: to ? new Date(to.getTime() + 86_400_000) : undefined,
    page: positiveInt(params.page),
  };
}

/** Whether any filter (not the page or the drawer) is set. */
export function hasMediaFilters(params: MediaSearchParams): boolean {
  return FILTER_KEYS.some((key) => !!params[key]?.trim());
}

/** The current filter as a query string with `overrides` applied (`null` drops a key). */
export function mediaHref(
  base: string,
  params: MediaSearchParams,
  overrides: Partial<Record<keyof MediaSearchParams, string | null>> = {},
): string {
  const out = new URLSearchParams();
  for (const key of [...FILTER_KEYS, "page", "asset"] as const) {
    const value = key in overrides ? overrides[key] : params[key]?.trim();
    if (value) out.set(key, value);
  }
  const s = out.toString();
  return s ? `${base}?${s}` : base;
}

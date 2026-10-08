import {
  POST_ASSET_ROLES,
  POST_FORMATS,
  POST_STATUSES,
  type PostAssetRole,
  type PostFormat,
  type PostStatus,
} from "@/db/schema";
import { ENGAGEMENT_MECHANICS, type EngagementMechanic } from "@/lib/posts/contract";
import type { TranslationKey } from "@/lib/i18n";

/** Label keys for the post enums (PLAN.md §6.S15), shared by the list, editor, pack and calendar. */
export const STATUS_LABEL = Object.fromEntries(
  POST_STATUSES.map((s) => [s, `posts.status.${s}`]),
) as Record<PostStatus, TranslationKey>;
export const FORMAT_LABEL = Object.fromEntries(
  POST_FORMATS.map((f) => [f, `posts.format.${f}`]),
) as Record<PostFormat, TranslationKey>;
export const ROLE_LABEL = Object.fromEntries(
  POST_ASSET_ROLES.map((r) => [r, `posts.role.${r}`]),
) as Record<PostAssetRole, TranslationKey>;
export const MECHANIC_LABEL = Object.fromEntries(
  ENGAGEMENT_MECHANICS.map((m) => [m, `posts.mechanic.${m}`]),
) as Record<EngagementMechanic, TranslationKey>;

/** A status's colour on the design tokens: done is accent, trouble is danger, the rest muted. */
export function statusTone(status: PostStatus): string {
  switch (status) {
    case "published":
    case "scheduled":
      return "text-[var(--color-accent)]";
    case "failed":
      return "text-[var(--color-danger)]";
    case "ready":
      return "text-[var(--color-ink)]";
    default:
      return "text-[var(--color-ink-muted)]";
  }
}

export type PostListFilters = {
  account?: number;
  status?: PostStatus;
  /** `YYYY-MM-DD`, inclusive, on the post's date (posted, else scheduled). */
  from?: string;
  /** `YYYY-MM-DD`, inclusive. */
  to?: string;
  page?: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `/posts?account=&status=&from=&to=&page=` → filters; anything malformed is dropped, not an error. */
export function parsePostListParams(
  params: Record<string, string | string[] | undefined>,
): PostListFilters {
  const filters: PostListFilters = {};
  const account = Number(one(params.account));
  if (Number.isInteger(account) && account > 0) filters.account = account;
  const status = one(params.status);
  if (status && (POST_STATUSES as readonly string[]).includes(status)) {
    filters.status = status as PostStatus;
  }
  for (const key of ["from", "to"] as const) {
    const day = one(params[key]);
    if (day && DAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))) filters[key] = day;
  }
  const page = Number(one(params.page));
  if (Number.isInteger(page) && page > 1) filters.page = page;
  return filters;
}

/** The [from, to) instants a `from`/`to` day pair covers (UTC days; `to` is inclusive). */
export function dayRange(filters: Pick<PostListFilters, "from" | "to">): {
  from?: Date;
  to?: Date;
} {
  const range: { from?: Date; to?: Date } = {};
  if (filters.from) range.from = new Date(`${filters.from}T00:00:00Z`);
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    range.to = end;
  }
  return range;
}

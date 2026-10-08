import { and, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { clips } from "@/db/schema";

import { isLearnCategory, type LearnCategory } from "./categories";

/**
 * `/learn`'s filters, read from the URL (`?category=&implemented=yes|no&
 * committed=yes|no&q=&page=`), and the SQL they become. Unknown values are
 * dropped, not rejected — a stale link shows everything (the /lessons rule).
 */
export type LearnSearchParams = {
  category?: string;
  implemented?: string;
  committed?: string;
  q?: string;
  page?: string;
};

export type YesNo = "yes" | "no";

export type LearnQuery = {
  /** A category, or `none` for not summarised yet. */
  category?: LearnCategory | "none";
  implemented?: YesNo;
  committed?: YesNo;
  search?: string;
  page: number;
};

const yesNo = (v: string | undefined): YesNo | undefined =>
  v === "yes" || v === "no" ? v : undefined;

export function learnQueryFrom(params: LearnSearchParams): LearnQuery {
  const category = params.category?.trim();
  const q = params.q?.trim().slice(0, 200);
  const page = Math.floor(Number(params.page));
  return {
    category: category === "none" ? "none" : isLearnCategory(category) ? category : undefined,
    implemented: yesNo(params.implemented),
    committed: yesNo(params.committed),
    search: q || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** The same filter as a query string (page dropped), for links that keep the filter. */
export function learnSearchString(
  query: Omit<LearnQuery, "page">,
  override: Partial<Record<"category", string | undefined>> = {},
): string {
  const out = new URLSearchParams();
  const category = "category" in override ? override.category : query.category;
  if (category) out.set("category", category);
  if (query.implemented) out.set("implemented", query.implemented);
  if (query.committed) out.set("committed", query.committed);
  if (query.search) out.set("q", query.search);
  const s = out.toString();
  return s ? `?${s}` : "";
}

/** `%`, `_` and `\` are literal in a search, as the inbox's lessons search does. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The WHERE conditions for a query. Always learn clips only; `withCategory`
 * false leaves the category out, for the per-category count badges (which
 * should show what each category would hold under the other filters).
 */
export function learnConditions(query: Omit<LearnQuery, "page">, withCategory = true): SQL {
  const pattern = query.search ? likePattern(query.search) : null;
  return and(
    eq(clips.purpose, "learn"),
    withCategory && query.category
      ? query.category === "none"
        ? isNull(clips.learnCategory)
        : eq(clips.learnCategory, query.category)
      : undefined,
    query.implemented === "yes"
      ? isNotNull(clips.implementedAt)
      : query.implemented === "no"
        ? isNull(clips.implementedAt)
        : undefined,
    query.committed === "yes"
      ? isNotNull(clips.committedAt)
      : query.committed === "no"
        ? isNull(clips.committedAt)
        : undefined,
    pattern
      ? or(
          sql`lower(${clips.title}) like lower(${pattern})`,
          sql`lower(${clips.note}) like lower(${pattern})`,
          sql`lower(${clips.summary}) like lower(${pattern})`,
          sql`lower(${clips.url}) like lower(${pattern})`,
          sql`lower(cast(${clips.tags} as char character set utf8mb4)) like lower(${pattern})`,
        )
      : undefined,
  )!;
}

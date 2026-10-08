import { LESSON_KINDS, type LessonKind } from "@/db/schema";
import type { LessonsQuery } from "@/lib/bridge/lessons";

/**
 * `/lessons` and its export share one filter, read from the URL:
 * `?brand=<id>` (or `none` for portfolio-wide lessons), `?kind=`, `?q=`.
 * Unknown values are dropped, not rejected — a stale link shows everything.
 */
export type LessonSearchParams = { brand?: string; kind?: string; q?: string };

export const NO_BRAND = "none";

export function isLessonKind(value: string | undefined): value is LessonKind {
  return !!value && (LESSON_KINDS as readonly string[]).includes(value);
}

export function lessonsQueryFrom(params: LessonSearchParams): Omit<LessonsQuery, "limit"> {
  const brand = params.brand?.trim();
  const q = params.q?.trim();
  return {
    brandId: brand === NO_BRAND ? null : brand || undefined,
    kind: isLessonKind(params.kind) ? params.kind : undefined,
    search: q || undefined,
  };
}

/** The same filter as a query string, for the export link. */
export function lessonsSearchString(params: LessonSearchParams): string {
  const out = new URLSearchParams();
  if (params.brand?.trim()) out.set("brand", params.brand.trim());
  if (isLessonKind(params.kind)) out.set("kind", params.kind);
  if (params.q?.trim()) out.set("q", params.q.trim());
  const s = out.toString();
  return s ? `?${s}` : "";
}

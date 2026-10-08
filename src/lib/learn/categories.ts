/**
 * The closed set of learn categories (docs/PLAN-build4.md §1.13), the same
 * list aiinsights' `item_category` enum had, so imported items keep their
 * category and the model picks from the list the filters show.
 *
 * Pure: the Worker's nudge formatter and the import mapping both use it.
 */
export const LEARN_CATEGORIES = [
  "ai-coding-tool",
  "ai-model-or-api",
  "agent-or-automation",
  "self-hosting",
  "dev-workflow",
  "productivity",
  "browser-extension",
  "design-or-ui",
  "learning-resource",
  "data-or-scraping",
  "other",
] as const;

export type LearnCategory = (typeof LEARN_CATEGORIES)[number];

export function isLearnCategory(value: unknown): value is LearnCategory {
  return typeof value === "string" && (LEARN_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Any category text → one of `LEARN_CATEGORIES`. An exact value is kept; free
 * text is mapped with aiinsights' legacy rules (its plan §2: "coding" →
 * ai-coding-tool, "model"/"api" → ai-model-or-api, …); anything else is
 * `other`. Null in, null out: no category is not the same as `other`.
 */
export function toLearnCategory(value: unknown): LearnCategory | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim().toLowerCase();
  if (isLearnCategory(v)) return v;
  if (v.includes("coding")) return "ai-coding-tool";
  if (v.includes("model") || /\bapi\b/.test(v)) return "ai-model-or-api";
  if (v.includes("automation") || v.includes("agent")) return "agent-or-automation";
  if (v.includes("self-host") || v.includes("self host")) return "self-hosting";
  if (v.includes("workflow")) return "dev-workflow";
  if (v.includes("productivity")) return "productivity";
  if (v.includes("extension")) return "browser-extension";
  if (v.includes("design") || /\bui\b/.test(v)) return "design-or-ui";
  if (v.includes("scrap") || v.includes("data")) return "data-or-scraping";
  if (v.includes("learn") || v.includes("course") || v.includes("tutorial"))
    return "learning-resource";
  return "other";
}

import type {
  AnalysisGap,
  AnalysisHook,
  AnalysisIdea,
  AnalysisPayload,
  AnalysisTimelineEntry,
} from "./contract";

/**
 * Defensive parsing for the §4 contract.
 *
 * Structured outputs already constrain the model to the schema, so this should
 * never fire in practice. It exists because PLAN.md §4 requires it and because
 * "should never fire" is not a property you want a nightly batch to depend on:
 * a malformed response must mark one row failed, not abort the run.
 */

export type ParseResult = { ok: true; payload: AnalysisPayload } | { ok: false; error: string };

export function parseAnalysisResponse(raw: string): ParseResult {
  const text = stripFences(raw).trim();
  if (!text) return { ok: false, error: "model returned an empty response" };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // A model that ignored the schema often still emits one valid object
    // surrounded by prose. Salvage it rather than discarding the whole call.
    const salvaged = extractFirstJsonObject(text);
    if (!salvaged) return { ok: false, error: "response was not valid JSON" };
    try {
      value = JSON.parse(salvaged);
    } catch {
      return { ok: false, error: "response was not valid JSON (salvage also failed)" };
    }
  }

  return validate(value);
}

/**
 * Coerce rather than reject wherever the shape is recoverable. A missing
 * `gaps` array is a thinner analysis; it is not a reason to throw away a
 * correct summary and pay for the video twice.
 */
function validate(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: "top level was not an object" };

  const summary = asString(value["summary"]);
  if (!summary) return { ok: false, error: "missing required field: summary" };

  const hookRaw = isRecord(value["hook"]) ? value["hook"] : {};
  const hook: AnalysisHook = {
    technique: asString(hookRaw["technique"]) ?? "",
    first_30s: asString(hookRaw["first_30s"]) ?? "",
    why_it_works: asString(hookRaw["why_it_works"]) ?? "",
  };

  const payload: AnalysisPayload = {
    summary,
    takeaways: asArray(value["takeaways"])
      .map(asString)
      .filter((s): s is string => Boolean(s)),
    hook,
    timeline: asArray(value["timeline"]).flatMap((entry): AnalysisTimelineEntry[] => {
      if (!isRecord(entry)) return [];
      const topic = asString(entry["topic"]);
      const beat = asString(entry["beat"]);
      if (!topic && !beat) return [];
      return [{ ts: asString(entry["ts"]) ?? "", topic: topic ?? "", beat: beat ?? "" }];
    }),
    gaps: asArray(value["gaps"]).flatMap((entry): AnalysisGap[] => {
      if (!isRecord(entry)) return [];
      const gap = asString(entry["gap"]);
      if (!gap) return [];
      return [{ gap, counter_angle: asString(entry["counter_angle"]) ?? "" }];
    }),
    // [PR-34] Deduplicated on the way in. A model asked for topics will
    // occasionally return "AI video" and "AI Video" in the same list, and two
    // rows that differ only in case would split one shelf into two.
    topics: stringList(value["topics"]),
    entities: stringList(value["entities"]),
    content_type: asString(value["content_type"])?.trim().toLowerCase() ?? "",
    ideas: asArray(value["ideas"]).flatMap((entry): AnalysisIdea[] => {
      if (!isRecord(entry)) return [];
      const title = asString(entry["title"]);
      if (!title) return [];
      return [
        {
          title,
          premise: asString(entry["premise"]) ?? "",
          why_now: asString(entry["why_now"]) ?? "",
        },
      ];
    }),
  };

  return { ok: true, payload };
}

/** Remove ```json fences the contract forbids but models sometimes emit anyway. */
function stripFences(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(raw);
  return fenced?.[1] ?? raw;
}

/** Brace-match the first complete object, ignoring braces inside strings. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * [PR-34] A list of tags: trimmed, blank-free, and deduplicated case- and
 * whitespace-insensitively while keeping the first spelling the model chose.
 *
 * The first spelling wins rather than a lowercased one because these strings
 * are rendered to a human — "Next.js" reads correctly and "next.js" does not.
 * Matching is what gets normalised; display is not. `slugifyTag` in
 * lib/tags.ts applies the same rule when projecting into the lookup tables, so
 * the two never disagree about whether two tags are the same tag.
 */
function stringList(value: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of asArray(value)) {
    const text = asString(item)?.trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

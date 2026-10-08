import type { ScreeningPayload } from "./contract";

/**
 * [PR-35] Defensive parsing for the screening contract, in the same spirit as
 * lib/analysis/parse.ts: structured outputs should make this unreachable, and a
 * nightly run must not depend on "should".
 *
 * One difference from the analysis parser, and it matters: that one coerces
 * wherever the shape is recoverable, because a thin analysis still beats paying
 * twice. This one refuses a missing or unreadable score outright. A screening
 * with a guessed score is worse than no screening — no screening fails open and
 * the video gets analysed, while a guessed 0 removes it from the corpus with a
 * sentence explaining a judgement nobody made.
 */

export type ScreeningParseResult =
  { ok: true; payload: ScreeningPayload } | { ok: false; error: string };

/** Reason is stored in a varchar(512); longer than that is padding, not signal. */
export const MAX_REASON_CHARS = 512;

export function parseScreeningResponse(raw: string): ScreeningParseResult {
  const text = stripFences(raw).trim();
  if (!text) return { ok: false, error: "model returned an empty response" };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const salvaged = extractFirstJsonObject(text);
    if (!salvaged) return { ok: false, error: "response was not valid JSON" };
    try {
      value = JSON.parse(salvaged);
    } catch {
      return { ok: false, error: "response was not valid JSON (salvage also failed)" };
    }
  }

  if (!isRecord(value)) return { ok: false, error: "top level was not an object" };

  const score = asScore(value["score"]);
  if (score === null) {
    return { ok: false, error: `score was missing or not a number 0-100: ${show(value["score"])}` };
  }

  const reason = typeof value["reason"] === "string" ? value["reason"].trim() : "";
  return {
    ok: true,
    payload: {
      score,
      // An empty reason is not worth failing a screening over — the score is
      // what the pipeline acts on, and a blank cell in the UI says "the model
      // did not explain itself", which is true and visible.
      reason: reason.slice(0, MAX_REASON_CHARS),
    },
  };
}

/**
 * Accepts an integer, a float, or a numeric string, and clamps to 0-100.
 *
 * Clamping rather than rejecting out-of-range: a model that answers 120 has
 * expressed "as high as it goes", which is a usable opinion. A model that
 * answers "high" has not, and that is the case this returns null for.
 */
function asScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function stripFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1]! : raw;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

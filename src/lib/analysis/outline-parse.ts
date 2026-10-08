import type { OutlinePayload } from "./contract";

/**
 * Defensive parsing for the outline contract, mirroring parse.ts's approach:
 * structured outputs already constrain the shape, this is the backstop for
 * when a model ignores it anyway.
 */

export type OutlineParseResult =
  { ok: true; payload: OutlinePayload } | { ok: false; error: string };

export function parseOutlineResponse(raw: string): OutlineParseResult {
  const text = stripFences(raw).trim();
  if (!text) return { ok: false, error: "model returned an empty response" };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "response was not valid JSON" };
  }

  if (!isRecord(value)) return { ok: false, error: "top level was not an object" };

  const hook = asString(value["hook"]);
  const rehook = asString(value["rehook"]);
  const twist = asString(value["twist"]);
  const cta = asString(value["cta"]);
  if (!hook || !rehook || !twist || !cta) {
    return { ok: false, error: "missing one or more required outline fields" };
  }

  const payload: OutlinePayload = {
    hook,
    rehook,
    teaching_points: asArray(value["teaching_points"])
      .map(asString)
      .filter((s): s is string => Boolean(s)),
    twist,
    cta,
  };

  return { ok: true, payload };
}

function stripFences(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(raw);
  return fenced?.[1] ?? raw;
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

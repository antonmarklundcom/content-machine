import "server-only";
import {
  upsertFamilyFacts,
  type FamilyFactRow,
  type FactUpsertResult,
} from "@/lib/bridge/family-facts";
import { getFamily } from "@/lib/bridge/families";

/**
 * Facts import (PLAN.md §1.48, §6.S18): a family's shared facts from a source
 * file shaped like `content/shared/facts.ts` in paraguayresidency — a TS module
 * whose `facts` object literal is JSON-shaped, one entry per key, with
 * per-locale `display` and `hedged` text.
 *
 * One row per key × locale, upserted by (family_id, external_key, language).
 * An unverified fact imports its `hedged` wording with `verified=false`, so
 * generation can only ever cite it as hedged. A locale is imported only where
 * the text it would store exists in that locale: the source site falls back to
 * English, but an English sentence filed under `es` would read to generation
 * as Spanish copy. Generation falls back to the base language itself (O11).
 *
 * Parsing is pure (`parseFactsSource`, `factRowsFrom`); only `importFacts`
 * touches the database, through the bridge.
 */

export class FactsImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactsImportError";
  }
}

type LocalizedText = string | Record<string, string>;

/** One entry of the source's `facts` object, as far as the import reads it. */
export type SourceFact = {
  key: string;
  label?: string;
  display: LocalizedText;
  hedged: LocalizedText;
  verified: boolean;
  verifiedOn?: string;
  sources?: string[];
  sourced?: { url?: string; checkedOn?: string };
  note?: string;
};

/** Index of the `}` closing the `{` at `open`, skipping over JSON strings. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * The `facts` object out of a source file: the literal after
 * `export const facts =` in a TS module, or the whole file when it is JSON.
 */
export function parseFactsSource(text: string): Record<string, SourceFact> {
  const trimmed = text.trim();
  let literal: string;
  if (trimmed.startsWith("{")) {
    literal = trimmed;
  } else {
    const decl = /export\s+const\s+facts\b[^=]*=\s*/.exec(text);
    if (!decl) throw new FactsImportError("No `export const facts = {…}` in the source file.");
    const open = decl.index + decl[0].length;
    if (text[open] !== "{")
      throw new FactsImportError("`facts` is not assigned an object literal.");
    const close = matchingBrace(text, open);
    if (close < 0) throw new FactsImportError("The `facts` object literal is not closed.");
    literal = text.slice(open, close + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(literal);
  } catch (err) {
    throw new FactsImportError(
      `The facts object is not JSON-shaped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new FactsImportError("The facts source is not an object.");

  const out: Record<string, SourceFact> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[key] = checkFact(key, value);
  }
  return out;
}

function isText(value: unknown): value is LocalizedText {
  if (typeof value === "string") return value.trim().length > 0;
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

function checkFact(key: string, value: unknown): SourceFact {
  const fact = value as Partial<SourceFact> | null;
  if (!fact || typeof fact !== "object") throw new FactsImportError(`"${key}" is not an object.`);
  if (!isText(fact.display)) throw new FactsImportError(`"${key}" has no display text.`);
  if (!isText(fact.hedged)) throw new FactsImportError(`"${key}" has no hedged text.`);
  if (typeof fact.verified !== "boolean")
    throw new FactsImportError(`"${key}" has no boolean \`verified\`.`);
  if (key.length > 255) throw new FactsImportError(`"${key.slice(0, 40)}…" is too long a key.`);
  return { ...fact, key } as SourceFact;
}

/** `{ en: text }` for a plain string; drops blank locales. Locale codes longer than the column are refused. */
function perLocale(text: LocalizedText, key: string): Array<[string, string]> {
  const entries =
    typeof text === "string" ? [["en", text] as [string, string]] : Object.entries(text);
  return entries
    .map(([locale, value]) => [locale.trim(), value.trim()] as [string, string])
    .filter(([locale, value]) => {
      if (locale.length > 8)
        throw new FactsImportError(`"${key}" has an unknown locale "${locale}".`);
      return locale && value;
    });
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1024) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The rows to upsert: one per key × locale of the text that will be stored —
 * `display` when verified, `hedged` otherwise. The topic is the key's first
 * segment (`investorpass.min_investment_usd` → `investorpass`).
 */
export function factRowsFrom(source: Record<string, SourceFact>): FamilyFactRow[] {
  const rows: FamilyFactRow[] = [];
  for (const fact of Object.values(source)) {
    const text = fact.verified ? fact.display : fact.hedged;
    const sourceUrl =
      httpUrl(fact.sourced?.url) ?? (fact.sources ?? []).map(httpUrl).find(Boolean) ?? null;
    const checkedAt = dateOrNull(fact.verified ? fact.verifiedOn : fact.sourced?.checkedOn);
    const notes = [fact.label, fact.note]
      .filter((s) => typeof s === "string" && s.trim())
      .join("\n\n");
    for (const [language, claim] of perLocale(text, fact.key)) {
      rows.push({
        externalKey: fact.key,
        language,
        topic: fact.key.split(".")[0] || fact.key,
        claim,
        verified: fact.verified,
        sourceUrl,
        notes: notes || null,
        lastCheckedAt: checkedAt,
      });
    }
  }
  return rows;
}

export type FactsImportResult = FactUpsertResult & { keys: number; rows: number };

/** Parse `text` and upsert it into `familyId`. Throws `FactsImportError` for a bad family or source. */
export async function importFacts(
  familyId: string,
  text: string,
  options: { dryRun?: boolean } = {},
): Promise<FactsImportResult> {
  if (!(await getFamily(familyId))) throw new FactsImportError(`No family "${familyId}".`);
  const source = parseFactsSource(text);
  const rows = factRowsFrom(source);
  const keys = Object.keys(source).length;
  if (options.dryRun) return { keys, rows: rows.length, inserted: 0, updated: 0, unchanged: 0 };
  return { keys, rows: rows.length, ...(await upsertFamilyFacts(familyId, rows)) };
}

/** Largest source accepted, from a URL or an upload. The real file is ~100 KB. */
export const MAX_SOURCE_BYTES = 2_000_000;

/** Read a source over http(s): the raw GitHub URL on Anton's PC. */
export async function fetchFactsSource(url: string): Promise<string> {
  if (!httpUrl(url))
    throw new FactsImportError("The source must be an http(s) URL or a file path.");
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  } catch (err) {
    throw new FactsImportError(
      `Could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) throw new FactsImportError(`Fetching ${url} returned HTTP ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_SOURCE_BYTES) throw new FactsImportError("The source file is too large.");
  return text;
}

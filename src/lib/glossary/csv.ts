/**
 * Glossary CSV import/export (build 4 §3.D). Pure: RFC 4180 quoting (fields
 * with a comma, quote, CR or LF are quoted; quotes doubled), CRLF line ends,
 * UTF-8 text kept as-is so Guaraní letters (ã ẽ ĩ õ ũ ỹ g̃) and the puso (')
 * round-trip. A leading BOM is ignored on read.
 */

import { GLOSSARY_REGISTERS, type GlossaryRegister } from "@/db/schema";
import { LEXICON_REVIEW_STATUSES, type LexiconReviewStatus } from "@/lib/voice/contract";

export const GLOSSARY_CSV_COLUMNS = [
  "term",
  "language",
  "meaning_es",
  "meaning_en",
  "say_as",
  "part_of_speech",
  "register",
  "jopara_ok",
  "example",
  "example_translation",
  "review_status",
  "reviewed_by",
  "reviewed_at",
  "source",
  "notes",
] as const;

export type GlossaryCsvRow = {
  term: string;
  language: string;
  meaningEs: string | null;
  meaningEn: string | null;
  sayAs: string | null;
  partOfSpeech: string | null;
  register: GlossaryRegister;
  joparaOk: boolean;
  example: string | null;
  exampleTranslation: string | null;
  reviewStatus: LexiconReviewStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  source: string | null;
  notes: string | null;
};

export class GlossaryCsvError extends Error {}

/** Split CSV text into records of raw fields (RFC 4180). */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === ",") {
      record.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) throw new GlossaryCsvError("Unterminated quoted field.");
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // Blank lines are not records.
  return records.filter((r) => !(r.length === 1 && r[0] === ""));
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(records: string[][]): string {
  return records.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}

const blank = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

function parseBool(v: string | undefined): boolean {
  return /^(1|true|yes|si|sí|ja|x)$/i.test((v ?? "").trim());
}

/** Header-keyed rows; `term` is required, unknown columns are ignored. */
export function parseGlossaryCsv(text: string): GlossaryCsvRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const cols = header.map((h) => h.trim().toLowerCase());
  if (!cols.includes("term")) throw new GlossaryCsvError('The header needs a "term" column.');
  return body.map((record, n) => {
    const get = (name: (typeof GLOSSARY_CSV_COLUMNS)[number]) => {
      const at = cols.indexOf(name);
      return at < 0 ? undefined : record[at];
    };
    const term = blank(get("term"))?.normalize("NFC");
    if (!term) throw new GlossaryCsvError(`Row ${n + 2}: "term" is empty.`);
    const register = (blank(get("register")) ?? "everyday").toLowerCase();
    if (!(GLOSSARY_REGISTERS as readonly string[]).includes(register))
      throw new GlossaryCsvError(`Row ${n + 2}: unknown register "${register}".`);
    const status = (blank(get("review_status")) ?? "proposed").toLowerCase();
    if (!(LEXICON_REVIEW_STATUSES as readonly string[]).includes(status))
      throw new GlossaryCsvError(`Row ${n + 2}: unknown review_status "${status}".`);
    const reviewedAtRaw = blank(get("reviewed_at"));
    const reviewedAt = reviewedAtRaw ? new Date(reviewedAtRaw) : null;
    if (reviewedAt && Number.isNaN(reviewedAt.getTime()))
      throw new GlossaryCsvError(`Row ${n + 2}: reviewed_at is not a date.`);
    return {
      term,
      language: blank(get("language")) ?? "gn",
      meaningEs: blank(get("meaning_es")),
      meaningEn: blank(get("meaning_en")),
      sayAs: blank(get("say_as")),
      partOfSpeech: blank(get("part_of_speech")),
      register: register as GlossaryRegister,
      joparaOk: parseBool(get("jopara_ok")),
      example: blank(get("example")),
      exampleTranslation: blank(get("example_translation")),
      reviewStatus: status as LexiconReviewStatus,
      reviewedBy: blank(get("reviewed_by")),
      reviewedAt,
      source: blank(get("source")),
      notes: blank(get("notes")),
    };
  });
}

export function glossaryToCsv(rows: GlossaryCsvRow[]): string {
  return toCsv([
    [...GLOSSARY_CSV_COLUMNS],
    ...rows.map((r) => [
      r.term,
      r.language,
      r.meaningEs ?? "",
      r.meaningEn ?? "",
      r.sayAs ?? "",
      r.partOfSpeech ?? "",
      r.register,
      r.joparaOk ? "true" : "false",
      r.example ?? "",
      r.exampleTranslation ?? "",
      r.reviewStatus,
      r.reviewedBy ?? "",
      r.reviewedAt ? r.reviewedAt.toISOString() : "",
      r.source ?? "",
      r.notes ?? "",
    ]),
  ]);
}

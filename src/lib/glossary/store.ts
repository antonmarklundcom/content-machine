import { deleteReturning, insertIfAbsent, updateReturning, upsertReturning } from "@/db/mutations";
/**
 * Glossary data access (build 4 §3.D). No auth here: `glossary.actions.ts`
 * gates every write to the owner.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  GLOSSARY_REGISTERS,
  glossaryTerms,
  pronunciations,
  type GlossaryRegister,
  type GlossaryTerm,
} from "@/db/schema";
import { LEXICON_REVIEW_STATUSES, type LexiconReviewStatus } from "@/lib/voice/contract";

import { parseGlossaryCsv, type GlossaryCsvRow } from "./csv";
import type { ApprovedTerm } from "./prompt";

export class InvalidGlossaryError extends Error {}

export type GlossaryFilters = {
  q?: string;
  status?: LexiconReviewStatus;
  register?: GlossaryRegister;
  joparaOk?: boolean;
};

export function isReviewStatus(v: unknown): v is LexiconReviewStatus {
  return typeof v === "string" && (LEXICON_REVIEW_STATUSES as readonly string[]).includes(v);
}

export function isRegister(v: unknown): v is GlossaryRegister {
  return typeof v === "string" && (GLOSSARY_REGISTERS as readonly string[]).includes(v);
}

export async function listGlossary(filters: GlossaryFilters = {}): Promise<GlossaryTerm[]> {
  const where: SQL[] = [];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(
      or(
        sql`lower(${glossaryTerms.term}) like lower(${like})`,
        sql`lower(${glossaryTerms.meaningEs}) like lower(${like})`,
        sql`lower(${glossaryTerms.meaningEn}) like lower(${like})`,
        sql`lower(${glossaryTerms.example}) like lower(${like})`,
      )!,
    );
  }
  if (filters.status) where.push(eq(glossaryTerms.reviewStatus, filters.status));
  if (filters.register) where.push(eq(glossaryTerms.register, filters.register));
  if (filters.joparaOk !== undefined) where.push(eq(glossaryTerms.joparaOk, filters.joparaOk));
  return db
    .select()
    .from(glossaryTerms)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(glossaryTerms.term));
}

export async function getGlossaryTerm(id: number): Promise<GlossaryTerm | null> {
  const [row] = await db.select().from(glossaryTerms).where(eq(glossaryTerms.id, id)).limit(1);
  return row ?? null;
}

/** What the add/edit form writes. Review fields are set by `reviewGlossaryTerm`. */
export type GlossaryInput = {
  term: string;
  language?: string;
  meaningEs?: string | null;
  meaningEn?: string | null;
  sayAs?: string | null;
  partOfSpeech?: string | null;
  register?: GlossaryRegister;
  joparaOk?: boolean;
  example?: string | null;
  exampleTranslation?: string | null;
  source?: string | null;
  notes?: string | null;
};

const clean = (v: string | null | undefined) => {
  const s = v?.trim();
  return s ? s : null;
};

function values(input: GlossaryInput) {
  const term = input.term?.trim().normalize("NFC");
  if (!term) throw new InvalidGlossaryError("The term is empty.");
  if (term.length > 255) throw new InvalidGlossaryError("The term is too long.");
  if (input.register && !isRegister(input.register))
    throw new InvalidGlossaryError("Unknown register.");
  return {
    term,
    language: clean(input.language) ?? "gn",
    meaningEs: clean(input.meaningEs),
    meaningEn: clean(input.meaningEn),
    sayAs: clean(input.sayAs),
    partOfSpeech: clean(input.partOfSpeech),
    register: input.register ?? "everyday",
    joparaOk: input.joparaOk ?? false,
    example: clean(input.example),
    exampleTranslation: clean(input.exampleTranslation),
    source: clean(input.source),
    notes: clean(input.notes),
  };
}

export async function createGlossaryTerm(input: GlossaryInput): Promise<GlossaryTerm> {
  const v = values(input);
  const [row] = await insertIfAbsent(db, glossaryTerms, v, {
    target: [glossaryTerms.term, glossaryTerms.language],
  });
  if (!row) throw new InvalidGlossaryError(`"${v.term}" is already in the glossary.`);
  return row;
}

/**
 * Edit a term. Changing the word, a meaning or the example sends an approved
 * term back to `proposed`: the speaker approved what was there before.
 */
export async function updateGlossaryTerm(id: number, input: GlossaryInput): Promise<boolean> {
  const before = await getGlossaryTerm(id);
  if (!before) return false;
  const v = values(input);
  const changed =
    v.term !== before.term ||
    v.meaningEs !== before.meaningEs ||
    v.meaningEn !== before.meaningEn ||
    v.example !== before.example ||
    v.joparaOk !== before.joparaOk;
  const reset = changed && before.reviewStatus !== "proposed";
  await db
    .update(glossaryTerms)
    .set({
      ...v,
      ...(reset ? { reviewStatus: "proposed" as const, reviewedBy: null, reviewedAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(glossaryTerms.id, id));
  return true;
}

export async function reviewGlossaryTerm(
  id: number,
  status: LexiconReviewStatus,
  reviewer: string,
  at = new Date(),
): Promise<boolean> {
  const name = reviewer.trim();
  if (status !== "proposed" && !name) throw new InvalidGlossaryError("The reviewer is missing.");
  const rows = await updateReturning(
    db,
    glossaryTerms,
    {
      reviewStatus: status,
      reviewedBy: status === "proposed" ? null : name,
      reviewedAt: status === "proposed" ? null : at,
      updatedAt: new Date(),
    },
    eq(glossaryTerms.id, id),
    { id: glossaryTerms.id },
  );
  return rows.length > 0;
}

export async function deleteGlossaryTerm(id: number): Promise<boolean> {
  const rows = await deleteReturning(db, glossaryTerms, eq(glossaryTerms.id, id), {
    id: glossaryTerms.id,
  });
  return rows.length > 0;
}

export type ImportResult = { rows: number; inserted: number; updated: number };

/**
 * Upsert on (term, language). Re-importing the same file changes nothing. A
 * row in the file overwrites the stored fields, review included — the CSV is
 * what a reviewer edited.
 */
export async function importGlossaryRows(rows: GlossaryCsvRow[]): Promise<ImportResult> {
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const fresh = await db.transaction(async (tx) => {
      const added = await insertIfAbsent(
        tx,
        glossaryTerms,
        r,
        {
          target: [glossaryTerms.term, glossaryTerms.language],
        },
        { id: glossaryTerms.id },
      );
      if (added.length) return true;
      // The duplicate row stays locked until the transaction ends, so the
      // insert/update counters describe the operation that actually occurred.
      const changed = await updateReturning(
        tx,
        glossaryTerms,
        { ...r, updatedAt: new Date() },
        and(eq(glossaryTerms.term, r.term), eq(glossaryTerms.language, r.language)),
        { id: glossaryTerms.id },
      );
      if (!changed.length)
        throw new Error("The duplicate glossary term disappeared during import.");
      return false;
    });
    if (fresh) inserted++;
    else updated++;
  }
  return { rows: rows.length, inserted, updated };
}

export function importGlossaryCsv(text: string): Promise<ImportResult> {
  return importGlossaryRows(parseGlossaryCsv(text));
}

export const SEED_FILE = path.join("content", "glossary", "gn-seed.csv");

/**
 * Import the seed (the safe words from `jopara.md`). Idempotent, and it never
 * overwrites a term already on file — a reviewer's decision outlives the seed.
 */
export async function importSeed(root = process.cwd()): Promise<ImportResult> {
  const rows = parseGlossaryCsv(await readFile(path.join(root, SEED_FILE), "utf8"));
  let inserted = 0;
  for (const r of rows) {
    const out = await insertIfAbsent(
      db,
      glossaryTerms,
      r,
      { target: [glossaryTerms.term, glossaryTerms.language] },
      { id: glossaryTerms.id },
    );
    inserted += out.length;
  }
  return { rows: rows.length, inserted, updated: 0 };
}

export function toCsvRow(t: GlossaryTerm): GlossaryCsvRow {
  return {
    term: t.term,
    language: t.language,
    meaningEs: t.meaningEs,
    meaningEn: t.meaningEn,
    sayAs: t.sayAs,
    partOfSpeech: t.partOfSpeech,
    register: t.register,
    joparaOk: t.joparaOk,
    example: t.example,
    exampleTranslation: t.exampleTranslation,
    reviewStatus: t.reviewStatus,
    reviewedBy: t.reviewedBy,
    reviewedAt: t.reviewedAt,
    source: t.source,
    notes: t.notes,
  };
}

/** Languages a glossary pronunciation applies to (§3.D). */
export const PRONUNCIATION_LANGUAGES = ["gn", "jopara"] as const;

/**
 * "Send to pronunciations": a global respelling per language, with the term's
 * review status. Returns false when the term is gone or has no `sayAs`.
 */
export async function sendToPronunciations(id: number): Promise<boolean> {
  const t = await getGlossaryTerm(id);
  if (!t?.sayAs) return false;
  for (const language of PRONUNCIATION_LANGUAGES) {
    const review = {
      sayAs: t.sayAs,
      reviewStatus: t.reviewStatus,
      reviewedBy: t.reviewedBy,
      reviewedAt: t.reviewedAt,
    };
    await upsertReturning(
      db,
      pronunciations,
      {
        term: t.term,
        language,
        scope: "global",
        ...review,
        notes: `From the glossary (#${t.id}).`,
      },
      {
        target: [pronunciations.term, pronunciations.language, pronunciations.scope],
        set: { ...review, updatedAt: new Date() },
      },
    );
  }
  return true;
}

/** Approved, Jopará-ok Guaraní terms for prompts (§1.2). */
export async function listApprovedJoparaTerms(): Promise<ApprovedTerm[]> {
  return db
    .select({
      term: glossaryTerms.term,
      meaningEs: glossaryTerms.meaningEs,
      meaningEn: glossaryTerms.meaningEn,
      example: glossaryTerms.example,
    })
    .from(glossaryTerms)
    .where(
      and(
        eq(glossaryTerms.language, "gn"),
        eq(glossaryTerms.reviewStatus, "approved"),
        eq(glossaryTerms.joparaOk, true),
      ),
    )
    .orderBy(asc(glossaryTerms.term));
}

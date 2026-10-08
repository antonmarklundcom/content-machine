/**
 * Language rules at prompt time (build 4 §1.2): Jopará prompts get the list
 * of Guaraní words a native speaker approved; pure Guaraní is never generated.
 */

export type ApprovedTerm = {
  term: string;
  meaningEs: string | null;
  meaningEn: string | null;
  example: string | null;
};

export const GUARANI_REFUSAL =
  "Guaraní (gn) content is written or approved by people, never generated (PLAN-build4 §1.2). Write it yourself or with a native speaker, or pick Jopará.";

export class GuaraniGenerationRefusedError extends Error {
  readonly status = 400 as const;
  constructor() {
    super(GUARANI_REFUSAL);
  }
}

/** `gn`, `gn-PY`, … — pure Guaraní. Jopará is its own tag and is not this. */
export function isPureGuarani(language: string): boolean {
  const tag = language.trim().toLowerCase();
  return tag === "gn" || tag.startsWith("gn-") || tag === "guarani" || tag === "guaraní";
}

export function assertGeneratableLanguage(language: string): void {
  if (isPureGuarani(language)) throw new GuaraniGenerationRefusedError();
}

export const APPROVED_HEADING = "PALABRAS GUARANÍES APROBADAS";

/** The block appended to the Jopará guide. `terms` must already be approved + jopara_ok. */
export function approvedTermsBlock(terms: readonly ApprovedTerm[]): string {
  if (terms.length === 0) {
    return `${APPROVED_HEADING}
Todavía no hay palabras aprobadas en el glosario. Usá solo las palabras de "Palabras seguras" de esta guía; nunca uses otro guaraní ni inventes palabras o frases en guaraní. Si dudás, usá el castellano.`;
  }
  const lines = terms.map((t) =>
    [t.term, t.meaningEs ?? t.meaningEn ?? "", t.example ?? ""]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" — "),
  );
  return `${APPROVED_HEADING} (revisadas por un hablante nativo)
${lines.map((l) => `- ${l}`).join("\n")}
Usá solo estas palabras guaraníes y las de "Palabras seguras" de esta guía. Nunca uses otro guaraní ni inventes palabras o frases en guaraní. Si dudás, usá el castellano.`;
}

// ---------------------------------------------------------------------------
// Loading, with a short cache

type Source = () => Promise<ApprovedTerm[]>;

const TTL_MS = 60_000;
let cache: { at: number; terms: ApprovedTerm[] } | null = null;
let source: Source | null = null;

/** Tests swap the source; `null` restores the database. */
export function setApprovedTermsSource(next: Source | null): void {
  source = next;
  cache = null;
}

export function clearApprovedTermsCache(): void {
  cache = null;
}

async function defaultSource(): Promise<ApprovedTerm[]> {
  // A unit-test process (`node --test`) has no database to talk to, and an
  // open pool would keep it alive; integration tests set the source.
  if (process.env.NODE_TEST_CONTEXT || !process.env.DATABASE_URL) return [];
  const { listApprovedJoparaTerms } = await import("./store");
  return listApprovedJoparaTerms();
}

export async function loadApprovedJoparaTerms(now = Date.now()): Promise<ApprovedTerm[]> {
  if (cache && now - cache.at < TTL_MS) return cache.terms;
  let terms: ApprovedTerm[];
  try {
    terms = await (source ?? defaultSource)();
  } catch {
    // No database: the safe list still applies, and the block says so.
    terms = [];
  }
  cache = { at: now, terms };
  return terms;
}

/** The guide as the model sees it: Jopará gets the approved-words block appended. */
export async function withLanguageRules(language: string, guide: string): Promise<string> {
  if (language.trim().toLowerCase() !== "jopara") return guide;
  const block = approvedTermsBlock(await loadApprovedJoparaTerms());
  return guide.trim() ? `${guide.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

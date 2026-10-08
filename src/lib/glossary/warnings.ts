/**
 * Flags Guaraní-looking words a text uses that nobody approved (build 4 §1.2).
 * Pure: the caller passes the approved terms; the safe list from
 * `content/style/jopara.md` is always allowed.
 */

/** The "Palabras seguras" in `content/style/jopara.md`. */
export const SAFE_JOPARA_WORDS = [
  "nde",
  "che",
  "ra'a",
  "mba'e",
  "pio",
  "piko",
  "katu",
  "na",
  "ndaje",
  "jaha",
  "iporã",
  "vai",
  "aguyje",
] as const;

/**
 * Common Guaraní words without a nasal letter or puso, so the letter rules
 * alone would miss them. Words Spanish also uses (tereré, jopara, karai as a
 * name) are left out to keep warnings useful.
 */
export const COMMON_GUARANI_WORDS = [
  "ñande",
  "ore",
  "ikatu",
  "ndaikatui",
  "ndaikatúi",
  "nahaniri",
  "nahániri",
  "heta",
  "hetaiterei",
  "porã",
  "porãite",
  "kuña",
  "mitã",
  "tuicha",
  "hasy",
  "avei",
  "upéi",
  "upeva",
  "upéva",
  "kova",
  "kóva",
  "hina",
  "hína",
  "mbarete",
  "mbaretete",
  "pyhare",
  "tembiapo",
  "tekove",
  "yvy",
  "ndéve",
  "chéve",
  "ñandéve",
  "aipota",
  "ahecha",
  "ahayhu",
  "rohayhu",
  "jajapo",
  "rejapo",
  "ajapo",
  "jaike",
  "nandi",
  "ndaipori",
  "ndaipóri",
] as const;

export type GuaraniWarning = {
  /** The word as written in the text. */
  word: string;
  /** UTF-16 offset in the text, and length, for highlighting. */
  index: number;
  length: number;
  reason: "nasal" | "puso" | "known";
};

const WORD = /[\p{L}\p{M}]+(?:['’ʼ][\p{L}\p{M}]+)*/gu;
const NASAL = /[ãẽĩõũỹÃẼĨÕŨỸ]|[gG]̃/u;
/** The puso sits between letters and is followed by a vowel: ra'a, mba'e, ko'ãga. */
const PUSO = /[\p{L}\p{M}]['’ʼ][aeiouyáéíóúýãẽĩõũỹ]/iu;

export function normalizeGuarani(word: string): string {
  return word.normalize("NFC").replace(/[’ʼ]/g, "'").toLowerCase();
}

const COMMON = new Set(COMMON_GUARANI_WORDS.map(normalizeGuarani));

/** Every token of `approvedTerms` (a term may be several words) plus the safe list. */
function allowedSet(approvedTerms: readonly string[]): Set<string> {
  const allowed = new Set<string>(SAFE_JOPARA_WORDS.map(normalizeGuarani));
  for (const term of approvedTerms) {
    allowed.add(normalizeGuarani(term.trim()));
    for (const m of term.matchAll(WORD)) allowed.add(normalizeGuarani(m[0]));
  }
  return allowed;
}

export function findUnapprovedGuarani(
  text: string,
  approvedTerms: readonly string[],
): GuaraniWarning[] {
  const allowed = allowedSet(approvedTerms);
  const warnings: GuaraniWarning[] = [];
  for (const m of text.matchAll(WORD)) {
    const word = m[0];
    const norm = normalizeGuarani(word);
    if (allowed.has(norm)) continue;
    const reason = NASAL.test(norm)
      ? "nasal"
      : PUSO.test(norm)
        ? "puso"
        : COMMON.has(norm)
          ? "known"
          : null;
    if (reason) warnings.push({ word, index: m.index, length: word.length, reason });
  }
  return warnings;
}

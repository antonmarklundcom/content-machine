import type { LexiconReviewStatus } from "./contract";

/**
 * The pronunciation dictionary, applied before synthesis (docs/VOICE.md).
 * Pure: the engine loads the rows, this decides which apply and rewrites the
 * text. Callers never respell; the engine does it once, here.
 *
 * Rules:
 *  - whole word, case-insensitive, Unicode-aware: a word is letters, marks
 *    (so `g̃` = g + U+0303 stays one letter), digits and the Guaraní puso
 *    (`'` or `’`, which match each other);
 *  - longest term first, one pass: a respelling is never itself rewritten;
 *  - narrower scope wins for the same term: `story:x` / `brand:x` >
 *    `provider:x` > `global`; then an exact language beats `*`;
 *  - only `approved` rows, unless `includeProposed` (previews).
 */

export type PronunciationRule = {
  term: string;
  sayAs: string;
  /** A `VoiceLanguage` or `*`. */
  language: string;
  /** `global`, `provider:<name>`, `brand:<id>`, `story:<slug>`. */
  scope: string;
  reviewStatus: LexiconReviewStatus;
};

export type PronunciationContext = {
  language: string;
  /** The provider the text goes to (`provider:<name>` rules). */
  provider?: string | null;
  /** Narrow scopes in play, e.g. `["story:tito", "brand:cuentos"]`. */
  scopes?: Array<string | null | undefined>;
  /** Also apply `proposed` rows (a preview before approving). */
  includeProposed?: boolean;
};

export type AppliedPronunciation = { term: string; sayAs: string; scope: string; count: number };

const PUSO = "'’";
const WORD_CHAR = `\\p{L}\\p{M}\\p{N}${PUSO}`;

/** 2 for a matching story/brand (or other narrow) scope, 1 for the provider, 0 global, null = not in play. */
export function scopeRank(scope: string, ctx: PronunciationContext): number | null {
  const s = scope.trim();
  if (s === "" || s === "global") return 0;
  if (s.startsWith("provider:")) {
    return ctx.provider && s === `provider:${ctx.provider}` ? 1 : null;
  }
  const scopes = (ctx.scopes ?? []).filter((x): x is string => !!x).map((x) => x.trim());
  return scopes.includes(s) ? 2 : null;
}

/** The comparison form of a term or a match: NFC, lower case, one kind of puso, single spaces. */
function key(term: string): string {
  return term.normalize("NFC").toLocaleLowerCase().replace(/’/g, "'").replace(/\s+/g, " ").trim();
}

/** The rules that apply in `ctx`, one per term (the winner), longest term first. */
export function selectRules(
  rules: PronunciationRule[],
  ctx: PronunciationContext,
): PronunciationRule[] {
  const best = new Map<string, { rule: PronunciationRule; rank: number }>();
  for (const rule of rules) {
    if (!rule.term.trim()) continue;
    if (rule.reviewStatus === "rejected") continue;
    if (rule.reviewStatus === "proposed" && !ctx.includeProposed) continue;
    if (rule.language !== "*" && rule.language !== ctx.language) continue;
    const scope = scopeRank(rule.scope, ctx);
    if (scope === null) continue;
    // Scope dominates; then an exact language beats `*`; then approved beats proposed.
    const rank =
      scope * 4 + (rule.language === "*" ? 0 : 2) + (rule.reviewStatus === "approved" ? 1 : 0);
    const k = key(rule.term);
    const current = best.get(k);
    if (!current || rank > current.rank) best.set(k, { rule, rank });
  }
  return [...best.values()]
    .map((b) => b.rule)
    .sort((a, b) => key(b.term).length - key(a.term).length || a.term.localeCompare(b.term));
}

function escapeTerm(term: string): string {
  return term
    .normalize("NFC")
    .trim()
    .replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")
    .replace(/['’]/g, `[${PUSO}]`)
    .replace(/\s+/g, "\\s+");
}

/** Rewrite `text` with the rules that apply in `ctx`. */
export function applyPronunciations(
  text: string,
  rules: PronunciationRule[],
  ctx: PronunciationContext,
): { text: string; applied: AppliedPronunciation[] } {
  const chosen = selectRules(rules, ctx);
  const source = text.normalize("NFC");
  if (!chosen.length) return { text: source, applied: [] };

  const byKey = new Map(chosen.map((r) => [key(r.term), r]));
  const pattern = new RegExp(
    `(?<![${WORD_CHAR}])(?:${chosen.map((r) => escapeTerm(r.term)).join("|")})(?![${WORD_CHAR}])`,
    "giu",
  );
  const counts = new Map<PronunciationRule, number>();
  const out = source.replace(pattern, (match) => {
    const rule = byKey.get(key(match));
    if (!rule) return match;
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
    return rule.sayAs;
  });
  const applied = chosen
    .filter((r) => counts.has(r))
    .map((r) => ({ term: r.term, sayAs: r.sayAs, scope: r.scope, count: counts.get(r) ?? 0 }));
  return { text: out, applied };
}

/**
 * Model rates and cost accounting (PLAN.md §1).
 *
 * Rates are USD per million tokens, Gemini API paid tier, read from Google's
 * own current pricing page on 2026-08-29 (Agent Platform / Vertex generative-AI
 * pricing, global endpoint — the Gemini Developer API bills the same per-token
 * figures for these models). Kept in one table because PR-07's hard spend cap
 * is only as trustworthy as this arithmetic — a wrong rate here silently
 * under-reports every row and the cap trips too late.
 *
 * PLAN.md §5.O3 moved every paid call off Anthropic onto Gemini; the shape of
 * this module did not change with the provider, only the model names and the
 * numbers.
 */

export type AnalysisModel = "gemini-3.1-flash-lite" | "gemini-3.7-flash";

/**
 * PLAN.md §1: the cheap model is the default. Summarising a transcript against
 * a fixed template is not a reasoning-hard task, and the cost difference (6x on
 * input, 5x on output) decides it. The stronger model is a per-video opt-in.
 *
 * This is the seat Haiku 4.5 used to hold. Flash-Lite is cheaper than Haiku was
 * on both sides of the ledger ($0.25/$1.50 against $1/$5), which is most of why
 * §8 answered the provider question the way it did.
 */
export const DEFAULT_MODEL: AnalysisModel = "gemini-3.1-flash-lite";

/**
 * The per-video opt-in: the same analysis on the stronger, dearer model. Named
 * here so no route, script or page has to carry a model string of its own — a
 * literal in a page is how a provider swap gets missed.
 */
export const UPGRADE_MODEL: AnalysisModel = "gemini-3.7-flash";

export type Rates = {
  /** USD per million input tokens, for a request under the long-context threshold. */
  input: number;
  /** USD per million output tokens (Gemini bills reasoning tokens as output). */
  output: number;
  /**
   * Rates once a request crosses LONG_CONTEXT_THRESHOLD_TOKENS. Absent means
   * the model is priced flat at any context length, which is true of every
   * Flash/Flash-Lite tier on the current page.
   */
  longContext?: { input: number; output: number };
  /** Minimum prefix length that will cache on this model, in tokens. */
  cacheMinimumTokens: number;
};

/**
 * Past this many input tokens, Google charges *all* tokens in the request —
 * input and output both — at the model's long-context rates. Uniform across the
 * Gemini 3 family on the 2026-08-29 page.
 *
 * Nothing this app sends comes close (the longest input is a transcript, ~7k
 * tokens for an hour of speech), but the tier is honoured here anyway: the one
 * failure this file exists to prevent is billing a call at less than it cost.
 */
export const LONG_CONTEXT_THRESHOLD_TOKENS = 200_000;

/**
 * The two models the analysis/screening pipeline may run on.
 *
 * Gemini 3.1 Flash-Lite is the Haiku seat, Gemini 3.7 Flash the Sonnet seat.
 */
export const MODEL_RATES: Record<AnalysisModel, Rates> = {
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheMinimumTokens: 4096 },
  // Gemini 3.7 Flash has an introductory $0.75/$3.75 rate through 2026-12-31;
  // from 2027-01-01 the standard rate below applies. The standard rate is used
  // here deliberately: over-estimating spend makes the PR-07 cap trip early,
  // which is the safe direction to be wrong in, and it means nothing silently
  // starts under-reporting on New Year's Day. (Same call the old table made
  // about Sonnet 5's introductory rate.)
  "gemini-3.7-flash": { input: 1.5, output: 7.5, cacheMinimumTokens: 4096 },
};

/**
 * Rates for the brand-ideation path (src/lib/ai.ts), which is not limited to
 * the two analysis models — it runs on GEMINI_MODEL, defaulting to Gemini 3.7
 * Flash. Kept in the same file as MODEL_RATES for the reason stated at the top:
 * one place to be wrong about a price, not two.
 *
 * The Pro row is still here even though nothing defaults to it: it is the
 * ceiling ideationRates() falls back to below, so it has to stay the most
 * expensive entry in this table.
 */
export const IDEATION_MODEL_RATES: Record<string, Rates> = {
  // The Pro seat, and the only model here with a long-context tier: above
  // 200k input tokens both figures roughly double, to $4/$18.
  "gemini-3.1-pro-preview": {
    input: 2,
    output: 12,
    longContext: { input: 4, output: 18 },
    cacheMinimumTokens: 4096,
  },
  "gemini-3.7-flash": { input: 1.5, output: 7.5, cacheMinimumTokens: 4096 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheMinimumTokens: 4096 },
};

/**
 * Rates for whatever GEMINI_MODEL is set to.
 *
 * An unknown model bills at the most expensive rate on file rather than
 * throwing or guessing low: the cap is a guard, and over-estimating an unknown
 * model trips it early — the safe direction (the same reasoning as the
 * introductory-rate comment above). Changing provider did not change which
 * direction it is safe to be wrong in.
 */
export function ideationRates(model: string): Rates {
  return IDEATION_MODEL_RATES[model] ?? IDEATION_MODEL_RATES["gemini-3.1-pro-preview"];
}

/**
 * Grounding with Google Search is billed per *query*, on top of tokens:
 * $14 per 1,000 grounding queries. One request can issue several queries, and
 * each one is charged — which is why this is per-query and not, as the
 * Anthropic `web_search` fee it replaces was, per request. The count comes from
 * `groundingMetadata.webSearchQueries` on the response (see src/lib/ai.ts).
 *
 * Two things are deliberately NOT modelled, both in the over-reporting
 * direction:
 *  - the first 5,000 grounding queries a month are free, aggregated across
 *    Gemini 3 models. Charging for them from the first query means this app's
 *    figure runs ahead of the real bill rather than behind it, and it keeps
 *    the arithmetic stateless — a free-tier counter would have to be tracked
 *    per calendar month across every deploy sharing the key.
 *  - the tokens Search grounding feeds back into the prompt are not charged by
 *    Google at all, so they are excluded from billed input in src/lib/ai.ts.
 *
 * `/api/generate` is the only caller — the analysis pipeline does not search.
 */
export const GROUNDING_USD_PER_QUERY = 14 / 1000;

/**
 * Cache accounting.
 *
 * Gemini prices a cache hit at 0.1x base input, but that discount is only
 * documented as reaching the bill on the 2.5 family, and this app never creates
 * an explicit cache (there is no `cache_control` breakpoint to set — caching on
 * Gemini is implicit, and needs a shared prefix of at least `cacheMinimumTokens`
 * that none of these prompts have). Cached tokens are therefore billed here at
 * the full input rate: if a cache hit ever does land, this over-reports it,
 * which is the safe direction. Gemini has no per-token cache-*write* charge at
 * all — explicit caching is billed by storage-hour, which this app never buys —
 * so `cacheWriteTokens` is always 0 on this provider and the multiplier only
 * exists so that a future writer of that field bills as plain input rather than
 * as free.
 */
const CACHE_READ_MULTIPLIER = 1;
const CACHE_WRITE_MULTIPLIER = 1;

/** Batch API is a flat 50% discount on everything (PLAN.md §1.2). */
export const BATCH_DISCOUNT = 0.5;

export type TokenUsage = {
  /** Tokens processed at full price — excludes both cache figures. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export function estimateCostUsd(
  model: AnalysisModel,
  usage: TokenUsage,
  options: { batch?: boolean } = {},
): number {
  return costUsdAtRates(MODEL_RATES[model], usage, options);
}

/** The same arithmetic, for a model whose rates are not in MODEL_RATES. */
export function costUsdAtRates(
  rates: Rates,
  usage: TokenUsage,
  options: { batch?: boolean } = {},
): number {
  // Google's threshold is on the request's input context, and crossing it
  // reprices the output too.
  const inputContext = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const tier =
    rates.longContext && inputContext > LONG_CONTEXT_THRESHOLD_TOKENS ? rates.longContext : rates;

  const perMillion =
    usage.inputTokens * tier.input +
    usage.cacheReadTokens * tier.input * CACHE_READ_MULTIPLIER +
    usage.cacheWriteTokens * tier.input * CACHE_WRITE_MULTIPLIER +
    usage.outputTokens * tier.output;

  const cost = perMillion / 1_000_000;
  return options.batch ? cost * BATCH_DISCOUNT : cost;
}

/** decimal(10,6) in the schema — round here so the stored value matches. */
export function toCostString(costUsd: number): string {
  return costUsd.toFixed(6);
}

export function isAnalysisModel(value: string): value is AnalysisModel {
  return value === "gemini-3.1-flash-lite" || value === "gemini-3.7-flash";
}

/**
 * [PR-35] Gallringen, step 1 — the screening contract.
 *
 * Deliberately tiny. The analysis contract (lib/analysis/contract.ts) is what a
 * researcher reads instead of watching the video, so it is nine fields and it is
 * frozen. A screening is read by the pipeline, not by a person: it answers one
 * question — is this worth $0.02 — and the only reason it carries prose at all
 * is that a number nobody can argue with is a number nobody will trust.
 *
 * Two fields, and both are load-bearing:
 *
 * - `score` is what the pipeline acts on, and it is a score rather than a
 *   verdict on purpose. The model is not told where the bar is, because the bar
 *   is a spend decision the owner changes (SCREEN_MIN_SCORE) and the model's
 *   sense of "worth it" must not move with it. See lib/screening/policy.ts.
 * - `reason` is what the owner reads when the gallring drops something they
 *   wanted. Without it, a culled video is an unexplained absence, and one
 *   unexplained absence is enough to stop trusting the whole filter.
 */

export type ScreeningPayload = {
  /** 0–100. How much this video's metadata suggests a full analysis would earn its cost. */
  score: number;
  /** One sentence naming the evidence. Shown verbatim in the UI. */
  reason: string;
};

/**
 * Bumped when a change to the prompt alters what a stored score *means*.
 *
 * Unlike ANALYSIS_PROMPT_VERSION this is cheap to bump: re-screening the whole
 * corpus costs a twentieth of re-analysing it, and screenings are replaceable
 * by design. It is still recorded per row, because comparing scores written by
 * two different prompts is the one way this table can quietly lie.
 */
export const SCREENING_PROMPT_VERSION = 1;

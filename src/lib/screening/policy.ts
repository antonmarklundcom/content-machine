/**
 * [PR-35] Where the bar sits, and who is allowed to move it.
 *
 * The screening model returns a score; this file turns a score into a decision.
 * Keeping the two apart is what makes the bar adjustable after the fact: raising
 * SCREEN_MIN_SCORE re-culls every video already screened without another API
 * call, and lowering it hands them back.
 */

/**
 * Default bar. Deliberately in the middle rather than high: the prompt is told
 * to answer 50 when the evidence is thin, so a default above 50 would cull every
 * video with a sparse description — which is a description filter dressed up as
 * a quality one.
 */
export const DEFAULT_MIN_SCORE = 50;

export function screenMinScore(): number {
  const raw = process.env.SCREEN_MIN_SCORE;
  if (raw === undefined || raw === "") return DEFAULT_MIN_SCORE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(
      `SCREEN_MIN_SCORE must be a number between 0 and 100, got "${raw}". ` +
        "Set it to 0 to keep screening videos but never cull one.",
    );
  }
  return parsed;
}

/**
 * Whether the poll run screens at all (SCREENING_ENABLED, default on).
 *
 * Off means no screening call is made and nothing is culled — the pipeline
 * behaves exactly as it did before PR-35. It is not the same as
 * SCREEN_MIN_SCORE=0, which keeps paying for screenings that no longer decide
 * anything: that combination is for measuring how the gallring would have
 * judged the corpus before letting it act.
 */
export function screeningEnabled(): boolean {
  const raw = process.env.SCREENING_ENABLED;
  if (raw === undefined || raw === "") return true;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

/** The owner's statement of current work, verbatim, or undefined. See prompt.ts. */
export function screenInterests(): string | undefined {
  const raw = process.env.SCREEN_INTERESTS?.trim();
  return raw ? raw : undefined;
}

/**
 * Culled = screened successfully, and scored below the bar.
 *
 * Every other state keeps the video: never screened, screening failed, score
 * null. The gallring fails open, always. It removes work from a queue on the
 * strength of one cheap opinion, and the failure mode of getting that wrong is
 * a video that silently never gets read — so the only thing allowed to cull is
 * an actual judgement that actually came back.
 */
export function isCulled(
  screening: { status: "ok" | "failed"; score: number | null } | null | undefined,
  minScore: number = screenMinScore(),
): boolean {
  if (!screening || screening.status !== "ok" || screening.score === null) return false;
  return screening.score < minScore;
}

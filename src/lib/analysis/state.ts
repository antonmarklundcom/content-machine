import type { Analysis, CaptionStatus } from "@/db/schema";

/**
 * How the UI talks about a video's analysis (PLAN.md §9 PR-17).
 *
 * `analyses` is append-only and a video can have no row at all, so the feed
 * needs three states rather than a boolean. `pending` is deliberately narrower
 * than "no analysis row": a video with no captions is never going to be
 * analysed, and labelling it pending would promise work that will never happen.
 */
export type AnalysisState = "analysed" | "failed" | "pending" | "unanalysable";

export function analysisState(
  status: Analysis["status"] | null,
  captionStatus: CaptionStatus,
): AnalysisState {
  if (status === "ok") return "analysed";
  if (status === "failed") return "failed";
  return captionStatus === "available" ? "pending" : "unanalysable";
}

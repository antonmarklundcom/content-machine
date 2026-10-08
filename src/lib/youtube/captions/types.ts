/** Shared types for the caption layer (PR-01 probe, PR-05 pipeline). */

export type CaptionKind = "manual" | "asr";

export type CaptionTrack = {
  languageCode: string;
  /** Human label as YouTube reports it, e.g. "English (auto-generated)". */
  name: string;
  kind: CaptionKind;
  /** Fully-qualified timedtext URL. */
  baseUrl: string;
};

export type CaptionSegment = {
  /** Seconds from video start. */
  start: number;
  /** Seconds. */
  dur: number;
  text: string;
};

export type CaptionResult = {
  strategy: StrategyName;
  languageCode: string;
  kind: CaptionKind;
  segments: CaptionSegment[];
  /** Segments joined into flowing prose — what the analysis prompt consumes. */
  text: string;
  wordCount: number;
};

/**
 * Why a strategy produced nothing. `no_captions` is a property of the video and
 * means every other strategy will also fail — the pipeline stops trying.
 * Everything else is a property of the network path and is worth retrying.
 */
export type CaptionFailureReason =
  "no_captions" | "blocked" | "unplayable" | "network" | "parse" | "unavailable";

export type StrategyName =
  | "innertube-android"
  | "innertube-ios"
  | "innertube-tv"
  | "innertube-web"
  | "watch-page"
  | "youtubei-lib";

export type StrategyOutcome =
  | { ok: true; strategy: StrategyName; result: CaptionResult; ms: number; trackCount: number }
  | {
      ok: false;
      strategy: StrategyName;
      reason: CaptionFailureReason;
      /** Where it broke: "list" (finding tracks) or "fetch" (downloading one). */
      stage: "list" | "fetch";
      error: string;
      ms: number;
      trackCount: number;
    };

export type ListTracksOptions = {
  /** Abort a single HTTP call after this many ms. */
  timeoutMs?: number;
};

export class CaptionError extends Error {
  constructor(
    message: string,
    readonly reason: CaptionFailureReason,
    readonly stage: "list" | "fetch" = "list",
  ) {
    super(message);
    this.name = "CaptionError";
  }
}

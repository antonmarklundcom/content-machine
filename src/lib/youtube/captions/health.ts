import type { CaptionFailureReason, StrategyName, StrategyOutcome } from "./types";

/**
 * Adaptive strategy health — stop paying for a caption strategy that has
 * already proved dead on this host.
 *
 * The problem this solves: every strategy in STRATEGY_ORDER costs a real round
 * trip, and a blocked one costs the full 20s timeout before it gives up. On a
 * host whose IP YouTube refuses, an ingest of 50 videos pays 6 dead strategies
 * × 50 videos before anyone notices. CAPTION_STRATEGIES already lets the owner
 * pin a working list by hand — but only *after* a probe run has told them what
 * to pin, and only until YouTube changes its mind. This is the same saving,
 * learned automatically, within a single run.
 *
 * Scope is deliberately one process. A CLI script, a poll run, or a single
 * serverless invocation each get a fresh tracker; nothing is written to the
 * database. Cross-run persistence would mean a transient block on Tuesday
 * silently disabling a strategy on Wednesday, which is exactly the failure mode
 * the manual CAPTION_STRATEGIES override already has.
 */

/**
 * Consecutive failures before a strategy is retired for the rest of the run.
 *
 * Three, because a strategy fails for reasons that have nothing to do with the
 * network path: an age-restricted or region-locked video, a transient 5xx, one
 * track whose body fails to parse. At N=1 a single unlucky video permanently
 * retires a healthy strategy; at N=2 any two awkward videos in a row do. Three
 * consecutive failures on three different videos is strong evidence the path
 * itself is dead, and the cost of learning it stays bounded — at most three
 * attempts per strategy per run, i.e. ~60s worst case for a fully blocked one,
 * paid once instead of once per video.
 */
export const DEFAULT_FAILURE_THRESHOLD = 3;

/**
 * Reasons that retire a strategy immediately rather than after N failures.
 *
 * `unavailable` means the strategy could not run at all — youtubei.js is not
 * installed, the module exported no Innertube, the proxy dispatcher would not
 * load. None of those get better on the next video, so waiting for two more
 * failures only buys latency.
 */
const TERMINAL_REASONS: ReadonlySet<CaptionFailureReason> = new Set<CaptionFailureReason>([
  "unavailable",
]);

export type StrategyHealthSnapshot = {
  strategy: StrategyName;
  attempts: number;
  successes: number;
  consecutiveFailures: number;
  retired: boolean;
  /** Why it was retired, or the most recent failure reason if still live. */
  lastReason: CaptionFailureReason | null;
};

type Entry = {
  attempts: number;
  successes: number;
  consecutiveFailures: number;
  retired: boolean;
  lastReason: CaptionFailureReason | null;
};

export class StrategyHealth {
  private readonly entries = new Map<StrategyName, Entry>();
  readonly threshold: number;

  /** `threshold: 0` disables retirement entirely — every strategy stays live. */
  constructor(options: { threshold?: number } = {}) {
    const raw = options.threshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.threshold = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_FAILURE_THRESHOLD;
  }

  /** Whether this strategy is still worth attempting in this run. */
  isLive(strategy: StrategyName): boolean {
    return !this.entries.get(strategy)?.retired;
  }

  /**
   * The still-live subset of `candidates`, in the caller's order.
   *
   * The caller's list is the allowlist — CAPTION_STRATEGIES, when set, is a
   * floor this can only prune, never widen. A strategy the owner left out of
   * CAPTION_STRATEGIES is never reintroduced by good health.
   */
  live(candidates: readonly StrategyName[]): StrategyName[] {
    return candidates.filter((s) => this.isLive(s));
  }

  /** Strategies retired so far, in retirement order. */
  retired(): StrategyName[] {
    return [...this.entries.entries()].filter(([, e]) => e.retired).map(([name]) => name);
  }

  /**
   * Fold one attempt into the tracker.
   *
   * A `no_captions` verdict counts as contact, not failure: the strategy
   * reached YouTube and got a straight answer about the video. Treating it as a
   * failure would retire every strategy on a run that happens to start with
   * three caption-less videos.
   */
  record(outcome: StrategyOutcome): void {
    const entry = this.entryFor(outcome.strategy);
    entry.attempts += 1;

    if (outcome.ok) {
      entry.successes += 1;
      entry.consecutiveFailures = 0;
      entry.lastReason = null;
      return;
    }

    entry.lastReason = outcome.reason;

    if (outcome.reason === "no_captions") {
      entry.consecutiveFailures = 0;
      return;
    }

    entry.consecutiveFailures += 1;

    if (this.threshold === 0) return;
    if (TERMINAL_REASONS.has(outcome.reason) || entry.consecutiveFailures >= this.threshold) {
      entry.retired = true;
    }
  }

  private entryFor(strategy: StrategyName): Entry {
    let entry = this.entries.get(strategy);
    if (!entry) {
      entry = {
        attempts: 0,
        successes: 0,
        consecutiveFailures: 0,
        retired: false,
        lastReason: null,
      };
      this.entries.set(strategy, entry);
    }
    return entry;
  }

  snapshot(): StrategyHealthSnapshot[] {
    return [...this.entries.entries()].map(([strategy, e]) => ({
      strategy,
      attempts: e.attempts,
      successes: e.successes,
      consecutiveFailures: e.consecutiveFailures,
      retired: e.retired,
      lastReason: e.lastReason,
    }));
  }

  /** One line for a run log. Empty string when nothing has been attempted. */
  summary(): string {
    return summariseHealth(this.snapshot());
  }
}

/**
 * One line for a run log, from a snapshot — what the CLI scripts and the cron
 * route have, since they receive the run's result rather than the tracker.
 */
export function summariseHealth(rows: StrategyHealthSnapshot[]): string {
  if (rows.length === 0) return "";
  return rows
    .map((r) => {
      const state = r.retired
        ? `retired after ${r.consecutiveFailures} (${r.lastReason ?? "unknown"})`
        : `${r.successes}/${r.attempts} ok`;
      return `${r.strategy}: ${state}`;
    })
    .join(" · ");
}

/** `CAPTION_FAILURE_THRESHOLD`, or the documented default. 0 disables retirement. */
export function configuredFailureThreshold(): number {
  const raw = process.env.CAPTION_FAILURE_THRESHOLD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_FAILURE_THRESHOLD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_FAILURE_THRESHOLD;
}

let current: StrategyHealth | null = null;

/**
 * The tracker for this process.
 *
 * Lazily built so `CAPTION_FAILURE_THRESHOLD` is read at first use rather than
 * at import time — scripts load dotenv after their imports have run.
 */
export function runHealth(): StrategyHealth {
  current ??= new StrategyHealth({ threshold: configuredFailureThreshold() });
  return current;
}

/** Drop the process-wide tracker. For tests, and for a caller starting a new run. */
export function resetRunHealth(): void {
  current = null;
}

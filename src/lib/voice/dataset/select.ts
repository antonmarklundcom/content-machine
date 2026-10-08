/**
 * Which takes go into a training dataset (build 5 §3.C, docs/DATASET.md).
 * Pure: the query in `query.ts` loads candidates, this decides.
 */

import type { ConsentStatus } from "@/lib/voice/contract";

export type DatasetCandidate = {
  id: number;
  ownerKind: string;
  ownerRef: string;
  sceneRef: string | null;
  speaker: string | null;
  provider: string;
  status: string;
  reviewStatus: string;
  selected: boolean;
  durationMs: number | null;
  inputText: string;
  createdAt: Date;
  /** The WAV master, relative to MEDIA_ROOT; null when the asset is gone. */
  masterPath: string | null;
};

export type DatasetOptions = {
  /** Include takes nobody has listened to yet (default false). */
  includeUnreviewed?: boolean;
  /** Include approved TTS takes (default false; not for training a voice). */
  includeTts?: boolean;
  /** Seconds (default 1). */
  minSec?: number;
  /** Seconds (default 15). */
  maxSec?: number;
};

export type ExclusionReason = "too_short" | "too_long" | "no_duration" | "no_audio" | "empty_text";

export type DatasetSelection = {
  clips: DatasetCandidate[];
  excluded: { id: number; reason: ExclusionReason; durationMs: number | null }[];
};

export const DEFAULT_MIN_SEC = 1;
export const DEFAULT_MAX_SEC = 15;

export function resolveOptions(opts: DatasetOptions = {}): Required<DatasetOptions> {
  const minSec = opts.minSec ?? DEFAULT_MIN_SEC;
  const maxSec = opts.maxSec ?? DEFAULT_MAX_SEC;
  if (!Number.isFinite(minSec) || !Number.isFinite(maxSec) || minSec < 0 || maxSec <= minSec) {
    throw new Error(`Invalid duration range: min ${minSec} s, max ${maxSec} s.`);
  }
  return {
    includeUnreviewed: opts.includeUnreviewed ?? false,
    includeTts: opts.includeTts ?? false,
    minSec,
    maxSec,
  };
}

/** Done, the right provider, approved (or unreviewed when allowed); rejected never. */
export function eligible(c: DatasetCandidate, opts: Required<DatasetOptions>): boolean {
  if (c.status !== "done") return false;
  if (c.provider !== "manual" && !opts.includeTts) return false;
  if (c.reviewStatus === "approved") return true;
  return opts.includeUnreviewed && c.reviewStatus === "unreviewed";
}

function slotKey(c: DatasetCandidate): string {
  return JSON.stringify([c.ownerKind, c.ownerRef, c.sceneRef ?? "", c.speaker ?? ""]);
}

function newer(a: DatasetCandidate, b: DatasetCandidate): boolean {
  const d = a.createdAt.getTime() - b.createdAt.getTime();
  return d > 0 || (d === 0 && a.id > b.id);
}

/**
 * One take per (owner, scene, speaker): the selected take when it is eligible,
 * else the newest eligible one. Then the duration filter, reported.
 */
export function selectClips(
  candidates: DatasetCandidate[],
  options: DatasetOptions = {},
): DatasetSelection {
  const opts = resolveOptions(options);
  const slots = new Map<string, DatasetCandidate>();
  for (const c of candidates) {
    if (!eligible(c, opts)) continue;
    const key = slotKey(c);
    const cur = slots.get(key);
    if (!cur || (c.selected && !cur.selected) || (c.selected === cur.selected && newer(c, cur))) {
      slots.set(key, c);
    }
  }
  const clips: DatasetCandidate[] = [];
  const excluded: DatasetSelection["excluded"] = [];
  for (const c of [...slots.values()].sort((a, b) => a.id - b.id)) {
    const ms = c.durationMs;
    let reason: ExclusionReason | null = null;
    if (!c.masterPath) reason = "no_audio";
    else if (!c.inputText.trim()) reason = "empty_text";
    else if (ms === null) reason = "no_duration";
    else if (ms < opts.minSec * 1000) reason = "too_short";
    else if (ms > opts.maxSec * 1000) reason = "too_long";
    if (reason) excluded.push({ id: c.id, reason, durationMs: ms });
    else clips.push(c);
  }
  return { clips, excluded };
}

export class DatasetConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetConsentError";
  }
}

/** Refuses a profile whose consent is `pending` or `revoked`; `signed` and `not_needed` pass. */
export function assertExportConsent(profile: { name: string; consentStatus: ConsentStatus }): void {
  if (profile.consentStatus === "pending" || profile.consentStatus === "revoked") {
    throw new DatasetConsentError(
      `Voice “${profile.name}” has consent “${profile.consentStatus}”: a training dataset needs signed consent (or not_needed for your own voice).`,
    );
  }
}

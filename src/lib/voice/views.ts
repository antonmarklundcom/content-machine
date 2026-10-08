import type { TakeReviewStatus, VoiceProvider } from "./contract";
import type { TakeRow } from "./store";

/** A take as the client components see it. */
export type TakeView = {
  id: number;
  createdAt: string;
  provider: VoiceProvider;
  profileName: string | null;
  language: string;
  status: "pending" | "done" | "failed";
  durationMs: number | null;
  costUsd: number;
  selected: boolean;
  reviewStatus: TakeReviewStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  error: string | null;
  playbackAssetId: number | null;
  masterAssetId: number | null;
  inputText: string;
  spokenText: string | null;
};

export function toTakeView(row: TakeRow): TakeView {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    provider: row.provider,
    profileName: row.profileName,
    language: row.language,
    status: row.status,
    durationMs: row.durationMs,
    costUsd: row.costUsd,
    selected: row.selected,
    reviewStatus: row.reviewStatus,
    reviewNote: row.reviewNote,
    reviewedBy: row.reviewedBy,
    error: row.error,
    playbackAssetId: row.playbackAssetId,
    masterAssetId: row.masterAssetId,
    inputText: row.inputText,
    spokenText: row.spokenText,
  };
}

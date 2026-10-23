/** Keep the existing learning lease identity across a rolling upgrade. */
export const clipWorkLease = (id: number) => `learn:clip:${id}`;
export const CLIP_WORK_LEASE_TTL_MS = 10 * 60 * 1000;
export const CLIP_WORK_BUSY_MESSAGE =
  "Another run is processing this clip. Try again when it finishes.";
export const CLIP_NO_CAPTIONS_MESSAGE =
  "No captions are available. Add a manual transcript from YouTube Ingest to continue.";

export class ClipWorkBusyError extends Error {
  constructor() {
    super(CLIP_WORK_BUSY_MESSAGE);
    this.name = "ClipWorkBusyError";
  }
}

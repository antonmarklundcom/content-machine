import type { VideoRender } from "@/db/schema";

/**
 * A render as the UI and the status route show it: status, duration and the
 * links to its files through the media library's owner-only asset route.
 * Pure, so the page, the route and the client poller agree.
 */

export type RenderView = {
  id: number;
  ownerKind: string;
  ownerRef: string;
  language: string;
  format: string;
  status: VideoRender["status"];
  durationMs: number | null;
  error: string | null;
  burned: boolean;
  videoUrl: string | null;
  srtUrl: string | null;
  vttUrl: string | null;
  createdAt: string;
  finishedAt: string | null;
};

const assetUrl = (id: number | null) => (id ? `/api/media/asset/${id}` : null);

export function renderView(row: VideoRender): RenderView {
  const plan = row.plan as { request?: { burnCaptions?: boolean } } | null;
  return {
    id: row.id,
    ownerKind: row.ownerKind,
    ownerRef: row.ownerRef,
    language: row.language,
    format: row.format,
    status: row.status,
    durationMs: row.durationMs,
    error: row.error,
    burned: !!plan?.request?.burnCaptions,
    videoUrl: assetUrl(row.outputAssetId),
    srtUrl: assetUrl(row.srtAssetId),
    vttUrl: assetUrl(row.vttAssetId),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

/** `m:ss` (or `h:mm:ss`) for a duration in ms; an em dash for none. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function isActive(status: string): boolean {
  return status === "queued" || status === "rendering";
}

/** Class strings shared by the voice studio's components (build 4 phase A), on the app's design tokens. */

export const VOICE_INPUT =
  "surface-border w-full rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const VOICE_LABEL = "text-xs font-medium text-[var(--color-ink-muted)]";
export const VOICE_BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50";
export const VOICE_PRIMARY =
  "rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const VOICE_BADGE =
  "inline-flex items-center rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]";
export const VOICE_BADGE_ON =
  "inline-flex items-center rounded-full border border-[var(--color-accent)] px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]";
export const VOICE_BADGE_WARN =
  "inline-flex items-center rounded-full border border-[var(--color-warn)] px-2 py-0.5 text-xs font-medium text-[var(--color-warn)]";
export const VOICE_CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const VOICE_CHIP_ON = `${VOICE_CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
export const VOICE_CHIP_OFF = `${VOICE_CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

/** `$0.0123` under a dollar, `$1.23` above. */
export function voiceUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

/** `1:05.3` / `0:04.2`. */
export function voiceDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = (total - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

/** Playback of a registered asset through the media library's owner-only route. */
export function voiceAssetUrl(assetId: number): string {
  return `/api/media/asset/${assetId}`;
}

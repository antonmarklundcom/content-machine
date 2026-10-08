/** Shared class strings for the brand pages' controls — the same tokens as the YouTube half's forms. */

const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

export const BUTTON_PRIMARY = `rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 ${FOCUS}`;

export const BUTTON_SECONDARY = `surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50 ${FOCUS}`;

export const FIELD = `surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] ${FOCUS}`;

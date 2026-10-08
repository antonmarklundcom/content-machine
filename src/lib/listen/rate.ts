/**
 * [PR-36] The speed dial.
 *
 * Default 2x. The whole point of listen mode is to get through an analysis
 * faster than reading it, and a summary read at 1x is slower than the eye.
 *
 * 1–3 is the offered range, but it is also close to the honest one: the Web
 * Speech spec allows 0.1–10 and every engine tested clamps or garbles well
 * before the top of that. Chrome's local voices hold together to about 3;
 * several of Safari's and Firefox's voices flatten out past 2 and simply stop
 * getting faster. Offering 10 would be offering a number, not a speed.
 */

export const MIN_RATE = 1;
export const MAX_RATE = 3;
export const DEFAULT_RATE = 2;
export const RATE_STEP = 0.25;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_RATE;
  // Rounded to the step so the stored value and the slider's value are the
  // same number — a rate of 2.0000000004 renders as a broken label.
  const stepped = Math.round(rate / RATE_STEP) * RATE_STEP;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Number(stepped.toFixed(2))));
}

/** "2x", "1.5x" — never "2.00x". */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

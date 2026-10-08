/** The results page's date range (build 4 §3.G). Pure. */

export const RESULTS_DEFAULT_DAYS = 90;

/** `?days=` / `?from=&to=` → a range; default the last 90 days up to now. */
export function resultsRange(
  params: { days?: string; from?: string; to?: string },
  now = new Date(),
): { from: Date; to: Date; days: number | null } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (params.from && day.test(params.from)) {
    const from = new Date(`${params.from}T00:00:00Z`);
    const to = params.to && day.test(params.to) ? new Date(`${params.to}T23:59:59.999Z`) : now;
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      return { from, to, days: null };
    }
  }
  const n = Number(params.days);
  const days = Number.isInteger(n) && n > 0 && n <= 730 ? n : RESULTS_DEFAULT_DAYS;
  return { from: new Date(now.getTime() - days * 86_400_000), to: now, days };
}

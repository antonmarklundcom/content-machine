/**
 * The calendar's pure date math (PLAN.md §6.S15). Days are plain
 * `YYYY-MM-DD` calendar dates, not instants: the grid is laid out the same on
 * the server and in the browser, and each post is placed on a day by the
 * browser, in the viewer's own time zone.
 */

export const CALENDAR_VIEWS = ["week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export type CalendarParams = {
  view: CalendarView;
  /** Any day inside the week or month shown. */
  date: string;
  account?: number;
  family?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function isDay(value: string | undefined): value is string {
  return !!value && DAY.test(value) && toUtc(value).toISOString().slice(0, 10) === value;
}

export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}

/** Monday of the week `day` is in (ISO weeks: Monday first). */
export function weekStart(day: string): string {
  const weekday = (toUtc(day).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(day, -weekday);
}

/** `/calendar?view=&date=&account=&family=`; `today` is the default date. */
export function parseCalendarParams(
  params: Record<string, string | string[] | undefined>,
  today: string,
): CalendarParams {
  const view = one(params.view) === "week" ? "week" : "month";
  const date = one(params.date);
  const account = Number(one(params.account));
  const family = one(params.family);
  return {
    view,
    date: isDay(date) ? date : today,
    ...(Number.isInteger(account) && account > 0 ? { account } : {}),
    ...(family ? { family } : {}),
  };
}

export type CalendarGrid = {
  /** Every day shown, Monday first, in whole weeks. */
  days: string[];
  /** Days outside this month are dimmed in the month view; null in the week view. */
  month: string | null;
  prev: string;
  next: string;
};

/** The days a week or month view shows, and the dates its arrows go to. */
export function calendarGrid(view: CalendarView, date: string): CalendarGrid {
  if (view === "week") {
    const start = weekStart(date);
    return {
      days: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
      month: null,
      prev: addDays(start, -7),
      next: addDays(start, 7),
    };
  }
  const first = `${date.slice(0, 7)}-01`;
  const d = toUtc(first);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const nextFirst = dayOf(d);
  const last = addDays(nextFirst, -1);
  const start = weekStart(first);
  const end = addDays(weekStart(last), 6);
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  d.setUTCMonth(d.getUTCMonth() - 2);
  return { days, month: first.slice(0, 7), prev: dayOf(d), next: nextFirst };
}

/**
 * The instants to fetch posts for: the grid's days widened by 14 hours each
 * side, so a post that falls on a shown day in any time zone is included. The
 * browser then keeps only the posts whose local day is on the grid.
 */
export function fetchRange(days: string[]): { from: Date; to: Date } {
  const from = toUtc(days[0]);
  from.setUTCHours(from.getUTCHours() - 14);
  const to = toUtc(addDays(days[days.length - 1], 1));
  to.setUTCHours(to.getUTCHours() + 14);
  return { from, to };
}

/** The local `YYYY-MM-DD` of an instant, in the runtime's time zone. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Drag-to-reschedule: the same local time of day on another day, as an ISO
 * instant (runtime time zone). A post with no time yet lands at 09:00.
 */
export function moveToDay(iso: string | null, day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const from = iso ? new Date(iso) : null;
  const moved = new Date(y, m - 1, d, from ? from.getHours() : 9, from ? from.getMinutes() : 0);
  return moved.toISOString();
}

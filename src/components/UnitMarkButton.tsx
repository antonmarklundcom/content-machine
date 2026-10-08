import { translator, type Locale } from "@/lib/i18n";
import type { UnitType } from "@/lib/listen/units";
import { toggleUnitMark } from "@/lib/marks.actions";

/**
 * [PR-37] The star on one content unit, in the reading view.
 *
 * A plain server-action form, like VideoReadControls (PR-19): no client JS, so
 * marking works before hydration and on a page that never hydrates. The listen
 * player has its own button because it already has the current unit in client
 * state — this one is for the eye, that one is for the ear.
 */
export function UnitMarkButton({
  videoId,
  unitType,
  unitIndex,
  unitText,
  marked,
  locale,
}: {
  videoId: number;
  unitType: UnitType;
  unitIndex: number;
  unitText: string;
  marked: boolean;
  locale: Locale;
}) {
  const t = translator(locale);
  const label = t(marked ? "marks.unmark" : "marks.mark");

  return (
    <form
      action={toggleUnitMark.bind(null, { videoId, unitType, unitIndex, unitText }, marked)}
      className="shrink-0"
    >
      <button
        type="submit"
        title={label}
        aria-label={label}
        aria-pressed={marked}
        className={
          "rounded-[var(--radius-sm)] px-1.5 py-0.5 text-sm leading-none transition-colors " +
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] " +
          (marked
            ? "text-[var(--color-warn)]"
            : "text-[var(--color-ink-muted)] opacity-40 hover:opacity-100")
        }
      >
        {marked ? "★" : "☆"}
      </button>
    </form>
  );
}

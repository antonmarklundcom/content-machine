import { translator, type Locale } from "@/lib/i18n";
import { renameSource } from "@/lib/sources.actions";

/**
 * An always-editable title field rather than an edit mode \u2014 one input and one
 * button beats a pencil icon, a state flag and a cancel path for a field that
 * is edited perhaps twice in a source\u2019s life.
 */
export function SourceTitleForm({
  id,
  title,
  locale,
}: {
  id: number;
  title: string;
  locale: Locale;
}) {
  const t = translator(locale);

  return (
    <form action={renameSource.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`source-title-${id}`}>
        {t("sources.titleLabel")}
      </label>
      <input
        id={`source-title-${id}`}
        name="title"
        defaultValue={title}
        maxLength={512}
        className="surface-border w-full max-w-md min-w-48 rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm font-medium text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      />
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] px-1 text-xs text-[var(--color-accent)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {t("sources.saveTitle")}
      </button>
    </form>
  );
}

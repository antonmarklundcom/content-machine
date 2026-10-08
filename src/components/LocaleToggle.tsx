import { setLocale } from "@/lib/i18n/actions";
import { LOCALES, translator, type Locale } from "@/lib/i18n";

/**
 * A no-JS server-action form: one submit button per language, the current one
 * marked with aria-current rather than only by colour.
 */
export function LocaleToggle({ locale }: { locale: Locale }) {
  const t = translator(locale);

  return (
    <form action={setLocale} className="flex items-center gap-1" aria-label={t("locale.label")}>
      {LOCALES.map((option) => {
        const active = option === locale;
        return (
          <button
            key={option}
            type="submit"
            name="locale"
            value={option}
            aria-current={active ? "true" : undefined}
            className={`rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              active
                ? "bg-[var(--color-accent-ink)] text-[var(--color-accent)]"
                : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {t(option === "en" ? "locale.en" : "locale.sv")}
          </button>
        );
      })}
    </form>
  );
}

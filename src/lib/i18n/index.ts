import { DICTIONARIES, en, type TranslationKey } from "./dictionary";

export type Locale = keyof typeof DICTIONARIES;
export const LOCALES: Locale[] = ["en", "sv"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "yt_locale";

export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "sv";
}

export type Translator = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * `{name}` placeholders only — no plural rules, no dates, no number formats.
 * Counts that inflect pick their own key ("digest.countOne" / "…Many") because
 * two languages with the same simple plural rule do not justify Intl.PluralRules.
 */
export function translator(locale: Locale): Translator {
  const dict = DICTIONARIES[locale];
  return (key, vars) => {
    // Falling back to English rather than to the key itself: a missing Swedish
    // string should read as untranslated, not as a broken UI.
    const template = dict[key] ?? en[key];
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  };
}

export type { TranslationKey };

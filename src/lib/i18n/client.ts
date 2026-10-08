"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, translator, type Locale } from ".";

/**
 * Locale for client components that cannot be handed one as a prop — in
 * practice the error boundaries, which React renders without going through a
 * page.
 *
 * Reads the cookie in an effect rather than during render on purpose: the
 * server renders with the default, so reading it inline would produce different
 * markup on the two sides and a hydration mismatch. The first paint of an error
 * page is briefly English; the alternative is a console full of warnings on
 * every page.
 */
export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
    const value = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    if (isLocale(value)) setLocale(value);
  }, []);

  return locale;
}

export function useTranslator() {
  return translator(useLocale());
}

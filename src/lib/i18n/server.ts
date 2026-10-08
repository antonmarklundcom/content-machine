import "server-only";
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  translator,
  type Locale,
  type Translator,
} from ".";

/**
 * The locale for this request, from a cookie.
 *
 * A cookie rather than a `[locale]` route segment (PLAN.md §9 PR-22): every URL
 * in the app keeps working, no link has to be rewritten, and there is no second
 * copy of the route tree to keep in step. The cost is that pages must not be
 * statically cached — which they already can't be, since the header reads spend
 * from MySQL on every request.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getTranslator(): Promise<Translator> {
  return translator(await getLocale());
}

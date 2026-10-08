"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from ".";

/** One year: the choice is a preference, not a session detail. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setLocale(formData: FormData): Promise<void> {
  const raw = String(formData.get("locale") ?? "");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    maxAge: ONE_YEAR_SECONDS,
    httpOnly: false, // read by client components too, and it is not a secret
    sameSite: "lax",
    path: "/",
  });

  // "layout" scope: the header, the <html lang> and every page string change.
  revalidatePath("/", "layout");
}

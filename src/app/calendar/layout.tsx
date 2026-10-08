import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return { title: t("calendar.title"), robots: { index: false, follow: false } };
}

// Posts and accounts are read on every request; nothing here can be
// prerendered on a machine with no DATABASE_URL (same as /studio).
export const dynamic = "force-dynamic";

/** The posting calendar (PLAN.md §6.S15). Header and <html lang> come from the root layout. */
export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return children;
}

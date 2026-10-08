import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return { title: t("studio.title"), robots: { index: false, follow: false } };
}

// Scripts, brands and the spend meter are read on every request; nothing here
// can be prerendered on a machine with no DATABASE_URL (same as /youtube).
export const dynamic = "force-dynamic";

/** The script studio (PLAN.md §6.S12). Header and <html lang> come from the root layout (§1.22). */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}

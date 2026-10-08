import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    // Template so every page's own title reads as "<page> · YT Intel" without
    // each route repeating the suffix.
    title: { default: t("app.title"), template: `%s · ${t("app.name")}` },
    description: t("app.description"),
    // Private tool — keep it out of indexes even though it now lives under a
    // path on the main app rather than its own subdomain.
    robots: { index: false, follow: false },
  };
}

// The header reads spendStatus() on every request (the counter must never go
// stale), which also means this subtree can't be statically generated at
// build time on a machine with no DATABASE_URL.
export const dynamic = "force-dynamic";

export default function YouTubeLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout now (PLAN.md §1.22).
  return children;
}

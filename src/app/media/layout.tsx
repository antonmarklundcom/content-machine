import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("media.title"), template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

// The library reads the drive on every request: a scan or a plugged-in drive shows at once.
export const dynamic = "force-dynamic";

export default function MediaLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout (PLAN.md §1.22).
  return children;
}

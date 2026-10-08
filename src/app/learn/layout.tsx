import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("learn.title"), template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

// A link just sent to the bot, or a summary just run, has to show on the next load.
export const dynamic = "force-dynamic";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout (PLAN.md §1.22).
  return children;
}

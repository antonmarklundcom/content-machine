import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("lessons.title"), template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

// Lessons are read on every request: one just saved from a video page has to be here.
export const dynamic = "force-dynamic";

export default function LessonsLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout (PLAN.md §1.22).
  return children;
}

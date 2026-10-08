import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("inbox.title"), template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

// listClips() reads on every request (PLAN.md §6.S3.1 — an inbox that's stale
// by a redeploy is the one page this build can least afford), same reasoning
// as the /youtube layout it's styled after.
export const dynamic = "force-dynamic";

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  // The header and <html lang> live in the root layout now (PLAN.md §1.22).
  return children;
}

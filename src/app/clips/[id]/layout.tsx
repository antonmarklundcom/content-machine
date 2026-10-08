import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("clipFetch.title"), template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

// A fetch rewrites the clip; the page must never show a cached transcript.
export const dynamic = "force-dynamic";

export default function ClipLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { PcOnlyNotice } from "@/components/PcOnlyNotice";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("higgsfield.title"), template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

// Runs change while the page is open; never serve a cached list.
export const dynamic = "force-dynamic";

export default function HiggsfieldLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PcOnlyNotice />
      {children}
    </>
  );
}

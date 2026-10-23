import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { Header } from "@/components/Header";
import { WorkspaceGuide } from "@/components/WorkspaceGuide";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Machine",
  robots: { index: false, follow: false, nocache: true },
  description:
    "Research, ideas, and copy for social media — per brand — plus a YouTube research tool.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // lang must follow the chosen locale — it is what a screen reader uses to
  // pick a pronunciation, and a Swedish UI announced in English is unusable.
  // Middleware marks protected pages; re-read the account so revoked cookies fail closed.
  const protectedPage = (await headers()).get("x-content-machine-protected") === "1";
  if (protectedPage) await requireUser();
  const locale = await getLocale();

  // One header for the whole app (PLAN.md §1.22). Header itself skips the
  // spend read when signed out, so the login page still renders without a DB.
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <Header />
        {protectedPage && <WorkspaceGuide locale={locale} />}
        {/* Target of the header's skip link; focusable so the jump moves keyboard focus. */}
        <div id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </div>
      </body>
    </html>
  );
}

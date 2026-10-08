import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Engine",
  description:
    "Research, ideas, and copy for social media — per brand — plus a YouTube research tool.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // lang must follow the chosen locale — it is what a screen reader uses to
  // pick a pronunciation, and a Swedish UI announced in English is unusable.
  const locale = await getLocale();

  // One header for the whole app (PLAN.md §1.22). Header itself skips the
  // spend read when signed out, so the login page still renders without a DB.
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <Header />
        {children}
      </body>
    </html>
  );
}

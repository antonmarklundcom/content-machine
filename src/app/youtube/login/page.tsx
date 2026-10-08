import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("login.title") };
}

export default async function LoginPage() {
  // Already signed in: there is nothing to do here, and a login form that
  // ignores an existing session is how you end up with two of them.
  if (await getSession()) redirect("/youtube");

  const locale = await getLocale();
  const t = translator(locale);

  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-24">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("app.name")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("login.title")}</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)] leading-relaxed">
        {t("login.intro")}
      </p>
      <div className="surface-border surface-card mt-6 p-5">
        <LoginForm locale={locale} />
      </div>
    </main>
  );
}

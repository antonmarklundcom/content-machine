import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SettingsForm } from "@/components/SettingsForm";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { isLocalRequest } from "@/lib/settings.actions";
import { maskValue, readEnv } from "@/lib/settings/envfile";
import { SETTING_FIELDS } from "@/lib/settings/fields";

import { MetaSection } from "./MetaSection";
import { VideoPlatformSection } from "./VideoPlatformSection";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("settings.title") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** API keys and AI provider, written to the local `.env` (local mode); the Meta connection (O12). */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const [user, locale, local] = await Promise.all([requireUser(), getLocale(), isLocalRequest()]);
  const t = translator(locale);
  const fileEnv = readEnv(await readFile(path.join(process.cwd(), ".env"), "utf8").catch(() => ""));
  const valueOf = (k: string) => process.env[k] ?? fileEnv[k];

  const fields = SETTING_FIELDS.map((f) => ({
    ...f,
    isSet: Boolean(valueOf(f.key)),
    display: f.kind === "secret" ? maskValue(valueOf(f.key)) : (valueOf(f.key) ?? ""),
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {t("settings.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("settings.title")}</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">{t("settings.intro")}</p>

      {!isOwner(user) ? (
        <p className="surface-card mt-6 p-4 text-sm">{t("settings.ownerOnly")}</p>
      ) : !local ? (
        <p className="surface-card mt-6 p-4 text-sm">{t("settings.localOnly")}</p>
      ) : (
        <SettingsForm fields={fields} locale={locale} />
      )}

      <section className="surface-card mt-8 p-4 text-sm">
        <h2 className="font-semibold text-[var(--color-ink)]">{t("settings.database")}</h2>
        <p className="mt-1 font-mono text-xs">
          {maskValue(valueOf("DATABASE_URL")) || t("settings.notSet")}
        </p>
        <p className="mt-1 text-[var(--color-muted)]">{t("settings.databaseNote")}</p>
      </section>

      {isOwner(user) && (
        <MetaSection
          locale={locale}
          local={local}
          notice={{
            connected: one(params.meta) === "connected" ? "1" : undefined,
            linked: one(params.linked),
            error: one(params.meta_error),
          }}
        />
      )}
      {isOwner(user) && (
        <VideoPlatformSection
          locale={locale}
          local={local}
          provider="youtube"
          notice={{
            connected: one(params.youtube) === "connected",
            linked: one(params.linked),
            error: one(params.youtube_error),
          }}
        />
      )}
      {isOwner(user) && (
        <VideoPlatformSection
          locale={locale}
          local={local}
          provider="tiktok"
          notice={{
            connected: one(params.tiktok) === "connected",
            error: one(params.tiktok_error),
          }}
        />
      )}
    </main>
  );
}

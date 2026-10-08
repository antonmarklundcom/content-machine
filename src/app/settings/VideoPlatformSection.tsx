import { headers } from "next/headers";
import { applicationOrigin } from "@/lib/app-origin";

import { youtubeRedirectUri } from "@/lib/google/config";
import type { Locale } from "@/lib/i18n";
import { translator, type TranslationKey } from "@/lib/i18n";
import { disconnectVideoAction } from "@/lib/publish/video.actions";
import { videoConfigured, videoSettingsState } from "@/lib/publish/video-settings";
import { tiktokRedirectUri } from "@/lib/tiktok/config";

import { VIDEO_BUTTON, VideoAppForm, VideoLinkRow } from "./VideoForms";

/**
 * Settings → YouTube and Settings → TikTok (build 4 §3.F): what to create on
 * the platform's developer site, the redirect URIs, the keys, Connect, the
 * connections and which content-engine account publishes through which.
 */

type Provider = "youtube" | "tiktok";

const LOCALHOST_ORIGIN = "http://localhost:3000";

const LINKS = {
  youtube: [
    {
      key: "publishVideo.youtube.step1.link",
      href: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    },
    {
      key: "publishVideo.youtube.step2.link",
      href: "https://console.cloud.google.com/apis/credentials/consent",
    },
    {
      key: "publishVideo.youtube.step3.link",
      href: "https://console.cloud.google.com/apis/credentials",
    },
  ],
  tiktok: [{ key: "publishVideo.tiktok.step1.link", href: "https://developers.tiktok.com/apps/" }],
} as const;

async function currentOrigin(): Promise<string> {
  return applicationOrigin({ url: "http://localhost:3000", headers: await headers() });
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children} ↗
    </a>
  );
}

export async function VideoPlatformSection({
  locale,
  local,
  provider,
  notice,
}: {
  locale: Locale;
  local: boolean;
  provider: Provider;
  notice: { connected?: boolean; linked?: string; error?: string };
}) {
  const t = translator(locale);
  const k = (suffix: string) => t(`publishVideo.${provider}.${suffix}` as TranslationKey);
  const [s, origin] = await Promise.all([videoSettingsState(provider), currentOrigin()]);
  const redirect = provider === "youtube" ? youtubeRedirectUri : tiktokRedirectUri;
  const uris = [...new Set([redirect(LOCALHOST_ORIGIN), redirect(origin)])];
  const configured = videoConfigured(provider) && !s.keyProblem;
  const platformName = k("title");
  const choices = s.connections.map((c) => ({ id: c.row.id, label: c.row.label }));
  const steps = [1, 2, 3, 4, 5];
  const uriStep = provider === "youtube" ? 3 : 2;
  const formStep = 4;

  return (
    <section id={provider} className="mt-10">
      <h2 className="text-lg font-semibold text-[var(--color-ink)]">{platformName}</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{k("intro")}</p>
      {notice.connected && (
        <p role="status" className="mt-4 text-sm text-green-700 dark:text-green-400">
          {t(`publishVideo.${provider}.connected` as TranslationKey, {
            linked: notice.linked ?? "0",
          })}
        </p>
      )}
      {notice.error && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {t("publishVideo.error", { detail: notice.error })}
        </p>
      )}

      <ol className="surface-card mt-4 list-decimal space-y-3 p-4 pl-8 text-sm">
        {steps.map((n) => (
          <li key={n}>
            <p>{k(`step${n}`)}</p>
            {n === 1 && (
              <p className="mt-1 space-x-3">
                {LINKS[provider].map((l) => (
                  <Ext key={l.href} href={l.href}>
                    {t(l.key)}
                  </Ext>
                ))}
              </p>
            )}
            {n === uriStep && (
              <ul className="mt-1 space-y-1">
                {uris.map((u) => (
                  <li key={u}>
                    <code className="select-all rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                      {u}
                    </code>
                  </li>
                ))}
              </ul>
            )}
            {n === formStep &&
              (local ? (
                <VideoAppForm
                  locale={locale}
                  provider={provider}
                  clientId={s.clientId}
                  secretSet={s.secretSet}
                  keySet={!s.keyProblem}
                />
              ) : (
                <p className="mt-1 text-xs">{t("publishVideo.form.localOnly")}</p>
              ))}
            {n === 5 &&
              (configured ? (
                <p className="mt-2">
                  <a
                    href={`/api/${provider}/oauth/start`}
                    className={`${VIDEO_BUTTON} inline-block bg-[var(--color-accent)] text-[var(--color-accent-ink)]`}
                  >
                    {s.connections.length ? k("connectAnother") : k("connect")}
                  </a>
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {t("publishVideo.needKeys")}
                </p>
              ))}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-[var(--color-muted)]">{k("audit")}</p>

      <div className="surface-card mt-4 p-4 text-sm">
        <h3 className="font-medium text-[var(--color-ink)]">{t("publishVideo.connections")}</h3>
        {s.connections.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--color-muted)]">{t("publishVideo.none")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {s.connections.map((c) => (
              <li key={c.row.id} className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-[var(--color-ink)]">{c.row.label}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {t(`publishVideo.status.${c.row.status}` as TranslationKey)}
                  {c.row.tokenExpiresAt
                    ? ` · ${t("publishVideo.loginEnds", { date: c.row.tokenExpiresAt.toISOString().slice(0, 10) })}`
                    : ""}
                </span>
                <span className="text-xs">
                  {c.linked.length
                    ? t("publishVideo.linked", {
                        list: c.linked.map((a) => `@${a.handle}`).join(", "),
                      })
                    : t("publishVideo.notLinked")}
                </span>
                <form action={disconnectVideoAction}>
                  <input type="hidden" name="provider" value={provider} />
                  <input type="hidden" name="integrationId" value={c.row.id} />
                  <button type="submit" className={VIDEO_BUTTON}>
                    {t("publishVideo.disconnect")}
                  </button>
                </form>
                {c.banner && (
                  <p
                    role="alert"
                    className={`w-full text-xs ${
                      c.banner.level === "soon"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-red-700 dark:text-red-400"
                    }`}
                  >
                    {c.banner.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-4 font-medium text-[var(--color-ink)]">{t("publishVideo.link.title")}</h3>
        <p className="mt-1 text-[var(--color-muted)]">
          {t("publishVideo.link.body", { platform: platformName })}
        </p>
        {s.accounts.length === 0 ? (
          <p className="mt-1 text-xs">
            {t("publishVideo.link.noAccounts", { platform: platformName })}{" "}
            <a href="/accounts" className="underline">
              /accounts
            </a>
          </p>
        ) : (
          <div className="mt-2">
            {s.accounts.map((a) => (
              <VideoLinkRow
                key={a.id}
                locale={locale}
                provider={provider}
                accountId={a.id}
                label={`@${a.handle} (${a.brandId})`}
                connections={choices}
                linkedIntegrationId={a.integrationId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

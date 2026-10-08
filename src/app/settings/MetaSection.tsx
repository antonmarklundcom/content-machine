import { headers } from "next/headers";

import type { Locale } from "@/lib/i18n";
import { translator, type TranslationKey } from "@/lib/i18n";
import { disconnectMetaAction } from "@/lib/meta/actions";
import { META_SCOPES, redirectUri } from "@/lib/meta/config";
import type { StepId, StepState } from "@/lib/meta/setup";
import { metaState } from "@/lib/meta/state";

import {
  META_BUTTON,
  MetaAppForm,
  MetaAutoLinkButton,
  MetaLinkRow,
  MetaSyncButton,
  type LinkChoice,
} from "./MetaForms";

/**
 * Settings → Meta (PLAN.md §1.49, §5.O12): the six setup steps in order, each
 * with a done / to-do mark where the app can tell, plain instructions and the
 * exact Meta pages; then the connection's banner and "Sync now".
 */

const LOCALHOST_ORIGIN = "http://localhost:3000";

const LINKS = {
  igProfessional: "https://help.instagram.com/502981923235522",
  createPage: "https://www.facebook.com/pages/create",
  igLinkPage: "https://help.instagram.com/570895513091465",
  createApp: "https://developers.facebook.com/apps/creation/",
  myApps: "https://developers.facebook.com/apps/",
};

function appLink(appId: string | null, path: string): string {
  return appId ? `https://developers.facebook.com/apps/${appId}/${path}` : LINKS.myApps;
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children} ↗
    </a>
  );
}

const MARK: Record<StepState, { icon: string; cls: string; key: TranslationKey }> = {
  done: { icon: "✓", cls: "text-green-700 dark:text-green-400", key: "meta.state.done" },
  todo: { icon: "○", cls: "text-amber-700 dark:text-amber-400", key: "meta.state.todo" },
  unknown: { icon: "?", cls: "text-[var(--color-muted)]", key: "meta.state.unknown" },
};

async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}

export async function MetaSection({
  locale,
  local,
  notice,
}: {
  locale: Locale;
  local: boolean;
  notice: { connected?: string; linked?: string; error?: string };
}) {
  const t = translator(locale);
  const [s, origin] = await Promise.all([metaState(), currentOrigin()]);
  const step = Object.fromEntries(s.steps.map((x) => [x.id, x])) as Record<
    StepId,
    (typeof s.steps)[number]
  >;
  const uris = [...new Set([redirectUri(LOCALHOST_ORIGIN), redirectUri(origin)])];
  const credentialsDone = step.credentials.state === "done";

  const accountLabel = (a: (typeof s.accounts)[number]) =>
    `${a.platform === "facebook" ? "" : "@"}${a.handle} (${a.brandId})`;
  const choices = (platform: "instagram" | "facebook"): LinkChoice[] =>
    s.accounts
      .filter((a) => a.platform === platform)
      .map((a) => ({ id: a.id, label: accountLabel(a) }));
  const linkedTo = (platform: "instagram" | "facebook", externalId: string) =>
    s.accounts.find((a) => a.platform === platform && a.externalId === externalId)?.id ?? null;

  const Step = ({ id, n, children }: { id: StepId; n: number; children: React.ReactNode }) => {
    const st = step[id];
    const mark = MARK[st.state];
    return (
      <li className="surface-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium text-[var(--color-ink)]">
            {n}. {t(`meta.step.${id}.title` as TranslationKey)}
          </h3>
          <span className={`text-xs font-semibold ${mark.cls}`}>
            {mark.icon} {t(mark.key)}
          </span>
        </div>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {t(`meta.step.${id}.body` as TranslationKey)}
        </p>
        {st.missing.length > 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {t("meta.stillToDo", { list: st.missing.join(", ") })}
          </p>
        )}
        <div className="mt-2 text-sm">{children}</div>
      </li>
    );
  };

  const banner = s.banner;
  return (
    <section id="meta" className="mt-10">
      <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("meta.title")}</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{t("meta.intro")}</p>

      {banner && (
        <p
          role="alert"
          className={`mt-4 rounded-[var(--radius-sm)] p-3 text-sm ${
            banner.level === "soon"
              ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              : "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {t(`meta.banner.${banner.level}` as TranslationKey, { detail: banner.message })}
        </p>
      )}
      {notice.connected && (
        <p role="status" className="mt-4 text-sm text-green-700 dark:text-green-400">
          {t("meta.connected", { linked: notice.linked ?? "0" })}
        </p>
      )}
      {notice.error && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {t("meta.error", { detail: notice.error })}
        </p>
      )}

      <ol className="mt-4 space-y-3">
        <Step id="professional" n={1}>
          <Ext href={LINKS.igProfessional}>{t("meta.step.professional.help")}</Ext>
          {" · "}
          <a href="/accounts" className="underline">
            {t("meta.step.professional.accounts")}
          </a>
          {!s.accounts.some((a) => a.platform === "instagram") && (
            <p className="mt-1 text-xs">{t("meta.step.professional.none")}</p>
          )}
        </Step>

        <Step id="pageLink" n={2}>
          <Ext href={LINKS.createPage}>{t("meta.step.pageLink.createPage")}</Ext>
          {" · "}
          <Ext href={LINKS.igLinkPage}>{t("meta.step.pageLink.help")}</Ext>
        </Step>

        <Step id="app" n={3}>
          <Ext href={LINKS.createApp}>{t("meta.step.app.create")}</Ext>
          {" · "}
          <Ext href={LINKS.myApps}>{t("meta.step.app.myApps")}</Ext>
        </Step>

        <Step id="credentials" n={4}>
          <Ext href={appLink(s.appId, "settings/basic/")}>{t("meta.step.credentials.basic")}</Ext>
          {local ? (
            <MetaAppForm
              locale={locale}
              appId={s.appId}
              appSecretSet={s.appSecretSet}
              configId={s.loginConfigId}
              keySet={!s.keyProblem}
            />
          ) : (
            <p className="mt-2 text-xs">{t("meta.step.credentials.localOnly")}</p>
          )}
          {s.keyProblem && process.env.ENCRYPTION_KEY && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-400">{s.keyProblem}</p>
          )}
          <h4 className="mt-4 font-medium text-[var(--color-ink)]">
            {t("meta.step.credentials.redirectTitle")}
          </h4>
          <p className="mt-1 text-[var(--color-muted)]">
            {t("meta.step.credentials.redirectBody")}
          </p>
          <ul className="mt-1 space-y-1">
            {uris.map((u) => (
              <li key={u}>
                <code className="select-all rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                  {u}
                </code>
              </li>
            ))}
          </ul>
          <p className="mt-1">
            <Ext href={appLink(s.appId, "business-login/settings/")}>
              {t("meta.step.credentials.loginSettings")}
            </Ext>
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {t("meta.step.credentials.localhost")}
          </p>
          <h4 className="mt-4 font-medium text-[var(--color-ink)]">
            {t("meta.step.credentials.configTitle")}
          </h4>
          <p className="mt-1 text-[var(--color-muted)]">{t("meta.step.credentials.configBody")}</p>
          <p className="mt-1 font-mono text-xs">{META_SCOPES.join(", ")}</p>
          <p className="mt-1">
            <Ext href={appLink(s.appId, "business-login/configurations/")}>
              {t("meta.step.credentials.configurations")}
            </Ext>
          </p>
        </Step>

        <Step id="connect" n={5}>
          {s.integration && (
            <p className="mb-2">
              {t("meta.step.connect.as", { label: s.integration.label })}
              {" · "}
              {s.integration.tokenExpiresAt
                ? t("meta.step.connect.expires", {
                    date: s.integration.tokenExpiresAt.toISOString().slice(0, 10),
                  })
                : t("meta.step.connect.noExpiry")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {credentialsDone ? (
              <a
                href="/api/meta/connect"
                className={`${META_BUTTON} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`}
              >
                {s.integration ? t("meta.step.connect.reconnect") : t("meta.step.connect.button")}
              </a>
            ) : (
              <span className="text-xs text-[var(--color-muted)]">
                {t("meta.step.connect.needKeys")}
              </span>
            )}
            {s.integration && (
              <form action={disconnectMetaAction}>
                <input type="hidden" name="integrationId" value={s.integration.id} />
                <button type="submit" className={META_BUTTON}>
                  {t("meta.step.connect.disconnect")}
                </button>
              </form>
            )}
          </div>
        </Step>

        <Step id="mapping" n={6}>
          {!s.integration ? (
            <p className="text-xs">{t("meta.step.mapping.connectFirst")}</p>
          ) : s.targetsError ? (
            <p className="text-xs text-red-700 dark:text-red-400">{s.targetsError}</p>
          ) : !s.targets?.length ? (
            <p className="text-xs">{t("meta.step.mapping.none")}</p>
          ) : (
            <>
              <MetaAutoLinkButton locale={locale} />
              <div className="mt-2 divide-y divide-[var(--color-border,rgba(0,0,0,0.08))]">
                {s.targets.map((target) => (
                  <div key={target.pageId} className="py-1">
                    <MetaLinkRow
                      locale={locale}
                      kind="page"
                      name={target.pageName}
                      externalId={target.pageId}
                      integrationId={s.integration!.id}
                      choices={choices("facebook")}
                      linkedAccountId={linkedTo("facebook", target.pageId)}
                    />
                    {target.igUserId ? (
                      <MetaLinkRow
                        locale={locale}
                        kind="instagram"
                        name={`@${target.igUsername ?? target.igUserId}`}
                        externalId={target.igUserId}
                        integrationId={s.integration!.id}
                        choices={choices("instagram")}
                        linkedAccountId={linkedTo("instagram", target.igUserId)}
                      />
                    ) : (
                      <p className="pl-2 text-xs text-[var(--color-muted)]">
                        {t("meta.step.mapping.noIg")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Step>
      </ol>

      {s.integration && (
        <div className="surface-card mt-4 p-4 text-sm">
          <h3 className="font-medium text-[var(--color-ink)]">{t("meta.sync.title")}</h3>
          <p className="mt-1 text-[var(--color-muted)]">{t("meta.sync.body")}</p>
          <div className="mt-2">
            <MetaSyncButton locale={locale} />
          </div>
        </div>
      )}
    </section>
  );
}

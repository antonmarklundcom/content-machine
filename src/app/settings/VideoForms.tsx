"use client";

import { useActionState, useState } from "react";

import type { Locale } from "@/lib/i18n";
import { translator, type TranslationKey } from "@/lib/i18n";
import {
  linkVideoAccountAction,
  saveVideoAppAction,
  type VideoActionResult,
} from "@/lib/publish/video.actions";

/** The client half of Settings → YouTube / TikTok (build 4 §3.F): the key form and link rows. */

const INPUT =
  "mt-1 w-full rounded-[var(--radius-sm)] surface-border bg-transparent px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const VIDEO_BUTTON =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50";

type Provider = "youtube" | "tiktok";

function Result({ result }: { result: VideoActionResult | null }) {
  if (!result || (result.ok && !result.message)) return null;
  return (
    <span
      role="status"
      className={`text-xs ${result.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
    >
      {result.ok ? result.message : result.error}
    </span>
  );
}

const ENV_KEYS: Record<Provider, { id: string; secret: string }> = {
  youtube: { id: "GOOGLE_OAUTH_CLIENT_ID", secret: "GOOGLE_OAUTH_CLIENT_SECRET" },
  tiktok: { id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" },
};

export function VideoAppForm({
  locale,
  provider,
  clientId,
  secretSet,
  keySet,
}: {
  locale: Locale;
  provider: Provider;
  clientId: string | null;
  secretSet: boolean;
  keySet: boolean;
}) {
  const t = translator(locale);
  const [state, action, pending] = useActionState(saveVideoAppAction, null);
  const status = (set: boolean) =>
    set ? t("publishVideo.form.set") : t("publishVideo.form.notSet");
  const keys = ENV_KEYS[provider];
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="provider" value={provider} />
      <label className="block text-xs text-[var(--color-muted)]">
        {t(`publishVideo.${provider}.clientId` as TranslationKey)} · {status(Boolean(clientId))}
        <input name={keys.id} defaultValue={clientId ?? ""} autoComplete="off" className={INPUT} />
      </label>
      <label className="block text-xs text-[var(--color-muted)]">
        {t(`publishVideo.${provider}.clientSecret` as TranslationKey)} · {status(secretSet)}
        <input
          name={keys.secret}
          type="password"
          autoComplete="off"
          placeholder={secretSet ? t("publishVideo.form.keep") : ""}
          className={INPUT}
        />
      </label>
      <p className="text-xs text-[var(--color-muted)]">
        {t("publishVideo.form.key")} · {status(keySet)}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`${VIDEO_BUTTON} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`}
        >
          {pending ? t("publishVideo.form.saving") : t("publishVideo.form.save")}
        </button>
        <Result result={state} />
      </div>
    </form>
  );
}

export type ConnectionChoice = { id: number; label: string };

/** One content-engine account and the connection it publishes through. */
export function VideoLinkRow({
  locale,
  provider,
  accountId,
  label,
  connections,
  linkedIntegrationId,
}: {
  locale: Locale;
  provider: Provider;
  accountId: number;
  label: string;
  connections: ConnectionChoice[];
  linkedIntegrationId: number | null;
}) {
  const t = translator(locale);
  const [state, action, pending] = useActionState(linkVideoAccountAction, null);
  const [picked, setPicked] = useState(linkedIntegrationId ? String(linkedIntegrationId) : "");
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <span className="min-w-40 font-medium text-[var(--color-ink)]">{label}</span>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="accountId" value={accountId} />
      <select
        name="integrationId"
        aria-label={label}
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="rounded-[var(--radius-sm)] surface-border bg-transparent px-2 py-1 text-sm"
      >
        <option value="">{t("publishVideo.link.pick")}</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || picked === String(linkedIntegrationId ?? "")}
        className={VIDEO_BUTTON}
      >
        {t("publishVideo.link.save")}
      </button>
      <Result result={state} />
    </form>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";

import type { Locale } from "@/lib/i18n";
import { translator } from "@/lib/i18n";
import {
  autoLinkAction,
  linkAccountAction,
  saveMetaAppAction,
  syncNowAction,
  type MetaActionResult,
} from "@/lib/meta/actions";

/** The client half of Settings → Meta (PLAN.md §5.O12): the forms and buttons. */

const INPUT =
  "mt-1 w-full rounded-[var(--radius-sm)] surface-border bg-transparent px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const META_BUTTON =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50";

function Result({ result }: { result: MetaActionResult | null }) {
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

export function MetaAppForm({
  locale,
  appId,
  appSecretSet,
  configId,
  keySet,
}: {
  locale: Locale;
  appId: string | null;
  appSecretSet: boolean;
  configId: string | null;
  keySet: boolean;
}) {
  const t = translator(locale);
  const [state, action, pending] = useActionState(saveMetaAppAction, null);
  const status = (set: boolean) => (set ? t("meta.form.set") : t("meta.form.notSet"));
  return (
    <form action={action} className="mt-3 space-y-3">
      <label className="block text-xs text-[var(--color-muted)]">
        {t("meta.form.appId")} · {status(Boolean(appId))}
        <input
          name="META_APP_ID"
          defaultValue={appId ?? ""}
          autoComplete="off"
          inputMode="numeric"
          className={INPUT}
        />
      </label>
      <label className="block text-xs text-[var(--color-muted)]">
        {t("meta.form.appSecret")} · {status(appSecretSet)}
        <input
          name="META_APP_SECRET"
          type="password"
          autoComplete="off"
          placeholder={appSecretSet ? t("meta.form.keep") : ""}
          className={INPUT}
        />
      </label>
      <label className="block text-xs text-[var(--color-muted)]">
        {t("meta.form.configId")} · {status(Boolean(configId))}
        <input
          name="META_LOGIN_CONFIG_ID"
          defaultValue={configId ?? ""}
          autoComplete="off"
          inputMode="numeric"
          className={INPUT}
        />
      </label>
      {configId && (
        <label className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
          <input type="checkbox" name="clear:META_LOGIN_CONFIG_ID" /> {t("meta.form.clearConfig")}
        </label>
      )}
      <p className="text-xs text-[var(--color-muted)]">
        {t("meta.form.key")} · {status(keySet)}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`${META_BUTTON} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`}
        >
          {pending ? t("meta.form.saving") : t("meta.form.save")}
        </button>
        <Result result={state} />
      </div>
    </form>
  );
}

export type LinkChoice = { id: number; label: string };

export function MetaLinkRow({
  locale,
  kind,
  name,
  externalId,
  integrationId,
  choices,
  linkedAccountId,
}: {
  locale: Locale;
  kind: "page" | "instagram";
  name: string;
  externalId: string;
  integrationId: number;
  choices: LinkChoice[];
  linkedAccountId: number | null;
}) {
  const t = translator(locale);
  const [state, action, pending] = useActionState(linkAccountAction, null);
  // Picking "not linked" unlinks the account that is linked now.
  const [picked, setPicked] = useState(linkedAccountId ? String(linkedAccountId) : "");
  const unlinking = picked === "" && linkedAccountId !== null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <span className="min-w-40 font-medium text-[var(--color-ink)]">
        {kind === "page" ? t("meta.step.mapping.page") : t("meta.step.mapping.instagram")}: {name}
      </span>
      <input type="hidden" name="integrationId" value={integrationId} />
      <input type="hidden" name="externalId" value={unlinking ? "" : externalId} />
      <input type="hidden" name="accountId" value={unlinking ? String(linkedAccountId) : picked} />
      <select
        aria-label={name}
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="rounded-[var(--radius-sm)] surface-border bg-transparent px-2 py-1 text-sm"
      >
        <option value="">{t("meta.step.mapping.pick")}</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || (picked === "" && !linkedAccountId)}
        className={META_BUTTON}
      >
        {t("meta.step.mapping.save")}
      </button>
      <Result result={state} />
    </form>
  );
}

function ActionButton({
  label,
  busy,
  run,
}: {
  label: string;
  busy: string;
  run: () => Promise<MetaActionResult>;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MetaActionResult | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={META_BUTTON}
        disabled={pending}
        onClick={() => start(async () => setResult(await run()))}
      >
        {pending ? busy : label}
      </button>
      <Result result={result} />
    </span>
  );
}

export function MetaAutoLinkButton({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <ActionButton
      label={t("meta.step.mapping.auto")}
      busy={t("meta.sync.running")}
      run={autoLinkAction}
    />
  );
}

export function MetaSyncButton({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <ActionButton label={t("meta.sync.button")} busy={t("meta.sync.running")} run={syncNowAction} />
  );
}

"use client";

import { useActionState } from "react";
import { login, type LoginResult } from "@/lib/auth/actions";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const initialState: LoginResult | null = null;

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

export function LoginForm({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-[var(--color-ink-muted)]">{t("login.email")}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          autoFocus
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-[var(--color-ink-muted)]">{t("login.password")}</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={FIELD}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {pending ? t("login.signingIn") : t("login.signIn")}
      </button>
      {state && !state.ok && <ResultMessage tone="error">{state.error}</ResultMessage>}
    </form>
  );
}

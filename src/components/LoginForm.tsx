"use client";

import { useActionState, useState } from "react";
import { login, type LoginResult } from "@/lib/auth/actions";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const initialState: LoginResult | null = null;

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

export function LoginForm({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(login, initialState);
  // Only changes how the field is displayed; the value never leaves the form.
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      action={formAction}
      onSubmit={() => setShowPassword(false)}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-[var(--color-ink-muted)]">{t("login.email")}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          autoFocus={!state?.email}
          defaultValue={state?.email ?? ""}
          className={FIELD}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-password" className="text-xs text-[var(--color-ink-muted)]">
          {t("login.password")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            name="password"
            required
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            // After a failed attempt the email is kept, so the password is next.
            autoFocus={Boolean(state?.email)}
            className={`${FIELD} min-w-0 flex-1`}
          />
          <button
            type="button"
            aria-controls="login-password"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
            className="surface-border shrink-0 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-ink)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            {showPassword ? t("login.hidePassword") : t("login.showPassword")}
          </button>
        </div>
      </div>
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

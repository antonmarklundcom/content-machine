"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteHookAction, type HookActionResult } from "@/lib/facts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { CopyTextButton } from "./CopyTextButton";
import { ResultMessage } from "./ResultMessage";

export type HookRowData = {
  id: number;
  text: string;
  kind: "hook" | "cta" | "caption_pattern";
  /** "Brand: X", "Family: Y" or "Every brand", already translated. */
  scope: string;
};

/** One hook, CTA or caption pattern, with copy and delete. */
export function HookRow({ hook, locale }: { hook: HookRowData; locale: Locale }) {
  const t = translator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<HookActionResult | null>(null);

  return (
    <li className="surface-border surface-card flex flex-col gap-2 p-4">
      <p className="text-sm leading-relaxed whitespace-pre-line text-[var(--color-ink)]">
        {hook.text}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        <span className="rounded-[var(--radius-sm)] border border-[var(--color-accent)] px-2 py-0.5 font-medium text-[var(--color-accent)]">
          {t(`hooks.kind.${hook.kind}`)}
        </span>
        <span>{hook.scope}</span>
        <span className="ml-auto flex gap-2">
          <CopyTextButton text={hook.text} label={t("hooks.copy")} />
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t("hooks.deleteConfirm"))) return;
              startTransition(async () => {
                const result = await deleteHookAction(hook.id);
                setError(result.ok ? null : result);
                if (result.ok) router.refresh();
              });
            }}
            className="surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:border-[var(--color-danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
          >
            {t("hooks.delete")}
          </button>
        </span>
      </div>
      {error && !error.ok && <ResultMessage tone="error">{t(error.error)}</ResultMessage>}
    </li>
  );
}

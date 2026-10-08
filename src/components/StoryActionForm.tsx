"use client";

import { useActionState } from "react";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import type { StoryActionResult } from "@/lib/stories/result";
import { StoryResult } from "./StoryResult";

export const STORY_FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-2 py-1.5 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const STORY_BUTTON =
  "rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * A story studio form: the fields come in as children (rendered on the
 * server), the bound server action does the work, the result shows below.
 */
export function StoryActionForm({
  action,
  submit,
  pending: pendingKey,
  locale,
  children,
}: {
  action: (prev: StoryActionResult | null, formData: FormData) => Promise<StoryActionResult>;
  submit: TranslationKey;
  pending: TranslationKey;
  locale: Locale;
  children?: React.ReactNode;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(action, null as StoryActionResult | null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <button type="submit" disabled={pending} className={STORY_BUTTON}>
          {pending ? t(pendingKey) : t(submit)}
        </button>
      </div>
      <StoryResult result={state} locale={locale} />
    </form>
  );
}

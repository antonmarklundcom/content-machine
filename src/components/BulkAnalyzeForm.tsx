"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeSelectedAction, type BulkAnalyzeState } from "@/lib/analyze.actions";
import { useTranslator } from "@/lib/i18n/client";
import { ResultMessage } from "./ResultMessage";

/**
 * Bulk "analyse selected" on the feed (PR-28).
 *
 * A real `<form>` of checkboxes wrapping the server-rendered grid, so selection
 * works before hydration and the submission is one post rather than N actions.
 * This component adds the two things a plain form cannot do: a running count
 * with a running cost, and select-all.
 *
 * The estimate is priced per video on the server (it needs each transcript's
 * word count) and passed in as a map, so the sum here is arithmetic rather than
 * a second round trip on every click.
 */
export function BulkAnalyzeForm({
  estimates,
  children,
}: {
  /** videoId → estimated batch cost in USD. Absent means "not selectable". */
  estimates: Record<number, number>;
  children: React.ReactNode;
}) {
  const t = useTranslator();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [state, formAction, pending] = useActionState<BulkAnalyzeState, FormData>(
    async (prev, formData) => {
      const result = await analyzeSelectedAction(prev, formData);
      // revalidatePath only marks the cache stale; this is what re-renders the
      // feed the user is looking at, so submitted videos stop looking pending.
      if (result?.ok) {
        setSelected([]);
        formRef.current?.reset();
        router.refresh();
      }
      return result;
    },
    null,
  );

  const selectableIds = Object.keys(estimates).map(Number);
  const total = selected.reduce((sum, id) => sum + (estimates[id] ?? 0), 0);

  // One handler on the form rather than one per checkbox: the checkboxes are
  // inside server-rendered cards this component never sees.
  function syncSelection() {
    const form = formRef.current;
    if (!form) return;
    const boxes = form.querySelectorAll<HTMLInputElement>('input[name="videoId"]:checked');
    setSelected([...boxes].map((b) => Number(b.value)));
  }

  function setAll(checked: boolean) {
    const form = formRef.current;
    if (!form) return;
    for (const box of form.querySelectorAll<HTMLInputElement>('input[name="videoId"]')) {
      box.checked = checked;
    }
    syncSelection();
  }

  return (
    <form ref={formRef} action={formAction} onChange={syncSelection}>
      {children}

      {/* Sticky rather than above the grid: the decision to analyse is made
          while scrolling through cards, not before reaching them. */}
      <div className="sticky bottom-4 z-10 mt-6">
        <div className="surface-border surface-card flex flex-wrap items-center gap-3 px-4 py-3 shadow-lg">
          <span className="text-sm text-[var(--color-ink)]">
            {selected.length > 0
              ? `${selected.length} ${t("bulk.selected")} · ~$${total.toFixed(total < 1 ? 4 : 2)}`
              : t("bulk.none")}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAll(selected.length < selectableIds.length)}
              className="surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              {selected.length < selectableIds.length ? t("bulk.selectAll") : t("bulk.clear")}
            </button>
            <button
              type="submit"
              disabled={pending || selected.length === 0}
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              {pending ? t("bulk.submitting") : t("bulk.submit")}
            </button>
          </div>
          {state && (
            <div className="w-full">
              <ResultMessage tone={state.ok ? "success" : "error"}>
                {state.ok ? state.message : state.error}
              </ResultMessage>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}

/**
 * The per-card checkbox. Separate from VideoCard because the card is a `<Link>`:
 * a checkbox inside it would navigate on click, and one outside it needs the
 * card's positioning context, which only the feed has.
 */
export function SelectVideoCheckbox({ videoId, title }: { videoId: number; title: string }) {
  return (
    // Positioned over the card but rendered as its sibling, not inside it: the
    // card is a <Link>, and a checkbox within it would navigate on click.
    <label className="absolute top-2 right-2 z-10 flex cursor-pointer items-center rounded-[var(--radius-sm)] bg-black/75 p-1.5">
      <input
        type="checkbox"
        name="videoId"
        value={videoId}
        aria-label={title}
        className="h-4 w-4 accent-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      />
    </label>
  );
}

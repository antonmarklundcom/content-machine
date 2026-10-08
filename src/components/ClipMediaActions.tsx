"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClipFetchActionResult, SaveFromClipInput } from "@/lib/clip-fetch.actions";
import { ResultMessage } from "./ResultMessage";

/**
 * The clip page's buttons (PLAN.md §6.S17): "Fetch + transcribe" (spends, so
 * a pending state and the refusal shown in place), and the two small forms
 * that turn a claim into a fact or a line into a hook.
 */

const BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink)]";

type Result = ClipFetchActionResult | null;

function Outcome({ result }: { result: Result }) {
  if (!result) return null;
  return result.ok ? (
    result.message ? (
      <ResultMessage tone="success">{result.message}</ResultMessage>
    ) : null
  ) : (
    <ResultMessage tone="error">{result.error}</ResultMessage>
  );
}

export function ClipFetchButton({
  clipId,
  action,
  label,
  pendingLabel,
}: {
  clipId: number;
  action: (clipId: number) => Promise<ClipFetchActionResult>;
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={BUTTON}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            setResult(await action(clipId));
            router.refresh();
          })
        }
      >
        {pending ? pendingLabel : label}
      </button>
      <Outcome result={result} />
    </div>
  );
}

export type BrandOption = { id: string; name: string };

/**
 * One line of text + a brand (+ a topic for facts) → an action. Used for
 * "Save claim as fact" (text fixed to the claim) and "Save hook" (editable).
 */
export function ClipSaveForm({
  clipId,
  action,
  initialText,
  editableText,
  textLabel,
  placeholder,
  brands,
  defaultBrandId,
  allowNoBrand,
  noBrandLabel,
  brandLabel,
  topicLabel,
  submitLabel,
  pendingLabel,
}: {
  clipId: number;
  action: (input: SaveFromClipInput) => Promise<ClipFetchActionResult>;
  initialText: string;
  editableText: boolean;
  textLabel?: string;
  placeholder?: string;
  brands: BrandOption[];
  defaultBrandId: string | null;
  /** Hooks may be portfolio-wide; facts need a brand. */
  allowNoBrand: boolean;
  noBrandLabel: string;
  brandLabel: string;
  /** Shown only for facts. */
  topicLabel?: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [text, setText] = useState(initialText);
  const [brandId, setBrandId] = useState(
    defaultBrandId ?? (allowNoBrand ? "" : (brands[0]?.id ?? "")),
  );
  const [topic, setTopic] = useState("");

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setResult(null);
          const r = await action({ clipId, text, brandId, topic });
          setResult(r);
          if (r.ok && editableText) setText("");
        });
      }}
    >
      {editableText && (
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {textLabel}
          <input
            className={FIELD}
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
        {brandLabel}
        <select className={FIELD} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          {allowNoBrand && <option value="">{noBrandLabel}</option>}
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {topicLabel && (
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {topicLabel}
          <input
            className={FIELD}
            value={topic}
            placeholder="from clips"
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
      )}
      <button type="submit" disabled={pending || !text.trim()} className={BUTTON}>
        {pending ? pendingLabel : submitLabel}
      </button>
      <Outcome result={result} />
    </form>
  );
}

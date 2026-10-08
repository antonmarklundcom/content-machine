"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkMediaAction, type BulkMediaOp, type BulkMediaResult } from "@/lib/media.actions";
import { useTranslator } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

export type MediaGridItem = {
  id: number;
  kind: string;
  status: string;
  /** `/api/media/asset/<id>/thumb` when the asset has a thumbnail — never the full file. */
  thumbUrl: string | null;
  label: string;
  owner: string;
  tags: string[];
  /** Opens the detail drawer, keeping the current filter. */
  href: string;
};

const OPS: BulkMediaOp[] = ["tag", "untag", "assign", "approve", "reject", "archive", "restore"];

/**
 * The library grid with its bulk bar (PLAN.md §6.S14). Selection is client
 * state; one click sends one `bulkMediaAction` for every selected file.
 */
export function MediaGrid({
  items,
  brands,
  accounts,
}: {
  items: MediaGridItem[];
  brands: { id: string; name: string }[];
  accounts: { id: number; brandId: string; label: string }[];
}) {
  const t = useTranslator();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [op, setOp] = useState<BulkMediaOp>("approve");
  const [tags, setTags] = useState("");
  const [brandId, setBrandId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [result, setResult] = useState<BulkMediaResult | null>(null);
  const [pending, start] = useTransition();

  const brandAccounts = useMemo(
    () => accounts.filter((a) => a.brandId === brandId),
    [accounts, brandId],
  );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply() {
    start(async () => {
      const next = await bulkMediaAction({
        ids: [...selected],
        op,
        tags: op === "tag" || op === "untag" ? [tags] : undefined,
        brandId: op === "assign" ? brandId || null : undefined,
        accountId: op === "assign" && accountId ? Number(accountId) : null,
      });
      setResult(next);
      if (next.ok) {
        setSelected(new Set());
        setTags("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="surface-border sticky top-0 z-10 flex flex-wrap items-end gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-3">
        <span className="py-2 text-sm text-[var(--color-ink)]">
          {t("media.bulk.selected", { n: selected.size })}
        </span>
        <button
          type="button"
          onClick={() => setSelected(new Set(items.map((i) => i.id)))}
          className="px-2 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {t("media.bulk.selectAll")}
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="px-2 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            {t("media.bulk.clear")}
          </button>
        )}
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("media.bulk.action")}
          <select
            value={op}
            onChange={(e) => setOp(e.target.value as BulkMediaOp)}
            className={FIELD}
          >
            {OPS.map((o) => (
              <option key={o} value={o}>
                {t(`media.bulk.op.${o}` as TranslationKey)}
              </option>
            ))}
          </select>
        </label>
        {(op === "tag" || op === "untag") && (
          <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
            {t("media.bulk.tags")}
            <input value={tags} onChange={(e) => setTags(e.target.value)} className={FIELD} />
          </label>
        )}
        {op === "assign" && (
          <>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
              {t("media.bulk.brand")}
              <select
                value={brandId}
                onChange={(e) => {
                  setBrandId(e.target.value);
                  setAccountId("");
                }}
                className={FIELD}
              >
                <option value="">{t("media.bulk.unassign")}</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            {brandId && (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
                {t("media.bulk.account")}
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className={FIELD}
                >
                  <option value="">{t("media.bulk.brandLevel")}</option>
                  {brandAccounts.map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <button
          type="button"
          onClick={apply}
          disabled={pending || selected.size === 0}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] hover:opacity-90 disabled:opacity-50"
        >
          {t("media.bulk.apply")}
        </button>
        {result && (
          <div className="basis-full">
            {result.ok ? (
              <ResultMessage tone={result.warnings.length ? "info" : "success"}>
                {t("media.bulk.done", { n: result.updated })}
                {result.moved ? ` ${t("media.bulk.moved", { n: result.moved })}` : ""}
                {result.warnings.map((w) => (
                  <span key={w} className="block text-xs">
                    {w}
                  </span>
                ))}
              </ResultMessage>
            ) : (
              <ResultMessage tone="error">{result.error}</ResultMessage>
            )}
          </div>
        )}
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => {
          const checked = selected.has(item.id);
          return (
            <li
              key={item.id}
              className={`surface-border relative overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] ${
                checked ? "ring-2 ring-[var(--color-accent)]" : ""
              }`}
            >
              <label className="absolute top-2 left-2 z-10 flex rounded bg-[var(--color-surface-raised)] p-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                  aria-label={`#${item.id} ${item.label}`}
                />
              </label>
              <a href={item.href} className="block">
                <div className="flex aspect-square items-center justify-center bg-[var(--color-surface)]">
                  {item.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- owner-only route, not optimisable
                    <img
                      src={item.thumbUrl}
                      alt={item.label}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xs tracking-widest text-[var(--color-ink-muted)] uppercase">
                      {t(`media.kind.${item.kind}` as TranslationKey)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 p-2 text-xs">
                  <span className="truncate text-[var(--color-ink)]" title={item.label}>
                    {item.label}
                  </span>
                  <span className="flex justify-between gap-2 text-[var(--color-ink-muted)]">
                    <span className="truncate">{item.owner}</span>
                    <span>{t(`media.status.${item.status}` as TranslationKey)}</span>
                  </span>
                  {item.tags.length > 0 && (
                    <span className="truncate text-[var(--color-ink-muted)]">
                      {item.tags.map((tag) => `#${tag}`).join(" ")}
                    </span>
                  )}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

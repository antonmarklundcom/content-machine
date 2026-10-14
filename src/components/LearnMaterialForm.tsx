"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLearnMaterialAction } from "@/lib/learn/material.actions";
import { useTranslator } from "@/lib/i18n/client";

export function LearnMaterialForm({
  clipId,
  caption,
  transcript,
}: {
  clipId: number;
  caption: string | null;
  transcript: string | null;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <details className="surface-border rounded-lg p-3 text-sm">
      <summary className="cursor-pointer font-medium">{t("learn.material.title")}</summary>
      <p className="mt-2 text-[var(--color-ink-muted)]">{t("learn.material.hint")}</p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await saveLearnMaterialAction(
              clipId,
              String(data.get("caption") ?? ""),
              String(data.get("transcript") ?? ""),
            );
            setMessage(result.ok ? (result.message ?? "") : result.error);
            if (result.ok) router.refresh();
          });
        }}
      >
        <label className="block">
          {t("learn.material.caption")}
          <textarea
            name="caption"
            defaultValue={caption ?? ""}
            maxLength={100000}
            rows={4}
            disabled={pending}
            className="surface-border mt-1 block w-full rounded-lg bg-[var(--color-surface)] p-2"
          />
        </label>
        <label className="block">
          {t("learn.material.transcript")}
          <textarea
            name="transcript"
            defaultValue={transcript ?? ""}
            maxLength={100000}
            rows={5}
            disabled={pending}
            className="surface-border mt-1 block w-full rounded-lg bg-[var(--color-surface)] p-2"
          />
        </label>
        <button
          disabled={pending}
          className="surface-border rounded-lg px-3 py-2 disabled:opacity-50"
        >
          {t(pending ? "learn.action.working" : "learn.material.save")}
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}

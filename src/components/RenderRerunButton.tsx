"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rerenderAction } from "@/lib/video.actions";
import { useTranslator } from "@/lib/i18n/client";

/** "Re-render" on a row of /video: queues a new render from the same owner, language and format. */
export function RenderRerunButton({ renderId }: { renderId: number }) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function rerun() {
    start(async () => {
      const result = await rerenderAction(renderId);
      setMessage(
        result.ok
          ? { ok: true, text: t("videoRender.rerenderStarted", { id: result.renderId }) }
          : { ok: false, text: result.error },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={rerun}
        disabled={pending}
        className="text-sm text-[var(--color-accent)] hover:underline disabled:opacity-50"
      >
        {pending ? t("videoRender.rerendering") : t("videoRender.rerender")}
      </button>
      {message && (
        <span
          role={message.ok ? "status" : "alert"}
          className={`text-xs ${message.ok ? "text-[var(--color-ink-muted)]" : "text-[var(--color-danger)]"}`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslator } from "@/lib/i18n/client";
import { savePublishUrl } from "@/lib/publish.actions";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL } from "./StudioStyles";

/** Paste the published video's URL; saving one moves the script to posted (idea 6). */
export function PublishUrlForm({ scriptId, initialUrl }: { scriptId: number; initialUrl: string }) {
  const t = useTranslator();
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setNote(null);
          try {
            const result = await savePublishUrl(scriptId, url);
            if (result.ok) {
              setUrl(result.script.youtubeUrl ?? "");
              setNote({ ok: true, text: t("publish.pack.urlSaved") });
              router.refresh();
            } else setNote({ ok: false, text: result.error });
          } catch {
            setNote({ ok: false, text: t("studio.error.generic") });
          }
        });
      }}
    >
      <label htmlFor="publish-url" className={STUDIO_LABEL}>
        {t("publish.pack.url")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="publish-url"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=…"
          className={`${STUDIO_INPUT} min-w-0 flex-1`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className={STUDIO_BUTTON} disabled={pending}>
          {t("publish.pack.saveUrl")}
        </button>
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">{t("publish.pack.urlHelp")}</p>
      {note && (
        <p
          className={`text-xs ${note.ok ? "text-[var(--color-ink-muted)]" : "text-[var(--color-danger)]"}`}
          role="status"
        >
          {note.text}
        </p>
      )}
    </form>
  );
}

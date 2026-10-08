"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import type { StoryActionResult } from "@/lib/stories/result";
import { STORY_BUTTON, STORY_FIELD } from "./StoryActionForm";
import { StoryResult } from "./StoryResult";

/**
 * Upload a recording for one line of a scene (a native Guaraní speaker,
 * Anton's own voice). Posts to `/api/stories/upload/<slug>` — recordings are
 * bigger than a server action accepts.
 */
export function StoryUploadForm({
  slug,
  sceneRef,
  lang,
  slots,
  profiles,
  locale,
}: {
  slug: string;
  sceneRef: string;
  lang: string;
  slots: Array<{ slot: string; label: string }>;
  profiles: Array<{ id: number; name: string }>;
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<StoryActionResult | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const body = new FormData(event.currentTarget);
      body.set("sceneRef", sceneRef);
      body.set("lang", lang);
      const res = await fetch(`/api/stories/upload/${encodeURIComponent(slug)}`, {
        method: "POST",
        body,
      });
      const json = (await res.json().catch(() => null)) as StoryActionResult | null;
      setResult(json ?? { ok: false, error: "stories.error.failed", detail: `HTTP ${res.status}` });
      if (json?.ok) router.refresh();
    } catch (err) {
      setResult({
        ok: false,
        error: "stories.error.failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {slots.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
            {t("stories.upload.line")}
            <select name="slot" className={STORY_FIELD}>
              {slots.map((s) => (
                <option key={s.slot} value={s.slot}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {slots.length === 1 && <input type="hidden" name="slot" value={slots[0].slot} />}
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("stories.upload.speaker")}
          <select name="profile" className={STORY_FIELD} defaultValue="">
            <option value="">{t("stories.upload.unnamed")}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <input
          name="file"
          type="file"
          accept="audio/*"
          required
          className={`${STORY_FIELD} max-w-56 text-xs`}
        />
        <button type="submit" disabled={pending} className={STORY_BUTTON}>
          {pending ? t("stories.working") : t("stories.upload.submit")}
        </button>
      </div>
      <StoryResult result={result} locale={locale} />
    </form>
  );
}

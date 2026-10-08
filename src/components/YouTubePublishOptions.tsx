"use client";

import { useState, useTransition } from "react";

import { useTranslator } from "@/lib/i18n/client";
import {
  DEFAULT_YOUTUBE_OPTIONS,
  parseYouTubeOptions,
  YOUTUBE_CATEGORIES,
  YOUTUBE_PRIVACY,
  type YouTubeOptions,
} from "@/lib/publish/options";
import { savePublishOptionsAction } from "@/lib/publish/video.actions";

import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL } from "./StudioStyles";

/**
 * The post editor's YouTube box (build 4 §3.F): privacy (default private),
 * made for kids, category, an optional YouTube-side publish time. Saves into
 * `posts.publish_options.youtube`. Mounted by the link pass on posts whose
 * account is on YouTube; `kidsBrand` shows the kids rule.
 */
export function YouTubePublishOptions({
  postId,
  publishOptions,
  kidsBrand = false,
  disabled = false,
}: {
  postId: number;
  publishOptions: unknown;
  kidsBrand?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslator();
  const parsed = parseYouTubeOptions(publishOptions);
  const [value, setValue] = useState<YouTubeOptions>(
    parsed.ok ? parsed.value : DEFAULT_YOUTUBE_OPTIONS,
  );
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    parsed.ok ? null : { ok: false, text: parsed.error },
  );
  const set = <K extends keyof YouTubeOptions>(k: K, v: YouTubeOptions[K]) =>
    setValue((cur) => ({ ...cur, [k]: v }));

  const kids = value.madeForKids === null ? "auto" : value.madeForKids ? "yes" : "no";
  return (
    <fieldset
      className="surface-border surface-card space-y-3 px-5 py-4 text-sm"
      disabled={disabled}
    >
      <legend className="px-1 font-medium text-[var(--color-ink)]">
        {t("publishVideo.options.youtube")}
      </legend>
      <label className="block">
        <span className={STUDIO_LABEL}>{t("publishVideo.options.privacy")}</span>
        <select
          className={STUDIO_INPUT}
          value={value.privacy}
          onChange={(e) => set("privacy", e.target.value as YouTubeOptions["privacy"])}
        >
          {YOUTUBE_PRIVACY.map((p) => (
            <option key={p} value={p}>
              {t(`publishVideo.options.${p}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={STUDIO_LABEL}>{t("publishVideo.options.madeForKids")}</span>
        <select
          className={STUDIO_INPUT}
          value={kids}
          onChange={(e) =>
            set("madeForKids", e.target.value === "auto" ? null : e.target.value === "yes")
          }
        >
          <option value="auto">{t("publishVideo.options.madeForKids.auto")}</option>
          <option value="yes">{t("publishVideo.options.madeForKids.yes")}</option>
          <option value="no">{t("publishVideo.options.madeForKids.no")}</option>
        </select>
      </label>
      {kidsBrand && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("publishVideo.options.kidsRule")}
        </p>
      )}
      <label className="block">
        <span className={STUDIO_LABEL}>{t("publishVideo.options.category")}</span>
        <select
          className={STUDIO_INPUT}
          value={value.categoryId}
          onChange={(e) => set("categoryId", e.target.value)}
        >
          {YOUTUBE_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={STUDIO_LABEL}>{t("publishVideo.options.publishAt")}</span>
        <input
          type="datetime-local"
          className={STUDIO_INPUT}
          value={value.publishAt ? toLocalInput(value.publishAt) : ""}
          onChange={(e) =>
            set("publishAt", e.target.value ? new Date(e.target.value).toISOString() : null)
          }
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.notifySubscribers}
          onChange={(e) => set("notifySubscribers", e.target.checked)}
        />
        {t("publishVideo.options.notify")}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={STUDIO_BUTTON}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await savePublishOptionsAction(postId, "youtube", value);
              setNotice(
                r.ok
                  ? { ok: true, text: t("publishVideo.options.saved") }
                  : { ok: false, text: r.error },
              );
            })
          }
        >
          {t("publishVideo.options.save")}
        </button>
        {notice && (
          <span
            role="status"
            className={`text-xs ${notice.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
          >
            {notice.text}
          </span>
        )}
      </div>
    </fieldset>
  );
}

/** ISO → the `YYYY-MM-DDTHH:mm` a datetime-local input shows, in the browser's zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

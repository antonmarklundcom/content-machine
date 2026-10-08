"use client";

import { useState, useTransition } from "react";

import { useTranslator } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n";
import {
  DEFAULT_TIKTOK_OPTIONS,
  parseTikTokOptions,
  TIKTOK_MODES,
  TIKTOK_PRIVACY,
  type TikTokOptions,
} from "@/lib/publish/options";
import { savePublishOptionsAction } from "@/lib/publish/video.actions";

import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL } from "./StudioStyles";

/**
 * The post editor's TikTok box (build 4 §3.F): inbox (default, a draft in the
 * creator's TikTok) or direct post, and for direct posts the privacy and
 * interaction switches. Saves into `posts.publish_options.tiktok`. Mounted by
 * the link pass on posts whose account is on TikTok.
 */
export function TikTokPublishOptions({
  postId,
  publishOptions,
  disabled = false,
}: {
  postId: number;
  publishOptions: unknown;
  disabled?: boolean;
}) {
  const t = useTranslator();
  const parsed = parseTikTokOptions(publishOptions);
  const [value, setValue] = useState<TikTokOptions>(
    parsed.ok ? parsed.value : DEFAULT_TIKTOK_OPTIONS,
  );
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    parsed.ok ? null : { ok: false, text: parsed.error },
  );
  const set = <K extends keyof TikTokOptions>(k: K, v: TikTokOptions[K]) =>
    setValue((cur) => ({ ...cur, [k]: v }));
  const direct = value.mode === "direct";

  const toggles = ["disableComment", "disableDuet", "disableStitch", "isAigc"] as const;
  return (
    <fieldset
      className="surface-border surface-card space-y-3 px-5 py-4 text-sm"
      disabled={disabled}
    >
      <legend className="px-1 font-medium text-[var(--color-ink)]">
        {t("publishVideo.options.tiktok")}
      </legend>
      <label className="block">
        <span className={STUDIO_LABEL}>{t("publishVideo.options.mode")}</span>
        <select
          className={STUDIO_INPUT}
          value={value.mode}
          onChange={(e) => set("mode", e.target.value as TikTokOptions["mode"])}
        >
          {TIKTOK_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`publishVideo.options.mode.${m}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      {direct && (
        <>
          <label className="block">
            <span className={STUDIO_LABEL}>{t("publishVideo.options.privacy")}</span>
            <select
              className={STUDIO_INPUT}
              value={value.privacy}
              onChange={(e) => set("privacy", e.target.value as TikTokOptions["privacy"])}
            >
              {TIKTOK_PRIVACY.map((p) => (
                <option key={p} value={p}>
                  {t(`publishVideo.options.tiktokPrivacy.${p}` as TranslationKey)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-[var(--color-muted)]">
            {t("publishVideo.options.tiktokPrivacyNote")}
          </p>
          {toggles.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value[k]}
                onChange={(e) => set(k, e.target.checked)}
              />
              {t(`publishVideo.options.${k}` as TranslationKey)}
            </label>
          ))}
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={STUDIO_BUTTON}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await savePublishOptionsAction(postId, "tiktok", value);
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

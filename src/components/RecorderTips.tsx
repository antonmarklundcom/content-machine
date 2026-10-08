"use client";

import { useCallback, useEffect, useState } from "react";

import { translator, type Locale } from "@/lib/i18n";
import { recordingMinutesAction } from "@/lib/record.actions";
import type { MinutesRow } from "@/lib/voice/record/session";

import { VOICE_BUTTON } from "./VoiceStyles";

/** Fired by `RecorderStudio` after every kept take, so the minutes refresh. */
export const RECORD_KEPT_EVENT = "record:kept";

/** A break every 20 minutes keeps the voice the same from the first line to the last. */
export const BREAK_EVERY_MS = 20 * 60 * 1000;

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The session tips panel: room, mic distance, steady levels, water, a break
 * timer, and minutes recorded per language and profile.
 */
export function RecorderTips({
  initialMinutes,
  locale,
}: {
  initialMinutes: MinutesRow[];
  locale: Locale;
}) {
  const t = translator(locale);
  const [rows, setRows] = useState(initialMinutes);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const start = Date.now();
    setSince(start);
    setNow(start);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const r = await recordingMinutesAction();
    if (r.ok) setRows(r.rows);
  }, []);

  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener(RECORD_KEPT_EVENT, on);
    return () => window.removeEventListener(RECORD_KEPT_EVENT, on);
  }, [refresh]);

  const elapsed = since === null ? 0 : now - since;
  const breakDue = elapsed >= BREAK_EVERY_MS;
  const tips = [
    "record.tips.room",
    "record.tips.mic",
    "record.tips.levels",
    "record.tips.water",
    "record.tips.posture",
  ] as const;

  return (
    <aside className="surface-border surface-card flex flex-col gap-4 p-4 text-sm">
      <section>
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{t("record.tips.title")}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--color-ink-muted)]">
          {tips.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{t("record.break.title")}</h2>
        <p
          className={`mt-1 font-mono text-lg ${
            breakDue ? "text-[var(--color-warn)]" : "text-[var(--color-ink)]"
          }`}
          aria-live="polite"
        >
          {clock(elapsed)} / {clock(BREAK_EVERY_MS)}
        </p>
        {breakDue && <p className="text-[var(--color-warn)]">{t("record.break.due")}</p>}
        <button
          type="button"
          className={`${VOICE_BUTTON} mt-2`}
          onClick={(e) => {
            e.currentTarget.blur();
            const n = Date.now();
            setSince(n);
            setNow(n);
          }}
        >
          {t("record.break.reset")}
        </button>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          {t("record.minutes.title")}
        </h2>
        {rows.length === 0 ? (
          <p className="mt-1 text-[var(--color-ink-muted)]">{t("record.minutes.none")}</p>
        ) : (
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-[var(--color-ink-muted)]">
              <tr>
                <th className="font-medium">{t("record.minutes.language")}</th>
                <th className="font-medium">{t("record.minutes.profile")}</th>
                <th className="text-right font-medium">{t("record.minutes.takes")}</th>
                <th className="text-right font-medium">{t("record.minutes.minutes")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.language}|${r.voiceProfileId ?? "none"}`}>
                  <td>{r.language}</td>
                  <td>{r.profileName ?? t("record.minutes.unnamed")}</td>
                  <td className="text-right">{r.takes}</td>
                  <td className="text-right font-mono">{(r.ms / 60000).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </aside>
  );
}

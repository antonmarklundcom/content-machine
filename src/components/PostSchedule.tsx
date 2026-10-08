"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { PostStatus } from "@/db/schema";
import { useTranslator } from "@/lib/i18n/client";
import { schedulePostAction } from "@/lib/posts.actions";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL } from "./StudioStyles";

/** An ISO instant as the `datetime-local` value in this browser's time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The post's date (PLAN.md §6.S15) — also the calendar's fallback for
 * drag-to-reschedule. Times are the browser's own; the server stores the
 * instant. "Save and schedule" sets the date and moves a ready post to
 * `scheduled` in one request.
 */
export function PostSchedule({
  postId,
  revision,
  status,
  scheduledFor,
}: {
  postId: number;
  revision?: number;
  status: PostStatus;
  scheduledFor: string | null;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Local time is only known in the browser; filling it after mount keeps the
  // server and client markup identical.
  useEffect(() => {
    setValue(scheduledFor ? toLocalInput(scheduledFor) : "");
  }, [scheduledFor]);

  if (status === "published" || status === "publishing") {
    return <p className="text-xs text-[var(--color-ink-muted)]">{t("posts.schedule.locked")}</p>;
  }

  const save = (when: string | null, schedule = false) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await schedulePostAction(postId, when, {
          schedule,
          expectedRevision: revision,
        });
        if (result.ok) router.refresh();
        else setError(result.error);
      } catch {
        setError(t("posts.error.generic"));
      }
    });
  const iso = value ? new Date(value).toISOString() : null;

  return (
    <div className="flex flex-col gap-2">
      <label>
        <span className={STUDIO_LABEL}>{t("posts.schedule.when")}</span>
        <input
          type="datetime-local"
          className={STUDIO_INPUT}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {!scheduledFor && !value && (
        <p className="text-xs text-[var(--color-ink-muted)]">{t("posts.schedule.none")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={STUDIO_BUTTON}
          disabled={pending || !iso}
          onClick={() => save(iso)}
        >
          {t("posts.schedule.set")}
        </button>
        {status !== "scheduled" && (
          <button
            type="button"
            className={STUDIO_BUTTON}
            disabled={pending || !iso || !["ready", "failed"].includes(status)}
            onClick={() => save(iso, true)}
          >
            {t("posts.schedule.schedule")}
          </button>
        )}
        {scheduledFor && status !== "scheduled" && (
          <button
            type="button"
            className={STUDIO_BUTTON}
            disabled={pending}
            onClick={() => save(null)}
          >
            {t("posts.schedule.clear")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

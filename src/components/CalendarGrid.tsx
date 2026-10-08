"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { PostFormat, PostStatus } from "@/db/schema";
import { localDay, moveToDay } from "@/app/calendar/model";
import { FORMAT_LABEL, STATUS_LABEL, statusTone } from "@/app/posts/model";
import { useTranslator } from "@/lib/i18n/client";
import { schedulePostAction } from "@/lib/posts.actions";

export type CalendarPost = {
  id: number;
  revision: number;
  title: string;
  handle: string | null;
  status: PostStatus;
  format: PostFormat;
  /** The instant it sits on: posted, else scheduled. */
  at: string;
  scheduledFor: string | null;
};

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const LOCKED: PostStatus[] = ["published", "publishing"];

function time(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The calendar grid (PLAN.md §6.S15). Posts are placed on days in the
 * viewer's time zone once mounted (UTC before that, so the server markup
 * matches). Dragging a post to another day keeps its time of day and saves
 * through `schedulePostAction`; posted posts do not move.
 */
export function CalendarGrid({
  days,
  month,
  posts,
}: {
  days: string[];
  month: string | null;
  posts: CalendarPost[];
}) {
  const t = useTranslator();
  const router = useRouter();
  const [local, setLocal] = useState(false);
  const [moved, setMoved] = useState<Record<number, string>>({});
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setLocal(true), []);
  // Fresh rows from the server replace the optimistic moves.
  useEffect(() => setMoved({}), [posts]);

  const dayFor = (iso: string) => (local ? localDay(iso) : iso.slice(0, 10));
  const byDay = new Map<string, CalendarPost[]>();
  for (const p of posts) {
    const at = moved[p.id] ?? p.at;
    const day = dayFor(at);
    byDay.set(day, [...(byDay.get(day) ?? []), { ...p, at }]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  const today = local ? localDay(new Date().toISOString()) : null;
  const shown = days.some((d) => byDay.has(d));

  const drop = (postId: number, day: string) => {
    const post = posts.find((p) => p.id === postId);
    if (!post || LOCKED.includes(post.status)) return;
    const current = moved[postId] ?? post.scheduledFor;
    if (current && dayFor(current) === day) return;
    const when = moveToDay(current, day);
    setMoved((m) => ({ ...m, [postId]: when }));
    startTransition(async () => {
      setError(null);
      try {
        const result = await schedulePostAction(postId, when, { expectedRevision: post.revision });
        if (!result.ok) {
          setMoved((m) => {
            const { [postId]: _, ...rest } = m;
            return rest;
          });
          setError(t("calendar.moveFailed", { error: result.error }));
        }
        router.refresh();
      } catch {
        setError(t("posts.error.generic"));
      }
    });
  };

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-7 gap-px overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-border-subtle)]">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="bg-[var(--color-surface-raised)] px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)]"
            >
              {t(`calendar.weekday.${w}` as const)}
            </div>
          ))}
          {days.map((day) => {
            const outside = month !== null && !day.startsWith(month);
            return (
              <div
                key={day}
                data-day={day}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(day);
                }}
                onDragLeave={() => setOver((o) => (o === day ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  drop(Number(e.dataTransfer.getData("text/plain")), day);
                }}
                className={`flex min-h-24 flex-col gap-1 p-1.5 ${
                  over === day ? "bg-[var(--color-surface-raised)]" : "bg-[var(--color-surface)]"
                } ${outside ? "opacity-50" : ""}`}
              >
                <span
                  className={`text-xs ${
                    day === today
                      ? "font-semibold text-[var(--color-accent)]"
                      : "text-[var(--color-ink-muted)]"
                  }`}
                >
                  {Number(day.slice(8))}
                </span>
                {(byDay.get(day) ?? []).map((p) => {
                  const locked = LOCKED.includes(p.status);
                  return (
                    <Link
                      key={p.id}
                      href={`/posts/${p.id}`}
                      draggable={!locked}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(p.id));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      title={`${t(STATUS_LABEL[p.status])} · ${t(FORMAT_LABEL[p.format])}`}
                      className={`surface-border block rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-1.5 py-1 text-[11px] leading-tight ${
                        locked ? "" : "cursor-grab"
                      }`}
                    >
                      <span className={`font-medium ${statusTone(p.status)}`}>
                        {local ? time(p.at) : ""}
                      </span>{" "}
                      <span className="text-[var(--color-ink)]">
                        {p.handle ? `@${p.handle}` : ""}
                      </span>
                      <span className="block truncate text-[var(--color-ink-muted)]">
                        {p.title || t("posts.untitled")}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {!shown && (
        <p className="mt-4 text-sm text-[var(--color-ink-muted)]">{t("calendar.empty")}</p>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PostStatus } from "@/db/schema";
import { STATUS_LABEL } from "@/app/posts/model";
import { useTranslator } from "@/lib/i18n/client";
import { setPostStatusAction } from "@/lib/posts.actions";
import { checkTransition } from "@/lib/posts/status";
import { STUDIO_BUTTON } from "./StudioStyles";

/** The moves a person makes by hand; `publishing` and `failed` belong to O13's publisher. */
const MANUAL: PostStatus[] = ["idea", "drafting", "ready", "scheduled", "published", "archived"];

/**
 * One button per status (PLAN.md §6.S15). A move O11's table refuses is
 * greyed out with the reason as its tooltip; the server checks again, so the
 * greying is a hint, not the gate.
 */
export function PostStatusButtons({
  postId,
  revision,
  status,
  hasBody,
  scheduledFor,
}: {
  postId: number;
  revision?: number;
  status: PostStatus;
  hasBody: boolean;
  scheduledFor: string | null;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const post = { hasBody, scheduledFor: scheduledFor ? new Date(scheduledFor) : null };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("posts.section.status")}>
        {(MANUAL.includes(status) ? MANUAL : [status, ...MANUAL]).map((s) => {
          const check = checkTransition(status, s, post);
          const current = s === status;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={current}
              title={check.ok ? undefined : check.error}
              disabled={pending || current || !check.ok}
              className={`${STUDIO_BUTTON} ${current ? "border-[var(--color-accent)] text-[var(--color-accent)] disabled:opacity-100" : ""}`}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  try {
                    const result = await setPostStatusAction(postId, s, revision);
                    if (result.ok) router.refresh();
                    else setError(result.error);
                  } catch {
                    setError(t("posts.error.generic"));
                  }
                })
              }
            >
              {t(STATUS_LABEL[s])}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">{t("posts.statusHint")}</p>
      {error && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

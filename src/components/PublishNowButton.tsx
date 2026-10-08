"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PostStatus, SocialPlatform } from "@/db/schema";
import { useTranslator } from "@/lib/i18n/client";
import { publishNowAction, stopPublishingAction } from "@/lib/publish/actions";
import { STUDIO_BUTTON } from "./StudioStyles";

const PUBLISHABLE: PostStatus[] = ["ready", "scheduled", "failed"];

/**
 * "Publish now" (PLAN.md §5.O13): asks once, then publishes through Meta and
 * shows what happened. The server re-checks everything; hiding the button is
 * only a hint.
 */
export function PublishNowButton({
  postId,
  revision,
  blocked = false,
  canStop = false,
  status,
  handle,
  platform,
  supported,
  linked,
  resumable,
  lastError,
}: {
  postId: number;
  revision?: number;
  blocked?: boolean;
  canStop?: boolean;
  status: PostStatus;
  handle: string;
  platform: SocialPlatform;
  supported: boolean;
  linked: boolean;
  resumable: boolean;
  lastError: string | null;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const canResume = resumable && (status === "publishing" || status === "failed");
  const visible = !blocked && (PUBLISHABLE.includes(status) || canResume);
  if (!visible && !canStop && !lastError) return null;

  const label = canResume
    ? t("publishNow.resume")
    : status === "failed"
      ? t("publishNow.retry")
      : t("publishNow.button");

  return (
    <div className="flex flex-col gap-2">
      {visible &&
        (!supported ? (
          <p className="text-xs text-[var(--color-ink-muted)]">
            {t("publishNow.unsupported", { platform })}
          </p>
        ) : !linked ? (
          <p className="text-xs text-[var(--color-ink-muted)]">{t("publishNow.notLinked")}</p>
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              className={`${STUDIO_BUTTON} self-start`}
              onClick={() => {
                if (!window.confirm(t("publishNow.confirm", { handle, platform }))) return;
                startTransition(async () => {
                  setNotice(null);
                  try {
                    const r = await publishNowAction(postId, revision);
                    if (!r.ok) {
                      setNotice({ tone: "error", text: r.error });
                      return;
                    }
                    const o = r.outcome;
                    const text =
                      o.result === "published"
                        ? [t("publishNow.published"), o.message].filter(Boolean).join(" ")
                        : o.result === "pending"
                          ? t("publishNow.pending")
                          : o.result === "failed"
                            ? t("publishNow.failed", { error: o.message ?? "" })
                            : t("publishNow.skipped", { reason: o.message ?? "" });
                    setNotice({ tone: o.result === "failed" ? "error" : "ok", text });
                    router.refresh();
                  } catch {
                    setNotice({ tone: "error", text: t("publishNow.error") });
                  }
                });
              }}
            >
              {pending ? t("publishNow.working") : label}
            </button>
            <p className="text-xs text-[var(--color-ink-muted)]">{t("publishNow.hint")}</p>
          </>
        ))}
      {canStop && (
        <button
          type="button"
          className={`${STUDIO_BUTTON} self-start`}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setNotice(null);
              try {
                const result = await stopPublishingAction(postId, revision);
                setNotice({
                  tone: result.ok ? "ok" : "error",
                  text: result.ok ? t("publishNow.stopped") : result.error,
                });
                router.refresh();
              } catch {
                setNotice({ tone: "error", text: t("publishNow.error") });
              }
            })
          }
        >
          {t("publishNow.stop")}
        </button>
      )}
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`text-xs ${notice.tone === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"}`}
        >
          {notice.text}
        </p>
      ) : (
        lastError && (
          <p className="text-xs text-[var(--color-ink-muted)]">
            {t("publishNow.lastError", { error: lastError })}
          </p>
        )
      )}
    </div>
  );
}

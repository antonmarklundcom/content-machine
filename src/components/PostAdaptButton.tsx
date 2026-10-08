"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslator } from "@/lib/i18n/client";
import { adaptPostAction } from "@/lib/posts.actions";
import { STUDIO_BUTTON } from "./StudioStyles";

/**
 * "Adapt to family" (PLAN.md §1.47). Re-runnable: accounts that already have
 * a version are skipped, so a second click only fills the gaps. Owner-only,
 * because every sibling is a paid rewrite.
 */
export function PostAdaptButton({ postId, canAdapt }: { postId: number; canAdapt: boolean }) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          className={STUDIO_BUTTON}
          disabled={pending || !canAdapt}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              try {
                const result = await adaptPostAction(postId);
                if (!result.ok) {
                  setMessage({ text: result.error, error: true });
                  return;
                }
                const reasons = result.skipped.map((s) => `@${s.handle}: ${s.reason}`);
                setMessage({
                  text: [
                    t("posts.adapted", {
                      created: result.created.length,
                      skipped: result.skipped.length,
                      cost: result.cost,
                    }),
                    ...reasons,
                  ].join(" · "),
                  error: false,
                });
                router.refresh();
              } catch {
                setMessage({ text: t("posts.error.generic"), error: true });
              }
            })
          }
        >
          {pending ? t("posts.adapting") : t("posts.adapt")}
        </button>
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">
        {t(canAdapt ? "posts.adaptHint" : "posts.adaptOwnerOnly")}
      </p>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={`text-xs ${message.error ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

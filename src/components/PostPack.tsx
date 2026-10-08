"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { PostStatus } from "@/db/schema";
import { ROLE_LABEL } from "@/app/posts/model";
import { useTranslator } from "@/lib/i18n/client";
import { markPostedAction } from "@/lib/posts.actions";
import type { PostPack as PackData } from "@/lib/posts/export";
import { STUDIO_INPUT, STUDIO_LABEL } from "./StudioStyles";

const BIG_PRIMARY =
  "w-full rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-4 text-base font-semibold text-[var(--color-accent-ink)] disabled:opacity-50";
const BIG_SECONDARY =
  "surface-border w-full rounded-[var(--radius-sm)] px-4 py-3 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50";

function CopyButton({ text, label, primary }: { text: string; label: string; primary?: boolean }) {
  const t = useTranslator();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={primary ? BIG_PRIMARY : BIG_SECONDARY}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? t("posts.pack.copied") : label}
    </button>
  );
}

/**
 * The post pack's body (PLAN.md §1.49): copy, files in order, mark posted.
 * The caption is shown in full above its button so it can be checked before
 * it is pasted.
 */
export function PostPack({
  pack,
  status,
  permalink: initialPermalink,
  scheduledFor,
}: {
  pack: PackData;
  status: PostStatus;
  permalink: string | null;
  scheduledFor: string | null;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [permalink, setPermalink] = useState(initialPermalink ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const posted = status === "published";

  // The date in the phone's own time zone, filled after mount so server and
  // client markup match.
  useEffect(() => {
    setWhen(
      scheduledFor
        ? new Date(scheduledFor).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "",
    );
  }, [scheduledFor]);

  return (
    <div className="mt-5 flex flex-col gap-6">
      {when && (
        <p className="text-sm text-[var(--color-ink-muted)]">
          {t("posts.scheduledFor", { date: when })}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <CopyButton text={pack.caption} label={t("posts.pack.copyCaption")} primary />
        <p className="surface-border surface-card rounded-[var(--radius-sm)] px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-[var(--color-ink)]">
          {pack.caption}
        </p>
        {pack.firstComment && (
          <>
            <CopyButton text={pack.firstComment} label={t("posts.pack.copyFirstComment")} />
            <p className="px-1 text-xs break-words whitespace-pre-wrap text-[var(--color-ink-muted)]">
              {pack.firstComment}
            </p>
          </>
        )}
        {pack.altText && <CopyButton text={pack.altText} label={t("posts.pack.copyAlt")} />}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">
          {t("posts.pack.files")}
        </h2>
        {pack.files.length === 0 ? (
          <p className="text-sm text-[var(--color-warn)]">{t("posts.pack.noFiles")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {pack.files.map((f) => (
              <li
                key={f.position}
                className="surface-border surface-card flex items-center gap-3 rounded-[var(--radius-sm)] p-3"
              >
                <span className="w-6 shrink-0 text-center text-lg font-semibold text-[var(--color-ink)]">
                  {f.position}
                </span>
                {f.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- owner-only media route
                  <img
                    src={f.url}
                    alt={f.altText ?? ""}
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-surface)] object-cover"
                  />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface)] text-[10px] text-[var(--color-ink-muted)] uppercase">
                    {f.kind}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--color-ink)]">
                    {f.fileName ?? `#${f.assetId}`}
                  </span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {t(ROLE_LABEL[f.role])}
                  </span>
                </span>
                <a
                  href={f.url}
                  download={f.fileName ?? undefined}
                  className="surface-border shrink-0 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--color-ink)]"
                >
                  {t("posts.pack.download")}
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <label>
          <span className={STUDIO_LABEL}>{t("posts.pack.permalink")}</span>
          <input
            type="url"
            inputMode="url"
            className={`${STUDIO_INPUT} py-3 text-base`}
            placeholder="https://www.instagram.com/p/…"
            value={permalink}
            onChange={(e) => setPermalink(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={posted ? BIG_SECONDARY : BIG_PRIMARY}
          disabled={pending || (posted && permalink.trim() === (initialPermalink ?? ""))}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              try {
                const result = await markPostedAction(pack.postId, permalink.trim() || null);
                if (result.ok) router.refresh();
                else setError(result.error);
              } catch {
                setError(t("posts.error.generic"));
              }
            })
          }
        >
          {posted ? t("posts.pack.savePermalink") : t("posts.pack.markPosted")}
        </button>
        {posted && (
          <p role="status" className="text-center text-sm font-medium text-[var(--color-accent)]">
            {t("posts.pack.posted")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

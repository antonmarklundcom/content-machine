import Link from "next/link";
import { translator, type Locale } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import type { InboxClip } from "@/lib/bridge";
import { CLIP_PURPOSES } from "@/db/schema";
import { dismissClipAction, retryClipAction, updateClipCaptureAction } from "@/lib/clips.actions";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";
import { PromoteButton, type PromoteBrand, type PromoteSourceOption } from "./PromoteButton";
import { RetryClipButton } from "./RetryClipButton";
import { STATUS_KEY, PLATFORM_KEY, PURPOSE_KEY } from "./ClipFilters";

const STATUS_CLASS: Record<InboxClip["status"], string> = {
  unprocessed: "bg-[var(--color-surface)] text-[var(--color-ink-muted)]",
  ingesting: "bg-[var(--color-accent-ink)] text-[var(--color-accent)]",
  analyzed: "bg-[var(--color-accent-ink)] text-[var(--color-accent)]",
  promoted: "bg-[var(--color-accent)] text-[var(--color-accent-ink)]",
  failed: "bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]",
};

const CHIP =
  "surface-border inline-flex w-fit items-center rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]";

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

const ACTION_BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * One saved link (PLAN.md §6.S3.1). `videoId`/`videoYoutubeId`/`videoTitle`
 * come from the bridge's join — this never queries `videos` itself.
 */
export function ClipRow({
  clip,
  locale,
  canManage,
  promoteSources,
  brands,
  canAdapt,
}: {
  clip: InboxClip;
  locale: Locale;
  /** Owner-only: retry can spend, dismiss throws away a row (see clips.actions.ts). */
  canManage: boolean;
  /** Empty until the clip has an analysed video with ideas to promote. */
  promoteSources: PromoteSourceOption[];
  brands: PromoteBrand[];
  canAdapt: boolean;
}) {
  const t = translator(locale);
  const brandName = clip.brandId
    ? (brands.find((b) => b.id === clip.brandId)?.name ?? clip.brandId)
    : null;

  return (
    <li className="surface-border surface-card flex flex-col gap-3 p-4 sm:flex-row">
      {clip.thumbnailUrl && (
        <div className="aspect-video w-full shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface)] sm:w-40">
          {/* eslint-disable-next-line @next/next/no-img-element -- external, best-effort thumbnail, same call as VideoCard */}
          <img
            src={clip.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`surface-border inline-flex w-fit items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[clip.status]}`}
          >
            {t(STATUS_KEY[clip.status])}
          </span>
          <span className="surface-border inline-flex w-fit items-center rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">
            {t(PLATFORM_KEY[clip.platform])}
          </span>
          {brandName && (
            <Link href={`/inbox?brand=${encodeURIComponent(clip.brandId!)}`} className={CHIP}>
              {brandName}
            </Link>
          )}
          {clip.purpose !== "other" && (
            <Link href={`/inbox?purpose=${clip.purpose}`} className={CHIP}>
              {t(PURPOSE_KEY[clip.purpose])}
            </Link>
          )}
          {clip.tags.map((tag) => (
            <Link key={tag} href={`/inbox?tag=${encodeURIComponent(tag)}`} className={CHIP}>
              #{tag}
            </Link>
          ))}
          <span className="text-xs text-[var(--color-ink-muted)]">
            {t("inbox.savedAt")} {formatDate(clip.savedAt, locale)} ·{" "}
            {t(`capture.source.${clip.source}`)}
          </span>
        </div>

        <a
          href={clip.url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
        >
          {clip.title ?? clip.url}
        </a>
        {clip.author && <p className="text-xs text-[var(--color-ink-muted)]">{clip.author}</p>}

        <p className="text-sm text-[var(--color-ink-muted)] italic">
          {clip.note ?? t("inbox.noNote")}
        </p>

        <details className="text-xs">
          <summary className="w-fit cursor-pointer text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]">
            {t("capture.edit")}
          </summary>
          <form
            action={updateClipCaptureAction.bind(null, clip.id)}
            className="mt-2 flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1">
              <span className="text-[var(--color-ink-muted)]">{t("capture.brand")}</span>
              <select name="brandId" defaultValue={clip.brandId ?? ""} className={FIELD}>
                <option value="">{t("capture.noBrand")}</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[var(--color-ink-muted)]">{t("capture.purpose")}</span>
              <select name="purpose" defaultValue={clip.purpose} className={FIELD}>
                {CLIP_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {t(PURPOSE_KEY[p])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[var(--color-ink-muted)]">{t("capture.tags")}</span>
              <input
                name="tags"
                defaultValue={clip.tags.join(", ")}
                placeholder={t("capture.tagsPlaceholder")}
                className={FIELD}
              />
            </label>
            <button type="submit" className={ACTION_BUTTON}>
              {t("capture.save")}
            </button>
          </form>
        </details>

        {clip.status === "failed" && clip.error && (
          <p className="text-xs text-[var(--color-danger)]">{clip.error}</p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Link href={`/clips/${clip.id}`} className={ACTION_BUTTON}>
            {t("links.openClip")}
          </Link>
          {clip.videoId !== null && (
            <Link href={`/youtube/video/${clip.videoId}`} className={ACTION_BUTTON}>
              {t("inbox.viewVideo")}
            </Link>
          )}
          {promoteSources.length > 0 && (
            <PromoteButton
              sources={promoteSources}
              brands={brands}
              canAdapt={canAdapt}
              clipId={clip.id}
            />
          )}
          {canManage && clip.platform === "youtube" && clip.status === "failed" && (
            <RetryClipButton
              clipId={clip.id}
              action={retryClipAction}
              label={t("inbox.retry")}
              retryingLabel={t("inbox.retrying")}
            />
          )}
          {canManage && (
            <form action={dismissClipAction.bind(null, clip.id)}>
              <ConfirmSubmitButton
                message={t("inbox.dismissConfirm")}
                className={`${ACTION_BUTTON} text-[var(--color-danger)] hover:border-[var(--color-danger)]`}
              >
                {t("inbox.dismiss")}
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}

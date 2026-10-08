import { translator, type Locale } from "@/lib/i18n";
import { deleteVideo, setVideoPinned, setVideoUnread } from "@/lib/video.actions";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";

const BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * Plain server-action forms \u2014 no client JS. Opening the page already marked it
 * read, so "Mark unread" is the way back into the unread queue.
 */
export function VideoReadControls({
  videoId,
  pinned,
  locale,
  canDelete,
}: {
  videoId: number;
  pinned: boolean;
  locale: Locale;
  canDelete: boolean;
}) {
  const t = translator(locale);

  return (
    <div className="flex flex-wrap gap-2">
      <form action={setVideoPinned.bind(null, videoId, !pinned)}>
        <button type="submit" className={BUTTON}>
          {pinned ? t("video.unpin") : t("video.pin")}
        </button>
      </form>
      <form action={setVideoUnread.bind(null, videoId)}>
        <button type="submit" className={BUTTON}>
          {t("video.markUnread")}
        </button>
      </form>
      {canDelete && (
        <form action={deleteVideo.bind(null, videoId)}>
          <ConfirmSubmitButton
            message={t("video.deleteConfirm")}
            className={`${BUTTON} text-[var(--color-danger)] hover:border-[var(--color-danger)]`}
          >
            {t("video.delete")}
          </ConfirmSubmitButton>
        </form>
      )}
    </div>
  );
}

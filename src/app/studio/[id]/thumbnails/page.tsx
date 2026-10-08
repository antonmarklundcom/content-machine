import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { listThumbnails, thumbnailDir } from "@/lib/studio/media";
import { defaultMaxCredits } from "@/lib/higgsfield/config";
import { HiggsfieldGenerateButton } from "@/components/HiggsfieldGenerateButton";
import { ThumbnailExport } from "@/components/ThumbnailExport";
import { ThumbnailPicker } from "@/components/ThumbnailPicker";
import { loadScript } from "../load";

/**
 * `/studio/[id]/thumbnails` (build 2b, idea 10): the thumbnail prompts to hand
 * to `/higgsfield-thumbnails`, the images it saved under
 * `media/<id>/thumbnails/`, and "Use this one" → `scripts.thumbnail_file`.
 */
export default async function ThumbnailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const t = translator(await getLocale());
  const { row } = await loadScript((await params).id);
  const dir = thumbnailDir(row.id);
  const owner = isOwner(user);
  const files = owner ? await listThumbnails(row.id) : [];
  const chosen = row.thumbnailFile;
  const chosenName = chosen?.startsWith(`${dir}/`) ? chosen.slice(dir.length + 1) : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href={`/studio/${row.id}`}
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("listing.thumbs.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
        {t("listing.thumbs.title")} · {row.title}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("listing.thumbs.howTo", { id: row.id, dir })}
      </p>

      <div className="surface-border surface-card mt-6 flex flex-wrap items-center gap-3 px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          {t("listing.thumbs.prompts")}
        </h2>
        <ThumbnailExport scriptId={row.id} />
        {owner && (
          <HiggsfieldGenerateButton
            kind="script_thumbnails"
            targetRef={`script:${row.id}`}
            brandId={row.brandId}
            defaultMaxCredits={defaultMaxCredits()}
          />
        )}
      </div>

      <div className="mt-8">
        {!owner ? (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("listing.thumbs.ownerOnly")}</p>
        ) : (
          <>
            {chosen && (
              <p className="mb-4 text-sm text-[var(--color-ink-muted)]">
                {chosenName && files.includes(chosenName)
                  ? t("listing.thumbs.current", { file: chosen })
                  : t("listing.thumbs.missing", { file: chosen })}
              </p>
            )}
            {files.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">
                {t("listing.thumbs.empty", { dir })}
              </p>
            ) : (
              <ThumbnailPicker
                scriptId={row.id}
                files={files}
                chosen={chosenName}
                hasChoice={Boolean(chosen)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

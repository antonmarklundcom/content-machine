import Link from "next/link";
import { getBrand } from "@/lib/bridge";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { defaultMaxCredits } from "@/lib/higgsfield/config";
import { formatDate } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { GlossaryWarnings } from "@/components/GlossaryWarnings";
import { HiggsfieldGenerateButton } from "@/components/HiggsfieldGenerateButton";
import { StudioEditor } from "@/components/StudioEditor";
import { StudioExports } from "@/components/StudioExports";
import { StudioStatusButtons } from "@/components/StudioStatusButtons";
import { STUDIO_BUTTON, STUDIO_PRIMARY } from "@/components/StudioStyles";
import { STATUS_LABEL } from "../model";
import { loadScript } from "./load";

/** `/studio/[id]` — edit, move along, export, and open the teleprompter (PLAN.md §6.S12.2). */
export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const { row, body, valid } = await loadScript((await params).id);
  const brand = await getBrand(row.brandId);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/studio"
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("studio.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">{row.title}</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {brand?.name ?? row.brandId} · {row.language} · {t(STATUS_LABEL[row.status])} ·{" "}
        {t("studio.updated", { date: formatDate(row.updatedAt, locale) })}
        {row.recordedAt && (
          <> · {t("studio.recordedOn", { date: formatDate(row.recordedAt, locale) })}</>
        )}
        {row.postedAt && <> · {t("studio.postedOn", { date: formatDate(row.postedAt, locale) })}</>}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2" data-saved-action>
        <div className="surface-border surface-card flex flex-col gap-3 px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">
            {t("studio.filter.status")}
          </h2>
          <StudioStatusButtons scriptId={row.id} status={row.status} />
          <Link href={`/studio/${row.id}/teleprompter`} className={`${STUDIO_PRIMARY} self-start`}>
            {t("studio.teleprompter.open")}
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href={`/studio/${row.id}/publish`} className={STUDIO_BUTTON}>
              {t("publish.link.pack")}
            </Link>
            <Link href={`/studio/${row.id}/repurpose`} className={STUDIO_BUTTON}>
              {t("publish.link.repurpose")}
            </Link>
            <Link href={`/studio/${row.id}/voice`} className={STUDIO_BUTTON}>
              {t("voice.studio.link")}
            </Link>
          </div>
        </div>
        <div className="surface-border surface-card flex flex-col gap-3 px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">
            {t("studio.export.title")}
          </h2>
          <StudioExports scriptId={row.id} />
          <p className="text-xs text-[var(--color-ink-muted)]">{t("studio.export.higgsfield")}</p>
          {isOwner(user) && (
            <HiggsfieldGenerateButton
              kind="script_shots"
              targetRef={`script:${row.id}`}
              brandId={row.brandId}
              defaultMaxCredits={defaultMaxCredits()}
            />
          )}
          <Link href={`/studio/${row.id}/thumbnails`} className={`${STUDIO_PRIMARY} self-start`}>
            {t("listing.thumbs.link")}
          </Link>
        </div>
      </div>

      <div className="mt-8">
        {valid && (
          <div className="mb-4">
            <GlossaryWarnings
              text={[
                ...body.hook.spokenLines,
                ...body.sections.flatMap((s) => s.spokenLines),
                ...body.cta.spokenLines,
              ].join("\n")}
              language={row.language}
            />
          </div>
        )}
        {valid ? (
          <StudioEditor
            key={`${user.id}:${row.brandId}:${row.id}`}
            scriptId={row.id}
            initialBody={body}
            userId={user.id}
            brandId={row.brandId}
            revision={row.updatedAt.toISOString()}
          />
        ) : (
          <p className="text-sm text-[var(--color-danger)]">{t("studio.editor.unreadable")}</p>
        )}
      </div>
    </div>
  );
}

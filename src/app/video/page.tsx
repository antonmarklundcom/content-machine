import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/auth/roles";
import { getLocale } from "@/lib/i18n/server";
import { translator, type TranslationKey } from "@/lib/i18n";
import { failStaleRenders, listRenders } from "@/lib/video/queries";
import { formatDuration, isActive, renderView, type RenderView } from "@/lib/video/view";
import { RenderAutoRefresh } from "@/components/RenderAutoRefresh";
import { RenderRerunButton } from "@/components/RenderRerunButton";
import { PcOnlyNotice } from "@/components/PcOnlyNotice";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return { title: t("videoRender.title"), robots: { index: false, follow: false } };
}

const STATUS_CLASS: Record<RenderView["status"], string> = {
  queued: "text-[var(--color-ink-muted)]",
  rendering: "text-[var(--color-accent)]",
  done: "text-[var(--color-ink)]",
  failed: "text-[var(--color-danger)]",
};

/** Where the owner of a render is edited, when this app has a page for it. */
function ownerHref(view: RenderView): string | null {
  const script = /^script:(\d+)$/.exec(view.ownerRef);
  if (view.ownerKind === "script" && script) return `/studio/${script[1]}`;
  return null;
}

/** `/video` (build 4 §3.B): every render with its status, files, error and a re-render button. */
export default async function VideoRendersPage() {
  const user = await requireUser();
  const t = translator(await getLocale());
  const stale = await failStaleRenders();
  const views = (await listRenders()).map(renderView);
  const owner = isOwner(user);
  const dateFmt = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PcOnlyNotice />
      <RenderAutoRefresh active={views.some((v) => isActive(v.status))} />
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("videoRender.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {t("videoRender.title")}
      </h1>
      <p className="mt-1 mb-6 text-sm text-[var(--color-ink-muted)]">{t("videoRender.intro")}</p>
      {stale > 0 && (
        <p role="status" className="mb-4 text-sm text-[var(--color-ink-muted)]">
          {t("videoRender.stale", { n: stale })}
        </p>
      )}

      {views.length === 0 ? (
        <p className="surface-border rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] px-4 py-6 text-sm text-[var(--color-ink-muted)]">
          {t("videoRender.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="text-xs text-[var(--color-ink-muted)] uppercase">
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">{t("videoRender.col.owner")}</th>
                <th className="py-2 pr-3">{t("videoRender.col.language")}</th>
                <th className="py-2 pr-3">{t("videoRender.col.format")}</th>
                <th className="py-2 pr-3">{t("videoRender.col.status")}</th>
                <th className="py-2 pr-3">{t("videoRender.col.duration")}</th>
                <th className="py-2 pr-3">{t("videoRender.col.files")}</th>
                <th className="py-2 pr-3">{t("videoRender.col.created")}</th>
                {owner && <th className="py-2">{t("videoRender.col.actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {views.map((v) => {
                const href = ownerHref(v);
                return (
                  <tr key={v.id} className="border-b border-[var(--color-border-subtle)] align-top">
                    <td className="py-2 pr-3 text-[var(--color-ink-muted)]">{v.id}</td>
                    <td className="py-2 pr-3">
                      {href ? (
                        <a href={href} className="text-[var(--color-accent)] hover:underline">
                          {v.ownerRef}
                        </a>
                      ) : (
                        v.ownerRef
                      )}
                    </td>
                    <td className="py-2 pr-3">{v.language}</td>
                    <td className="py-2 pr-3">
                      {v.format.replace("x", ":")}
                      {v.burned && (
                        <span className="block text-xs text-[var(--color-ink-muted)]">
                          {t("videoRender.burned")}
                        </span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 font-medium ${STATUS_CLASS[v.status]}`}>
                      {t(`videoRender.status.${v.status}` as TranslationKey)}
                      {v.status === "failed" && (
                        <span className="block max-w-xs text-xs font-normal break-words">
                          {v.error ?? t("videoRender.noError")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatDuration(v.durationMs)}</td>
                    <td className="space-x-2 py-2 pr-3">
                      {v.videoUrl && (
                        <a href={v.videoUrl} className="text-[var(--color-accent)] hover:underline">
                          {t("videoRender.file.mp4")}
                        </a>
                      )}
                      {v.srtUrl && (
                        <a href={v.srtUrl} className="text-[var(--color-accent)] hover:underline">
                          {t("videoRender.file.srt")}
                        </a>
                      )}
                      {v.vttUrl && (
                        <a href={v.vttUrl} className="text-[var(--color-accent)] hover:underline">
                          {t("videoRender.file.vtt")}
                        </a>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-[var(--color-ink-muted)]">
                      {dateFmt.format(new Date(v.createdAt))}
                    </td>
                    {owner && (
                      <td className="py-2">
                        {!isActive(v.status) && <RenderRerunButton renderId={v.id} />}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

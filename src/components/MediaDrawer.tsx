import Link from "next/link";
import type { Asset } from "@/db/schema";
import type { AssetUse } from "@/lib/bridge/assets";
import { formatDate } from "@/lib/format";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-sm break-words text-[var(--color-ink)]">{children}</dd>
    </div>
  );
}

/**
 * The detail drawer (PLAN.md §6.S14): prompt, model, source link and where the
 * file is used. Server-rendered from `?asset=<id>`, so it is a link like every
 * other view; closing is a link without the param. The full file loads only
 * here, never in the grid.
 */
export function MediaDrawer({
  locale,
  asset,
  owner,
  uses,
  closeHref,
}: {
  locale: Locale;
  asset: Asset | null;
  owner: string;
  uses: AssetUse[];
  closeHref: string;
}) {
  const t = translator(locale);
  const none = t("media.drawer.none");
  const fileUrl = asset ? `/api/media/asset/${asset.id}` : "";
  const sourceLink =
    asset?.sourceRef && /^https?:\/\//.test(asset.sourceRef) ? asset.sourceRef : null;

  return (
    <aside
      aria-label={asset ? `#${asset.id}` : t("media.drawer.missing")}
      className="surface-border fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col gap-4 overflow-y-auto bg-[var(--color-surface-raised)] p-5 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {asset ? `#${asset.id}` : none}
        </h2>
        <a
          href={closeHref}
          className="px-2 py-1 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {t("media.drawer.close")}
        </a>
      </div>
      {!asset ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("media.drawer.missing")}</p>
      ) : (
        <>
          {asset.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- owner-only file from /api/media
            <img
              src={asset.localPath ? fileUrl : `${fileUrl}/thumb`}
              alt={asset.altText ?? ""}
              className="max-h-80 w-full rounded-[var(--radius-sm)] object-contain"
            />
          ) : asset.kind === "video" ? (
            <video src={fileUrl} controls preload="none" className="max-h-80 w-full" />
          ) : null}
          {asset.localPath && (
            <a href={fileUrl} className="text-sm text-[var(--color-accent)] hover:underline">
              {t("media.drawer.open")}
            </a>
          )}
          <dl className="flex flex-col gap-3">
            <Row label={t("media.drawer.status")}>
              {t(`media.status.${asset.status}` as TranslationKey)} ·{" "}
              {t(`media.kind.${asset.kind}` as TranslationKey)}
            </Row>
            <Row label={t("media.drawer.brand")}>{owner}</Row>
            <Row label={t("media.drawer.prompt")}>
              {asset.prompt ? <span className="whitespace-pre-wrap">{asset.prompt}</span> : none}
            </Row>
            <Row label={t("media.drawer.model")}>{asset.model ?? none}</Row>
            <Row label={t("media.drawer.source")}>
              {t(`media.source.${asset.source}` as TranslationKey)}
              {asset.sourceRef &&
                (sourceLink ? (
                  <>
                    {" · "}
                    <a
                      href={sourceLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-accent)] hover:underline"
                    >
                      {asset.sourceRef}
                    </a>
                  </>
                ) : (
                  ` · ${asset.sourceRef}`
                ))}
            </Row>
            <Row label={t("media.drawer.tags")}>
              {asset.tags.length ? asset.tags.map((tag) => `#${tag}`).join(" ") : none}
            </Row>
            <Row label={t("media.drawer.file")}>
              <code className="text-xs">{asset.localPath ?? none}</code>
            </Row>
            <Row label={t("media.drawer.size")}>
              {formatBytes(asset.bytes)}
              {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
              {asset.durationSec ? ` · ${Math.round(asset.durationSec)} s` : ""}
            </Row>
            <Row label={t("media.drawer.created")}>{formatDate(asset.createdAt, locale)}</Row>
            {asset.altText && <Row label={t("media.drawer.altText")}>{asset.altText}</Row>}
            {asset.notes && <Row label={t("media.drawer.notes")}>{asset.notes}</Row>}
            <Row label={t("media.drawer.uses")}>
              {uses.length ? (
                <ul className="flex flex-col gap-1">
                  {uses.map((use) => (
                    <li key={`${use.postId}-${use.position}`}>
                      <Link
                        href={`/posts/${use.postId}`}
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        #{use.postId} {use.postTitle}
                      </Link>{" "}
                      · {use.role} {use.position} · {use.postStatus}
                    </li>
                  ))}
                </ul>
              ) : (
                t("media.drawer.notUsed")
              )}
            </Row>
          </dl>
        </>
      )}
    </aside>
  );
}

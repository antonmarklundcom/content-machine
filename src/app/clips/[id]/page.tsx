import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipFetchButton, ClipSaveForm } from "@/components/ClipMediaActions";
import { ClipMediaPlayer } from "@/components/ClipMediaPlayer";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getAsset, getClip, listBrands } from "@/lib/bridge";
import {
  fetchClipAction,
  saveClaimAsFactAction,
  saveHookFromClipAction,
} from "@/lib/clip-fetch.actions";
import { formatDate } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { mediaRootStatus } from "@/lib/storage/root";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const t = translator(await getLocale());
  return { title: `${t("clipFetch.title")} ${(await params).id}` };
}

const SECTION = "mt-8";
const H2 = "text-lg font-semibold text-[var(--color-ink)]";
const PROSE = "mt-2 text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-ink)]";

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One saved clip (PLAN.md §6.S17): the fetched media, transcript, on-screen
 * text, summary and claims, with "Fetch + transcribe" (the owner's click,
 * §1.44), "Save claim as fact" and "Save hook". Research only.
 */
export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const t = translator(locale);
  const clip = Number.isInteger(id) && id > 0 ? await getClip(id) : null;
  if (!clip) notFound();

  const [asset, brands, drive] = await Promise.all([
    clip.mediaAssetId ? getAsset(clip.mediaAssetId) : Promise.resolve(null),
    listBrands(),
    mediaRootStatus(),
  ]);
  const owner = isOwner(user);
  const brandOptions = brands.map((b) => ({ id: b.id, name: b.name }));
  const transcribed = Boolean(clip.fetchedAt);
  const claims = clip.claims ?? [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a
        href="/inbox"
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        {t("clipFetch.back")}
      </a>
      <p className="mt-4 text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {clip.platform} · {t("clipFetch.purpose")}: {clip.purpose}
        {clip.brandId ? ` · ${clip.brandId}` : ""}
      </p>
      <h1 className="mt-1 text-2xl font-semibold break-words text-[var(--color-ink)]">
        {clip.title ?? clip.url}
      </h1>
      <p className="mt-2 text-sm">
        <a
          href={clip.url}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] underline"
        >
          {t("clipFetch.openOriginal")}
        </a>
        {" · "}
        <Link
          href={`/posts/new?topic=${encodeURIComponent((clip.summary ?? clip.title ?? clip.url).slice(0, 500))}`}
          className="text-[var(--color-accent)] underline"
        >
          {t("links.makePost")}
        </Link>
      </p>
      {clip.note && (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          {t("clipFetch.note")}: {clip.note}
        </p>
      )}
      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{t("clipFetch.researchOnly")}</p>

      <section className={SECTION} aria-labelledby="clip-media">
        <h2 id="clip-media" className={H2}>
          {t("clipFetch.media")}
        </h2>
        <div className="mt-3">
          {!asset ? (
            <p className="text-sm text-[var(--color-ink-muted)]">{t("clipFetch.notFetched")}</p>
          ) : drive === "missing" ? (
            <p className="text-sm text-[var(--color-ink-muted)]">{t("clipFetch.driveMissing")}</p>
          ) : (
            <ClipMediaPlayer asset={asset} label={clip.title ?? clip.url} />
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {owner ? (
            <ClipFetchButton
              clipId={clip.id}
              action={fetchClipAction}
              label={t(transcribed ? "clipFetch.refetch" : "clipFetch.fetch")}
              pendingLabel={t("clipFetch.fetching")}
            />
          ) : (
            <p className="text-xs text-[var(--color-ink-muted)]">{t("clipFetch.ownerOnly")}</p>
          )}
          {clip.error && (
            <p className="text-xs text-[var(--color-danger)]" data-testid="clip-error">
              {t("clipFetch.lastError")}: {clip.error}
            </p>
          )}
          {clip.fetchedAt && (
            <p className="text-xs text-[var(--color-ink-muted)]">
              {t("clipFetch.fetchedAt")}: {formatDate(clip.fetchedAt, locale)}
            </p>
          )}
        </div>
      </section>

      {!transcribed && !clip.transcript ? (
        <p className={`${SECTION} text-sm text-[var(--color-ink-muted)]`}>{t("clipFetch.empty")}</p>
      ) : (
        <>
          {clip.summary && (
            <section className={SECTION}>
              <h2 className={H2}>{t("clipFetch.summary")}</h2>
              <p className={PROSE}>{clip.summary}</p>
            </section>
          )}

          <section className={SECTION}>
            <h2 className={H2}>{t("clipFetch.claims")}</h2>
            {claims.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                {t("clipFetch.noClaims")}
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {claims.map((c, i) => (
                  <li key={i} className="surface-border surface-card flex flex-col gap-2 p-3">
                    <p className="text-sm text-[var(--color-ink)]">
                      {typeof c.timestampSec === "number" && (
                        <span className="mr-2 font-mono text-xs text-[var(--color-ink-muted)]">
                          {mmss(c.timestampSec)}
                        </span>
                      )}
                      {c.claim}
                    </p>
                    {owner && brandOptions.length > 0 && (
                      <ClipSaveForm
                        clipId={clip.id}
                        action={saveClaimAsFactAction}
                        initialText={c.claim}
                        editableText={false}
                        brands={brandOptions}
                        defaultBrandId={clip.brandId}
                        allowNoBrand={false}
                        noBrandLabel={t("clipFetch.allBrands")}
                        brandLabel={t("clipFetch.brand")}
                        topicLabel={t("clipFetch.topic")}
                        submitLabel={t("clipFetch.saveFact")}
                        pendingLabel={t("clipFetch.saving")}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={SECTION}>
            <h2 className={H2}>{t("clipFetch.saveHook")}</h2>
            <div className="mt-3">
              <ClipSaveForm
                clipId={clip.id}
                action={saveHookFromClipAction}
                initialText={(clip.transcript ?? "").split(/(?<=[.!?])\s/)[0]?.slice(0, 280) ?? ""}
                editableText
                textLabel={t("clipFetch.hookLabel")}
                placeholder={t("clipFetch.hookPlaceholder")}
                brands={brandOptions}
                defaultBrandId={clip.brandId}
                allowNoBrand
                noBrandLabel={t("clipFetch.allBrands")}
                brandLabel={t("clipFetch.brand")}
                submitLabel={t("clipFetch.saveHook")}
                pendingLabel={t("clipFetch.saving")}
              />
            </div>
          </section>

          {clip.postText && (
            <section className={SECTION}>
              <h2 className={H2}>{t("clipFetch.postText")}</h2>
              <p className={PROSE}>{clip.postText}</p>
            </section>
          )}

          {clip.transcript && (
            <section className={SECTION}>
              <h2 className={H2}>{t("clipFetch.transcript")}</h2>
              <p className={PROSE}>{clip.transcript}</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

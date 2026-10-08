import type { Metadata } from "next";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import {
  analysisBundleForVideo,
  listBrands,
  listClips,
  clipCountsByStatus,
  type InboxClip,
} from "@/lib/bridge";
import {
  CLIP_PLATFORMS,
  CLIP_PURPOSES,
  CLIP_STATUSES,
  type ClipPlatform,
  type ClipPurpose,
  type ClipStatus,
} from "@/db/schema";
import { ClipFilters } from "@/components/ClipFilters";
import { ClipRow } from "@/components/ClipRow";
import { QuickAddClipForm } from "@/components/QuickAddClipForm";
import { Pagination } from "@/components/Pagination";
import type { PromoteSourceOption } from "@/components/PromoteButton";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("inbox.title") };
}

type SearchParams = {
  status?: string;
  platform?: string;
  brand?: string;
  purpose?: string;
  tag?: string;
  page?: string;
};

function isClipStatus(value: string | undefined): value is ClipStatus {
  return !!value && (CLIP_STATUSES as readonly string[]).includes(value);
}

function isClipPurpose(value: string | undefined): value is ClipPurpose {
  return !!value && (CLIP_PURPOSES as readonly string[]).includes(value);
}

function isClipPlatform(value: string | undefined): value is ClipPlatform {
  return !!value && (CLIP_PLATFORMS as readonly string[]).includes(value);
}

/**
 * The promote choices for one analysed clip: one option per idea in its
 * video's latest analysis (PLAN.md §6.S3.1). Empty when the video has no
 * analysis yet, or the analysis proposed no ideas — the row's promote button
 * disappears rather than opening onto nothing.
 */
async function promoteSourcesFor(clip: InboxClip): Promise<PromoteSourceOption[]> {
  if (clip.videoId === null) return [];
  const bundle = await analysisBundleForVideo(clip.videoId);
  if (!bundle?.analysis || !bundle.analysis.ideas?.length) return [];
  return bundle.analysis.ideas.map((idea, ideaIndex) => ({
    label: idea.title || `Idea ${ideaIndex + 1}`,
    source: { kind: "analysis-idea" as const, analysisId: bundle.analysis!.id, ideaIndex },
  }));
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const canManage = isOwner(user);

  const status = isClipStatus(params.status) ? params.status : undefined;
  const platform = isClipPlatform(params.platform) ? params.platform : undefined;
  const page = Number(params.page) || 1;
  const brandId = params.brand?.trim() || undefined;
  const purpose = isClipPurpose(params.purpose) ? params.purpose : undefined;
  // Tags are stored lower-case without the `#` (normalizeTags), so match that.
  const tag = params.tag?.trim().replace(/^#+/, "").toLowerCase() || undefined;

  const [result, counts, brands] = await Promise.all([
    listClips({ status, platform, brandId, purpose, tag, page }),
    clipCountsByStatus(),
    listBrands(),
  ]);

  const promoteSources = await Promise.all(result.clips.map(promoteSourcesFor));
  const hasFilters = [status, platform, brandId, purpose, tag].some((v) => v !== undefined);
  const brandOptions = brands.map((b) => ({ id: b.id, name: b.name, platforms: b.platforms }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            {t("inbox.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
            {result.total} {t(result.total === 1 ? "inbox.countOne" : "inbox.countMany")}
          </h1>
        </div>
        <ClipFilters
          status={status ?? ""}
          platform={platform ?? ""}
          brandId={brandId ?? ""}
          purpose={purpose ?? ""}
          tag={tag ?? ""}
          brands={brandOptions}
          locale={locale}
        />
        {Object.keys(counts).length > 0 && (
          <p className="text-xs text-[var(--color-ink-muted)]">
            {Object.entries(counts)
              .map(([s, n]) => `${t(("inbox.status." + s) as `inbox.status.${ClipStatus}`)}: ${n}`)
              .join(" · ")}
          </p>
        )}
      </div>

      <div className="surface-border surface-card mb-6 p-5">
        <QuickAddClipForm />
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">{t("capture.hashtagHint")}</p>
      </div>

      {result.clips.length === 0 ? (
        <div className="surface-border surface-card flex min-h-[30vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <h2 className="text-lg font-medium text-[var(--color-ink)]">
            {t(hasFilters ? "inbox.noMatch.title" : "inbox.empty.title")}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-[var(--color-ink-muted)]">
            {t(hasFilters ? "inbox.noMatch.body" : "inbox.empty.body")}
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {result.clips.map((clip, i) => (
              <ClipRow
                key={clip.id}
                clip={clip}
                locale={locale}
                canManage={canManage}
                promoteSources={promoteSources[i]!}
                brands={brandOptions}
                canAdapt={canManage}
              />
            ))}
          </ul>
          <div className="mt-8">
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              searchParams={params}
              locale={locale}
              basePath="/inbox"
            />
          </div>
        </>
      )}

      <div className="surface-border surface-card mt-8 p-5 text-sm text-[var(--color-ink-muted)]">
        <p className="font-medium text-[var(--color-ink)]">{t("inbox.captureSetup.title")}</p>
        <p className="mt-1">{t("inbox.captureSetup.body")}</p>
        <p className="mt-3 font-medium text-[var(--color-ink)]">{t("capture.telegram.title")}</p>
        <p className="mt-1">{t("capture.telegram.body")}</p>
      </div>
    </main>
  );
}

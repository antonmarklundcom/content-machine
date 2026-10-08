import type { Metadata } from "next";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { DEFAULT_MODEL } from "@/lib/analysis/pricing";
import { estimateAnalysisCostUsd } from "@/lib/spend";
import { isCulled, screenMinScore } from "@/lib/screening/policy";
import { BulkAnalyzeForm, SelectVideoCheckbox } from "@/components/BulkAnalyzeForm";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { DigestFilters } from "@/components/DigestFilters";
import { Pagination } from "@/components/Pagination";
import { VideoCard } from "@/components/VideoCard";
import {
  listDigestVideos,
  parseCaptionStatus,
  parseDigestSort,
  parseReadFilter,
} from "@/lib/videos";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("digest.eyebrow") };
}

type SearchParams = {
  q?: string;
  status?: string;
  filter?: string;
  /** [PR-34] One shape of video, linked from the /topics page. */
  type?: string;
  sort?: string;
  page?: string;
};

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  // The feed shows *this* user's read state (PR-25), so it needs the row.
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const q = params.q?.trim() ?? "";
  const status = parseCaptionStatus(params.status);
  const filter = parseReadFilter(params.filter);
  const sort = parseDigestSort(params.sort);
  const page = Number(params.page) || 1;

  const contentType = params.type?.trim() || undefined;

  const result = await listDigestVideos({
    userId: user.id,
    q: q || undefined,
    status,
    filter,
    contentType,
    sort,
    page,
  });
  const hasFilters =
    q !== "" || status !== undefined || filter !== undefined || contentType !== undefined;

  // What a bulk selection would cost, priced per video from its transcript
  // length (PR-28). Only videos that could actually be submitted get an entry:
  // no transcript, or already analysed, means nothing to select. The action
  // re-checks all of this server-side — this map is for the estimate and the
  // checkbox, not for permission.
  const canSpend = isOwner(user);
  const minScore = screenMinScore();
  const estimates: Record<number, number> = {};
  if (canSpend) {
    for (const video of result.videos) {
      if (video.analysisStatus === "ok") continue;
      if (!video.transcriptWords) continue;
      // [PR-35] A culled video is not offered for bulk analysis — the action
      // refuses it anyway (findPendingVideosByIds), and a checkbox that submits
      // into a silent no-op is worse than no checkbox. Its own page still has
      // the button, which is where an override belongs: one video, one decision.
      if (isCulled({ status: "ok", score: video.screenScore }, minScore)) continue;
      estimates[video.id] = estimateAnalysisCostUsd(video.transcriptWords, DEFAULT_MODEL, {
        batch: true,
      });
    }
  }
  const selectable = Object.keys(estimates).length > 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            {t("digest.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
            {result.total} {t(result.total === 1 ? "digest.countOne" : "digest.countMany")}
          </h1>
        </div>
        <DigestFilters
          q={q}
          status={status ?? ""}
          filter={filter ?? ""}
          sort={sort ?? "published"}
          locale={locale}
        />
      </div>

      {result.videos.length === 0 ? (
        <div className="surface-border surface-card flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <h2 className="text-lg font-medium text-[var(--color-ink)]">
            {t(hasFilters ? "digest.noMatch.title" : "digest.empty.title")}
          </h2>
          <p className="max-w-md text-sm text-[var(--color-ink-muted)] leading-relaxed">
            {t(hasFilters ? "digest.noMatch.body" : "digest.empty.body")}
          </p>
        </div>
      ) : (
        <>
          {(() => {
            const grid = (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {result.videos.map((video) => (
                  <div key={video.id} className="relative">
                    {estimates[video.id] !== undefined && (
                      <SelectVideoCheckbox videoId={video.id} title={video.title} />
                    )}
                    <VideoCard video={video} locale={locale} />
                  </div>
                ))}
              </div>
            );
            // The form only exists when there is something to submit: an
            // employee, or a page where every video is analysed, gets the plain
            // grid rather than a bar that can only say "nothing selected".
            return selectable ? (
              <BulkAnalyzeForm estimates={estimates}>{grid}</BulkAnalyzeForm>
            ) : (
              grid
            );
          })()}
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            searchParams={params}
            locale={locale}
          />
        </>
      )}
    </main>
  );
}

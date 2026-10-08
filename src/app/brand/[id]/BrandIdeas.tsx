import type { IdeaStatus } from "@/db/schema";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { ideaCountsByStatus, listIdeas } from "@/lib/bridge";
import type { Locale } from "@/lib/i18n";
import { BrandIdeaBoard } from "@/components/BrandIdeaBoard";
import { IdeaStatusTabs } from "@/components/IdeaStatusTabs";
import { Pagination } from "@/components/Pagination";

export type AnalyzedVideoOption = {
  analysisId: number;
  videoId: number;
  title: string;
  channelTitle: string | null;
};

/**
 * The brand page's ideas section, read on the server through the bridge
 * (PLAN.md §4.7): S6's status tabs and paging, with S6's `IdeaActions` on each
 * card (S9 swapped them in for the card's own approve/reject buttons).
 */
export default async function BrandIdeas({
  brandId,
  analyzedVideos,
  locale,
  status,
  page,
}: {
  brandId: string;
  /** The "seed from a video" picker's list (PLAN.md §6.S3.2) — bridge.listAnalyzedVideos(). */
  analyzedVideos: AnalyzedVideoOption[];
  locale: Locale;
  status: IdeaStatus | undefined;
  page: number;
}) {
  const [user, result, counts] = await Promise.all([
    requireUser(),
    listIdeas({ brandId, status, page }),
    ideaCountsByStatus(brandId),
  ]);
  const basePath = `/brand/${encodeURIComponent(brandId)}`;

  return (
    <section className="mt-8 flex flex-col gap-6">
      <BrandIdeaBoard
        brandId={brandId}
        analyzedVideos={analyzedVideos}
        locale={locale}
        ideas={result.ideas}
        canDelete={isOwner(user)}
        canGenerate={isOwner(user)}
        tabs={
          <IdeaStatusTabs counts={counts} active={status} basePath={basePath} locale={locale} />
        }
      />
      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        searchParams={{ status }}
        locale={locale}
        basePath={basePath}
      />
    </section>
  );
}

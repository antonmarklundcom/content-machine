import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { analysisBundleForVideo, listAnalyzedVideos, listBrands } from "@/lib/bridge";
import { listLessons } from "@/lib/bridge/lessons";
import { defaultScriptLanguage } from "@/lib/scripts/language";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { StudioBriefForm, type BriefLesson, type BriefVideo } from "@/components/StudioBriefForm";
import { parseBriefParams } from "../model";

/**
 * `/studio/new` — the brief (PLAN.md §6.S12.1). `?brand=` and repeated
 * `?ref=<videoId>` (S10's "Use as reference") preselect the brand and the
 * competitor videos; `?topic=` (build 2b's report and questions) the topic.
 * Generation itself is O8's routes, called from the form.
 */
export default async function NewScriptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const t = translator(await getLocale());
  const params = await searchParams;
  const { brand: wanted, refs } = parseBriefParams(params);
  // Build 2b: the competitor report's ideas and mined questions prefill the topic.
  const topic = typeof params.topic === "string" ? params.topic.trim().slice(0, 500) : "";

  const brands = await listBrands();
  const brand = brands.find((b) => b.id === wanted) ?? brands[0];

  if (!brand) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-[var(--color-ink)]">
          {t("studio.brief.title")}
        </h1>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t("studio.brief.noBrands")}</p>
      </div>
    );
  }

  const [analysed, brandLessons, sharedLessons] = await Promise.all([
    listAnalyzedVideos(100),
    listLessons({ brandId: brand.id, limit: 200 }),
    listLessons({ brandId: null, limit: 200 }),
  ]);

  const videos: BriefVideo[] = analysed.map((v) => ({
    id: v.videoId,
    title: v.title,
    channel: v.channelTitle,
  }));
  // A ref outside the latest 100 analysed videos is still offered; one with no
  // usable analysis is named, so the person knows why it is not selectable.
  const unusable: { id: number; title: string }[] = [];
  for (const id of refs.filter((r) => !videos.some((v) => v.id === r))) {
    const bundle = await analysisBundleForVideo(id);
    if (!bundle) continue;
    if (bundle.analysis?.status === "ok") {
      videos.unshift({ id, title: bundle.video.title, channel: bundle.video.channelTitle });
    } else {
      unusable.push({ id, title: bundle.video.title });
    }
  }

  const lessons: BriefLesson[] = [...brandLessons, ...sharedLessons].map((l) => ({
    id: l.id,
    kind: l.kind,
    text: l.text,
    shared: l.brandId === null,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/studio"
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("studio.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
        {t("studio.brief.title")}
      </h1>
      {!isOwner(user) && (
        <p className="mt-3 text-sm text-[var(--color-warn)]">{t("studio.brief.ownerOnly")}</p>
      )}
      {unusable.map((v) => (
        <p key={v.id} className="mt-3 text-sm text-[var(--color-warn)]">
          {t("studio.brief.refNotAnalysed", { title: v.title })}{" "}
          <Link href={`/youtube/video/${v.id}`} className="underline">
            {t("studio.brief.openVideo")}
          </Link>
        </p>
      ))}
      <StudioBriefForm
        brands={brands.map((b) => ({ id: b.id, name: b.name, language: defaultScriptLanguage(b) }))}
        brandId={brand.id}
        videos={videos}
        selectedRefs={refs.filter((r) => videos.some((v) => v.id === r))}
        lessons={lessons}
        initialTopic={topic}
      />
    </div>
  );
}

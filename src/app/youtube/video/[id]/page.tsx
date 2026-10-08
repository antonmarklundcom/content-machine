import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { outlines, screenings, transcripts, videoReads, videos } from "@/db/schema";
import { latestAnalysisForVideo } from "@/lib/analysis/latest";
import { DEFAULT_MODEL, UPGRADE_MODEL } from "@/lib/analysis/pricing";
import { estimateAnalysisCostUsd, formatUsd } from "@/lib/spend";
import { slugifyTag } from "@/lib/tags";
import { isCulled, screenMinScore } from "@/lib/screening/policy";
import { markVideoRead } from "@/lib/videos";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import type { UnitType } from "@/lib/listen/units";
import { analysisRowUnits, unitKey } from "@/lib/listen/units";
import { markedUnitKeys } from "@/lib/marks";
import { listBrands } from "@/lib/bridge";
import { AnalyzeButton } from "@/components/AnalyzeButton";
import { ListenPlayer } from "@/components/ListenPlayer";
import { PromoteButton } from "@/components/PromoteButton";
import { UnitMarkButton } from "@/components/UnitMarkButton";
import { VideoReadControls } from "@/components/VideoReadControls";
import { CaptionBadge } from "@/components/CaptionBadge";
import { FallbackAnalyzeButton } from "@/components/FallbackAnalyzeButton";
import { SaveLessonButton } from "@/components/SaveLessonButton";
import { CopyAnalysisButton } from "@/components/CopyAnalysisButton";
import { CopyTextButton } from "@/components/CopyTextButton";
import { IdeaOutline } from "@/components/IdeaOutline";
import {
  formatCompactNumber,
  formatDate,
  formatDuration,
  formatLikeRate,
  likesPerThousandViews,
} from "@/lib/format";

/**
 * Selects the title alone rather than reusing the page's query — this runs
 * before the page renders and the whole row is not needed to name a tab.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId)) return { title: "Video" };

  const [row] = await db
    .select({ title: videos.title })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  return { title: row?.title ?? "Video" };
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId)) notFound();

  const locale = await getLocale();
  const t = translator(locale);
  // Owner-only controls are hidden rather than shown-and-refused. The server
  // actions check for themselves regardless (src/lib/auth/roles.ts).
  // requireUser() rather than getSession(): read state is per-user (PR-25), so
  // the page needs an id, not just a role. The middleware has already redirected
  // signed-out visitors; this is the same gate, one layer in.
  const user = await requireUser();
  const canSpend = isOwner(user);

  const rows = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  const video = rows[0];
  if (!video) notFound();

  // Opening the page is what "read" means here (PR-19), for this user alone
  // since PR-25. Fire-and-forget would race the read of the state below, so it
  // is awaited — one primary-key upsert whose timestamp stops moving after the
  // first visit.
  await markVideoRead(video.id, user.id);

  // Read after the mark, so the controls show the state the visit just created.
  const [readState] = await db
    .select({ pinned: videoReads.pinned })
    .from(videoReads)
    .where(and(eq(videoReads.videoId, video.id), eq(videoReads.userId, user.id)))
    .limit(1);
  const pinned = readState?.pinned ?? false;

  const analysis = await latestAnalysisForVideo(video.id);

  // [PR-35] The gallring's judgement, if it has one. Read on every video rather
  // than only on unanalysed ones: a score that turns out to have been wrong is
  // exactly the thing worth seeing next to the analysis it nearly prevented.
  const [screening] = await db
    .select()
    .from(screenings)
    .where(eq(screenings.videoId, video.id))
    .limit(1);
  const minScore = screenMinScore();
  const culled = isCulled(screening, minScore);

  // The estimate on the button needs the transcript's length, and its absence
  // is also what decides whether analysing is possible at all.
  const [transcript] = await db
    .select({ wordCount: transcripts.wordCount })
    .from(transcripts)
    .where(eq(transcripts.videoId, video.id))
    .limit(1);
  const estimate =
    canSpend && transcript
      ? {
          standard: formatUsd(estimateAnalysisCostUsd(transcript.wordCount, DEFAULT_MODEL)),
          upgrade: formatUsd(estimateAnalysisCostUsd(transcript.wordCount, UPGRADE_MODEL)),
        }
      : null;
  // Both statuses (PR-29). PR-16 made a failed generation write a row precisely
  // so a paid failure would survive a reload — filtering them out here is what
  // kept them invisible, which meant the row it preserved was never read.
  const outlineRows =
    analysis && analysis.status === "ok"
      ? await db.select().from(outlines).where(eq(outlines.analysisId, analysis.id))
      : [];
  const outlineByIdeaIndex = new Map(outlineRows.map((o) => [o.ideaIndex, o]));

  // [PR-37] Which units this user has starred. Read for every analysis, not
  // only while listening: a mark made with the ear has to be visible to the eye.
  const units = analysisRowUnits(analysis);
  const marked = analysis ? await markedUnitKeys(video.id, user.id) : new Set<string>();
  // Every unit's current text, by address — what a star stores as its snapshot.
  const unitText = new Map(units.map((u) => [u.key, u.text]));

  // [S3] The promote touchpoint (PLAN.md §6.S3.2): every starrable unit is also
  // promotable — "turn this into an idea for a brand" is the same gesture on a
  // takeaway as it is on a proposed idea. Brands are fetched once, up front,
  // rather than per-unit.
  const brands = await listBrands();
  const brandOptions = brands.map((b) => ({ id: b.id, name: b.name, platforms: b.platforms }));

  const star = (unitType: UnitType, unitIndex: number) => {
    const key = unitKey(unitType, unitIndex);
    const text = unitText.get(key);
    // No text means nothing to mark: the section is empty and is not a unit.
    if (text === undefined) return null;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <UnitMarkButton
          videoId={video.id}
          unitType={unitType}
          unitIndex={unitIndex}
          unitText={text}
          marked={marked.has(key)}
          locale={locale}
        />
        {brandOptions.length > 0 && (
          <PromoteButton
            sources={[
              { label: text, source: { kind: "unit", videoId: video.id, unitType, unitIndex } },
            ]}
            brands={brandOptions}
            canAdapt={canSpend}
          />
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <CaptionBadge status={video.captionStatus} locale={locale} />
          <span className="text-xs text-[var(--color-ink-muted)]">
            {video.channelTitle ?? t("video.unknownChannel")} ·{" "}
            {formatDate(video.publishedAt, locale)} · {formatDuration(video.durationSeconds)}
          </span>
        </div>
        {/* [PR-33] Reach and reaction, side by side. Each counter is skipped
            when the uploader hides it rather than rendered as zero. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-ink-muted)]">
          {video.viewCount !== null && (
            <span>
              {formatCompactNumber(video.viewCount, locale)} {t("card.views")}
            </span>
          )}
          {video.likeCount !== null && (
            <span>
              {formatCompactNumber(video.likeCount, locale)} {t("video.likes")}
            </span>
          )}
          {video.commentCount !== null && (
            <span>
              {formatCompactNumber(video.commentCount, locale)} {t("video.comments")}
            </span>
          )}
          {likesPerThousandViews(video.likeCount, video.viewCount) !== null && (
            <span>
              {formatLikeRate(video.likeCount, video.viewCount, locale)} {t("card.likeRate")}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-balance text-[var(--color-ink)]">
          {video.title}
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a
            href={`https://www.youtube.com/watch?v=${video.youtubeId}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            {t("video.watch")}
          </a>
          <VideoReadControls
            videoId={video.id}
            pinned={pinned}
            locale={locale}
            canDelete={canSpend}
          />
        </div>
      </div>

      {/* [PR-35] What the screen thought, in its own words. Shown above the
          analysis panel because when a video is culled this is the reason the
          panel below says "not analysed", and an explanation that appears after
          the thing it explains is read as an excuse. */}
      {screening && screening.status === "ok" && (
        <div className={`surface-border surface-card mb-4 px-5 py-4 ${culled ? "" : "opacity-80"}`}>
          <p className="text-sm font-medium text-[var(--color-ink)]">
            {t(culled ? "screen.culled.title" : "screen.kept.title")}{" "}
            <span className="text-[var(--color-ink-muted)]">
              {screening.score}/{minScore}
            </span>
          </p>
          {screening.reason && (
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{screening.reason}</p>
          )}
          {culled && (
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{t("screen.culled.body")}</p>
          )}
        </div>
      )}

      {!analysis && (
        <div className="surface-border surface-card flex flex-col items-center gap-4 px-6 py-12 text-center">
          <div>
            <p className="text-[var(--color-ink)] font-medium">{t("video.notAnalysed.title")}</p>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {t(estimate ? "video.notAnalysed.ready" : "video.notAnalysed.noTranscript")}
            </p>
          </div>
          {estimate && (
            <AnalyzeButton
              videoId={video.id}
              labelKey="video.analyzeNow"
              estimate={estimate.standard}
              locale={locale}
            />
          )}
          {/* [S11] No transcript: the click-only URL fallback (§1.35). Owner only. */}
          {!transcript && <FallbackAnalyzeButton videoId={video.id} isOwner={canSpend} />}
        </div>
      )}

      {analysis && analysis.status === "failed" && (
        <div className="surface-border surface-card px-6 py-8">
          <p className="font-medium text-[var(--color-danger)]">{t("video.failed.title")}</p>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            {analysis.error ?? t("video.failed.noMessage")}
          </p>
          {analysis.rawResponse && (
            <div className="mt-4 flex flex-col items-start gap-2">
              <pre className="surface-border max-h-64 w-full overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-ink-muted)]">
                {analysis.rawResponse}
              </pre>
              <CopyTextButton text={analysis.rawResponse} label={t("video.copyRaw")} />
            </div>
          )}
          {estimate && (
            <div className="mt-5 flex flex-wrap gap-3">
              {/* force: a failed row is not a success, but `analyzeVideo` only
                  skips on a successful one, so this is belt-and-braces for the
                  case where an older successful analysis exists behind it. */}
              <AnalyzeButton
                videoId={video.id}
                labelKey="video.retry"
                estimate={estimate.standard}
                locale={locale}
                force
              />
              <AnalyzeButton
                videoId={video.id}
                labelKey="video.retryUpgrade"
                estimate={estimate.upgrade}
                locale={locale}
                model={UPGRADE_MODEL}
                variant="secondary"
                force
              />
            </div>
          )}
        </div>
      )}

      {analysis && analysis.status === "ok" && (
        <div className="flex flex-col gap-6">
          {/* [PR-36] Above the analysis, not below it: the choice between
              reading and listening is made on arrival, and a play button found
              after scrolling past the whole summary is a play button found too
              late. Renders nothing when the analysis has no readable units. */}
          <ListenPlayer units={units} videoId={video.id} markedKeys={[...marked]} />

          <div className="flex flex-wrap items-start justify-end gap-3">
            {estimate && analysis.model !== UPGRADE_MODEL && (
              <AnalyzeButton
                videoId={video.id}
                labelKey="video.reanalyseUpgrade"
                estimate={estimate.upgrade}
                locale={locale}
                model={UPGRADE_MODEL}
                variant="secondary"
                force
              />
            )}
            <CopyAnalysisButton video={video} analysis={analysis} />
          </div>

          {/* [PR-34] The video's tags, each one a link into the shelf it shares
              with everything else carrying it. Placed above the summary because
              the useful move after reading one analysis is usually sideways —
              to the other four videos about the same thing. */}
          {(!!analysis.topics?.length || !!analysis.entities?.length || !!analysis.contentType) && (
            <div className="mb-6 flex flex-wrap items-center gap-2">
              {analysis.contentType && (
                <span className="rounded-full bg-[var(--color-surface-raised)] px-3 py-1 text-xs text-[var(--color-ink-muted)]">
                  {analysis.contentType}
                </span>
              )}
              {analysis.topics?.map((topic) => (
                <TagLink key={`t-${topic}`} kind="topic" name={topic} />
              ))}
              {analysis.entities?.map((entity) => (
                <TagLink key={`e-${entity}`} kind="entity" name={entity} />
              ))}
            </div>
          )}

          {analysis.summary && (
            <Section titleKey="section.summary" locale={locale} action={star("summary", 0)}>
              <p className="text-sm leading-relaxed text-[var(--color-ink)]">{analysis.summary}</p>
              {!!analysis.takeaways?.length && (
                <ul className="mt-3 space-y-1 text-sm text-[var(--color-ink-muted)]">
                  {analysis.takeaways.map((takeaway, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {star("takeaway", i) ?? <span className="w-6 shrink-0" />}
                      <div className="flex flex-col items-start gap-1">
                        <span>{takeaway}</span>
                        <SaveLessonButton videoId={video.id} text={takeaway} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {analysis.hookBreakdown && (
            <Section titleKey="section.hook" locale={locale} action={star("hook", 0)}>
              <dl className="grid grid-cols-1 gap-3 text-sm">
                <Field label={t("hook.technique")} value={analysis.hookBreakdown.technique} />
                <Field label={t("hook.first30s")} value={analysis.hookBreakdown.first_30s} />
                <Field label={t("hook.whyItWorks")} value={analysis.hookBreakdown.why_it_works} />
              </dl>
            </Section>
          )}

          {!!analysis.timeline?.length && (
            <Section titleKey="section.timeline" locale={locale}>
              <ol className="flex flex-col gap-3">
                {analysis.timeline.map((entry, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    {star("timeline", i) ?? <span className="w-6 shrink-0" />}
                    <span className="w-16 shrink-0 font-mono text-[var(--color-accent)]">
                      {entry.ts}
                    </span>
                    <span>
                      <span className="font-medium text-[var(--color-ink)]">{entry.topic}</span>
                      <span className="text-[var(--color-ink-muted)]"> — {entry.beat}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {!!analysis.gaps?.length && (
            <Section titleKey="section.gaps" locale={locale}>
              <ul className="flex flex-col gap-3">
                {analysis.gaps.map((g, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {star("gap", i) ?? <span className="w-6 shrink-0" />}
                    <div>
                      <p className="text-[var(--color-ink)]">{g.gap}</p>
                      <p className="text-[var(--color-ink-muted)]">
                        {t("gaps.counterAngle")}: {g.counter_angle}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!!analysis.ideas?.length && (
            <Section titleKey="section.ideas" locale={locale}>
              <ul className="flex flex-col gap-4">
                {analysis.ideas.map((idea, i) => {
                  const row = outlineByIdeaIndex.get(i);
                  return (
                    <li key={i} className="surface-border rounded-[var(--radius-sm)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-[var(--color-ink)]">{idea.title}</p>
                        {star("idea", i)}
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{idea.premise}</p>
                      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                        {t("ideas.whyNow")}: {idea.why_now}
                      </p>
                      <IdeaOutline
                        analysisId={analysis.id}
                        ideaIndex={i}
                        videoId={video.id}
                        outline={row?.status === "ok" ? row.content : null}
                        failure={
                          row?.status === "failed"
                            ? { error: row.error, rawResponse: row.rawResponse }
                            : null
                        }
                        canGenerate={canSpend}
                      />
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </div>
      )}
    </main>
  );
}

function Section({
  titleKey,
  locale,
  action,
  children,
}: {
  titleKey: TranslationKey;
  locale: Locale;
  /** [PR-37] The star, for the sections that are themselves one unit. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-border surface-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
          {translator(locale)(titleKey)}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="mt-0.5 text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

/**
 * [PR-34] A tag, linked to its shelf.
 *
 * The href is built from the display name through the same slugifier the write
 * path uses, rather than from a stored slug: the analysis payload holds names,
 * not slugs, and re-deriving guarantees the link and the row agree. If they
 * ever disagreed the link would 404, which is at least loud.
 */
function TagLink({ kind, name }: { kind: "topic" | "entity"; name: string }) {
  const slug = slugifyTag(name);
  if (!slug) return null;
  return (
    <Link
      href={`/youtube/topics/${kind}/${encodeURIComponent(slug)}`}
      className={
        "rounded-full border px-3 py-1 text-xs transition-colors " +
        "focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none " +
        (kind === "entity"
          ? "border-[var(--color-accent)]/40 text-[var(--color-accent)] hover:border-[var(--color-accent)]"
          : "border-[var(--color-line)] text-[var(--color-ink)] hover:border-[var(--color-accent)]")
      }
    >
      {name}
    </Link>
  );
}

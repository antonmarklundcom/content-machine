import type { HiggsfieldJob } from "@/db/schema";
import { targetHref } from "@/lib/higgsfield/config";
import { translator, type Locale } from "@/lib/i18n";

import { HiggsfieldAutoRefresh, HiggsfieldJobActions } from "./HiggsfieldJobActions";

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;

const STATUS_CLASS: Record<HiggsfieldJob["status"], string> = {
  queued: "text-[var(--color-ink-muted)]",
  running: "text-[var(--color-accent)]",
  done: "text-[var(--color-accent)]",
  failed: "text-[var(--color-danger)]",
  cancelled: "text-[var(--color-ink-muted)]",
};

/** An output path as the owner-only media file route (`/api/media/<path>`). */
export function mediaUrl(rel: string): string {
  return `/api/media/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function when(value: Date | null, locale: Locale): string {
  if (!value) return "—";
  return value.toLocaleString(locale === "sv" ? "sv-SE" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The runs list on /higgsfield (build 4 §3.H). Server-rendered; refreshes itself while a run is active. */
export function HiggsfieldJobs({ jobs, locale }: { jobs: HiggsfieldJob[]; locale: Locale }) {
  const t = translator(locale);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-[var(--color-ink)]">
        {t("higgsfield.jobs.title")}
      </h2>
      <HiggsfieldAutoRefresh active={active} />
      {active && (
        <p className="text-xs text-[var(--color-ink-muted)]">{t("higgsfield.jobs.live")}</p>
      )}
      {jobs.length === 0 ? (
        <p className="surface-border mt-3 rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
          {t("higgsfield.jobs.empty")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {jobs.map((job) => {
            const href = targetHref(job.kind, job.targetRef);
            const isActive = job.status === "queued" || job.status === "running";
            return (
              <li
                key={job.id}
                className="surface-border rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--color-ink)]">
                      #{job.id} · {t(`higgsfield.kind.${job.kind}`)}
                      {job.targetRef && (
                        <>
                          {" · "}
                          {href ? (
                            <a href={href} className="underline">
                              {job.targetRef}
                            </a>
                          ) : (
                            job.targetRef
                          )}
                        </>
                      )}
                      {job.brandId && (
                        <span className="text-[var(--color-ink-muted)]"> · {job.brandId}</span>
                      )}
                    </p>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-[var(--color-ink-muted)]">
                      <dt>{t("higgsfield.jobs.status")}</dt>
                      <dd className={`font-medium ${STATUS_CLASS[job.status]}`}>
                        {t(`higgsfield.status.${job.status}`)}
                      </dd>
                      <dt>{t("higgsfield.jobs.credits")}</dt>
                      <dd>
                        {job.creditsUsed ?? "?"} / {job.maxCredits}
                      </dd>
                      <dt>{t("higgsfield.jobs.started")}</dt>
                      <dd>{when(job.startedAt, locale)}</dd>
                      <dt>{t("higgsfield.jobs.finished")}</dt>
                      <dd>{when(job.finishedAt, locale)}</dd>
                      {job.externalJobIds.length > 0 && (
                        <>
                          <dt>{t("higgsfield.jobs.externalIds")}</dt>
                          <dd className="break-all">{job.externalJobIds.join(", ")}</dd>
                        </>
                      )}
                    </dl>
                    {job.error && (
                      <p className="mt-1 text-xs text-[var(--color-danger)]">{job.error}</p>
                    )}
                  </div>
                  <HiggsfieldJobActions id={job.id} active={isActive} />
                </div>

                {job.outputPaths.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {job.outputPaths.map((p) => (
                      <li key={p} className="w-28">
                        <a href={mediaUrl(p)} title={p} className="block">
                          {IMAGE.test(p) ? (
                            // eslint-disable-next-line @next/next/no-img-element -- owner-only route, not optimisable
                            <img
                              src={mediaUrl(p)}
                              alt={p}
                              loading="lazy"
                              className="surface-border h-28 w-28 rounded-[var(--radius-sm)] object-cover"
                            />
                          ) : VIDEO.test(p) ? (
                            <video
                              src={mediaUrl(p)}
                              preload="metadata"
                              muted
                              className="surface-border h-28 w-28 rounded-[var(--radius-sm)] object-cover"
                            />
                          ) : null}
                          <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                            {p.split("/").pop()}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  job.status !== "queued" &&
                  job.status !== "running" && (
                    <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                      {t("higgsfield.jobs.noOutputs")}
                    </p>
                  )
                )}

                {job.log && (
                  <details className="mt-3" open={isActive}>
                    <summary className="cursor-pointer text-xs text-[var(--color-ink-muted)]">
                      {t("higgsfield.jobs.log")}
                    </summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2 text-xs whitespace-pre-wrap text-[var(--color-ink)]">
                      {job.log.slice(-4000)}
                    </pre>
                  </details>
                )}
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-[var(--color-ink-muted)]">
                    {t("higgsfield.jobs.prompt")}
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2 text-xs whitespace-pre-wrap text-[var(--color-ink)]">
                    {job.prompt}
                  </pre>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import type { StoryScene, VoiceProfile } from "@/db/schema";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import {
  approveTextAction,
  buildSceneAudioAction,
  narrateSceneAction,
  reviewTakeAction,
  revokeApprovalAction,
  selectTakeAction,
} from "@/lib/stories.actions";
import type { TakeRow } from "@/lib/stories/data";
import { readSceneMeta } from "@/lib/stories/meta";
import { sceneAudioFresh, sceneReadiness } from "@/lib/stories/readiness";
import { canApproveInApp, IN_APP_APPROVED, normalizeStatus, ttsAllowed } from "@/lib/stories/rules";
import { StoryActionButton } from "./StoryActionButton";
import { STORY_FIELD, StoryActionForm } from "./StoryActionForm";
import { StoryUploadForm } from "./StoryUploadForm";

const BADGE = "rounded-full px-2 py-0.5 text-[11px] font-medium";

function statusBadge(status: string | null, ok: boolean): string {
  if (ok) return `${BADGE} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
  if (!status) return `${BADGE} surface-border text-[var(--color-ink-muted)]`;
  return `${BADGE} border border-[var(--color-danger)] text-[var(--color-danger)]`;
}

const PROBLEM_KEYS: Record<string, TranslationKey> = {
  no_take: "stories.take.problem.noTake",
  text_changed: "stories.take.problem.textChanged",
  rejected: "stories.take.problem.rejected",
  not_done: "stories.take.problem.notDone",
};

function seconds(ms: number | null | undefined): string {
  return ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * One scene in one language (build 4 §3.C.8): art, text + status, lines, the
 * take history per line with select/approve/reject, Narrate and Upload, and
 * the joined scene audio. Owner controls only for the owner.
 */
export function StorySceneCard({
  slug,
  scene,
  lang,
  takes,
  profiles,
  narrators,
  canEdit,
  locale,
}: {
  slug: string;
  scene: StoryScene;
  lang: string;
  takes: TakeRow[];
  profiles: VoiceProfile[];
  narrators: VoiceProfile[];
  canEdit: boolean;
  locale: Locale;
}) {
  const t = translator(locale);
  const readiness = sceneReadiness(scene, lang, takes);
  const meta = readSceneMeta(scene.notes);
  const approval = meta.approvals?.[lang];
  const audio = meta.audio?.[lang];
  const audioFresh = sceneAudioFresh(audio, readiness);
  const status = normalizeStatus(scene.textStatus[lang]);
  const text = scene.text[lang];
  const approvable = canApproveInApp(scene, lang);
  const speakers = [
    ...new Set(readiness.lines.map((l) => l.line.speaker).filter((s): s is string => !!s)),
  ];
  const multi = readiness.lines.length > 1;

  return (
    <li
      className="surface-border surface-card flex flex-col gap-3 p-4"
      id={`scene-${scene.sceneRef}`}
    >
      <div className="flex gap-4">
        <div className="w-36 shrink-0">
          {scene.artPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- owner-only route, not a static asset
            <img
              src={`/api/stories/art/${encodeURIComponent(slug)}/${encodeURIComponent(scene.sceneRef)}?size=thumb`}
              alt={scene.alt ?? ""}
              loading="lazy"
              className="w-full rounded-[var(--radius-sm)] object-contain"
            />
          ) : (
            <p className="text-xs text-[var(--color-ink-muted)]">{t("stories.scene.noArt")}</p>
          )}
          {scene.artWidth && scene.artHeight && (
            <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
              {scene.artWidth}×{scene.artHeight}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">{scene.sceneRef}</h3>
            {scene.kind !== "page" && (
              <span className="text-xs text-[var(--color-ink-muted)]">{scene.kind}</span>
            )}
            <span className={statusBadge(status, readiness.text.ok)}>
              {status ?? t("stories.status.none")}
            </span>
            {approval && (
              <span className="text-[11px] text-[var(--color-ink-muted)]">
                {t("stories.approve.by", { by: approval.by, at: approval.at.slice(0, 10) })}
              </span>
            )}
          </div>
          {typeof text === "string" ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-ink)]">
              {text}
            </p>
          ) : (
            <p className="text-sm text-[var(--color-danger)]">
              {t("stories.scene.noText", { lang })}
            </p>
          )}
          {!readiness.text.ok && (
            <p className="text-xs text-[var(--color-danger)]">{readiness.text.message}</p>
          )}
          {canEdit && approvable.ok && !readiness.text.ok && (
            <div>
              <StoryActionButton
                action={approveTextAction.bind(null, slug, scene.sceneRef, lang)}
                label="stories.approve.button"
                tone="primary"
                locale={locale}
              />
            </div>
          )}
          {canEdit && status === IN_APP_APPROVED && (
            <div>
              <StoryActionButton
                action={revokeApprovalAction.bind(null, slug, scene.sceneRef, lang)}
                label="stories.approve.revoke"
                locale={locale}
              />
            </div>
          )}
        </div>
      </div>

      {readiness.lines.length > 0 && (
        <div className="flex flex-col gap-2">
          {readiness.lines.map((l) => (
            <div key={l.slot} className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2">
              {multi && (
                <p className="text-xs text-[var(--color-ink)]">
                  <span className="font-medium">
                    {l.slot} · {l.line.speaker ?? t("stories.narrator")}:
                  </span>{" "}
                  {l.line.text}
                </p>
              )}
              <p className="text-[11px] text-[var(--color-ink-muted)]">
                {l.usable
                  ? t("stories.take.ready")
                  : t(PROBLEM_KEYS[l.problem] ?? "stories.take.problem.noTake")}
              </p>
              {l.takes.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {l.takes.slice(0, 8).map((take) => {
                    const assetId = take.playbackAssetId ?? take.masterAssetId;
                    return (
                      <li key={take.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={
                            take.selected ? "font-semibold text-[var(--color-accent)]" : ""
                          }
                        >
                          #{take.id}
                          {take.selected ? ` ✓ ${t("stories.take.selectedMark")}` : ""}
                        </span>
                        <span className="text-[var(--color-ink-muted)]">
                          {take.profileName ?? take.provider} · {seconds(take.durationMs)} ·{" "}
                          {take.reviewStatus}
                          {take.status !== "done" ? ` · ${take.status}` : ""}
                          {take.inputText !== l.line.text ? ` · ${t("stories.take.oldText")}` : ""}
                        </span>
                        {assetId && take.status === "done" && (
                          <audio
                            controls
                            preload="none"
                            src={`/api/media/asset/${assetId}`}
                            className="h-7"
                          />
                        )}
                        {canEdit && take.status === "done" && (
                          <>
                            {!take.selected && (
                              <StoryActionButton
                                action={selectTakeAction.bind(null, slug, take.id)}
                                label="stories.take.select"
                                locale={locale}
                              />
                            )}
                            {take.reviewStatus !== "approved" && (
                              <StoryActionButton
                                action={reviewTakeAction.bind(null, slug, take.id, "approved")}
                                label="stories.take.approve"
                                locale={locale}
                              />
                            )}
                            {take.reviewStatus !== "rejected" && (
                              <StoryActionButton
                                action={reviewTakeAction.bind(null, slug, take.id, "rejected")}
                                label="stories.take.reject"
                                tone="danger"
                                locale={locale}
                              />
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        <span className="font-medium">{t("stories.audio.label")}</span>
        {audioFresh && audio ? (
          <>
            <span>{seconds(audio.durationMs)}</span>
            <audio
              controls
              preload="none"
              src={`/api/stories/audio/${encodeURIComponent(slug)}/${encodeURIComponent(scene.sceneRef)}/${encodeURIComponent(lang)}`}
              className="h-7"
            />
          </>
        ) : (
          <span>{audio ? t("stories.audio.stale") : t("stories.audio.none")}</span>
        )}
        {canEdit && readiness.takesReady && !audioFresh && (
          <StoryActionButton
            action={buildSceneAudioAction.bind(null, slug, scene.sceneRef, lang)}
            label="stories.audio.build"
            locale={locale}
          />
        )}
      </div>

      {canEdit && readiness.text.ok && (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] pt-3">
          {ttsAllowed(lang) ? (
            <StoryActionForm
              action={narrateSceneAction.bind(null, slug, scene.sceneRef, lang)}
              submit="stories.narrate.submit"
              pending="stories.narrate.running"
              locale={locale}
            >
              <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
                {t("stories.narrator")}
                <select
                  name="narrator"
                  className={STORY_FIELD}
                  defaultValue={narrators[0]?.id ?? ""}
                >
                  {narrators.length === 0 && (
                    <option value="">{t("stories.narrate.noNarrator")}</option>
                  )}
                  {narrators.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {speakers.map((sp) => {
                const own = profiles.find(
                  (p) => (p.characterKey ?? "").toLowerCase() === sp.toLowerCase(),
                );
                return (
                  <label
                    key={sp}
                    className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]"
                  >
                    {sp}
                    <select
                      name={`speaker:${sp}`}
                      className={STORY_FIELD}
                      defaultValue={own?.id ?? ""}
                    >
                      <option value="">{t("stories.narrate.useNarrator")}</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.characterKey ? ` (${p.characterKey})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              <label className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
                <input type="checkbox" name="all" value="1" />
                {t("stories.narrate.all")}
              </label>
            </StoryActionForm>
          ) : (
            <p className="text-xs text-[var(--color-ink-muted)]">{t("stories.narrate.gnUpload")}</p>
          )}
          <StoryUploadForm
            slug={slug}
            sceneRef={scene.sceneRef}
            lang={lang}
            slots={readiness.lines.map((l) => ({
              slot: l.slot,
              label: `${l.slot} · ${l.line.speaker ?? t("stories.narrator")}`,
            }))}
            profiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
            locale={locale}
          />
        </div>
      )}
    </li>
  );
}

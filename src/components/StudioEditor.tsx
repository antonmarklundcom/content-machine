"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { draftKey } from "@/lib/draft-recovery";
import { DraftRecoveryNotice, useDraftRecovery } from "./useDraftRecovery";
import { errorsUnder, flaggedSourceIds, normalizeBody, sectionVerifyIds } from "@/app/studio/model";
import { useTranslator } from "@/lib/i18n/client";
import {
  ASPECT_RATIOS,
  SCRIPT_LANGUAGES,
  validateScriptBody,
  type AspectRatio,
  type BrollShot,
  type ScriptBodyV1,
  type ScriptLanguage,
} from "@/lib/scripts/contract";
import { saveScript } from "@/lib/studio.actions";
import {
  STUDIO_BUTTON,
  STUDIO_INPUT,
  STUDIO_LABEL,
  STUDIO_PRIMARY,
  STUDIO_VERIFY_BADGE,
} from "./StudioStyles";

const CARD = "surface-border surface-card flex flex-col gap-4 px-5 py-5";
const REMOVE = "text-xs text-[var(--color-danger)] hover:underline";

function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul role="alert" className="flex flex-col gap-1 text-xs text-[var(--color-danger)]">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

function Text({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className={STUDIO_LABEL}>{label}</span>
      {multiline ? (
        <textarea
          rows={2}
          className={STUDIO_INPUT}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input className={STUDIO_INPUT} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/** One line per row — a teleprompter line, a talking point, a caption. */
function Lines({
  label,
  help,
  value,
  onChange,
  large,
}: {
  label: string;
  help?: string;
  value: string[];
  onChange: (value: string[]) => void;
  large?: boolean;
}) {
  return (
    <label className="block">
      <span className={STUDIO_LABEL}>{label}</span>
      {help && <span className="mb-1 block text-xs text-[var(--color-ink-muted)]">{help}</span>}
      <textarea
        rows={Math.max(large ? 4 : 2, value.length + 1)}
        className={`${STUDIO_INPUT} ${large ? "text-base leading-relaxed" : ""}`}
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
      />
    </label>
  );
}

function newShot(spokenLine = ""): BrollShot {
  return { spokenLine, description: "", imagePrompt: "", videoPrompt: null, aspectRatio: "16:9" };
}

function Shots({
  shots,
  onChange,
  errors,
  prefix,
}: {
  shots: BrollShot[];
  onChange: (shots: BrollShot[]) => void;
  errors: string[];
  prefix: string;
}) {
  const t = useTranslator();
  const set = (i: number, patch: Partial<BrollShot>) =>
    onChange(shots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="flex flex-col gap-3">
      <span className={STUDIO_LABEL}>{t("studio.editor.shots", { n: shots.length })}</span>
      {shots.map((shot, i) => (
        <div key={i} className="surface-border flex flex-col gap-3 rounded-[var(--radius-sm)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--color-ink-muted)]">
              {t("studio.editor.shot", { n: i + 1 })}
            </span>
            <button
              type="button"
              className={REMOVE}
              onClick={() => onChange(shots.filter((_, j) => j !== i))}
            >
              {t("studio.editor.remove")}
            </button>
          </div>
          <Text
            label={t("studio.editor.shotLine")}
            value={shot.spokenLine}
            onChange={(v) => set(i, { spokenLine: v })}
          />
          <Text
            label={t("studio.editor.shotDescription")}
            value={shot.description}
            onChange={(v) => set(i, { description: v })}
          />
          <Text
            multiline
            label={t("studio.editor.imagePrompt")}
            value={shot.imagePrompt}
            onChange={(v) => set(i, { imagePrompt: v })}
          />
          <Text
            multiline
            label={t("studio.editor.videoPrompt")}
            value={shot.videoPrompt ?? ""}
            onChange={(v) => set(i, { videoPrompt: v })}
          />
          <label className="block max-w-40">
            <span className={STUDIO_LABEL}>{t("studio.editor.aspect")}</span>
            <select
              className={STUDIO_INPUT}
              value={shot.aspectRatio}
              onChange={(e) => set(i, { aspectRatio: e.target.value as AspectRatio })}
            >
              {ASPECT_RATIOS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <Errors errors={errorsUnder(errors, `${prefix}[${i}]`)} />
        </div>
      ))}
      <button
        type="button"
        className={`${STUDIO_BUTTON} self-start`}
        onClick={() => onChange([...shots, newShot()])}
      >
        {t("studio.editor.addShot")}
      </button>
    </div>
  );
}

/**
 * The section editor (PLAN.md §6.S12.2). Edits a copy of the body; "Save"
 * tidies it (`normalizeBody`), runs O8's `validateScriptBody` here for instant
 * feedback, and the server action runs it again before the bridge write. An
 * invalid body is never saved — each error is shown beside the part it names.
 */
export function StudioEditor({
  scriptId,
  initialBody,
  userId,
  brandId,
  revision = "",
}: {
  scriptId: number;
  initialBody: ScriptBodyV1;
  userId?: number;
  brandId?: string;
  revision?: string;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [body, setBody] = useState<ScriptBodyV1>(initialBody);
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recovery = useDraftRecovery({
    storageKey: userId != null && brandId ? draftKey(userId, brandId, "script", scriptId) : null,
    revision,
    initial: initialBody,
    value: body,
    dirty,
    validate: (value): value is ScriptBodyV1 =>
      !!value &&
      typeof value === "object" &&
      Array.isArray((value as ScriptBodyV1).sections) &&
      !!(value as ScriptBodyV1).hook,
    restore: (value, changed) => {
      setBody(value);
      setDirty(changed);
      setSaved(false);
    },
  });

  function update(change: (draft: ScriptBodyV1) => void) {
    setBody((prev) => {
      const next = structuredClone(prev);
      change(next);
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function save() {
    if (recovery.conflict) return;
    const clean = normalizeBody(body);
    const verdict = validateScriptBody(clean);
    setFailure(null);
    if (!verdict.ok) {
      setErrors(verdict.errors);
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveScript(scriptId, clean, initialBody);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        setErrors([]);
        const cleared = recovery.saved(body);
        if (cleared) setBody(clean);
        setDirty(!cleared);
        setSaved(cleared);
        router.refresh();
      } catch (error) {
        setFailure(error instanceof Error ? error.message : t("studio.error.generic"));
      }
    });
  }

  const flagged = flaggedSourceIds(body);
  const sourceIds = body.sources.map((s) => s.id);

  return (
    <div className="flex flex-col gap-6">
      <DraftRecoveryNotice recovery={recovery} />
      <div className="surface-border surface-card sticky top-16 z-[5] flex flex-wrap items-center gap-3 px-5 py-3">
        <button
          type="button"
          className={STUDIO_PRIMARY}
          disabled={pending || recovery.conflict}
          onClick={save}
        >
          {pending ? t("studio.editor.saving") : t("studio.editor.save")}
        </button>
        <span className="text-xs text-[var(--color-ink-muted)]">
          {errors.length
            ? t("studio.editor.invalid", { n: errors.length })
            : dirty
              ? t("studio.editor.unsaved")
              : saved
                ? t("studio.editor.saved")
                : t("studio.editor.savedCopyNote")}
        </span>
        {failure && <span className="text-xs text-[var(--color-danger)]">{failure}</span>}
      </div>
      {errors.length > 0 && (
        <details open className="surface-border rounded-[var(--radius-sm)] px-4 py-3">
          <summary className="cursor-pointer text-sm text-[var(--color-danger)]">
            {t("studio.editor.invalid", { n: errors.length })}
          </summary>
          <div className="mt-2">
            <Errors errors={errors} />
          </div>
        </details>
      )}

      <section className={CARD}>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("studio.editor.basics")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem_8rem]">
          <label className="block">
            <span className={STUDIO_LABEL}>{t("studio.editor.chosenTitle")}</span>
            <input
              list="studio-title-options"
              className={STUDIO_INPUT}
              value={body.chosenTitle}
              onChange={(e) => update((d) => void (d.chosenTitle = e.target.value))}
            />
            <datalist id="studio-title-options">
              {body.titleOptions.map((o, i) => (
                <option key={i} value={o.title} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className={STUDIO_LABEL}>{t("studio.brief.language")}</span>
            <select
              className={STUDIO_INPUT}
              value={body.language}
              onChange={(e) => update((d) => void (d.language = e.target.value as ScriptLanguage))}
            >
              {SCRIPT_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={STUDIO_LABEL}>{t("studio.brief.minutes")}</span>
            <input
              type="number"
              min={1}
              max={60}
              className={STUDIO_INPUT}
              value={body.targetMinutes}
              onChange={(e) => update((d) => void (d.targetMinutes = Number(e.target.value)))}
            />
          </label>
        </div>
        <Text
          label={t("studio.editor.topic")}
          value={body.topic}
          onChange={(v) => update((d) => void (d.topic = v))}
        />
        <Errors
          errors={[
            "body.chosenTitle",
            "body.topic",
            "body.language",
            "body.targetMinutes",
            "body.version",
          ].flatMap((p) => errorsUnder(errors, p))}
        />
      </section>

      <section className={CARD}>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("studio.editor.titleOptions")}
        </h2>
        {body.titleOptions.map((o, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-2">
            <Text
              label={`${t("studio.editor.title")} ${i + 1}`}
              value={o.title}
              onChange={(v) => update((d) => void (d.titleOptions[i]!.title = v))}
            />
            <Text
              label={t("studio.editor.angle")}
              value={o.angle}
              onChange={(v) => update((d) => void (d.titleOptions[i]!.angle = v))}
            />
          </div>
        ))}
        <Errors errors={errorsUnder(errors, "body.titleOptions")} />
      </section>

      <section className={CARD}>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("studio.editor.thumbnails")}
        </h2>
        {body.thumbnailConcepts.map((c, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 border-b border-[var(--color-border-subtle)] pb-4 last:border-0 last:pb-0"
          >
            <Text
              label={`${t("studio.editor.thumbnail")} ${i + 1}`}
              value={c.description}
              onChange={(v) => update((d) => void (d.thumbnailConcepts[i]!.description = v))}
            />
            <Text
              label={t("studio.editor.textOverlay")}
              value={c.textOverlay}
              onChange={(v) => update((d) => void (d.thumbnailConcepts[i]!.textOverlay = v))}
            />
            <Text
              multiline
              label={t("studio.editor.imagePrompt")}
              value={c.imagePrompt}
              onChange={(v) => update((d) => void (d.thumbnailConcepts[i]!.imagePrompt = v))}
            />
          </div>
        ))}
        <Errors errors={errorsUnder(errors, "body.thumbnailConcepts")} />
      </section>

      <section className={CARD}>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("studio.editor.hook")}</h2>
        <Lines
          large
          label={t("studio.editor.spokenLines")}
          help={t("studio.editor.spokenHelp")}
          value={body.hook.spokenLines}
          onChange={(v) => update((d) => void (d.hook.spokenLines = v))}
        />
        <Lines
          label={t("studio.editor.onScreen")}
          value={body.hook.onScreenText}
          onChange={(v) => update((d) => void (d.hook.onScreenText = v))}
        />
        <Shots
          prefix="body.hook.broll"
          errors={errors}
          shots={body.hook.broll}
          onChange={(v) => update((d) => void (d.hook.broll = v))}
        />
        <Errors
          errors={["body.hook.spokenLines", "body.hook.onScreenText"]
            .flatMap((p) => errorsUnder(errors, p))
            .concat(errors.filter((e) => e.startsWith("body.hook ")))}
        />
      </section>

      {body.sections.map((section, i) => {
        const verify = sectionVerifyIds(section, flagged);
        const prefix = `body.sections[${i}]`;
        return (
          <section key={i} className={CARD} aria-label={section.heading}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--color-ink)]">
                {t("studio.editor.section", { n: i + 1 })}
              </h2>
              <div className="flex items-center gap-3">
                {verify.length > 0 && (
                  <span className={STUDIO_VERIFY_BADGE} data-verify-badge>
                    ⚠ {t("studio.verifyBadge")} · {verify.join(", ")}
                  </span>
                )}
                <button
                  type="button"
                  className={STUDIO_BUTTON}
                  disabled={i === 0}
                  onClick={() =>
                    update((d) => void d.sections.splice(i - 1, 0, ...d.sections.splice(i, 1)))
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={STUDIO_BUTTON}
                  disabled={i === body.sections.length - 1}
                  onClick={() =>
                    update((d) => void d.sections.splice(i + 1, 0, ...d.sections.splice(i, 1)))
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={REMOVE}
                  onClick={() => update((d) => void d.sections.splice(i, 1))}
                >
                  {t("studio.editor.remove")}
                </button>
              </div>
            </div>
            <Text
              label={t("studio.editor.heading")}
              value={section.heading}
              onChange={(v) => update((d) => void (d.sections[i]!.heading = v))}
            />
            <Lines
              large
              label={t("studio.editor.spokenLines")}
              help={t("studio.editor.spokenHelp")}
              value={section.spokenLines}
              onChange={(v) => update((d) => void (d.sections[i]!.spokenLines = v))}
            />
            <Lines
              label={t("studio.editor.talkingPoints")}
              value={section.talkingPoints}
              onChange={(v) => update((d) => void (d.sections[i]!.talkingPoints = v))}
            />
            <Lines
              label={t("studio.editor.onScreen")}
              value={section.onScreenText}
              onChange={(v) => update((d) => void (d.sections[i]!.onScreenText = v))}
            />
            {sourceIds.length > 0 && (
              <fieldset>
                <legend className={STUDIO_LABEL}>{t("studio.editor.sectionSources")}</legend>
                <div className="flex flex-wrap gap-3">
                  {sourceIds.map((id) => (
                    <label
                      key={id}
                      className="flex items-center gap-1 text-sm text-[var(--color-ink)]"
                    >
                      <input
                        type="checkbox"
                        checked={section.sourceIds.includes(id)}
                        onChange={() =>
                          update((d) => {
                            const s = d.sections[i]!;
                            s.sourceIds = s.sourceIds.includes(id)
                              ? s.sourceIds.filter((x) => x !== id)
                              : [...s.sourceIds, id];
                          })
                        }
                      />
                      {id}
                      {flagged.has(id) && <span className="text-[var(--color-warn)]">⚠</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <Shots
              prefix={`${prefix}.broll`}
              errors={errors}
              shots={section.broll}
              onChange={(v) => update((d) => void (d.sections[i]!.broll = v))}
            />
            <Errors
              errors={errorsUnder(errors, prefix).filter((e) => !e.startsWith(`${prefix}.broll[`))}
            />
          </section>
        );
      })}
      <button
        type="button"
        className={`${STUDIO_BUTTON} self-start`}
        onClick={() =>
          update(
            (d) =>
              void d.sections.push({
                heading: "",
                spokenLines: [""],
                talkingPoints: [],
                onScreenText: [],
                broll: [],
                sourceIds: [],
              }),
          )
        }
      >
        {t("studio.editor.addSection")}
      </button>
      <Errors errors={errors.filter((e) => e.startsWith("body.sections "))} />

      <section className={CARD}>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("studio.editor.cta")}</h2>
        <Lines
          large
          label={t("studio.editor.spokenLines")}
          value={body.cta.spokenLines}
          onChange={(v) => update((d) => void (d.cta.spokenLines = v))}
        />
        <Lines
          label={t("studio.editor.onScreen")}
          value={body.cta.onScreenText}
          onChange={(v) => update((d) => void (d.cta.onScreenText = v))}
        />
        <Errors errors={errorsUnder(errors, "body.cta")} />
      </section>

      <section className={CARD}>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("studio.editor.sources", { n: body.sources.length })}
        </h2>
        {body.sources.length === 0 && (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("studio.editor.noSources")}</p>
        )}
        {body.sources.map((s, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 border-b border-[var(--color-border-subtle)] pb-4 last:border-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-[var(--color-ink)]">
                {s.id}
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-xs text-[var(--color-accent)] hover:underline"
                  >
                    {t("studio.editor.openSource")} ↗
                  </a>
                )}
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-[var(--color-warn)]">
                  <input
                    type="checkbox"
                    checked={s.verifyBeforeRecording}
                    onChange={(e) =>
                      update((d) => void (d.sources[i]!.verifyBeforeRecording = e.target.checked))
                    }
                  />
                  {t("studio.verifyBadge")}
                </label>
                <button
                  type="button"
                  className={REMOVE}
                  onClick={() => update((d) => void d.sources.splice(i, 1))}
                >
                  {t("studio.editor.remove")}
                </button>
              </div>
            </div>
            <Text
              multiline
              label={t("studio.editor.claim")}
              value={s.claim}
              onChange={(v) => update((d) => void (d.sources[i]!.claim = v))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Text
                label="URL"
                value={s.url}
                onChange={(v) => update((d) => void (d.sources[i]!.url = v))}
              />
              <Text
                label={t("studio.editor.sourceTitle")}
                value={s.title}
                onChange={(v) => update((d) => void (d.sources[i]!.title = v))}
              />
            </div>
            <Errors errors={errorsUnder(errors, `body.sources[${i}]`)} />
          </div>
        ))}
        <button
          type="button"
          className={`${STUDIO_BUTTON} self-start`}
          onClick={() =>
            update((d) => {
              let n = d.sources.length + 1;
              while (d.sources.some((s) => s.id === `s${n}`)) n++;
              d.sources.push({
                id: `s${n}`,
                claim: "",
                url: "",
                title: "",
                verifyBeforeRecording: true,
              });
            })
          }
        >
          {t("studio.editor.addSource")}
        </button>
      </section>
    </div>
  );
}

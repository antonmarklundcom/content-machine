"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslator } from "@/lib/i18n/client";
import { generatePack, savePublishPack } from "@/lib/publish.actions";
import type { PublishPack } from "@/lib/studio/types";
import { PublishCopyButton } from "./PublishCopyButton";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL, STUDIO_PRIMARY } from "./StudioStyles";

type Draft = {
  description: string;
  chapters: string;
  tags: string;
  pinnedComment: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  generatedAt: string;
};

function toDraft(pack: PublishPack): Draft {
  return {
    description: pack.description,
    chapters: pack.chapters.map((c) => `${c.time} ${c.title}`).join("\n"),
    tags: pack.tags.join(", "),
    pinnedComment: pack.pinnedComment,
    instagram: pack.captions.instagram,
    facebook: pack.captions.facebook,
    tiktok: pack.captions.tiktok,
    generatedAt: pack.generatedAt,
  };
}

/** "1:02 Title" lines → chapters; a line without a leading time keeps an empty one, which the server refuses. */
function fromDraft(d: Draft): PublishPack {
  const chapters = d.chapters
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(\S+)\s+(.*)$/.exec(l);
      return m ? { time: m[1]!, title: m[2]!.trim() } : { time: l, title: "" };
    });
  return {
    description: d.description,
    chapters,
    tags: d.tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    pinnedComment: d.pinnedComment,
    captions: { instagram: d.instagram, facebook: d.facebook, tiktok: d.tiktok },
    generatedAt: d.generatedAt,
  };
}

function withChapters(d: Draft): string {
  return [d.description.trim(), d.chapters.trim()].filter(Boolean).join("\n\n");
}

const FIELDS: {
  key: Exclude<keyof Draft, "generatedAt">;
  label: TranslationKey;
  rows: number;
  help?: TranslationKey;
}[] = [
  { key: "description", label: "publish.pack.description", rows: 10 },
  { key: "chapters", label: "publish.pack.chapters", rows: 6, help: "publish.pack.chaptersHelp" },
  { key: "tags", label: "publish.pack.tags", rows: 3, help: "publish.pack.tagsHelp" },
  { key: "pinnedComment", label: "publish.pack.pinned", rows: 3 },
  { key: "instagram", label: "publish.pack.instagram", rows: 5 },
  { key: "facebook", label: "publish.pack.facebook", rows: 4 },
  { key: "tiktok", label: "publish.pack.tiktok", rows: 3 },
];

/** Generate, edit, save and copy the post-recording pack (idea 6). */
export function PublishPackEditor({
  scriptId,
  initialPack,
  canGenerate,
}: {
  scriptId: number;
  initialPack: PublishPack | null;
  canGenerate: boolean;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(initialPack ? toDraft(initialPack) : null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);

  function generate() {
    if (draft && !window.confirm(t("publish.pack.regenerateConfirm"))) return;
    setBusy("generate");
    startTransition(async () => {
      setNote(null);
      try {
        const result = await generatePack(scriptId);
        if (result.ok) {
          setDraft(toDraft(result.pack));
          setNote({ ok: true, text: t("publish.cost", { cost: result.costUsd.toFixed(4) }) });
          router.refresh();
        } else setNote({ ok: false, text: result.error, errors: result.errors });
      } catch (error) {
        setNote({
          ok: false,
          text: error instanceof Error ? error.message : t("studio.error.generic"),
        });
      } finally {
        setBusy(null);
      }
    });
  }

  function save() {
    if (!draft) return;
    setBusy("save");
    startTransition(async () => {
      setNote(null);
      try {
        const result = await savePublishPack(scriptId, fromDraft(draft));
        if (result.ok) {
          setDraft(toDraft(result.pack));
          setNote({ ok: true, text: t("publish.pack.saved") });
        } else setNote({ ok: false, text: result.error, errors: result.errors });
      } catch {
        setNote({ ok: false, text: t("studio.error.generic") });
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {canGenerate ? (
          <button type="button" className={STUDIO_PRIMARY} disabled={pending} onClick={generate}>
            {t(draft ? "publish.pack.regenerate" : "publish.pack.generate")}
          </button>
        ) : (
          <p className="text-xs text-[var(--color-ink-muted)]">{t("publish.ownerOnly")}</p>
        )}
        {busy === "generate" && (
          <span className="text-xs text-[var(--color-ink-muted)]">{t("publish.generating")}</span>
        )}
        {draft?.generatedAt && (
          <span className="text-xs text-[var(--color-ink-muted)]">
            {t("publish.pack.generatedAt", { date: new Date(draft.generatedAt).toLocaleString() })}
          </span>
        )}
      </div>

      {note && (
        <div
          role="status"
          className={`text-sm ${note.ok ? "text-[var(--color-ink-muted)]" : "text-[var(--color-danger)]"}`}
        >
          {note.text}
          {note.errors && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {note.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!draft ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("publish.pack.empty")}</p>
      ) : (
        <>
          {FIELDS.map(({ key, label, rows, help }) => (
            <div key={key} className="surface-border surface-card flex flex-col gap-2 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`pack-${key}`} className={STUDIO_LABEL}>
                  {t(label)}
                </label>
                <div className="flex gap-2">
                  {key === "description" && (
                    <PublishCopyButton
                      text={withChapters(draft)}
                      label={t("publish.pack.descriptionCopy")}
                    />
                  )}
                  <PublishCopyButton text={draft[key]} />
                </div>
              </div>
              <textarea
                id={`pack-${key}`}
                rows={rows}
                className={STUDIO_INPUT}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
              {help && <p className="text-xs text-[var(--color-ink-muted)]">{t(help)}</p>}
            </div>
          ))}
          <button
            type="button"
            className={`${STUDIO_BUTTON} self-start`}
            disabled={pending}
            onClick={save}
          >
            {busy === "save" ? "…" : t("publish.pack.save")}
          </button>
        </>
      )}
    </div>
  );
}

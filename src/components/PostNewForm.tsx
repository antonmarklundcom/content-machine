"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { POST_FORMATS, type PostFormat } from "@/db/schema";
import { FORMAT_LABEL } from "@/app/posts/model";
import { useTranslator } from "@/lib/i18n/client";
import { createPostAction } from "@/lib/posts.actions";
import { STUDIO_INPUT, STUDIO_LABEL, STUDIO_PRIMARY } from "./StudioStyles";

export type NewPostIdea = { id: number; brandId: string; title: string; format: PostFormat | null };

/** The `/posts/new` form (PLAN.md §6.S15): account, idea-or-topic, format, then the paid draft. */
export function PostNewForm({
  accounts,
  ideas,
  initialAccountId,
  initialIdeaId,
  initialTopic,
  canDraft,
}: {
  accounts: { id: number; label: string; brandId: string }[];
  ideas: NewPostIdea[];
  initialAccountId: number;
  initialIdeaId: number | null;
  initialTopic: string;
  canDraft: boolean;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [accountId, setAccountId] = useState(initialAccountId);
  const [source, setSource] = useState<"idea" | "topic">(
    initialIdeaId || !initialTopic ? "idea" : "topic",
  );
  const [ideaId, setIdeaId] = useState<number | null>(initialIdeaId);
  const [topic, setTopic] = useState(initialTopic);
  const [format, setFormat] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const brandId = accounts.find((a) => a.id === accountId)?.brandId;
  const brandIdeas = ideas.filter((i) => i.brandId === brandId);
  const chosenIdea = brandIdeas.find((i) => i.id === ideaId) ?? null;
  const useTopic = source === "topic" || brandIdeas.length === 0;
  const ready = useTopic ? topic.trim().length > 0 : chosenIdea !== null;

  return (
    <form
      className="mt-6 flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || !canDraft) return;
        startTransition(async () => {
          setError(null);
          const result = await createPostAction({
            accountId,
            ideaId: useTopic ? null : chosenIdea!.id,
            topic: useTopic ? topic : null,
            format: format || null,
            title: title || null,
          });
          if (result.ok) router.push(`/posts/${result.id}`);
          else setError([result.error, ...(result.errors ?? [])].join(" · "));
        });
      }}
    >
      <label>
        <span className={STUDIO_LABEL}>{t("posts.field.account")}</span>
        <select
          className={STUDIO_INPUT}
          value={accountId}
          onChange={(e) => {
            setAccountId(Number(e.target.value));
            setIdeaId(null);
          }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className={STUDIO_LABEL}>{t("posts.field.source")}</legend>
        <div className="flex gap-4 text-sm text-[var(--color-ink)]">
          {(["idea", "topic"] as const).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input
                type="radio"
                name="source"
                checked={(s === "topic") === useTopic}
                disabled={s === "idea" && brandIdeas.length === 0}
                onChange={() => setSource(s)}
              />
              {t(s === "idea" ? "posts.source.idea" : "posts.source.topic")}
            </label>
          ))}
        </div>
      </fieldset>

      {useTopic ? (
        <label>
          <span className={STUDIO_LABEL}>{t("posts.field.topic")}</span>
          <textarea
            className={STUDIO_INPUT}
            rows={3}
            maxLength={500}
            value={topic}
            placeholder={t("posts.topicPlaceholder")}
            onChange={(e) => setTopic(e.target.value)}
          />
          {brandIdeas.length === 0 && (
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              {t("posts.noIdeas")}
            </span>
          )}
        </label>
      ) : (
        <label>
          <span className={STUDIO_LABEL}>{t("posts.field.idea")}</span>
          <select
            className={STUDIO_INPUT}
            value={ideaId ?? ""}
            onChange={(e) => setIdeaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">—</option>
            {brandIdeas.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={STUDIO_LABEL}>{t("posts.field.format")}</span>
          <select
            className={STUDIO_INPUT}
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="">
              {chosenIdea?.format && !useTopic
                ? t(FORMAT_LABEL[chosenIdea.format])
                : t("posts.format.auto")}
            </option>
            {POST_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(FORMAT_LABEL[f])}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={STUDIO_LABEL}>{t("posts.field.title")}</span>
          <input
            className={STUDIO_INPUT}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={STUDIO_PRIMARY} disabled={!ready || !canDraft || pending}>
          {pending ? t("posts.creating") : t("posts.create")}
        </button>
        {error && (
          <span role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

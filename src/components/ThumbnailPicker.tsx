"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslator } from "@/lib/i18n/client";
import { chooseThumbnail } from "@/lib/thumbnails.actions";
import { STUDIO_BUTTON, STUDIO_PRIMARY } from "./StudioStyles";

/**
 * The images in `media/<id>/thumbnails/`, served by `/api/media/…`, each with
 * "Use this one" (build 2b, idea 10).
 */
export function ThumbnailPicker({
  scriptId,
  files,
  chosen: initial,
  hasChoice,
}: {
  scriptId: number;
  files: string[];
  chosen: string | null;
  hasChoice: boolean;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [chosen, setChosen] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(name: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        await chooseThumbnail(scriptId, name);
        setChosen(name);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("listing.error"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {files.map((name) => {
          const active = chosen === name;
          return (
            <li
              key={name}
              className={`surface-border surface-card overflow-hidden ${active ? "ring-2 ring-[var(--color-accent)]" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- owner-only files from /api/media */}
              <img
                src={`/api/media/${scriptId}/thumbnails/${encodeURIComponent(name)}`}
                alt={name}
                loading="lazy"
                className="aspect-video w-full object-cover"
              />
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-xs text-[var(--color-ink-muted)]">{name}</span>
                {active ? (
                  <span className="text-xs font-medium text-[var(--color-accent)]">
                    {t("listing.thumbs.chosen")}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={STUDIO_PRIMARY}
                    disabled={pending}
                    onClick={() => pick(name)}
                  >
                    {t("listing.thumbs.use")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {(chosen || hasChoice) && (
        <button
          type="button"
          className={`${STUDIO_BUTTON} self-start`}
          disabled={pending}
          onClick={() => pick(null)}
        >
          {t("listing.thumbs.clear")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

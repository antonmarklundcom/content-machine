import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { scriptBlocks, scriptOwnerRef } from "@/lib/video/script-blocks";
import type { VoiceLanguage } from "@/lib/voice/contract";
import { NarrationTakes } from "@/components/NarrationTakes";
import { RenderButton } from "@/components/RenderButton";
import { HiggsfieldVoiceBatchButton } from "@/components/HiggsfieldVoiceBatchButton";
import { defaultMaxCredits } from "@/lib/higgsfield/config";
import { listHiggsfieldProfiles } from "@/lib/voice/higgsfield-takes";
import { listMusicTracks } from "@/lib/media/music";
import { loadScript } from "../load";

/**
 * `/studio/[id]/voice` (build 4 link pass): one take list per spoken block
 * (hook, sections, CTA — the scene refs `src/lib/video/script-blocks.ts`
 * defines), then "render the video" from the selected takes.
 */
export default async function ScriptVoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const { row, body, valid } = await loadScript((await params).id);
  const ownerRef = scriptOwnerRef(row.id);
  const language = row.language as VoiceLanguage;
  const blocks = valid ? scriptBlocks({ ...row, body }) : [];
  const musicTracks = isOwner(user) ? await listMusicTracks().catch(() => []) : [];
  const hfProfiles = isOwner(user) ? await listHiggsfieldProfiles() : [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href={`/studio/${row.id}`}
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("voice.studio.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
        {t("voice.studio.title")} · {row.title}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("voice.studio.intro")}</p>
      {isOwner(user) && (
        <p className="mt-2 text-sm">
          <Link
            href={`/voice/record?source=${encodeURIComponent(`script:${row.id}`)}`}
            className="text-[var(--color-accent)] hover:underline"
          >
            {t("record.title")} →
          </Link>
        </p>
      )}

      {!valid ? (
        <p className="mt-6 text-sm text-[var(--color-danger)]">{t("voice.studio.unreadable")}</p>
      ) : (
        <>
          {isOwner(user) && (
            <section className="surface-border surface-card mt-6 px-5 py-4">
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">
                {t("voice.studio.render")}
              </h2>
              <RenderButton
                ownerKind="script"
                ownerRef={ownerRef}
                languages={[row.language]}
                defaultLanguage={row.language}
                musicTracks={musicTracks}
              />
              {hfProfiles.length > 0 && (
                <div className="mt-4">
                  <HiggsfieldVoiceBatchButton
                    kind="script"
                    targetRef={row.id}
                    language={row.language}
                    profiles={hfProfiles}
                    defaultMaxCredits={defaultMaxCredits()}
                    locale={locale}
                  />
                </div>
              )}
            </section>
          )}
          <div className="mt-6 flex flex-col gap-4">
            {blocks.map((block) => (
              <section key={block.sceneRef} className="surface-border surface-card px-5 py-4">
                <h2 className="text-sm font-semibold text-[var(--color-ink)]">
                  {block.label}{" "}
                  <span className="font-normal text-[var(--color-ink-muted)]">
                    ({block.sceneRef})
                  </span>
                </h2>
                <p className="mt-2 mb-3 text-sm whitespace-pre-line text-[var(--color-ink)]">
                  {block.spokenText}
                </p>
                <NarrationTakes
                  ownerKind="script"
                  ownerRef={ownerRef}
                  sceneRef={block.sceneRef}
                  language={language}
                  text={block.spokenText}
                  pronunciationScope={`brand:${row.brandId}`}
                  locale={locale}
                />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

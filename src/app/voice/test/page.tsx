import type { Metadata } from "next";

import { VoiceSubnav } from "@/components/VoiceSubnav";
import { VoiceTestForm, type VoiceTestScript } from "@/components/VoiceTestForm";
import { VoiceTestRun } from "@/components/VoiceTestRun";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listScripts } from "@/lib/bridge/scripts";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { isScriptBodyV1 } from "@/lib/scripts/contract";
import { listProfiles, listVoiceTests } from "@/lib/voice/store";
import { toTakeView } from "@/lib/voice/views";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("voice.test.title") };
}

/** About 45 seconds of speech: the voice gate's script length. */
const TEST_CHARS = 900;

/** The spoken lines of a studio script, hook first, cut at a sentence near 45 s. */
function spokenExcerpt(body: unknown): string | null {
  if (!isScriptBodyV1(body)) return null;
  const lines = [
    ...body.hook.spokenLines,
    ...body.sections.flatMap((s) => s.spokenLines),
    ...body.cta.spokenLines,
  ];
  let out = "";
  for (const line of lines) {
    if (out.length + line.length > TEST_CHARS && out) break;
    out += (out ? "\n" : "") + line;
  }
  return out || null;
}

/**
 * The voice gate (build 4 phase A, PLAN-build4 §4.2): one script, 2–4 voices,
 * rendered side by side (ownerKind `voice_test`); listen and mark a winner.
 */
export default async function VoiceTestPage() {
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const t = translator(locale);
  const owner = isOwner(user);
  const [profiles, runs, scriptRows] = owner
    ? await Promise.all([
        listProfiles({ activeOnly: true }),
        listVoiceTests(10),
        listScripts({ limit: 30 }),
      ])
    : [[], [], []];

  const scripts: VoiceTestScript[] = scriptRows.flatMap((s) => {
    const text = spokenExcerpt(s.body);
    return text ? [{ id: s.id, title: s.title, language: s.language, text }] : [];
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("voice.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
        {t("voice.test.title")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("voice.test.intro")}
      </p>
      <VoiceSubnav current="/voice/test" locale={locale} />

      {!owner ? (
        <p className="surface-card mt-6 p-4 text-sm">{t("voice.ownerOnly")}</p>
      ) : (
        <>
          <section className="surface-border surface-card mt-8 p-5">
            <VoiceTestForm
              scripts={scripts}
              profiles={profiles
                .filter((p) => p.provider !== "manual")
                .map((p) => ({
                  id: p.id,
                  name: p.name,
                  provider: p.provider,
                  languages: p.languages,
                }))}
              locale={locale}
            />
          </section>
          <h2 className="mt-10 text-lg font-semibold text-[var(--color-ink)]">
            {t("voice.test.runs")}
          </h2>
          {runs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t("voice.test.noRuns")}</p>
          ) : (
            <div className="mt-4 flex flex-col gap-4">
              {runs.map((run) => (
                <VoiceTestRun
                  key={run.ownerRef}
                  ownerRef={run.ownerRef}
                  takes={run.takes.map(toTakeView)}
                  locale={locale}
                />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

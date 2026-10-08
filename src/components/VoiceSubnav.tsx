import { translator, type Locale } from "@/lib/i18n";

import { VOICE_CHIP_OFF, VOICE_CHIP_ON } from "./VoiceStyles";

const LINKS = [
  { href: "/voice", key: "voice.nav.profiles" },
  { href: "/voice/pronunciations", key: "voice.nav.pronunciations" },
  { href: "/voice/test", key: "voice.nav.test" },
  { href: "/voice/record", key: "record.title" },
  { href: "/voice/dataset", key: "dataset.title" },
] as const;

/** The voice studio's three pages. */
export function VoiceSubnav({ current, locale }: { current: string; locale: Locale }) {
  const t = translator(locale);
  return (
    <nav aria-label={t("voice.eyebrow")} className="mt-6 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          aria-current={l.href === current ? "page" : undefined}
          className={l.href === current ? VOICE_CHIP_ON : VOICE_CHIP_OFF}
        >
          {t(l.key)}
        </a>
      ))}
    </nav>
  );
}

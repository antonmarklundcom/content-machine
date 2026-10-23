import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { LogoutForm } from "./LogoutForm";
import { spendStatus } from "@/lib/spend";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { LocaleToggle } from "./LocaleToggle";
import { SpendMeter } from "./SpendMeter";
import { HeaderNav, type NavItem, type NavLink } from "./HeaderNav";

export async function Header() {
  const [locale, user] = await Promise.all([getLocale(), getSession()]);
  const t = translator(locale);
  // The login page must work without querying spend or exposing private totals.
  const status = user ? await spendStatus() : null;
  const copy = (en: string, sv: string) => (locale === "sv" ? sv : en);
  const tool = (href: string, label: string, description?: string): NavLink => ({
    href,
    label,
    description,
  });
  const nav: NavItem[] = [
    tool("/", copy("Start here", "Börja här")),
    {
      label: copy("1 · Save & learn", "1 · Spara & lär"),
      description: copy(
        "Collect links, then turn them into useful lessons.",
        "Samla länkar och gör dem till användbara lärdomar.",
      ),
      items: [
        {
          ...tool(
            "/inbox",
            copy("Save a link", "Spara en länk"),
            copy(
              "Your YouTube, Instagram and idea inbox",
              "Din inkorg för YouTube, Instagram och idéer",
            ),
          ),
          also: ["/clips", "/share"],
        },
        tool(
          "/learn",
          copy("My learning library", "Mitt lärbibliotek"),
          copy("Read lessons, resources and next steps", "Läs lärdomar, resurser och nästa steg"),
        ),
        tool(
          "/youtube/ingest",
          copy("Import YouTube videos", "Importera YouTube-videor"),
          copy("Add a video, playlist or channel", "Lägg till en video, spellista eller kanal"),
        ),
        tool(
          "/youtube",
          copy("YouTube digest", "YouTube-översikt"),
          copy(
            "Browse imported videos and analyses",
            "Bläddra bland importerade videor och analyser",
          ),
        ),
        tool(
          "/youtube/sources",
          copy("Follow channels", "Följ kanaler"),
          copy("Choose sources for monitoring", "Välj källor att bevaka"),
        ),
      ],
    },
    {
      label: copy("2 · Create", "2 · Skapa"),
      description: copy(
        "Choose a brand and turn what you know into content.",
        "Välj ett varumärke och skapa innehåll av det du vet.",
      ),
      items: [
        tool(
          "/posts",
          copy("Posts & drafts", "Inlägg & utkast"),
          copy("Write and review your social content", "Skriv och granska ditt innehåll"),
        ),
        tool(
          "/studio",
          copy("Video scripts", "Videomanus"),
          copy("Prepare what to say on camera", "Förbered vad du ska säga i kameran"),
        ),
        tool(
          "/studio/listing",
          copy("Property scripts", "Fastighetsmanus"),
          copy(
            "Turn listing details into a property tour",
            "Gör bostadsdetaljer till en visningsvideo",
          ),
        ),
        tool(
          "/facts",
          copy("Facts & references", "Fakta & referenser"),
          copy(
            "Keep trusted information for your brands",
            "Spara tillförlitlig information för dina varumärken",
          ),
        ),
        tool(
          "/hooks",
          t("header.hooks"),
          copy("Find an opening for your next post", "Hitta en inledning till nästa inlägg"),
        ),
        tool(
          "/media",
          t("header.media"),
          copy("Find your photos, clips and assets", "Hitta dina foton, klipp och filer"),
        ),
      ],
    },
    {
      label: copy("3 · Plan & publish", "3 · Planera & publicera"),
      description: copy(
        "Organize your week and review what works.",
        "Planera din vecka och se vad som fungerar.",
      ),
      items: [
        tool(
          "/calendar",
          copy("Content calendar", "Innehållskalender"),
          copy("See your scheduled content", "Se ditt planerade innehåll"),
        ),
        tool(
          "/studio/plan",
          copy("Filming plan", "Inspelningsplan"),
          copy("Prepare your next recording session", "Förbered nästa inspelning"),
        ),
        tool(
          "/accounts",
          copy("Connected accounts", "Anslutna konton"),
          copy("Manage publishing connections", "Hantera anslutningar för publicering"),
        ),
        tool(
          "/results",
          copy("Results", "Resultat"),
          copy("Review content performance", "Granska hur innehållet presterar"),
        ),
        tool(
          "/comments",
          t("header.engage.comments"),
          copy("Review conversations and replies", "Granska samtal och svar"),
        ),
      ],
    },
    {
      label: copy("More tools", "Fler verktyg"),
      description: copy(
        "Research, brands, production and settings.",
        "Research, varumärken, produktion och inställningar.",
      ),
      items: [
        tool(
          "/settings",
          t("header.settings"),
          copy("Automation controls and integrations", "Automatisering och integrationer"),
        ),
        { ...tool("/brands", t("header.accounts.brands")), also: ["/brand"] },
        tool("/families", t("header.accounts.families")),
        tool("/research", t("header.research.outliers")),
        tool("/research/instagram", copy("Instagram research", "Instagram-research")),
        tool("/research/report", t("header.research.report")),
        tool("/research/questions", t("header.research.questions")),
        tool("/research/compare", t("header.research.compare")),
        tool("/research/gaps", t("header.research.gaps")),
        tool("/lessons", t("header.lessons")),
        tool("/youtube/topics", t("nav.topics")),
        tool("/youtube/marks", t("nav.marks")),
        tool("/video", t("header.studio.video")),
        tool("/higgsfield", t("header.studio.higgsfield")),
        tool("/stories", t("header.voice.stories")),
        tool("/voice", t("header.voice.profiles")),
        tool("/voice/test", t("header.voice.test")),
        tool("/voice/record", t("header.voice.record")),
        tool("/voice/pronunciations", t("header.voice.pronunciations")),
        tool("/voice/dataset", t("header.voice.dataset")),
        tool("/glossary", t("header.voice.glossary")),
      ],
    },
  ];

  // Sticky only when there is room: at 200% zoom on a laptop the header would
  // otherwise cover about 40% of the visible page.
  return (
    <header className="surface-border relative top-0 z-30 border-x-0 [@media(min-height:560px)]:sticky border-t-0 bg-[var(--color-surface)]/95 backdrop-blur-xl">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-surface-raised)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--color-ink)] focus:outline-2 focus:outline-[var(--color-accent)]"
      >
        {t("header.skip")}
      </a>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-xl text-base font-semibold tracking-tight text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
        >
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-accent)] text-base text-white shadow-sm"
          >
            ✦
          </span>
          {t("app.name")}
        </Link>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start sm:gap-5">
          <LocaleToggle locale={locale} />
          {status && <SpendMeter status={status} locale={locale} />}
          {user && <LogoutForm label={t("login.signOut")} />}
        </div>
      </div>
      {user && (
        <div className="mx-auto max-w-6xl px-5 pb-3 sm:px-8">
          <HeaderNav
            nav={nav}
            label={copy("Your content workflow", "Ditt innehållsflöde")}
            menuLabel={copy("Menu & tools", "Meny & verktyg")}
          />
        </div>
      )}
    </header>
  );
}

import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { spendStatus } from "@/lib/spend";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { LocaleToggle } from "./LocaleToggle";
import { SpendMeter } from "./SpendMeter";
import { HeaderNav, type NavItem } from "./HeaderNav";

export async function Header() {
  const [locale, user] = await Promise.all([getLocale(), getSession()]);
  const t = translator(locale);

  // Signed out (the login page renders inside this layout): no nav to offer and
  // no spend figure to leak. Reading spendStatus() unconditionally would also
  // put MySQL in the path of the one page that must work when things are broken.
  const status = user ? await spendStatus() : null;

  // Final order (PLAN.md §6.S20): the daily loop first, then research and the
  // older tools. The wordmark is the home link (families and this week).
  const nav: NavItem[] = [
    { href: "/posts", label: t("header.posts") },
    { href: "/calendar", label: t("header.calendar") },
    { href: "/media", label: t("header.media") },
    {
      label: t("header.accounts"),
      items: [
        { href: "/accounts", label: t("header.accounts") },
        { href: "/brands", label: t("header.accounts.brands"), also: ["/brand"] },
        { href: "/families", label: t("header.accounts.families") },
      ],
    },
    { href: "/hooks", label: t("header.hooks") },
    {
      label: t("header.inbox"),
      items: [
        { href: "/inbox", label: t("header.inbox"), also: ["/clips", "/share"] },
        { href: "/learn", label: t("header.learn") },
      ],
    },
    {
      label: t("header.research"),
      items: [
        { href: "/research", label: t("header.research.outliers") },
        { href: "/research/report", label: t("header.research.report") },
        { href: "/research/questions", label: t("header.research.questions") },
        { href: "/research/compare", label: t("header.research.compare") },
        { href: "/research/gaps", label: t("header.research.gaps") },
        { href: "/lessons", label: t("header.lessons") },
      ],
    },
    {
      label: t("header.studio"),
      items: [
        { href: "/studio", label: t("header.studio.scripts") },
        { href: "/studio/plan", label: t("header.studio.plan") },
        { href: "/studio/listing", label: t("header.studio.listing") },
        { href: "/video", label: t("header.studio.video") },
        { href: "/higgsfield", label: t("header.studio.higgsfield") },
      ],
    },
    // Build 4 (docs/PLAN-build4.md): voice, cuentos stories and the Guaraní glossary.
    {
      label: t("header.voice"),
      items: [
        { href: "/stories", label: t("header.voice.stories") },
        { href: "/voice", label: t("header.voice.profiles") },
        { href: "/voice/test", label: t("header.voice.test") },
        { href: "/voice/record", label: t("header.voice.record") },
        { href: "/voice/pronunciations", label: t("header.voice.pronunciations") },
        { href: "/voice/dataset", label: t("header.voice.dataset") },
        { href: "/glossary", label: t("header.voice.glossary") },
      ],
    },
    {
      label: t("header.engage"),
      items: [
        { href: "/results", label: t("header.engage.results") },
        { href: "/comments", label: t("header.engage.comments") },
      ],
    },
    { href: "/facts", label: t("header.facts") },
    {
      label: t("header.youtube"),
      items: [
        { href: "/youtube", label: t("nav.digest") },
        { href: "/youtube/topics", label: t("nav.topics") },
        { href: "/youtube/marks", label: t("nav.marks") },
        { href: "/youtube/sources", label: t("nav.sources") },
        { href: "/youtube/ingest", label: t("nav.ingest") },
      ],
    },
    { href: "/settings", label: t("header.settings") },
  ];

  return (
    <header className="surface-border sticky top-0 z-10 border-x-0 border-t-0 bg-[var(--color-surface)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="whitespace-nowrap text-sm font-semibold tracking-tight text-[var(--color-ink)]"
          >
            {t("app.name")}
          </Link>
          {user && <HeaderNav nav={nav} />}
        </div>
        <div className="flex items-center gap-5">
          <LocaleToggle locale={locale} />
          {status && <SpendMeter status={status} locale={locale} />}
          {user && (
            <form action={logout}>
              <button
                type="submit"
                title={user.email}
                className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                {t("login.signOut")}
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}

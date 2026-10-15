"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n";

const swedish: Record<string, string> = {
  Collect: "Samla",
  Learn: "Lär",
  Create: "Skapa",
  "Review & plan": "Granska & planera",
  "Where to go next": "Vart du kan gå härnäst",
  "Content workflow": "Innehållsflöde",
  Start: "Start",
  "Choose a task on Start, or open the tool you need from the navigation.":
    "Välj en uppgift på startsidan eller öppna verktyget du behöver i menyn.",
  "Back to Start": "Tillbaka till Start",
  "Save the source and why it matters. Open Learn for learning summaries and implementation steps.":
    "Spara källan och varför den är viktig. Öppna Lär för sammanfattningar och praktiska steg.",
  "Next: review lessons": "Nästa: granska lärdomar",
  "Import one video first. Its transcript and analysis belong in your YouTube library.":
    "Importera en video först. Transkriptet och analysen finns i ditt YouTube-bibliotek.",
  "Next: video library": "Nästa: videobiblioteket",
  "Choose channels here. Automation controls and the scheduler determine when new videos are checked.":
    "Välj kanaler här. Automatiseringsreglagen och schemaläggaren avgör när nya videor kontrolleras.",
  "Check automation": "Kontrollera automatisering",
  "Keep the useful takeaways and source links. Then decide what to implement or turn into content.":
    "Spara användbara lärdomar och källänkar. Bestäm sedan vad du vill genomföra eller göra innehåll av.",
  "Next: write a script": "Nästa: skriv ett manus",
  "Choose a brand, use approved facts, and shape your idea for its audience. Review before publishing.":
    "Välj ett varumärke, använd granskade fakta och anpassa idén till målgruppen. Granska före publicering.",
  "Next: review drafts": "Nästa: granska utkast",
  "Review the facts, language and call to action. Publishing needs connected accounts and explicit setup.":
    "Granska fakta, språk och uppmaning. Publicering kräver anslutna konton och särskild konfiguration.",
  "Review drafts": "Granska utkast",
  "Next: calendar": "Nästa: kalendern",
  "Set up the services you need first. Keep automatic work paused until your manual workflow succeeds.":
    "Konfigurera tjänsterna du behöver först. Håll automatiskt arbete pausat tills det manuella flödet fungerar.",
  "Production tools may need your PC or a configured service. Start with a finished script.":
    "Produktionsverktyg kan behöva din dator eller en konfigurerad tjänst. Börja med ett färdigt manus.",
  "Open scripts": "Öppna manus",
};

const steps = [
  { label: "Collect", href: "/inbox" },
  { label: "Learn", href: "/learn" },
  { label: "Create", href: "/studio" },
  { label: "Review & plan", href: "/posts" },
];

/** Wayfinding only: does not start work, change policy or read provider secrets. */
export function WorkspaceGuide({ locale }: { locale: Locale }) {
  const copy = (text: string) => (locale === "sv" ? (swedish[text] ?? text) : text);
  const path = usePathname() ?? "/";
  if (path === "/" || path === "/youtube/login" || path.includes("/teleprompter")) return null;
  let stage: number | null = null;
  let hint = "Choose a task on Start, or open the tool you need from the navigation.";
  let next = { href: "/", label: "Back to Start" };
  if (path === "/inbox" || path.startsWith("/clips/") || path === "/share") {
    stage = 0;
    hint =
      "Save the source and why it matters. Open Learn for learning summaries and implementation steps.";
    next = { href: "/learn", label: "Next: review lessons" };
  } else if (path === "/youtube/ingest") {
    stage = 0;
    hint = "Import one video first. Its transcript and analysis belong in your YouTube library.";
    next = { href: "/youtube", label: "Next: video library" };
  } else if (path.startsWith("/youtube/sources")) {
    stage = 0;
    hint =
      "Choose channels here. Automation controls and the scheduler determine when new videos are checked.";
    next = { href: "/settings#automation", label: "Check automation" };
  } else if (
    path === "/learn" ||
    path.startsWith("/youtube") ||
    path.startsWith("/research") ||
    path === "/lessons"
  ) {
    stage = 1;
    hint =
      "Keep the useful takeaways and source links. Then decide what to implement or turn into content.";
    next = { href: "/studio/new", label: "Next: write a script" };
  } else if (
    path.startsWith("/studio") ||
    path.startsWith("/brand") ||
    path === "/hooks" ||
    path === "/facts"
  ) {
    stage = 2;
    hint =
      "Choose a brand, use approved facts, and shape your idea for its audience. Review before publishing.";
    next = { href: "/posts", label: "Next: review drafts" };
  } else if (path.startsWith("/posts") || path === "/calendar") {
    stage = 3;
    hint =
      "Review the facts, language and call to action. Publishing needs connected accounts and explicit setup.";
    next = {
      href: path === "/calendar" ? "/posts" : "/calendar",
      label: path === "/calendar" ? "Review drafts" : "Next: calendar",
    };
  } else if (path === "/settings" || path === "/accounts") {
    hint =
      "Set up the services you need first. Keep automatic work paused until your manual workflow succeeds.";
  } else if (
    path.startsWith("/voice") ||
    path === "/video" ||
    path === "/stories" ||
    path === "/higgsfield"
  ) {
    hint =
      "Production tools may need your PC or a configured service. Start with a finished script.";
    next = { href: "/studio", label: "Open scripts" };
  }
  return (
    <aside className="workspace-guide" aria-label={copy("Where to go next")}>
      <div className="workspace-guide-top">
        <Link className="workspace-text-link" href="/">
          Start
        </Link>
        <span aria-hidden>/</span>
        <nav aria-label={copy("Content workflow")}>
          <ol>
            {steps.map((step, index) => (
              <li key={step.href}>
                <Link href={step.href} aria-current={stage === index ? "step" : undefined}>
                  <span aria-hidden>{index + 1}</span>
                  {copy(step.label)}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <div className="workspace-guide-next">
        <p>{copy(hint)}</p>
        <Link href={next.href}>
          {copy(next.label)} <span aria-hidden>→</span>
        </Link>
      </div>
    </aside>
  );
}

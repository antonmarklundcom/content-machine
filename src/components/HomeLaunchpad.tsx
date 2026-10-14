"use client";

import { useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { QuickAddClipForm } from "./QuickAddClipForm";

const swedish: Record<string, string> = {
  "Save a link": "Spara en länk",
  "Residency content": "Innehåll om uppehållstillstånd",
  "Real estate content": "Fastighetsinnehåll",
  "YOUR IDEAS, WITH A NEXT STEP": "DINA IDÉER, MED ETT NÄSTA STEG",
  "What would you like": "Vad vill du",
  "to work on?": "arbeta med?",
  "A useful lesson. A better post. Your next property story.":
    "En användbar lärdom. Ett bättre inlägg. Din nästa bostadspresentation.",
  "Start here and we’ll guide you through it.": "Börja här så guidar vi dig vidare.",
  "Choose your task": "Välj din uppgift",
  "Found something worth keeping?": "Hittat något värt att spara?",
  "Paste a YouTube or Instagram link. Add what you want to learn from it.":
    "Klistra in en YouTube- eller Instagram-länk. Skriv vad du vill lära dig av den.",
  "Next: open your saved lessons to process and review them.":
    "Nästa steg: öppna dina sparade lärdomar för att bearbeta och granska dem.",
  "Open lessons": "Öppna lärdomar",
  "Make Paraguay easier to understand.": "Gör Paraguay lättare att förstå.",
  "Give your next property a story.": "Ge nästa bostad en berättelse.",
  "Start with your residency brand and approved facts. Build a post, then a script when you’re ready to film.":
    "Börja med ditt varumärke för uppehållstillstånd och granskade fakta. Skapa ett inlägg och sedan ett manus när du är redo att filma.",
  "Start with the actual property details. Turn the location, features and price into a short video or tour.":
    "Börja med bostadens verkliga uppgifter. Gör läge, egenskaper och pris till en kort video eller visning.",
  "Choose your brand and audience": "Välj varumärke och målgrupp",
  "Add the facts and your angle": "Lägg till fakta och din vinkel",
  "Draft, review and export": "Skriv utkast, granska och exportera",
  "Start residency content": "Skapa innehåll om uppehållstillstånd",
  "Create a property script": "Skapa ett fastighetsmanus",
  "Review my facts": "Granska mina fakta",
  "Open real estate brand": "Öppna fastighetsvarumärket",
  "Saving a learning link does not generate a summary. AI processing needs a configured provider.":
    "En sparad lärlänk skapar ingen sammanfattning. AI-bearbetning kräver en konfigurerad leverantör.",
  "A SIMPLE WAY THROUGH": "EN ENKEL VÄG FRAMÅT",
  "From “save this” to “use this”.": "Från ”spara det här” till ”använd det här”.",
  "Check setup & automation": "Kontrollera inställningar och automatisering",
  Collect: "Samla",
  "Keep links, captions and the reason you saved them.":
    "Spara länkar, bildtexter och varför du sparade dem.",
  "Open inbox": "Öppna inkorgen",
  Learn: "Lär",
  "Review takeaways, useful links and steps to put into practice.":
    "Granska lärdomar, användbara länkar och steg att genomföra.",
  "Review lessons": "Granska lärdomar",
  Create: "Skapa",
  "Turn approved facts and ideas into posts and video scripts.":
    "Gör granskade fakta och idéer till inlägg och videomanus.",
  "Open scripts": "Öppna manus",
  "Review & plan": "Granska & planera",
  "Check the draft, choose a date and decide how to publish.":
    "Granska utkastet, välj datum och bestäm hur du vill publicera.",
  "Review drafts": "Granska utkast",
  "PICK UP WHERE YOU NEED TO": "FORTSÄTT DÄR DU BEHÖVER",
  "Your everyday tools": "Dina vardagsverktyg",
  "YouTube library": "YouTube-bibliotek",
  "Import a video, then read and search its analysis.":
    "Importera en video och läs och sök i analysen.",
  "Open video library": "Öppna videobiblioteket",
  "Follow selected channels": "Följ utvalda kanaler",
  "Choose your sources. Keep automatic checks under your control.":
    "Välj dina källor och styr de automatiska kontrollerna.",
  "Manage channels": "Hantera kanaler",
  "Plan your content": "Planera ditt innehåll",
  "See what’s scheduled across your brands.": "Se vad som är planerat för dina varumärken.",
  "Open calendar": "Öppna kalendern",
};

const tasks = [
  { id: "save", label: "Save a link", symbol: "↗" },
  { id: "residency", label: "Residency content", symbol: "◎" },
  { id: "property", label: "Real estate content", symbol: "⌂" },
] as const;

export function HomeLaunchpad({ locale }: { locale: Locale }) {
  const copy = (text: string) => (locale === "sv" ? (swedish[text] ?? text) : text);
  const [task, setTask] = useState<(typeof tasks)[number]["id"]>("save");
  return (
    <>
      <section className="workspace-hero" aria-labelledby="workspace-title">
        <div className="workspace-hero-copy">
          <span className="workspace-eyebrow">{copy("YOUR IDEAS, WITH A NEXT STEP")}</span>
          <h1 id="workspace-title">
            {copy("What would you like")} <br className="hidden sm:block" /> {copy("to work on?")}
          </h1>
          <p>
            {copy("A useful lesson. A better post. Your next property story.")}
            <br className="hidden sm:block" /> {copy("Start here and we’ll guide you through it.")}
          </p>
        </div>
        <div className="workspace-composer">
          <div className="workspace-task-tabs" role="tablist" aria-label={copy("Choose your task")}>
            {tasks.map((item) => (
              <button
                key={item.id}
                id={`task-${item.id}`}
                role="tab"
                type="button"
                aria-selected={task === item.id}
                tabIndex={task === item.id ? 0 : -1}
                aria-controls="workspace-task-panel"
                onClick={() => setTask(item.id)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const current = tasks.findIndex((option) => option.id === item.id);
                  const index =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tasks.length - 1
                        : (current + (event.key === "ArrowRight" ? 1 : -1) + tasks.length) %
                          tasks.length;
                  setTask(tasks[index].id);
                  document.getElementById(`task-${tasks[index].id}`)?.focus();
                }}
              >
                <span aria-hidden>{item.symbol}</span>
                {copy(item.label)}
              </button>
            ))}
          </div>
          <div
            id="workspace-task-panel"
            role="tabpanel"
            aria-labelledby={`task-${task}`}
            className="workspace-composer-body"
          >
            {task === "save" ? (
              <>
                <h2>{copy("Found something worth keeping?")}</h2>
                <p className="workspace-panel-note">
                  {copy("Paste a YouTube or Instagram link. Add what you want to learn from it.")}
                </p>
                <QuickAddClipForm locale={locale} />
                <div className="workspace-after-save">
                  <span>{copy("Next: open your saved lessons to process and review them.")}</span>
                  <Link href="/learn">
                    {copy("Open lessons")} <span aria-hidden>↗</span>
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h2>
                  {task === "residency"
                    ? copy("Make Paraguay easier to understand.")
                    : copy("Give your next property a story.")}
                </h2>
                <p className="workspace-panel-note">
                  {task === "residency"
                    ? copy(
                        "Start with your residency brand and approved facts. Build a post, then a script when you’re ready to film.",
                      )
                    : copy(
                        "Start with the actual property details. Turn the location, features and price into a short video or tour.",
                      )}
                </p>
                <ol className="workspace-mini-steps">
                  <li>{copy("Choose your brand and audience")}</li>
                  <li>{copy("Add the facts and your angle")}</li>
                  <li>{copy("Draft, review and export")}</li>
                </ol>
                <div className="flex flex-wrap items-center gap-4">
                  <Link
                    className="workspace-button"
                    href={task === "residency" ? "/brand/guide" : "/studio/listing"}
                  >
                    {task === "residency"
                      ? copy("Start residency content")
                      : copy("Create a property script")}{" "}
                    <span aria-hidden>↗</span>
                  </Link>
                  <Link
                    className="workspace-text-link"
                    href={task === "residency" ? "/facts" : "/brand/propia"}
                  >
                    {task === "residency"
                      ? copy("Review my facts")
                      : copy("Open real estate brand")}
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
        <p className="workspace-hero-footnote">
          {copy(
            "Saving a learning link does not generate a summary. AI processing needs a configured provider.",
          )}
        </p>
      </section>

      <section className="workspace-journey" aria-labelledby="journey-title">
        <div className="workspace-section-heading">
          <div>
            <span className="workspace-eyebrow">{copy("A SIMPLE WAY THROUGH")}</span>
            <h2 id="journey-title">{copy("From “save this” to “use this”.")}</h2>
          </div>
          <Link className="workspace-text-link" href="/settings">
            {copy("Check setup & automation")} <span aria-hidden>↗</span>
          </Link>
        </div>
        <ol className="workspace-journey-grid">
          {[
            {
              number: "01",
              title: "Collect",
              copy: "Keep links, captions and the reason you saved them.",
              href: "/inbox",
              action: "Open inbox",
            },
            {
              number: "02",
              title: "Learn",
              copy: "Review takeaways, useful links and steps to put into practice.",
              href: "/learn",
              action: "Review lessons",
            },
            {
              number: "03",
              title: "Create",
              copy: "Turn approved facts and ideas into posts and video scripts.",
              href: "/studio",
              action: "Open scripts",
            },
            {
              number: "04",
              title: "Review & plan",
              copy: "Check the draft, choose a date and decide how to publish.",
              href: "/posts",
              action: "Review drafts",
            },
          ].map((step) => (
            <li key={step.number}>
              <span className="workspace-step-number">{step.number}</span>
              <h3>{copy(step.title)}</h3>
              <p>{copy(step.copy)}</p>
              <Link href={step.href}>
                {copy(step.action)} <span aria-hidden>→</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="workspace-shortcuts" aria-labelledby="shortcuts-title">
        <div className="workspace-section-heading">
          <div>
            <span className="workspace-eyebrow">{copy("PICK UP WHERE YOU NEED TO")}</span>
            <h2 id="shortcuts-title">{copy("Your everyday tools")}</h2>
          </div>
        </div>
        <div className="workspace-shortcut-grid">
          {[
            {
              icon: "▷",
              title: "YouTube library",
              text: "Import a video, then read and search its analysis.",
              href: "/youtube",
              label: "Open video library",
              tone: "blue",
            },
            {
              icon: "◉",
              title: "Follow selected channels",
              text: "Choose your sources. Keep automatic checks under your control.",
              href: "/youtube/sources",
              label: "Manage channels",
              tone: "violet",
            },
            {
              icon: "▦",
              title: "Plan your content",
              text: "See what’s scheduled across your brands.",
              href: "/calendar",
              label: "Open calendar",
              tone: "peach",
            },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="workspace-shortcut">
              <span aria-hidden className={`workspace-shortcut-icon ${item.tone}`}>
                {item.icon}
              </span>
              <h3>{copy(item.title)}</h3>
              <p>{copy(item.text)}</p>
              <span className="workspace-shortcut-action">
                {copy(item.label)} <span aria-hidden>↗</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

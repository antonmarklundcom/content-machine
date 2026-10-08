import type { PostDraft } from "./contract";

/**
 * Valid `PostDraft` bodies for tests and fakes. Fresh objects every call, so a
 * test can mutate one without leaking into the next.
 */

export function sampleCarouselDraft(): PostDraft {
  return {
    version: 1,
    format: "carousel",
    language: "en",
    hook: "3 things nobody tells you before moving to Paraguay",
    caption: "Swipe for the three surprises. Which one would catch you out?",
    cta: "Save this for your move",
    hashtags: ["paraguay", "expatlife"],
    firstComment: "Sources in the second slide's caption.",
    altText: "Three illustrated cards about moving to Paraguay.",
    engagement: { mechanic: "question", detail: "Ask which surprise they did not know." },
    slides: [
      {
        n: 1,
        headline: "Nobody tells you this",
        body: "",
        visual: { prompt: "Asunción skyline at dusk, warm light", textOverlay: "3 surprises" },
      },
      {
        n: 2,
        headline: "Residency takes months",
        body: "Plan for the wait before you sell everything.",
        visual: { prompt: "Calendar on a desk with paperwork", textOverlay: "" },
      },
    ],
    sources: [{ claim: "Residency takes months", url: "https://example.com/residency" }],
  };
}

export function sampleReelDraft(): PostDraft {
  return {
    version: 1,
    format: "reel",
    language: "es",
    hook: "¿Sabías esto de Paraguay?",
    caption: "Comentá RESIDENCIA y te mando la guía.",
    cta: "Comentá RESIDENCIA",
    hashtags: ["paraguay"],
    engagement: { mechanic: "comment_keyword", detail: "RESIDENCIA" },
    shots: [
      {
        n: 1,
        seconds: 3,
        onScreenText: "¿Sabías esto?",
        voiceover: "¿Sabías esto de Paraguay?",
        visual: { imagePrompt: "Street in Asunción", videoPrompt: "Slow push-in" },
      },
    ],
    sources: [],
  };
}

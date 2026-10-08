import type { ScriptBodyV1 } from "./contract";

/** A small valid body, for tests. A fresh copy each call, so tests can mutate it. */
export function sampleScriptBody(): ScriptBodyV1 {
  return {
    version: 1,
    language: "en",
    topic: "Paraguay residency timeline",
    chosenTitle: "Paraguay residency in 45 days",
    targetMinutes: 6,
    titleOptions: [
      { title: "Paraguay residency in 45 days", angle: "Replaces the old figure." },
      { title: "The 4 documents that restart your file", angle: "Names the mistake." },
      { title: "90 days or 45?", angle: "A contradiction." },
    ],
    thumbnailConcepts: [
      {
        description: "Calendar, 90 crossed out",
        textOverlay: "45 DAYS",
        imagePrompt: "Paper calendar close-up",
      },
      {
        description: "Four documents on a desk",
        textOverlay: "",
        imagePrompt: "Four blank documents, top-down",
      },
      {
        description: "Passport and folder",
        textOverlay: "FIRST",
        imagePrompt: "Passport beside a folder",
      },
    ],
    hook: {
      spokenLines: ["Everyone still says ninety days.", "That changed."],
      onScreenText: ["90 → 45"],
      broll: [
        {
          spokenLine: "Everyone still says ninety days.",
          description: "Calendar pages flipping",
          imagePrompt: "Paper calendar mid-flip",
          videoPrompt: "Pages flip, slow push-in",
          aspectRatio: "16:9",
        },
      ],
    },
    sections: [
      {
        heading: "The real timeline",
        spokenLines: ["It takes about forty-five days.", "If the file is complete."],
        talkingPoints: ["Show the official page."],
        onScreenText: ["~45 days"],
        broll: [
          {
            spokenLine: "It takes about forty-five days.",
            description: "Stopwatch on forms",
            imagePrompt: "Stopwatch on blank forms",
            videoPrompt: null,
            aspectRatio: "9:16",
          },
        ],
        sourceIds: ["s1"],
      },
    ],
    cta: { spokenLines: ["Check your certificate's expiry today."], onScreenText: [] },
    sources: [
      {
        id: "s1",
        claim: "Complete applications take about 45 days.",
        url: "https://example.gov.py/migraciones/plazos",
        title: "Migraciones",
        verifyBeforeRecording: true,
      },
    ],
  };
}

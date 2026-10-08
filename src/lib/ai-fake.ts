import {
  FinishReason,
  GenerateContentResponse,
  JobState,
  type BatchJob,
  type CreateBatchJobParameters,
  type GenerateContentParameters,
  type GetBatchJobParameters,
  type GenerateContentResponseUsageMetadata,
  type InlinedRequest,
  type InlinedResponse,
  type JobError,
} from "@google/genai";

/**
 * The Gemini test double (PLAN.md §1.16, §5.O5.1).
 *
 * Build 1 shipped every paid path unverified because no session could reach the
 * API. This is what makes them verifiable without one: `GEMINI_FAKE=1` swaps
 * `geminiClient()` for this object, and everything downstream — the spend
 * arithmetic, the parsers, the route contracts, the batch state machine — runs
 * for real against canned responses.
 *
 * Three properties are what make it worth trusting, and each one is load-bearing:
 *
 *  - **Schema-valid by construction.** Every canned payload is validated, at
 *    call time, against the very `responseJsonSchema` the caller sent
 *    (`validate()` below). A fake that answers with a shape the real API would
 *    have been constrained away from is a fake that green-lights a parser bug.
 *    An unrecognised schema throws rather than guessing — silence there would
 *    let a new call site quietly test nothing.
 *  - **Realistic `usageMetadata` and `groundingMetadata`.** §1.16's whole point:
 *    the money math must be *exercised*, not skipped. The figures are asymmetric
 *    on purpose — a non-zero `cachedContentTokenCount` proves `readUsage`
 *    subtracts it out of `promptTokenCount`, and a non-zero
 *    `thoughtsTokenCount` proves reasoning is billed as output.
 *  - **The right prototypes in the right places.** Interactive calls return real
 *    `GenerateContentResponse` instances, so the SDK's `text` getter is the code
 *    path under test. Batch results come back through `JSON.parse`, exactly as
 *    the SDK delivers `inlinedResponses`, so `responseText`'s parts fallback is
 *    the code path under test there. See the comment on `responseText`: getting
 *    this backwards is how a batch bills for analyses it then marks failed.
 *
 * Nothing here is imported by production code paths other than the one branch in
 * `geminiClient()`.
 */

// ---------------------------------------------------------------------------
// which call is this?
// ---------------------------------------------------------------------------

/**
 * The five request shapes this app makes, named by what they ask for.
 *
 * Identified from the schema's own property names rather than by importing the
 * five schema constants: two of them (`IDEAS_JSON_SCHEMA`, `ADAPT_JSON_SCHEMA`)
 * are module-private to `ai.ts`, and importing the other three would point this
 * module back at half the app for no gain.
 */
export type FakeResponseKind =
  | "ideas"
  | "adapt"
  | "analysis"
  | "screening"
  | "outline"
  | "titles"
  | "script"
  | "post"
  | "transcript"
  // build 4: learn summaries (§3.E), comment replies and content gaps (§3.G)
  | "learn"
  | "reply"
  | "gaps";

type JsonObject = Record<string, unknown>;

function propertyNames(schema: unknown): Set<string> {
  const properties = (schema as JsonObject | undefined)?.["properties"];
  if (typeof properties !== "object" || properties === null) return new Set();
  return new Set(Object.keys(properties as JsonObject));
}

export function classifySchema(schema: unknown): FakeResponseKind {
  const keys = propertyNames(schema);
  const has = (...names: string[]) => names.every((n) => keys.has(n));

  if (has("ideas", "researchNotes")) return "ideas";
  // A post has a hook and a cta like an outline, and sources like a script;
  // the caption + engagement pair is its own.
  if (has("hook", "caption", "engagement")) return "post";
  if (has("transcript", "postText", "claims")) return "transcript";
  // Ahead of `outline`, which also has a hook and a cta: a script is the one
  // with sections and sources.
  if (has("hook", "sections", "sources")) return "script";
  if (has("titles")) return "titles";
  if (has("summary", "takeaways", "content_type")) return "analysis";
  if (has("score", "reason")) return "screening";
  if (has("hook", "rehook", "cta")) return "outline";
  if (has("title", "angle", "draftCopy")) return "adapt";
  // Build 4. Last: the analysis schema also has a `gaps` property.
  if (has("whatItIs", "whyItMatters", "howToStart")) return "learn";
  if (has("reply", "needsHuman")) return "reply";
  if (has("gaps")) return "gaps";

  throw new Error(
    "ai-fake: no canned response for a request whose responseJsonSchema has properties " +
      `[${[...keys].join(", ")}]. Add one to PAYLOADS — a new paid call site must not ` +
      "silently test nothing.",
  );
}

// ---------------------------------------------------------------------------
// a JSON Schema subset, just enough to keep the canned answers honest
// ---------------------------------------------------------------------------

/**
 * Validate a canned payload against the schema the caller sent.
 *
 * Deliberately not a dependency: the five schemas in this repo use nine
 * keywords between them (`type`, `properties`, `required`, `items`, `enum`,
 * `minItems`, `maxItems`, `minimum`, `maximum`, `additionalProperties`), and a
 * validator for exactly those is shorter than the argument for adding ajv to a
 * production bundle. Anything it does not understand it ignores, so a schema
 * that grows a keyword loses coverage rather than failing spuriously — the one
 * keyword worth being strict about, `additionalProperties: false`, is
 * implemented.
 */
export function validate(value: unknown, schema: unknown, path = "$"): void {
  const fail = (why: string): never => {
    throw new Error(
      `ai-fake: canned response is not valid against the caller's schema at ${path}: ${why}`,
    );
  };
  if (typeof schema !== "object" || schema === null) return;
  const s = schema as JsonObject;

  const type = s["type"];
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return void fail(
        `expected an object, got ${Array.isArray(value) ? "an array" : typeof value}`,
      );
    }
    const object = value as JsonObject;
    const properties = (s["properties"] ?? {}) as JsonObject;

    for (const name of (s["required"] as string[] | undefined) ?? []) {
      if (object[name] === undefined) fail(`missing required property "${name}"`);
    }
    if (s["additionalProperties"] === false) {
      for (const name of Object.keys(object)) {
        if (!(name in properties)) fail(`property "${name}" is not in the schema`);
      }
    }
    for (const [name, child] of Object.entries(properties)) {
      if (object[name] !== undefined) validate(object[name], child, `${path}.${name}`);
    }
    return;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return void fail(`expected an array, got ${typeof value}`);
    const min = s["minItems"];
    const max = s["maxItems"];
    if (typeof min === "number" && value.length < min)
      fail(`${value.length} items, minimum ${min}`);
    if (typeof max === "number" && value.length > max)
      fail(`${value.length} items, maximum ${max}`);
    value.forEach((item, i) => validate(item, s["items"], `${path}[${i}]`));
    return;
  }

  const enumeration = s["enum"];
  if (Array.isArray(enumeration) && !enumeration.includes(value)) {
    fail(`${JSON.stringify(value)} is not one of ${JSON.stringify(enumeration)}`);
  }

  if (type === "string" && typeof value !== "string")
    fail(`expected a string, got ${typeof value}`);

  if (type === "integer" || type === "number") {
    if (typeof value !== "number") return void fail(`expected a number, got ${typeof value}`);
    if (type === "integer" && !Number.isInteger(value)) fail(`${value} is not an integer`);
    const minimum = s["minimum"];
    const maximum = s["maximum"];
    if (typeof minimum === "number" && value < minimum)
      fail(`${value} is below minimum ${minimum}`);
    if (typeof maximum === "number" && value > maximum)
      fail(`${value} is above maximum ${maximum}`);
  }
}

// ---------------------------------------------------------------------------
// the canned answers
// ---------------------------------------------------------------------------

/**
 * One payload per request shape. Plausible rather than lorem ipsum, because
 * these strings end up in `ideas.draft_copy` and on a rendered page during a
 * screenshot run, and "string" tells a reader nothing about whether the column
 * is wide enough.
 */
export const PAYLOADS: Record<FakeResponseKind, unknown> = {
  learn: {
    title: "Claude Code hooks for auto-formatting",
    whatItIs:
      "A pattern for running a formatter automatically after every file edit an AI coding agent makes, configured in the agent's settings file.",
    whyItMatters: "Diffs stay clean without asking the agent to format, which saves review time.",
    howToStart: [
      "Open the project's agent settings file.",
      "Add a post-edit hook that runs the formatter on the edited file.",
      "Make one edit and check the file was formatted.",
    ],
    category: "dev-workflow",
    tags: ["claude-code", "hooks", "prettier"],
  },
  reply: {
    reply:
      "¡Gracias por escribir! El trámite completo te lo explicamos paso a paso en el link de la bio.",
    needsHuman: false,
    humanReason: "",
  },
  // Refs a test seeds on purpose (`q:1`, `cp:1`); gaps citing refs the inputs
  // lack are dropped by validation, which is the behaviour under test there.
  gaps: {
    gaps: [
      {
        topic: "Cédula renewal after the first year",
        angle: "Lo que nadie te dice de renovar la cédula: plazos reales y qué llevar.",
        evidence: [{ ref: "q:1", note: "Followers ask how renewal works." }],
        score: 8,
      },
      {
        topic: "Opening a bank account as a new resident",
        angle: "Tres bancos, tres respuestas: qué piden de verdad para abrir una cuenta.",
        evidence: [{ ref: "cp:1", note: "A competitor's top post covers it." }],
        score: 7,
      },
    ],
  },
  // Every list filled, so one payload serves every format: the app keeps the
  // list the format uses (src/lib/posts/assemble.ts) and drops the rest. One
  // source has no URL on purpose, to exercise the UNSOURCED note.
  post: {
    hook: "Everyone still quotes 90 days. It's 45.",
    caption:
      "Everyone still quotes 90 days for residency. For a complete file it's about 45.\n\nSwipe to see what 'complete' means — and save this before you book a flight.\n\nWhich document would you have forgotten? Tell me below.",
    cta: "Save this before you book",
    hashtags: ["#paraguay", "residency", "Expat Life"],
    firstComment: "Sources: the migraciones office's own page, linked in bio.",
    altText: "Carousel: the four documents of a complete residency file, one per slide.",
    engagement: {
      mechanic: "question",
      detail: "Which document would you have forgotten?",
    },
    slides: [
      {
        headline: "90 days? Not any more.",
        body: "",
        visualPrompt: "Wall calendar with the number 45 circled, warm window light, photographic",
        textOverlay: "90 → 45 days",
      },
      {
        headline: "Only for a complete file",
        body: "Miss one document and the clock restarts.",
        visualPrompt: "Neat stack of forms tied with string on a wooden desk, top-down",
        textOverlay: "Complete = 4 documents",
      },
      {
        headline: "Save this",
        body: "Check all four before you fly.",
        visualPrompt: "Passport and boarding pass on a table next to a checklist, soft light",
        textOverlay: "Save for your move",
      },
    ],
    shots: [
      {
        seconds: 3,
        onScreenText: "90 days? No.",
        voiceover: "Everyone still says ninety days.",
        imagePrompt: "Close-up of a desk calendar, shallow depth of field, vertical 9:16",
        videoPrompt: "Slow push-in on the calendar",
      },
      {
        seconds: 5,
        onScreenText: "~45 days (complete files)",
        imagePrompt: "Hands laying four documents on a desk one at a time, vertical 9:16",
        videoPrompt: "Top-down, documents slide into frame",
      },
    ],
    storyFrames: [
      {
        text: "How long does residency take?",
        sticker: "quiz",
        visualPrompt: "Asunción street at golden hour, vertical 9:16",
      },
      {
        text: "About 45 days — if your file is complete.",
        visualPrompt: "Stack of forms, vertical",
      },
    ],
    sources: [
      {
        claim: "Complete residency applications are processed in about 45 days.",
        url: "https://example.gov.py/migraciones/plazos",
      },
      { claim: "Four documents make a file complete.", url: "see the guide" },
    ],
  },
  transcript: {
    transcript:
      "Si querés la residencia en Paraguay, esto es lo que nadie te dice. El trámite tarda cuarenta y cinco días.",
    postText: "RESIDENCIA EN 45 DÍAS | Comentá GUIA",
    summary:
      "A creator claims Paraguayan residency takes 45 days and invites viewers to comment for a guide.",
    claims: [
      { claim: "Paraguayan residency takes 45 days.", timestampSec: 4 },
      { claim: "Nobody mentions the police certificate expiry." },
    ],
  },
  ideas: {
    // Empty on purpose: /api/generate falls back to [brandId] when a note names
    // no brands, which is the branch worth exercising, and it keeps the note
    // attached to whichever brand the caller actually asked about.
    researchNotes: [
      {
        topic: "Residency paperwork timelines",
        summary:
          "Processing times published by the migraciones office moved from 90 to 45 days for complete applications.",
        sources: [
          "https://example.gov.py/migraciones/plazos",
          "https://example.com/py-residency-2026",
        ],
        relatedBrandIds: [],
      },
    ],
    ideas: [
      {
        title: "The 45-day timeline, start to finish",
        angle: "Everyone still quotes 90 days. Show the current figure and where it comes from.",
        format: "carousel",
        platform: "instagram",
        draftCopy:
          "45 días. Ese es el plazo actual para una solicitud completa.\n\nLa mayoría todavía repite 90 — y planifica el viaje con el número equivocado.\n\nGuardá esto antes de comprar el pasaje.\n\n#residencia #paraguay",
        visualNotes: "Six slides, one per stage, dates in the corner.",
        citations: [
          {
            claim: "Complete applications are now processed in 45 days.",
            sources: [
              "https://example.gov.py/migraciones/plazos",
              "https://example.com/py-residency-2026",
            ],
          },
        ],
      },
      {
        title: "What 'complete' actually means",
        angle:
          "The timeline only holds for a complete file; name the four documents people forget.",
        format: "reel",
        platform: "instagram",
        draftCopy:
          "El plazo de 45 días es para expedientes completos.\n\nCuatro documentos son los que faltan casi siempre. Te los muestro en orden.\n\n#tramites #paraguay",
        visualNotes: "Hands laying four documents on a desk, one at a time.",
      },
      {
        title: "Apostille before you fly",
        angle: "The one step that cannot be fixed from inside the country.",
        format: "image_post",
        platform: "instagram",
        draftCopy:
          "La apostilla se hace en tu país. No después.\n\nEs el único paso que no se arregla desde acá.\n\n#apostilla #residencia",
      },
      {
        title: "Police certificate expiry",
        angle: "A certificate that expires mid-process is the most common restart.",
        format: "story",
        platform: "instagram",
        draftCopy:
          "Tu certificado de antecedentes vence. Revisá la fecha antes de presentar. #residencia",
      },
      {
        title: "Cost breakdown, line by line",
        angle: "People budget for the fee and nothing else.",
        format: "carousel",
        platform: "instagram",
        draftCopy:
          "El arancel no es el costo total.\n\nTraducciones, apostillas, gestoría: acá está el desglose completo.\n\n#costos #residenciaparaguay",
        visualNotes: "Plain table, one line per cost, total at the bottom.",
      },
    ],
  },

  adapt: {
    title: "Residency timeline, for this audience",
    angle: "The source names a rule change; this brand's readers plan trips around it.",
    draftCopy:
      "45 días, no 90.\n\nSi estás planificando el viaje con el número viejo, vas a llegar con los papeles vencidos.\n\nRevisá las fechas antes de comprar.\n\n#residencia #paraguay",
    visualNotes: "Calendar with the old figure struck through.",
  },

  analysis: {
    summary:
      "A walkthrough of the Paraguayan residency process as it stands after the 2026 processing-time change, with a stage-by-stage account of the paperwork and the two places applications stall.",
    takeaways: [
      "Complete applications are now processed in about 45 days, not 90.",
      "The apostille must be obtained in the applicant's home country before travelling.",
      "Police certificates expire and are the most common cause of a restart.",
      "Translation and gestoría costs roughly double the headline fee.",
    ],
    hook: {
      technique: "Contradiction of a widely repeated number",
      first_30s:
        "Opens by stating that the 90-day figure everyone quotes has been wrong since the rule change.",
      why_it_works:
        "The viewer's existing plan is suddenly suspect, so the rest of the video is about their own file.",
    },
    timeline: [
      {
        ts: "00:00",
        topic: "The 90-day myth",
        beat: "States the current figure and cites the source.",
      },
      {
        ts: "02:15",
        topic: "Document checklist",
        beat: "Walks the four documents applicants forget.",
      },
      { ts: "07:40", topic: "Apostille", beat: "Explains why it cannot be done locally." },
      { ts: "12:05", topic: "Costs", beat: "Breaks the total into fee, translation and gestoría." },
    ],
    gaps: [
      {
        gap: "Never says what happens when a certificate expires mid-process.",
        counter_angle: "Cover the restart procedure and what carries over.",
      },
      {
        gap: "Costs are quoted in dollars with no guaraní figure.",
        counter_angle: "Publish the same table in guaraníes at a stated exchange rate.",
      },
    ],
    ideas: [
      {
        title: "The four forgotten documents",
        premise: "Each of the four gets its own beat, with what it looks like.",
        why_now: "The shortened timeline only applies to complete files.",
      },
      {
        title: "Restarting after an expiry",
        premise: "What happens to a file when the police certificate lapses.",
        why_now: "The gap the source video leaves open.",
      },
    ],
    topics: ["residency", "immigration paperwork", "paraguay", "relocation costs"],
    entities: ["Dirección General de Migraciones", "apostille", "cédula"],
    content_type: "tutorial",
  },

  screening: {
    score: 72,
    reason:
      "Names a specific rule change with a date and walks the paperwork stage by stage, which is the kind of detail the corpus is short on.",
  },

  outline: {
    hook: "Everyone still says 90 days. That number changed and nobody updated the advice.",
    rehook: "And the new figure only applies if your file is complete — which most are not.",
    teaching_points: [
      "Where the 45-day figure is published and how to check it yourself.",
      "The four documents that make a file incomplete.",
      "Why the apostille has to happen before you fly.",
      "What a lapsed police certificate costs you in time.",
    ],
    twist: "The fastest applicants are not the ones who rush — they are the ones who file once.",
    cta: "Check the expiry date on your police certificate before you book anything.",
  },

  titles: {
    titles: [
      {
        title: "Paraguay residency in 45 days: the real timeline",
        angle: "Replaces the 90-day figure everyone still quotes.",
      },
      {
        title: "The 4 documents that restart your residency file",
        angle: "Names the mistake before the viewer makes it.",
      },
      {
        title: "Why your apostille must happen before you fly",
        angle: "The one step that cannot be fixed on arrival.",
      },
      {
        title: "I checked the migraciones timeline so you don't have to",
        angle: "Saves the viewer the research.",
      },
      {
        title: "Paraguay residency: what 'complete file' actually means",
        angle: "The condition hidden behind the headline number.",
      },
      {
        title: "Your police certificate expires. Here's when.",
        angle: "A deadline most applicants discover too late.",
      },
      {
        title: "The full cost of Paraguay residency, line by line",
        angle: "The fee is not the total, and viewers budget wrong.",
      },
      {
        title: "90 days or 45? Paraguay residency, 2026",
        angle: "A direct contradiction the viewer wants settled.",
      },
      {
        title: "Moving to Paraguay: do this before you book a flight",
        angle: "Ordering advice the viewer can act on today.",
      },
      {
        title: "Paraguay residency mistakes that cost you months",
        angle: "Loss aversion, with specifics.",
      },
    ],
  },

  // The model's half of a script body — `generateScript` adds version,
  // language, topic, chosenTitle and targetMinutes. Deliberately imperfect in
  // the two ways `assembleScriptBody` repairs: source "s3" has no usable URL
  // (dropped, its section gets an UNSOURCED talking point) and a section cites
  // "s9", which does not exist. "s2"'s claim carries a fee, so it is flagged
  // even though the model said false.
  script: {
    titleOptions: [
      {
        title: "Paraguay residency in 45 days: the real timeline",
        angle: "Replaces the 90-day figure.",
      },
      {
        title: "The 4 documents that restart your residency file",
        angle: "Names the mistake first.",
      },
      {
        title: "90 days or 45? Paraguay residency, 2026",
        angle: "A contradiction the viewer wants settled.",
      },
    ],
    thumbnailConcepts: [
      {
        description: "Calendar with 90 crossed out and 45 circled",
        textOverlay: "45 DAYS",
        imagePrompt:
          "Close-up of a paper wall calendar, the number 90 crossed out in red marker, soft daylight, shallow depth of field",
      },
      {
        description: "Four documents fanned out on a wooden desk",
        textOverlay: "",
        imagePrompt:
          "Overhead shot of four official-looking blank documents fanned on a warm wooden desk, natural window light",
      },
      {
        description: "Passport next to a stamped folder",
        textOverlay: "DO THIS FIRST",
        imagePrompt:
          "A closed passport beside a manila folder with a generic stamp, top-down, clean studio light",
      },
    ],
    hook: {
      spokenLines: [
        "Everyone still says ninety days.",
        "That number changed.",
        "Here is the real timeline, and the one thing that breaks it.",
      ],
      onScreenText: ["90 → 45 days"],
      broll: [
        {
          spokenLine: "Everyone still says ninety days.",
          description: "Calendar pages flipping",
          imagePrompt: "Paper calendar on a desk, pages mid-flip, warm morning light, photographic",
          videoPrompt: "Pages flip quickly from left to right, slow push-in",
          aspectRatio: "16:9",
        },
      ],
    },
    sections: [
      {
        heading: "The real timeline",
        spokenLines: [
          "A complete application now takes about forty-five days.",
          "That comes from the migraciones office itself.",
          "Complete is the key word.",
        ],
        talkingPoints: ["Show the official page on screen.", "Say the date the rule changed."],
        onScreenText: ["~45 days (complete files)"],
        broll: [
          {
            spokenLine: "A complete application now takes about forty-five days.",
            description: "Stopwatch on a stack of forms",
            imagePrompt:
              "Analog stopwatch resting on a neat stack of blank forms, soft side light, photographic",
            videoPrompt: "",
            aspectRatio: "16:9",
          },
        ],
        sourceIds: ["s1", "s9"],
      },
      {
        heading: "What it costs",
        spokenLines: [
          "The fee is not the total.",
          "Translations and apostilles add up.",
          "Budget for all of it before you start.",
        ],
        talkingPoints: ["Walk the cost table line by line."],
        onScreenText: ["Fee + translations + apostilles"],
        broll: [
          {
            spokenLine: "Translations and apostilles add up.",
            description: "Receipts spread on a table",
            imagePrompt:
              "Several blank paper receipts spread on a table next to a calculator, top-down, natural light",
            videoPrompt: "Slow pan across the receipts from left to right",
            aspectRatio: "9:16",
          },
        ],
        sourceIds: ["s2", "s3"],
      },
    ],
    cta: {
      spokenLines: ["Check your police certificate's expiry date today.", "Then book the flight."],
      onScreenText: ["Check expiry → then book"],
    },
    sources: [
      {
        id: "s1",
        claim: "Complete residency applications are processed in about 45 days.",
        url: "https://example.gov.py/migraciones/plazos",
        title: "Dirección General de Migraciones",
        verifyBeforeRecording: true,
      },
      {
        id: "s2",
        claim: "The application fee is separate from translation and apostille costs.",
        url: "https://example.com/py-residency-2026",
        title: "Residency cost guide",
        verifyBeforeRecording: false,
      },
      {
        id: "s3",
        claim: "Sworn translations cost around 150,000 guaraníes per page.",
        url: "not a url",
        title: "",
        verifyBeforeRecording: false,
      },
    ],
  },
};

/**
 * What each call reports having used.
 *
 * Chosen so every branch of `readUsage` and `costUsdAtRates` is exercised by at
 * least one call: `analysis` carries a cached prefix (so the subtraction from
 * `promptTokenCount` is provable from the stored `analyses` columns), `ideas`
 * carries reasoning tokens (so billing them at the output rate is provable from
 * `spend_log`), and the two cheap calls carry neither, which is the ordinary
 * case. Every figure is plausible for the prompt that produced it — a
 * transcript-sized input for an analysis, a couple of paragraphs for an adapt.
 */
export const USAGE: Record<FakeResponseKind, GenerateContentResponseUsageMetadata> = {
  learn: {
    promptTokenCount: 2_400,
    candidatesTokenCount: 420,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 2_820,
  },
  reply: {
    promptTokenCount: 1_800,
    candidatesTokenCount: 120,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 1_920,
  },
  gaps: {
    promptTokenCount: 6_500,
    candidatesTokenCount: 900,
    thoughtsTokenCount: 600,
    cachedContentTokenCount: 0,
    totalTokenCount: 8_000,
  },
  post: {
    promptTokenCount: 5_200,
    candidatesTokenCount: 1_900,
    thoughtsTokenCount: 800,
    cachedContentTokenCount: 0,
    totalTokenCount: 7_900,
  },
  // A 40-second reel sent inline at default resolution.
  transcript: {
    promptTokenCount: 12_400,
    candidatesTokenCount: 420,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 12_820,
  },
  ideas: {
    promptTokenCount: 4_200,
    candidatesTokenCount: 3_100,
    thoughtsTokenCount: 1_900,
    cachedContentTokenCount: 0,
    totalTokenCount: 9_200,
  },
  adapt: {
    promptTokenCount: 1_200,
    candidatesTokenCount: 480,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 1_680,
  },
  analysis: {
    promptTokenCount: 7_400,
    candidatesTokenCount: 2_400,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 1_400,
    totalTokenCount: 9_800,
  },
  screening: {
    promptTokenCount: 900,
    candidatesTokenCount: 60,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 960,
  },
  outline: {
    promptTokenCount: 500,
    candidatesTokenCount: 650,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: 0,
    totalTokenCount: 1_150,
  },
  titles: {
    promptTokenCount: 1_100,
    candidatesTokenCount: 520,
    thoughtsTokenCount: 700,
    cachedContentTokenCount: 0,
    totalTokenCount: 2_320,
  },
  script: {
    promptTokenCount: 3_600,
    candidatesTokenCount: 4_800,
    thoughtsTokenCount: 2_400,
    cachedContentTokenCount: 0,
    totalTokenCount: 10_800,
  },
};

/**
 * The searches a grounded call reports having run — three, per §5.O5.1.
 *
 * Billed per query at $14/1,000, so the count is money: a test that asserts
 * `spend_log` is asserting that `groundingQueryCount` read this list correctly.
 */
export const WEB_SEARCH_QUERIES = [
  "paraguay residency processing time 2026",
  "migraciones paraguay plazo residencia",
  "apostille requirement paraguay residency",
] as const;

// ---------------------------------------------------------------------------
// the no-captions fallback (PLAN.md §1.35, O7)
// ---------------------------------------------------------------------------

/**
 * The fallback asks for the same analysis schema as the caption path — that is
 * the point of it — so the schema alone classifies it as `analysis`. What
 * tells it apart is the request itself: a `fileData` part carrying the YouTube
 * URL. It gets its own payload and usage, because a video is billed very
 * differently from a transcript and the test must see that difference.
 */
export const FALLBACK_PAYLOAD = {
  ...(PAYLOADS.analysis as JsonObject),
  summary:
    "Watched without captions: a presenter at a desk walks through the Paraguayan residency paperwork, holding up each document as it is named, with the costs shown on screen at the end.",
};

/**
 * ~31 minutes at LOW media resolution (~100 tokens per second of video and
 * audio). Well under the fallback's reservation for that length, as a real run
 * must be — a usage above the reservation would mean the estimate is wrong.
 */
export const FALLBACK_USAGE: GenerateContentResponseUsageMetadata = {
  promptTokenCount: 188_700,
  candidatesTokenCount: 2_600,
  thoughtsTokenCount: 0,
  cachedContentTokenCount: 0,
  totalTokenCount: 191_300,
};

/**
 * The fallback is an *analysis* request carrying a file URI. Clip
 * transcription (§1.44) also attaches media, and answers in its own schema.
 */
function isVideoUrlFallback(params: GenerateContentParameters, kind: FakeResponseKind): boolean {
  return kind === "analysis" && isVideoUrlRequest(params);
}

/** Does this request attach a file by URI — i.e. is it the video-URL fallback? */
export function isVideoUrlRequest(params: GenerateContentParameters): boolean {
  const contents = Array.isArray(params.contents) ? params.contents : [params.contents];
  return contents.some(
    (content) =>
      typeof content === "object" &&
      content !== null &&
      "parts" in content &&
      (content.parts ?? []).some((part) => Boolean(part.fileData?.fileUri)),
  );
}

// ---------------------------------------------------------------------------
// building responses
// ---------------------------------------------------------------------------

/** Is this request asking for Search grounding? `/api/generate` and script generation do. */
function isGrounded(params: GenerateContentParameters): boolean {
  return (params.config?.tools ?? []).some((tool) => "googleSearch" in tool);
}

type ResponseParts = {
  text: string;
  usageMetadata?: GenerateContentResponseUsageMetadata;
  webSearchQueries?: readonly string[];
  finishReason?: FinishReason;
};

/**
 * A real `GenerateContentResponse` instance — not a plain object with the same
 * fields. The SDK's `text` getter lives on the prototype, and the interactive
 * paths read it; a lookalike would exercise `responseText`'s fallback branch
 * instead and leave the branch that actually runs in production untested.
 */
function sdkResponse(parts: ResponseParts): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), {
    modelVersion: "fake-gemini",
    responseId: `fake-${nextId()}`,
    candidates: [
      {
        content: { role: "model", parts: [{ text: parts.text }] },
        finishReason: parts.finishReason ?? FinishReason.STOP,
        index: 0,
        ...(parts.webSearchQueries
          ? { groundingMetadata: { webSearchQueries: [...parts.webSearchQueries] } }
          : {}),
      },
    ],
    ...(parts.usageMetadata ? { usageMetadata: parts.usageMetadata } : {}),
  });
}

let counter = 0;
function nextId(): number {
  return ++counter;
}

/**
 * Split a string into `n` roughly equal pieces, so a streamed answer arrives in
 * fragments the way a real one does — the concatenation, not any single chunk,
 * is the JSON.
 */
function fragments(text: string, n: number): string[] {
  const size = Math.ceil(text.length / n);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

// ---------------------------------------------------------------------------
// the fake client
// ---------------------------------------------------------------------------

export type FakeCall = {
  kind: "generateContent" | "generateContentStream" | "batches.create" | "batches.get";
  /** The request shape, as classified from its schema. Null for batch calls. */
  responseKind: FakeResponseKind | null;
  model?: string;
  /** Exactly what the caller sent, for asserting the prompt reached the model. */
  params: unknown;
  /** What this call reported using, so a test can price it with `pricing.ts`. */
  usageMetadata?: GenerateContentResponseUsageMetadata;
  /** How many Search queries the response claimed. 0 for an ungrounded call. */
  groundingQueries: number;
};

/** Levers a test pulls to drive a path that is not the happy one. */
export type FakeControls = {
  /**
   * The state `batches.get` reports. `JOB_STATE_SUCCEEDED` (the default) is the
   * only state `mapProviderStatus` calls collectable; set it to anything else to
   * exercise the still-in-flight branch.
   */
  batchState: JobState;
  /** `custom_id` → error, to fail individual entries of an otherwise fine batch. */
  batchEntryErrors: Map<string, JobError>;
  /**
   * Answer interactive calls of a kind with this payload instead. Still checked
   * against the caller's schema, so it drives a schema-valid answer the app
   * must reject on its own (e.g. a one-slide carousel) — never a shape the real
   * API could not return.
   */
  payloadOverrides: Map<FakeResponseKind, unknown>;
};

export class FakeGemini {
  /** Every call, in order. */
  readonly calls: FakeCall[] = [];
  readonly controls: FakeControls = {
    batchState: JobState.JOB_STATE_SUCCEEDED,
    batchEntryErrors: new Map(),
    payloadOverrides: new Map(),
  };

  /** Requests as submitted, keyed by the job name `batches.create` handed back. */
  private readonly submitted = new Map<string, InlinedRequest[]>();

  readonly models = {
    generateContent: async (
      params: GenerateContentParameters,
    ): Promise<GenerateContentResponse> => {
      const kind = this.record(params);
      if (isVideoUrlFallback(params, kind)) {
        return sdkResponse({
          text: JSON.stringify(FALLBACK_PAYLOAD),
          usageMetadata: FALLBACK_USAGE,
        });
      }
      return sdkResponse({
        text: JSON.stringify(this.payloadFor(kind)),
        usageMetadata: USAGE[kind],
        webSearchQueries: isGrounded(params) ? WEB_SEARCH_QUERIES : undefined,
      });
    },

    generateContentStream: async (
      params: GenerateContentParameters,
    ): Promise<AsyncGenerator<GenerateContentResponse>> => {
      const kind = this.record(params, "generateContentStream");
      const grounded = isGrounded(params);
      const pieces = fragments(JSON.stringify(this.payloadFor(kind)), 3);

      // Grounding metadata is split across chunks on purpose. Whether the real
      // API repeats the full list on every chunk or dribbles it out is not
      // documented either way, which is why generateContentPlan unions the
      // queries it sees as well as taking the per-chunk maximum. Splitting here
      // is what proves the union half of that is doing something: no single
      // chunk carries all three.
      const queriesByChunk: (readonly string[] | undefined)[] = grounded
        ? [WEB_SEARCH_QUERIES.slice(0, 2), WEB_SEARCH_QUERIES.slice(2), undefined]
        : [undefined, undefined, undefined];

      async function* stream(): AsyncGenerator<GenerateContentResponse> {
        for (const [index, piece] of pieces.entries()) {
          const last = index === pieces.length - 1;
          yield sdkResponse({
            text: piece,
            // Usage arrives cumulatively, with the totals on the final chunk —
            // the assumption generateContentPlan's "last one seen" is built on.
            usageMetadata: last ? USAGE[kind] : undefined,
            webSearchQueries: queriesByChunk[index],
            finishReason: last ? FinishReason.STOP : undefined,
          });
        }
      }
      return stream();
    },
  };

  readonly batches = {
    create: async (params: CreateBatchJobParameters): Promise<BatchJob> => {
      // This app only ever submits inlined requests (see submitAnalysisBatch's
      // note on why); a GCS or BigQuery source would be a new code path, not a
      // new canned response, so it is refused rather than quietly answered.
      if (!Array.isArray(params.src)) {
        throw new Error(
          "ai-fake: batches.create was given a non-inlined source. This app submits " +
            "inlined requests only — see src/lib/analysis/batch.ts.",
        );
      }
      const requests: InlinedRequest[] = params.src;
      // Validated at submission, not at collection: a batch whose requests carry
      // a schema this fake cannot answer should fail where it was built.
      for (const request of requests) classifySchema(request.config?.responseJsonSchema);

      const name = `batches/fake-${nextId()}`;
      this.submitted.set(name, requests);
      this.calls.push({
        kind: "batches.create",
        responseKind: null,
        model: params.model,
        params,
        groundingQueries: 0,
      });

      return {
        name,
        model: params.model,
        state: JobState.JOB_STATE_PENDING,
        createTime: new Date().toISOString(),
      };
    },

    get: async (params: GetBatchJobParameters): Promise<BatchJob> => {
      const requests = this.submitted.get(params.name);
      if (!requests) throw new Error(`ai-fake: no such batch job "${params.name}"`);

      this.calls.push({
        kind: "batches.get",
        responseKind: null,
        params,
        groundingQueries: 0,
      });

      const state = this.controls.batchState;
      if (state !== JobState.JOB_STATE_SUCCEEDED) {
        return { name: params.name, state };
      }

      const inlinedResponses: InlinedResponse[] = requests.map((request) => {
        const metadata = request.metadata ?? {};
        const customId = metadata["custom_id"];
        const failure =
          customId === undefined ? undefined : this.controls.batchEntryErrors.get(customId);
        if (failure) return { metadata, error: failure };

        const kind = classifySchema(request.config?.responseJsonSchema);
        const payload = PAYLOADS[kind];
        validate(payload, request.config?.responseJsonSchema);

        // Round-tripped through JSON, which is what the SDK hands back for
        // `inlinedResponses` and is the whole reason `responseText` has a parts
        // fallback: a prototype-less object's `text` getter is `undefined`, and
        // reading that as an empty answer would fail every analysis in the batch
        // while still billing for it.
        const response = JSON.parse(
          JSON.stringify(
            sdkResponse({ text: JSON.stringify(payload), usageMetadata: USAGE[kind] }),
          ),
        ) as GenerateContentResponse;

        return { metadata, response };
      });

      return {
        name: params.name,
        state,
        dest: { inlinedResponses },
        endTime: new Date().toISOString(),
      };
    },
  };

  /** Forget every recorded call and every submitted batch. */
  reset(): void {
    this.calls.length = 0;
    this.submitted.clear();
    this.controls.batchState = JobState.JOB_STATE_SUCCEEDED;
    this.controls.batchEntryErrors.clear();
    this.controls.payloadOverrides.clear();
  }

  private payloadFor(kind: FakeResponseKind): unknown {
    return this.controls.payloadOverrides.has(kind)
      ? this.controls.payloadOverrides.get(kind)
      : PAYLOADS[kind];
  }

  /** Calls of one kind, for the common "what did the app send?" assertion. */
  callsOf(kind: FakeCall["kind"]): FakeCall[] {
    return this.calls.filter((call) => call.kind === kind);
  }

  private record(
    params: GenerateContentParameters,
    as: FakeCall["kind"] = "generateContent",
  ): FakeResponseKind {
    const schema = params.config?.responseJsonSchema;
    const kind = classifySchema(schema);
    // The canned answer is checked against the caller's own schema on every
    // call, not once at module load: the schema travels with the request, and
    // this is the only place both halves are in the same scope.
    const videoUrl = isVideoUrlFallback(params, kind);
    validate(videoUrl ? FALLBACK_PAYLOAD : this.payloadFor(kind), schema);

    this.calls.push({
      kind: as,
      responseKind: kind,
      model: params.model,
      params,
      usageMetadata: videoUrl ? FALLBACK_USAGE : USAGE[kind],
      groundingQueries: isGrounded(params) ? WEB_SEARCH_QUERIES.length : 0,
    });
    return kind;
  }
}

// ---------------------------------------------------------------------------
// the seam
// ---------------------------------------------------------------------------

/**
 * Whether this process talks to the fake instead of Google (§1.16).
 *
 * Two ways in. `GEMINI_FAKE=1` is the explicit one, and the one CI sets. The
 * second — no key at all under `NODE_ENV=test` — exists so a test run that
 * forgets the flag fails on an assertion rather than reaching for a credential
 * it does not have, or worse, finding one.
 */
export function fakeGeminiEnabled(): boolean {
  if (process.env.GEMINI_FAKE === "1") return true;
  return process.env.NODE_ENV === "test" && !process.env.GEMINI_API_KEY;
}

let shared: FakeGemini | undefined;

/**
 * The process-wide fake. One instance, so a test can read `calls` after driving
 * a route that constructed its own client reference several modules away.
 */
export function fakeGeminiClient(): FakeGemini {
  shared ??= new FakeGemini();
  return shared;
}

/** Drop every recorded call — call it between tests, as `resetTables` is called. */
export function resetFakeGemini(): void {
  shared?.reset();
}

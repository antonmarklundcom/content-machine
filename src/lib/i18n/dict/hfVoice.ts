/** Narration with Higgsfield engines through the bridge (build 5 §3.A). */

export const en = {
  "hfVoice.settings": "Higgsfield voice",
  "hfVoice.field.model": "Engine",
  "hfVoice.field.variant": "Variant",
  "hfVoice.field.voiceType": "Voice type",
  "hfVoice.field.voiceType.preset": "Preset (built-in voice)",
  "hfVoice.field.voiceType.element": "Element (cloned voice — needs signed consent)",
  "hfVoice.field.voiceId": "Higgsfield voice id",
  "hfVoice.field.voiceIdHelp":
    "Run list_voices in Claude Code, or copy the id from Higgsfield (a cloned voice is an element id).",
  "hfVoice.field.price": "≈ {credits} credits per minute of speech",
  "hfVoice.field.priceUnmeasured": "≈ {credits} credits per minute (not measured — estimated high)",
  "hfVoice.field.noSpanish": "This engine lists no Spanish.",
  "hfVoice.field.elementNote":
    "A cloned voice is a person: record their consent below. It makes takes only once the consent is signed.",
  "hfVoice.error.model": "Pick a Higgsfield engine.",
  "hfVoice.error.variant": "text2speech_v2 needs a variant.",
  "hfVoice.error.elementConsent":
    "A cloned (element) voice needs a consent record: set the consent to pending or signed and name the person.",
  "hfVoice.batch.title": "Narrate with Higgsfield",
  "hfVoice.batch.storyIntro":
    "Every approved line in {language} without a usable take, as one batch.",
  "hfVoice.batch.scriptIntro": "Every spoken block of this script, as one batch.",
  "hfVoice.batch.voice": "Voice",
  "hfVoice.batch.noProfiles": "No Higgsfield voice profile yet. Add one in Voice profiles.",
  "hfVoice.batch.estimating": "Counting lines…",
  "hfVoice.batch.summary": "{lines} line(s) · ≈ {credits} credits",
  "hfVoice.batch.nothing": "Nothing to voice: every line has a usable take or is queued.",
  "hfVoice.batch.refused": "{count} line(s) left out:",
  "hfVoice.batch.maxCredits": "Credit ceiling",
  "hfVoice.batch.maxCreditsHint":
    "The run checks the balance and get_cost first and stops before passing the ceiling. The estimate is this app's; Higgsfield's price is the truth.",
  "hfVoice.batch.start": "Queue",
  "hfVoice.batch.open": "Open",
  "hfVoice.batch.dismiss": "Close",
  "hfVoice.batch.queued":
    "Job #{id} queued: {lines} line(s), ≈ {credits} credits. Status: {status}.",
  "hfVoice.batch.openJob": "See the run on /higgsfield",
  "hfVoice.batch.pcOnly": "Runs on the PC only (Claude Code + the Higgsfield MCP).",
  "hfVoice.line.button": "Higgsfield",
  "hfVoice.line.estimate": "≈ {credits} credits",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "hfVoice.settings": "Higgsfield-röst",
  "hfVoice.field.model": "Motor",
  "hfVoice.field.variant": "Variant",
  "hfVoice.field.voiceType": "Rösttyp",
  "hfVoice.field.voiceType.preset": "Förval (inbyggd röst)",
  "hfVoice.field.voiceType.element": "Element (klonad röst — kräver signerat samtycke)",
  "hfVoice.field.voiceId": "Higgsfield-röst-id",
  "hfVoice.field.voiceIdHelp":
    "Kör list_voices i Claude Code, eller kopiera id:t från Higgsfield (en klonad röst är ett element-id).",
  "hfVoice.field.price": "≈ {credits} krediter per minut tal",
  "hfVoice.field.priceUnmeasured": "≈ {credits} krediter per minut (inte uppmätt — högt räknat)",
  "hfVoice.field.noSpanish": "Den här motorn har ingen spanska.",
  "hfVoice.field.elementNote":
    "En klonad röst är en person: registrera samtycket nedan. Den gör tagningar först när samtycket är signerat.",
  "hfVoice.error.model": "Välj en Higgsfield-motor.",
  "hfVoice.error.variant": "text2speech_v2 behöver en variant.",
  "hfVoice.error.elementConsent":
    "En klonad röst (element) behöver ett samtycke: sätt samtycket till väntande eller signerat och ange personen.",
  "hfVoice.batch.title": "Läs in med Higgsfield",
  "hfVoice.batch.storyIntro":
    "Varje godkänd rad på {language} utan användbar tagning, i en körning.",
  "hfVoice.batch.scriptIntro": "Varje talat block i manuset, i en körning.",
  "hfVoice.batch.voice": "Röst",
  "hfVoice.batch.noProfiles": "Ingen Higgsfield-röstprofil än. Lägg till en under Röstprofiler.",
  "hfVoice.batch.estimating": "Räknar rader…",
  "hfVoice.batch.summary": "{lines} rad(er) · ≈ {credits} krediter",
  "hfVoice.batch.nothing": "Inget att läsa in: varje rad har en användbar tagning eller står i kö.",
  "hfVoice.batch.refused": "{count} rad(er) utelämnade:",
  "hfVoice.batch.maxCredits": "Kredittak",
  "hfVoice.batch.maxCreditsHint":
    "Körningen kollar saldot och get_cost först och stannar innan taket passeras. Uppskattningen är appens; Higgsfields pris gäller.",
  "hfVoice.batch.start": "Lägg i kö",
  "hfVoice.batch.open": "Öppna",
  "hfVoice.batch.dismiss": "Stäng",
  "hfVoice.batch.queued":
    "Jobb #{id} i kö: {lines} rad(er), ≈ {credits} krediter. Status: {status}.",
  "hfVoice.batch.openJob": "Se körningen på /higgsfield",
  "hfVoice.batch.pcOnly": "Körs bara på datorn (Claude Code + Higgsfield-MCP).",
  "hfVoice.line.button": "Higgsfield",
  "hfVoice.line.estimate": "≈ {credits} krediter",
};

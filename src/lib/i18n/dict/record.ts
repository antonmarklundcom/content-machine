/** The recording studio — a teleprompter that records each line (build 5 §3.B). */

export const en = {
  "record.title": "Recording studio",
  "record.intro":
    "A narrator reads a story or a script line by line from the teleprompter. Every kept take is saved with its exact approved text as a manual take: narration now, training data later.",
  "record.ownerOnly": "Only the owner can run recording sessions.",

  "record.setup.source": "What to read",
  "record.setup.pickSource": "Pick a story language or a script…",
  "record.setup.stories": "Stories",
  "record.setup.scripts": "Studio scripts",
  "record.setup.profile": "Speaker (voice profile)",
  "record.setup.pickProfile": "Pick the speaker…",
  "record.setup.start": "Open session",
  "record.setup.noSources":
    "Nothing to read yet: import the cuentos books on /stories or write a script.",
  "record.setup.noProfiles":
    "No speaker profile yet. Add one on /voice with provider “manual” (and the person's signed consent if the recordings may train a voice).",

  "record.error.notFound": "That story, script or speaker profile was not found.",
  "record.error.owner": "Only the owner can use the recording studio.",
  "record.error.failed": "Saving the take failed.",
  "record.error.mic": "The microphone could not be opened. Allow microphone access in the browser.",
  "record.error.recorder": "This browser cannot record audio here.",

  "record.tips.title": "Before you start",
  "record.tips.room":
    "Quiet room with soft surfaces (curtains, a sofa, clothes). No fridge, fan or street noise; phone on silent.",
  "record.tips.mic":
    "Same microphone and the same distance all session: about a hand's width (15–20 cm), slightly off to the side to avoid pops.",
  "record.tips.levels":
    "Keep levels steady: speech peaks around −12 to −6 dB on the meter, never red. Don't touch the gain once you start.",
  "record.tips.water": "Water at room temperature within reach; no milk or coffee right before.",
  "record.tips.posture":
    "Sit or stand the same way every time, and leave a short breath of silence before and after each line.",
  "record.break.title": "Break timer",
  "record.break.due": "Time for a break: 5 minutes, water, rest the voice.",
  "record.break.reset": "I took a break — restart",
  "record.minutes.title": "Minutes recorded",
  "record.minutes.none": "Nothing recorded yet.",
  "record.minutes.language": "Language",
  "record.minutes.profile": "Speaker",
  "record.minutes.takes": "Takes",
  "record.minutes.minutes": "Min",
  "record.minutes.unnamed": "(no profile)",

  "record.progress.lines": "{recorded}/{total} lines recorded",
  "record.progress.minutes": "{minutes} min",
  "record.progress.locked": "{count} locked",
  "record.progress.done": "All lines recorded",
  "record.refused": "This speaker cannot record here:",

  "record.line.recorded": "recorded ×{count}",
  "record.line.selected": "slot has a selected take",
  "record.line.locked": "locked",
  "record.lock.missing_text": "No text in this language.",
  "record.lock.status_unknown": "The text has no review status yet.",
  "record.lock.not_approved": "The text is not approved yet.",
  "record.lock.pending_notice": "The text still carries a review notice.",
  "record.lock.no_voice_language": "This language cannot be recorded.",
  "record.noLines": "This source has no lines.",

  "record.mic.device": "Microphone",
  "record.mic.default": "Default microphone",
  "record.mic.on": "Turn on microphone",
  "record.mic.off": "Turn off microphone",
  "record.mic.level": "Input level",
  "record.mic.hint": "Turn on the microphone to see the level and record.",
  "record.countIn": "3-2-1 count-in",
  "record.autoSelect": "Use the take when the line has none selected",

  "record.record": "Record",
  "record.stop": "Stop",
  "record.redo": "Redo",
  "record.keep": "Keep & next",
  "record.saving": "Saving…",
  "record.prev": "Previous",
  "record.next": "Next",
  "record.kept": "Kept {line} ({seconds} s).",
  "record.kept.selected": "Kept {line} ({seconds} s) and selected it for the line.",
  "record.analysis": "{seconds} s · peak {peak} dB · silence {lead} s before, {tail} s after",
  "record.analysing": "Checking the take…",
  "record.warn.silent": "No sound was recorded. Check the microphone.",
  "record.warn.clipping": "Clipping: the voice hit the top. Lower the gain or move back a little.",
  "record.warn.quiet": "Very quiet. Move a little closer or raise the gain (then keep it there).",
  "record.warn.start_cut": "The first word may be cut off: wait a beat after starting.",
  "record.warn.end_cut": "The last word may be cut off: wait a beat before stopping.",
  "record.warn.long_lead": "Long silence before the line.",
  "record.warn.long_tail": "Long silence after the line.",
  "record.warn.too_short": "Much shorter than the text suggests: was the whole line read?",
  "record.warn.too_long": "Much longer than the text suggests: long pauses or a restart?",
  "record.keys": "Keys: Space record/stop · Enter keep & next · R redo · ←/→ previous/next line",
  "record.lines.title": "All lines ({count})",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "record.title": "Inspelningsstudio",
  "record.intro":
    "En berättare läser en saga eller ett manus rad för rad från telepromptern. Varje sparad tagning sparas med sin exakta godkända text som en manuell tagning: berättarröst nu, träningsdata senare.",
  "record.ownerOnly": "Bara ägaren kan köra inspelningar.",

  "record.setup.source": "Vad ska läsas",
  "record.setup.pickSource": "Välj ett sagospråk eller ett manus…",
  "record.setup.stories": "Sagor",
  "record.setup.scripts": "Studiomanus",
  "record.setup.profile": "Talare (röstprofil)",
  "record.setup.pickProfile": "Välj talare…",
  "record.setup.start": "Öppna session",
  "record.setup.noSources":
    "Inget att läsa än: importera cuentos-böckerna på /stories eller skriv ett manus.",
  "record.setup.noProfiles":
    "Ingen talarprofil än. Lägg till en på /voice med leverantör ”manual” (och personens signerade samtycke om inspelningarna får träna en röst).",

  "record.error.notFound": "Sagan, manuset eller talarprofilen hittades inte.",
  "record.error.owner": "Bara ägaren kan använda inspelningsstudion.",
  "record.error.failed": "Det gick inte att spara tagningen.",
  "record.error.mic": "Mikrofonen kunde inte öppnas. Tillåt mikrofonåtkomst i webbläsaren.",
  "record.error.recorder": "Den här webbläsaren kan inte spela in ljud här.",

  "record.tips.title": "Innan du börjar",
  "record.tips.room":
    "Tyst rum med mjuka ytor (gardiner, soffa, kläder). Inget kylskåp, fläkt eller gatubuller; telefonen på ljudlöst.",
  "record.tips.mic":
    "Samma mikrofon och samma avstånd hela sessionen: ungefär en handsbredd (15–20 cm), lite snett för att undvika smällar.",
  "record.tips.levels":
    "Håll jämna nivåer: talet toppar runt −12 till −6 dB på mätaren, aldrig rött. Rör inte förstärkningen när du har börjat.",
  "record.tips.water": "Rumstempererat vatten inom räckhåll; ingen mjölk eller kaffe precis innan.",
  "record.tips.posture":
    "Sitt eller stå likadant varje gång, och lämna ett kort andetag tystnad före och efter varje rad.",
  "record.break.title": "Paustimer",
  "record.break.due": "Dags för paus: 5 minuter, vatten, vila rösten.",
  "record.break.reset": "Jag har tagit paus — starta om",
  "record.minutes.title": "Inspelade minuter",
  "record.minutes.none": "Inget inspelat än.",
  "record.minutes.language": "Språk",
  "record.minutes.profile": "Talare",
  "record.minutes.takes": "Tagningar",
  "record.minutes.minutes": "Min",
  "record.minutes.unnamed": "(ingen profil)",

  "record.progress.lines": "{recorded}/{total} rader inspelade",
  "record.progress.minutes": "{minutes} min",
  "record.progress.locked": "{count} låsta",
  "record.progress.done": "Alla rader inspelade",
  "record.refused": "Den här talaren kan inte spela in här:",

  "record.line.recorded": "inspelad ×{count}",
  "record.line.selected": "raden har en vald tagning",
  "record.line.locked": "låst",
  "record.lock.missing_text": "Ingen text på det här språket.",
  "record.lock.status_unknown": "Texten har ingen granskningsstatus än.",
  "record.lock.not_approved": "Texten är inte godkänd än.",
  "record.lock.pending_notice": "Texten har fortfarande en granskningsnotis.",
  "record.lock.no_voice_language": "Det här språket kan inte spelas in.",
  "record.noLines": "Källan har inga rader.",

  "record.mic.device": "Mikrofon",
  "record.mic.default": "Standardmikrofon",
  "record.mic.on": "Slå på mikrofonen",
  "record.mic.off": "Stäng av mikrofonen",
  "record.mic.level": "Insignalsnivå",
  "record.mic.hint": "Slå på mikrofonen för att se nivån och spela in.",
  "record.countIn": "Nedräkning 3-2-1",
  "record.autoSelect": "Använd tagningen när raden saknar vald tagning",

  "record.record": "Spela in",
  "record.stop": "Stoppa",
  "record.redo": "Gör om",
  "record.keep": "Behåll & nästa",
  "record.saving": "Sparar…",
  "record.prev": "Föregående",
  "record.next": "Nästa",
  "record.kept": "Sparade {line} ({seconds} s).",
  "record.kept.selected": "Sparade {line} ({seconds} s) och valde den för raden.",
  "record.analysis": "{seconds} s · topp {peak} dB · tystnad {lead} s före, {tail} s efter",
  "record.analysing": "Kontrollerar tagningen…",
  "record.warn.silent": "Inget ljud spelades in. Kontrollera mikrofonen.",
  "record.warn.clipping":
    "Klippning: rösten slog i taket. Sänk förstärkningen eller flytta dig lite bakåt.",
  "record.warn.quiet":
    "Mycket tyst. Flytta dig lite närmare eller höj förstärkningen (och låt den sedan vara).",
  "record.warn.start_cut": "Första ordet kan vara avklippt: vänta ett ögonblick efter start.",
  "record.warn.end_cut": "Sista ordet kan vara avklippt: vänta ett ögonblick innan du stoppar.",
  "record.warn.long_lead": "Lång tystnad före raden.",
  "record.warn.long_tail": "Lång tystnad efter raden.",
  "record.warn.too_short": "Mycket kortare än texten antyder: lästes hela raden?",
  "record.warn.too_long": "Mycket längre än texten antyder: långa pauser eller en omstart?",
  "record.keys":
    "Tangenter: Mellanslag spela in/stoppa · Enter behåll & nästa · R gör om · ←/→ föregående/nästa rad",
  "record.lines.title": "Alla rader ({count})",
};

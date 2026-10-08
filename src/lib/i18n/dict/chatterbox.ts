/** The Chatterbox voice provider — local server or Replicate (build 5 §3.D). */

export const en = {
  "chatterbox.settings": "Chatterbox",
  "chatterbox.settings.help":
    "Clones the reference sample you upload below the profile. Local = the free server on this PC (slow, CPU); Replicate = a few cents per clip.",
  "chatterbox.field.mode": "Where it runs",
  "chatterbox.mode.local": "This PC (local server)",
  "chatterbox.mode.replicate": "Replicate (cloud)",
  "chatterbox.field.exaggeration": "Expressiveness (0.25–2)",
  "chatterbox.field.cfgWeight": "Pacing (0–1)",
  "chatterbox.field.languageId": "Language id",
  "chatterbox.reference.title": "Chatterbox reference sample",
  "chatterbox.reference.help":
    "About 10 seconds of the person speaking clearly in a quiet room. It is only the voice to copy: takes can be any length. Stored as WAV 24 kHz mono, at most 30 s.",
  "chatterbox.reference.current": "Current sample",
  "chatterbox.reference.none": "No sample yet.",
  "chatterbox.reference.upload": "Upload a sample",
  "chatterbox.reference.uploading": "Uploading…",
  "chatterbox.reference.saved": "Sample saved.",
  "chatterbox.reference.record": "Record 10 s",
  "chatterbox.reference.recording": "Recording… {seconds} s",
  "chatterbox.reference.stop": "Stop",
  "chatterbox.reference.noMic": "This browser cannot record (no microphone access).",
  "chatterbox.reference.consentNeeded":
    "A cloned voice needs the person's signed consent first. Upload it on the voice profile.",
  "chatterbox.reference.failed": "The upload failed.",
};

export const sv: Record<keyof typeof en, string> = {
  "chatterbox.settings": "Chatterbox",
  "chatterbox.settings.help":
    "Klonar röstprovet du laddar upp under profilen. Lokalt = den gratis servern på den här datorn (långsam, CPU); Replicate = några cent per klipp.",
  "chatterbox.field.mode": "Var den körs",
  "chatterbox.mode.local": "Den här datorn (lokal server)",
  "chatterbox.mode.replicate": "Replicate (moln)",
  "chatterbox.field.exaggeration": "Uttrycksfullhet (0,25–2)",
  "chatterbox.field.cfgWeight": "Tempo (0–1)",
  "chatterbox.field.languageId": "Språk-id",
  "chatterbox.reference.title": "Chatterbox-röstprov",
  "chatterbox.reference.help":
    "Cirka 10 sekunder där personen talar tydligt i ett tyst rum. Provet är bara rösten som ska efterliknas: tagningarna kan vara hur långa som helst. Sparas som WAV 24 kHz mono, högst 30 s.",
  "chatterbox.reference.current": "Nuvarande prov",
  "chatterbox.reference.none": "Inget prov än.",
  "chatterbox.reference.upload": "Ladda upp ett prov",
  "chatterbox.reference.uploading": "Laddar upp…",
  "chatterbox.reference.saved": "Provet sparat.",
  "chatterbox.reference.record": "Spela in 10 s",
  "chatterbox.reference.recording": "Spelar in… {seconds} s",
  "chatterbox.reference.stop": "Stoppa",
  "chatterbox.reference.noMic": "Den här webbläsaren kan inte spela in (ingen mikrofonåtkomst).",
  "chatterbox.reference.consentNeeded":
    "En klonad röst kräver personens undertecknade samtycke först. Ladda upp det på röstprofilen.",
  "chatterbox.reference.failed": "Uppladdningen misslyckades.",
};

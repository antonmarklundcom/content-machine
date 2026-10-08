/** The Higgsfield bridge: jobs run through Claude Code + the Higgsfield MCP (build 4 §3.H). */

export const en = {
  "higgsfield.title": "Higgsfield",
  "higgsfield.eyebrow": "Generate",
  "higgsfield.intro":
    "Runs the logged-in Claude Code CLI on this PC with the Higgsfield MCP. It spends your Higgsfield subscription credits, never more than the ceiling you set, and saves files to the media drive.",
  "higgsfield.pcOnly":
    "Only works where the app runs on your PC next to Claude Code — not on a hosted deploy.",
  "higgsfield.ownerOnly": "Only the owner can start Higgsfield runs.",

  "higgsfield.preflight.title": "Ready to run?",
  "higgsfield.preflight.check": "Check now",
  "higgsfield.preflight.checking": "Checking… (asks Claude Code a one-word question)",
  "higgsfield.preflight.notChecked":
    "Not checked yet. The check runs `claude --version`, a one-word ping and `claude mcp list`.",
  "higgsfield.preflight.ok": "Ready",
  "higgsfield.preflight.failed": "Not ready",
  "higgsfield.preflight.checkedAt": "Checked {time}",
  "higgsfield.check.media_root": "Media drive (MEDIA_ROOT)",
  "higgsfield.check.claude_binary": "Claude Code CLI",
  "higgsfield.check.claude_login": "Claude Code logged in",
  "higgsfield.check.higgsfield_mcp": "Higgsfield MCP available to the CLI",

  "higgsfield.fix.media_missing":
    "Plug in the media drive, or set MEDIA_ROOT in .env to a folder that exists, then restart the app.",
  "higgsfield.fix.media_unwritable":
    "The media drive is read-only. Check the drive, or point MEDIA_ROOT at a writable folder.",
  "higgsfield.fix.claude_missing":
    "Install Claude Code on this PC (see docs/HIGGSFIELD.md), or set CLAUDE_CLI_PATH to the `claude` program.",
  "higgsfield.fix.claude_logged_out":
    "Open a terminal, run `claude`, and sign in with /login using your Claude subscription.",
  "higgsfield.fix.claude_api_key":
    "ANTHROPIC_API_KEY is set, so runs bill that API key instead of your subscription. Remove it to use the subscription.",
  "higgsfield.fix.mcp_missing":
    "Add the Higgsfield MCP for the CLI: run `claude mcp add --transport http higgsfield <Higgsfield MCP URL>` (the URL is in Higgsfield's MCP setup page), or connect Higgsfield in claude.ai → Settings → Connectors. See docs/HIGGSFIELD.md.",
  "higgsfield.fix.mcp_failed":
    "The Higgsfield MCP is configured but did not connect. Run `claude mcp list` in a terminal to see why, then re-add it.",
  "higgsfield.fix.mcp_auth":
    "The Higgsfield MCP needs you to sign in: run `claude`, type /mcp, pick Higgsfield and authenticate.",

  "higgsfield.maxCredits": "Credit ceiling",
  "higgsfield.maxCreditsHint":
    "The run checks costs first and stops before spending more than this.",

  "higgsfield.free.title": "Free prompt",
  "higgsfield.free.intro":
    "Describe images or videos to make. They land in the inbox (_inbox/higgsfield/<date>/) for sorting.",
  "higgsfield.free.brand": "Brand (optional)",
  "higgsfield.free.noBrand": "No brand — unsorted",
  "higgsfield.free.description": "What to make",
  "higgsfield.free.placeholder":
    "e.g. three 4:5 photos of Asunción's skyline at dusk, warm light, no text",
  "higgsfield.free.submit": "Generate",

  "higgsfield.import.title": "Import my Higgsfield history",
  "higgsfield.import.intro":
    "Downloads past generations into the inbox. Spends no credits. Leave the range empty for everything since the last import.",
  "higgsfield.import.range": "Range (optional)",
  "higgsfield.import.rangePlaceholder": "since 2026-09-01 · last 50 · all",
  "higgsfield.import.submit": "Import history",

  "higgsfield.jobs.title": "Runs",
  "higgsfield.jobs.empty": "No runs yet.",
  "higgsfield.jobs.target": "Target",
  "higgsfield.jobs.status": "Status",
  "higgsfield.jobs.credits": "Credits used / ceiling",
  "higgsfield.jobs.started": "Started",
  "higgsfield.jobs.finished": "Finished",
  "higgsfield.jobs.outputs": "Files",
  "higgsfield.jobs.noOutputs": "No files reported.",
  "higgsfield.jobs.log": "Log",
  "higgsfield.jobs.prompt": "Prompt",
  "higgsfield.jobs.externalIds": "Higgsfield job ids",
  "higgsfield.jobs.live": "Updating every few seconds while a run is active.",

  "higgsfield.kind.post": "Post visuals",
  "higgsfield.kind.script_shots": "Script shots",
  "higgsfield.kind.script_thumbnails": "Script thumbnails",
  "higgsfield.kind.import": "History import",
  "higgsfield.kind.free": "Free prompt",
  "higgsfield.kind.voice": "Voice takes",

  "higgsfield.status.queued": "Queued",
  "higgsfield.status.running": "Running",
  "higgsfield.status.done": "Done",
  "higgsfield.status.failed": "Failed",
  "higgsfield.status.cancelled": "Cancelled",

  "higgsfield.cancel": "Cancel",
  "higgsfield.cancelConfirm":
    "Stop this run? Generations already submitted to Higgsfield still cost credits.",
  "higgsfield.retry": "Run again",
  "higgsfield.started": "Started run #{id}.",

  "higgsfield.generate.button": "Generate with Higgsfield",
  "higgsfield.generate.start": "Start run",
  "higgsfield.generate.dismiss": "Never mind",
  "higgsfield.generate.status": "Run #{id}: {status}",
  "higgsfield.generate.open": "Open runs",
};

export const sv: Record<keyof typeof en, string> = {
  "higgsfield.title": "Higgsfield",
  "higgsfield.eyebrow": "Generera",
  "higgsfield.intro":
    "Kör den inloggade Claude Code-CLI:n på den här datorn med Higgsfield-MCP:n. Den använder krediter från ditt Higgsfield-abonnemang, aldrig fler än taket du anger, och sparar filerna på mediedisken.",
  "higgsfield.pcOnly":
    "Fungerar bara där appen körs på din dator bredvid Claude Code — inte i en driftsatt version.",
  "higgsfield.ownerOnly": "Bara ägaren kan starta Higgsfield-körningar.",

  "higgsfield.preflight.title": "Redo att köra?",
  "higgsfield.preflight.check": "Kontrollera nu",
  "higgsfield.preflight.checking": "Kontrollerar… (ställer en enordsfråga till Claude Code)",
  "higgsfield.preflight.notChecked":
    "Inte kontrollerat än. Kontrollen kör `claude --version`, en kort ping och `claude mcp list`.",
  "higgsfield.preflight.ok": "Redo",
  "higgsfield.preflight.failed": "Inte redo",
  "higgsfield.preflight.checkedAt": "Kontrollerat {time}",
  "higgsfield.check.media_root": "Mediedisk (MEDIA_ROOT)",
  "higgsfield.check.claude_binary": "Claude Code-CLI",
  "higgsfield.check.claude_login": "Claude Code inloggad",
  "higgsfield.check.higgsfield_mcp": "Higgsfield-MCP tillgänglig för CLI:n",

  "higgsfield.fix.media_missing":
    "Anslut mediedisken, eller sätt MEDIA_ROOT i .env till en mapp som finns, och starta om appen.",
  "higgsfield.fix.media_unwritable":
    "Mediedisken är skrivskyddad. Kontrollera disken, eller peka MEDIA_ROOT på en skrivbar mapp.",
  "higgsfield.fix.claude_missing":
    "Installera Claude Code på datorn (se docs/HIGGSFIELD.md), eller sätt CLAUDE_CLI_PATH till programmet `claude`.",
  "higgsfield.fix.claude_logged_out":
    "Öppna en terminal, kör `claude` och logga in med /login med ditt Claude-abonnemang.",
  "higgsfield.fix.claude_api_key":
    "ANTHROPIC_API_KEY är satt, så körningar debiterar den API-nyckeln i stället för abonnemanget. Ta bort den för att använda abonnemanget.",
  "higgsfield.fix.mcp_missing":
    "Lägg till Higgsfield-MCP:n för CLI:n: kör `claude mcp add --transport http higgsfield <Higgsfields MCP-URL>` (URL:en finns på Higgsfields MCP-sida), eller anslut Higgsfield i claude.ai → Settings → Connectors. Se docs/HIGGSFIELD.md.",
  "higgsfield.fix.mcp_failed":
    "Higgsfield-MCP:n är inlagd men anslöt inte. Kör `claude mcp list` i en terminal för att se varför och lägg till den igen.",
  "higgsfield.fix.mcp_auth":
    "Higgsfield-MCP:n vill att du loggar in: kör `claude`, skriv /mcp, välj Higgsfield och autentisera.",

  "higgsfield.maxCredits": "Kredittak",
  "higgsfield.maxCreditsHint":
    "Körningen kollar kostnaden först och stannar innan den passerar taket.",

  "higgsfield.free.title": "Fri prompt",
  "higgsfield.free.intro":
    "Beskriv bilder eller videor att göra. De hamnar i inkorgen (_inbox/higgsfield/<datum>/) för sortering.",
  "higgsfield.free.brand": "Varumärke (valfritt)",
  "higgsfield.free.noBrand": "Inget varumärke — osorterat",
  "higgsfield.free.description": "Vad ska göras",
  "higgsfield.free.placeholder":
    "t.ex. tre 4:5-foton av Asuncións skyline i skymningen, varmt ljus, ingen text",
  "higgsfield.free.submit": "Generera",

  "higgsfield.import.title": "Importera min Higgsfield-historik",
  "higgsfield.import.intro":
    "Laddar ner tidigare genereringar till inkorgen. Kostar inga krediter. Lämna intervallet tomt för allt sedan förra importen.",
  "higgsfield.import.range": "Intervall (valfritt)",
  "higgsfield.import.rangePlaceholder": "since 2026-09-01 · last 50 · all",
  "higgsfield.import.submit": "Importera historik",

  "higgsfield.jobs.title": "Körningar",
  "higgsfield.jobs.empty": "Inga körningar än.",
  "higgsfield.jobs.target": "Mål",
  "higgsfield.jobs.status": "Status",
  "higgsfield.jobs.credits": "Använda krediter / tak",
  "higgsfield.jobs.started": "Startad",
  "higgsfield.jobs.finished": "Klar",
  "higgsfield.jobs.outputs": "Filer",
  "higgsfield.jobs.noOutputs": "Inga filer rapporterade.",
  "higgsfield.jobs.log": "Logg",
  "higgsfield.jobs.prompt": "Prompt",
  "higgsfield.jobs.externalIds": "Higgsfield-jobb-id:n",
  "higgsfield.jobs.live": "Uppdateras med några sekunders mellanrum medan en körning pågår.",

  "higgsfield.kind.post": "Inläggsbilder",
  "higgsfield.kind.script_shots": "Manusklipp",
  "higgsfield.kind.script_thumbnails": "Manusminiatyrer",
  "higgsfield.kind.import": "Historikimport",
  "higgsfield.kind.free": "Fri prompt",
  "higgsfield.kind.voice": "Rösttagningar",

  "higgsfield.status.queued": "I kö",
  "higgsfield.status.running": "Pågår",
  "higgsfield.status.done": "Klar",
  "higgsfield.status.failed": "Misslyckades",
  "higgsfield.status.cancelled": "Avbruten",

  "higgsfield.cancel": "Avbryt",
  "higgsfield.cancelConfirm":
    "Stoppa körningen? Genereringar som redan skickats till Higgsfield kostar ändå krediter.",
  "higgsfield.retry": "Kör igen",
  "higgsfield.started": "Startade körning #{id}.",

  "higgsfield.generate.button": "Generera med Higgsfield",
  "higgsfield.generate.start": "Starta körning",
  "higgsfield.generate.dismiss": "Strunta i det",
  "higgsfield.generate.status": "Körning #{id}: {status}",
  "higgsfield.generate.open": "Öppna körningar",
};

/**
 * What the Settings page lets the owner edit. Everything else in `.env` stays
 * as the installer wrote it. Labels are English: they name services.
 */
export type SettingField = {
  key: string;
  label: string;
  help: string;
  url?: string;
  kind: "secret" | "text" | "select";
  options?: Array<{ value: string; label: string }>;
  required: boolean;
  /** Which test the "Test" button runs, if any. */
  test?: "gemini" | "youtube" | "cli";
};

export const SETTING_FIELDS: SettingField[] = [
  {
    key: "GEMINI_API_KEY",
    label: "Gemini API key",
    help: "YouTube summaries, research and (by default) scripts. Create a key in Google AI Studio on the project that holds your credits; turn billing on for Search grounding.",
    url: "https://aistudio.google.com/apikey",
    kind: "secret",
    required: true,
    test: "gemini",
  },
  {
    key: "YOUTUBE_API_KEY",
    label: "YouTube Data API key",
    help: "Channel lists, view counts and comments. Free: Google Cloud console → enable “YouTube Data API v3” → Credentials → Create API key.",
    url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    kind: "secret",
    required: true,
    test: "youtube",
  },
  {
    key: "AI_PROVIDER",
    label: "Who writes titles, scripts and reports",
    help: "Claude or Codex use your subscription through the CLI installed on this PC (see docs/SUBSCRIPTION-MODE.md). YouTube summaries always use Gemini.",
    kind: "select",
    options: [
      { value: "gemini", label: "Gemini API (credits)" },
      { value: "claude", label: "Claude Code CLI (Claude subscription)" },
      { value: "codex", label: "Codex CLI (ChatGPT subscription)" },
    ],
    required: false,
    test: "cli",
  },
  {
    key: "CLAUDE_CLI_MODEL",
    label: "Claude model (optional)",
    help: "e.g. opus or sonnet. Empty uses the CLI's default.",
    kind: "text",
    required: false,
  },
  {
    key: "CODEX_CLI_MODEL",
    label: "Codex model (optional)",
    help: "Empty uses the CLI's default.",
    kind: "text",
    required: false,
  },
  {
    key: "MONTHLY_SPEND_CAP_USD",
    label: "Monthly Gemini spend cap (USD)",
    help: "The app refuses paid Gemini calls above this. Subscription-mode calls count as $0.",
    kind: "text",
    required: false,
  },
  // --- build 4 (docs/PLAN-build4.md) -----------------------------------------
  {
    key: "ELEVENLABS_API_KEY",
    label: "ElevenLabs API key (voice)",
    help: "Cloned and stock voices for narration. Clone only with a signed consent on the voice profile.",
    url: "https://elevenlabs.io/app/settings/api-keys",
    kind: "secret",
    required: false,
  },
  {
    key: "AZURE_SPEECH_KEY",
    label: "Azure Speech key (voice)",
    help: "Stock es-PY voices (castellano paraguayo). Free tier ≈ 0.5M characters/month.",
    url: "https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices",
    kind: "secret",
    required: false,
  },
  {
    key: "AZURE_SPEECH_REGION",
    label: "Azure Speech region",
    help: "The region of the Speech resource, e.g. westeurope or brazilsouth.",
    kind: "text",
    required: false,
  },
  {
    key: "CHATTERBOX_URL",
    label: "Chatterbox server URL (voice)",
    help: "The local Chatterbox server (tools/chatterbox-server), e.g. http://127.0.0.1:8004. Free, runs on this PC's CPU — slow, good for overnight batches.",
    kind: "text",
    required: false,
  },
  {
    key: "REPLICATE_API_TOKEN",
    label: "Replicate API token (voice)",
    help: "Runs Chatterbox in the cloud for a few cents per clip, no GPU needed.",
    url: "https://replicate.com/account/api-tokens",
    kind: "secret",
    required: false,
  },
  {
    key: "CUENTOS_ROOT",
    label: "cuentos folder",
    help: "The cuentos.com.py repo on this PC, e.g. C:\\dev\\cuentos. Stories are imported from its books/ folder.",
    kind: "text",
    required: false,
  },
  {
    key: "GOOGLE_DRIVE_API_KEY",
    label: "Google Drive API key (optional)",
    help: "Read-only links to the Drive backup of the media drive. Google Cloud console → enable “Google Drive API” → Credentials → API key.",
    url: "https://console.cloud.google.com/apis/library/drive.googleapis.com",
    kind: "secret",
    required: false,
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "Telegram bot token",
    help: "The capture bot's token. Used here for the weekly “implement one thing” nudge and screenshot downloads.",
    kind: "secret",
    required: false,
  },
];

export const EDITABLE_KEYS = new Set(SETTING_FIELDS.map((f) => f.key));

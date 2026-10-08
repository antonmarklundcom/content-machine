/**
 * Register the Worker as the bot's webhook (PLAN.md §6.S16).
 *
 *   TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… WORKER_URL=https://….workers.dev npm run setup
 *
 * Re-runnable: setWebhook replaces whatever was registered before. Only
 * `message` updates are requested; the Worker ignores everything else anyway.
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const workerUrl = process.env.WORKER_URL;

const missing = Object.entries({
  TELEGRAM_BOT_TOKEN: token,
  TELEGRAM_WEBHOOK_SECRET: secret,
  WORKER_URL: workerUrl,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")}. See workers/telegram-capture/README.md.`);
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret!)) {
  console.error(
    "TELEGRAM_WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, _ and - (Telegram's rule).",
  );
  process.exit(1);
}

const api = (method: string) => `https://api.telegram.org/bot${token}/${method}`;

const res = await fetch(api("setWebhook"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: workerUrl,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  }),
});
const body = (await res.json()) as { ok: boolean; description?: string };
if (!body.ok) {
  console.error(`setWebhook failed: ${body.description ?? res.status}`);
  process.exit(1);
}

const info = (await (await fetch(api("getWebhookInfo"))).json()) as {
  result?: { url?: string; pending_update_count?: number; last_error_message?: string };
};
console.log(`Webhook set: ${info.result?.url}`);
console.log(`Pending updates: ${info.result?.pending_update_count ?? 0}`);
if (info.result?.last_error_message) console.log(`Last error: ${info.result.last_error_message}`);

export {};

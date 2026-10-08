import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThinkingLevel } from "@google/genai";

import {
  geminiClient,
  messageCostUsd,
  readUsage,
  responseText,
  TRANSCRIBE_MAX_INLINE_BYTES,
  TRANSCRIPT_JSON_SCHEMA,
} from "@/lib/ai";
import { costUsdAtRates, ideationRates } from "@/lib/analysis/pricing";
import { downloadTelegramFile } from "@/lib/clips/fetch/telegram";
import { dispatchSpend, recordSpend, withSpendCap } from "@/lib/spend";

/**
 * Screenshots for learn (docs/PLAN-build4.md §1.13): a photo sent to the
 * capture bot is downloaded through the Bot API and read by Gemini vision
 * under the spend cap — the same pattern as `transcribeClip`, one cheap
 * Flash-Lite call. Always Gemini: the CLI providers cannot take an image.
 *
 * It answers in the transcript schema (on-screen text + a summary), which is
 * what a screenshot description is, and which the Gemini fake already knows.
 * The file is fetched to a temp folder and deleted; nothing is kept.
 */

const VISION_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-3.1-flash-lite";
const VISION_MAX_OUTPUT_TOKENS = 3_000;
const IMAGE_TOKENS = 1_300;
const PROMPT_TOKENS = 600;

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
};

export class ScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenshotError";
  }
}

export function estimateScreenshotCostUsd(model: string = VISION_MODEL): number {
  return costUsdAtRates(ideationRates(model), {
    inputTokens: IMAGE_TOKENS + PROMPT_TOKENS,
    outputTokens: VISION_MAX_OUTPUT_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export const SCREENSHOT_PROMPT =
  "This screenshot was saved because it shows an AI tool, repo or dev trick worth trying. Copy every piece of visible text that matters (repo names, URLs, commands, captions) into postText, and say in summary what the screenshot is about.";

/** Text read off the screenshot ("On screen: … / About: …"), or throws `ScreenshotError`. */
export async function describeScreenshot(
  fileId: string,
  context?: string | null,
): Promise<{ text: string; costUsd: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), "learn-shot-"));
  try {
    const got = await downloadTelegramFile(fileId, dir);
    if (!got.ok) throw new ScreenshotError(got.error);
    const mime = IMAGE_TYPES[path.extname(got.file).toLowerCase()];
    if (!mime) throw new ScreenshotError("The Telegram file is not an image.");
    if ((await stat(got.file)).size > TRANSCRIBE_MAX_INLINE_BYTES) {
      throw new ScreenshotError("The screenshot is too large to send.");
    }
    const data = (await readFile(got.file)).toString("base64");
    const prompt = context?.trim()
      ? `${SCREENSHOT_PROMPT}\nIt was sent with this note: ${context.trim()}`
      : SCREENSHOT_PROMPT;

    return await withSpendCap(estimateScreenshotCostUsd(), async () => {
      const response = await dispatchSpend(() =>
        geminiClient().models.generateContent({
          model: VISION_MODEL,
          contents: [
            { role: "user", parts: [{ inlineData: { mimeType: mime, data } }, { text: prompt }] },
          ],
          config: {
            systemInstruction:
              "You read screenshots accurately. Never add text that is not in the image. Answer with JSON matching the required schema and nothing else.",
            maxOutputTokens: VISION_MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: "application/json",
            responseJsonSchema: TRANSCRIPT_JSON_SCHEMA,
          },
        }),
      );
      // Billed whether or not the answer parses: the tokens were spent.
      const costUsd = messageCostUsd(readUsage(response), 0, VISION_MODEL);
      await recordSpend(costUsd);
      let parsed: { postText?: unknown; summary?: unknown };
      try {
        parsed = JSON.parse(responseText(response)) as typeof parsed;
      } catch {
        throw new ScreenshotError("The model could not read the screenshot.");
      }
      const onScreen = typeof parsed.postText === "string" ? parsed.postText.trim() : "";
      const about = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const text = [onScreen && `On screen: ${onScreen}`, about && `About: ${about}`]
        .filter(Boolean)
        .join("\n");
      if (!text) throw new ScreenshotError("Nothing readable in the screenshot.");
      return { text, costUsd };
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

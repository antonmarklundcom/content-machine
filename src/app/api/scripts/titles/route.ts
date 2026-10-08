import { NextResponse } from "next/server";

import { generateTitles } from "@/lib/ai";
import { getBrand } from "@/lib/bridge";
import { lessonsForPrompt } from "@/lib/scripts/brief";
import { defaultScriptLanguage, isScriptLanguage, loadStyleGuide } from "@/lib/scripts/language";
import { idList, ownerOnly } from "@/lib/scripts/owner-gate";
import { SpendCapExceededError } from "@/lib/spend";

export const maxDuration = 120;

/**
 * POST /api/scripts/titles — ten title options for a topic (PLAN.md §5.O8.4).
 * Body: `{ brandId, topic, language?, lessonIds? }`. Without `lessonIds` the
 * brand's saved hooks and title patterns are used.
 */
export async function POST(request: Request) {
  const denied = await ownerOnly("Suggesting titles");
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (typeof body.brandId !== "string" || !body.brandId) {
    return NextResponse.json({ error: "brandId required" }, { status: 400 });
  }
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  if (body.language !== undefined && !isScriptLanguage(body.language)) {
    return NextResponse.json(
      { error: "language must be one of en, es-PY, jopara" },
      { status: 400 },
    );
  }
  const lessonIds = idList(body.lessonIds);
  if (!lessonIds)
    return NextResponse.json({ error: "lessonIds must be a list of lesson ids" }, { status: 400 });

  const brand = await getBrand(body.brandId);
  if (!brand)
    return NextResponse.json({ error: `unknown brandId "${body.brandId}"` }, { status: 400 });

  const language = body.language ?? defaultScriptLanguage(brand);
  const lessons = await lessonsForPrompt(
    brand.id,
    lessonIds.length ? { ids: lessonIds } : { kinds: ["hook", "title_pattern"] },
  );

  try {
    const { titles, costUsd } = await generateTitles(brand, topic, lessons, {
      language,
      styleGuide: await loadStyleGuide(language),
    });
    return NextResponse.json({ titles, language, costUsd });
  } catch (error) {
    if (error instanceof SpendCapExceededError) {
      return NextResponse.json({ error: error.message, spend: error.status }, { status: 429 });
    }
    throw error;
  }
}

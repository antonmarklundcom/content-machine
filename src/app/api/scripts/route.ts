import { NextResponse } from "next/server";

import { generateScript, ScriptGenerationError } from "@/lib/ai";
import { getBrand } from "@/lib/bridge";
import { createScript } from "@/lib/bridge/scripts";
import {
  factsForPrompt,
  lessonsForPrompt,
  structureReferences,
  UnknownReferenceVideoError,
} from "@/lib/scripts/brief";
import { validateScriptBody } from "@/lib/scripts/contract";
import { defaultScriptLanguage, isScriptLanguage, loadStyleGuide } from "@/lib/scripts/language";
import { idList, ownerOnly } from "@/lib/scripts/owner-gate";
import { SpendCapExceededError } from "@/lib/spend";

export const maxDuration = 300; // grounded research + a full script

/**
 * POST /api/scripts — write a script and save it as a draft (PLAN.md §5.O8.4).
 *
 * Body: `{ brandId, topic, title, targetMinutes, language?, competitorVideoIds?,
 * lessonIds?, ideaId? }`. Competitor videos (by `videos.id`) must have an
 * analysis; they are passed as structure references only. The brand's fact
 * sheet always goes along (build 2b, idea 3). Responds 201 with
 * `{ script, costUsd }`.
 */
export async function POST(request: Request) {
  const denied = await ownerOnly("Writing a script");
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const targetMinutes = Number(body.targetMinutes ?? 8);

  if (typeof body.brandId !== "string" || !body.brandId) {
    return NextResponse.json({ error: "brandId required" }, { status: 400 });
  }
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!Number.isFinite(targetMinutes) || targetMinutes < 1 || targetMinutes > 30) {
    return NextResponse.json({ error: "targetMinutes must be between 1 and 30" }, { status: 400 });
  }
  if (body.language !== undefined && !isScriptLanguage(body.language)) {
    return NextResponse.json(
      { error: "language must be one of en, es-PY, jopara" },
      { status: 400 },
    );
  }
  const competitorVideoIds = idList(body.competitorVideoIds);
  const lessonIds = idList(body.lessonIds);
  if (!competitorVideoIds) {
    return NextResponse.json(
      { error: "competitorVideoIds must be a list of video ids" },
      { status: 400 },
    );
  }
  if (!lessonIds)
    return NextResponse.json({ error: "lessonIds must be a list of lesson ids" }, { status: 400 });
  const ideaId = body.ideaId === undefined || body.ideaId === null ? null : Number(body.ideaId);
  if (ideaId !== null && (!Number.isInteger(ideaId) || ideaId <= 0)) {
    return NextResponse.json({ error: "ideaId must be an idea id" }, { status: 400 });
  }

  const brand = await getBrand(body.brandId);
  if (!brand)
    return NextResponse.json({ error: `unknown brandId "${body.brandId}"` }, { status: 400 });

  // Everything that can be refused for free is refused before the paid call.
  let references;
  try {
    references = await structureReferences(competitorVideoIds);
  } catch (error) {
    if (error instanceof UnknownReferenceVideoError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const language = body.language ?? defaultScriptLanguage(brand);
  const [lessons, facts] = await Promise.all([
    lessonsForPrompt(brand.id, { ids: lessonIds }),
    factsForPrompt(brand.id),
  ]);

  let generated;
  try {
    generated = await generateScript(brand, {
      topic,
      title,
      targetMinutes,
      language,
      styleGuide: await loadStyleGuide(language),
      references,
      lessons,
      facts,
    });
  } catch (error) {
    if (error instanceof SpendCapExceededError) {
      return NextResponse.json({ error: error.message, spend: error.status }, { status: 429 });
    }
    // Billed, but nothing usable came back: a bad gateway, not a bad request.
    if (error instanceof ScriptGenerationError) {
      return NextResponse.json({ error: error.message, errors: error.errors }, { status: 502 });
    }
    throw error;
  }

  const script = await createScript(
    { brandId: brand.id, ideaId, title, language, body: generated.body },
    validateScriptBody,
  );
  return NextResponse.json({ script, costUsd: generated.costUsd }, { status: 201 });
}

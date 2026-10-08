import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { isFormat, isUnitType, promoteToIdea, type PromoteSource } from "@/lib/promote";
import { SpendCapExceededError } from "@/lib/spend";

/**
 * `POST /api/ideas/promote` — one piece of the YouTube corpus becomes one idea
 * for one brand (PLAN.md §5.O2.3).
 *
 * Body:
 *   { brandId, format, platform, adapt?, clipId?,
 *     source: { kind: "unit", videoId, unitType, unitIndex }
 *           | { kind: "analysis-idea", analysisId, ideaIndex } }
 *
 * Behind the session middleware, so a signed-in user is a given. `adapt` is
 * the only part that spends, and spending is the owner's (PR-24).
 */

export const dynamic = "force-dynamic";

function parseSource(raw: unknown): PromoteSource | string {
  if (typeof raw !== "object" || raw === null) return "source required";
  const source = raw as Record<string, unknown>;

  if (source.kind === "unit") {
    const videoId = Number(source.videoId);
    const unitIndex = Number(source.unitIndex);
    const unitType = String(source.unitType ?? "");
    if (!Number.isInteger(videoId) || videoId <= 0) return "source.videoId must be a video id";
    if (!isUnitType(unitType)) return `source.unitType "${unitType}" is not a unit type`;
    if (!Number.isInteger(unitIndex) || unitIndex < 0) return "source.unitIndex must be an index";
    return { kind: "unit", videoId, unitType, unitIndex };
  }

  if (source.kind === "analysis-idea") {
    const analysisId = Number(source.analysisId);
    const ideaIndex = Number(source.ideaIndex);
    if (!Number.isInteger(analysisId) || analysisId <= 0) {
      return "source.analysisId must be an analysis id";
    }
    if (!Number.isInteger(ideaIndex) || ideaIndex < 0) return "source.ideaIndex must be an index";
    return { kind: "analysis-idea", analysisId, ideaIndex };
  }

  return 'source.kind must be "unit" or "analysis-idea"';
}

export async function POST(request: Request): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const brandId = String(body.brandId ?? "").trim();
  if (!brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });

  const format = body.format;
  if (!isFormat(format)) {
    return NextResponse.json(
      { error: `format must be one of the four post formats` },
      { status: 400 },
    );
  }

  const platform = String(body.platform ?? "").trim();
  if (!platform) return NextResponse.json({ error: "platform required" }, { status: 400 });

  const source = parseSource(body.source);
  if (typeof source === "string") return NextResponse.json({ error: source }, { status: 400 });

  const adapt = body.adapt === true;
  // Refused rather than quietly downgraded to a verbatim promote: the caller
  // asked for adapted copy, and silently returning something else is worse
  // than saying no.
  if (adapt && !isOwner(user)) {
    return NextResponse.json(
      {
        error:
          "Adapting copy spends money, which is the owner's to spend. Promote verbatim instead.",
      },
      { status: 403 },
    );
  }

  const clipId = body.clipId === undefined ? undefined : Number(body.clipId);
  if (clipId !== undefined && (!Number.isInteger(clipId) || clipId <= 0)) {
    return NextResponse.json({ error: "clipId must be a clip id" }, { status: 400 });
  }

  try {
    const result = await promoteToIdea({ source, brandId, format, platform, adapt, clipId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ idea: result.idea, costUsd: result.costUsd }, { status: 201 });
  } catch (error) {
    if (error instanceof SpendCapExceededError) {
      return NextResponse.json({ error: error.message, spend: error.status }, { status: 429 });
    }
    throw error;
  }
}

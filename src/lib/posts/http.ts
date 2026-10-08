import "server-only";
import { NextResponse } from "next/server";

import { PostGenerationError } from "@/lib/ai";
import { GuaraniGenerationRefusedError } from "@/lib/glossary/prompt";
import { SpendCapExceededError } from "@/lib/spend";

import { PostEngineError } from "./engine";

/**
 * How the post routes answer a refusal (§5.O11.3): the engine's own refusals
 * with their status, the spend cap as 429 (nothing spent), and a model answer
 * that failed the contract as 502 (billed, nothing usable) — the same shape
 * as `/api/scripts`. Anything else is a bug and rethrown.
 */
export function postErrorResponse(error: unknown): NextResponse {
  if (error instanceof PostEngineError) {
    return NextResponse.json(
      { error: error.message, ...(error.errors.length ? { errors: error.errors } : {}) },
      { status: error.status },
    );
  }
  if (error instanceof GuaraniGenerationRefusedError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof SpendCapExceededError) {
    return NextResponse.json({ error: error.message, spend: error.status }, { status: 429 });
  }
  if (error instanceof PostGenerationError) {
    return NextResponse.json({ error: error.message, errors: error.errors }, { status: 502 });
  }
  throw error;
}

/** A positive integer id from a route segment, or null. */
export function routeId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

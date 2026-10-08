"use server";

/**
 * `/studio/listing` (build 2b, idea 8): read a listing page into the form,
 * then write a short or a tour from it and save it as a draft script.
 *
 * Results are data, not throws: a "use server" error reaches the browser as a
 * generic message in production, and "the page did not answer" or "the spend
 * cap is reached" are things the person should read as written.
 */

import { revalidatePath } from "next/cache";
import {
  assembleScriptBody,
  estimateScriptCostUsd,
  SCRIPT_JSON_SCHEMA,
  structuredJson,
} from "@/lib/ai";
import { isOwner } from "@/lib/auth/roles";
import { getSession, requireUser } from "@/lib/auth/session";
import { getBrand } from "@/lib/bridge";
import { createScript } from "@/lib/bridge/scripts";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import { defaultScriptLanguage, isScriptLanguage, loadStyleGuide } from "@/lib/scripts/language";
import { SpendCapExceededError } from "@/lib/spend";
import {
  fetchListing,
  finishListingScript,
  LISTING_MODES,
  ListingFetchError,
  listingScriptPrompt,
  listingTopic,
  MODE_SPEC,
  normalizeListing,
  type ListingFields,
  type ListingMode,
} from "@/lib/studio/listing";

export type ReadListingResult = { ok: true; listing: ListingFields } | { ok: false; error: string };

/** Fetch and parse a listing URL (10 s timeout). Free, so any signed-in user may. */
export async function readListing(url: string): Promise<ReadListingResult> {
  await requireUser();
  try {
    return { ok: true, listing: await fetchListing(String(url ?? "")) };
  } catch (error) {
    if (error instanceof ListingFetchError) return { ok: false, error: error.message };
    return { ok: false, error: "The page could not be read. Fill the form by hand instead." };
  }
}

export type WriteListingInput = {
  brandId: string;
  mode: ListingMode;
  /** Defaults to the brand's (real estate → English, §1.33). */
  language?: string;
  listing: Partial<Record<keyof ListingFields, unknown>>;
};

export type WriteListingResult =
  { ok: true; id: number; costUsd: number } | { ok: false; error: string; errors?: string[] };

/** Room for a tour's ~650 words plus shots and thumbnails, with headroom. */
const LISTING_MAX_OUTPUT_TOKENS = 12_000;

type RawScript = Parameters<typeof assembleScriptBody>[0];

/**
 * Write the script and save it as a draft. Owner-only: it spends money (or a
 * CLI run, §1.38) through `structuredJson`, under `withSpendCap` on Gemini.
 * The listing is the research — no web search.
 */
export async function writeListingScript(input: WriteListingInput): Promise<WriteListingResult> {
  const user = await getSession();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!isOwner(user))
    return { ok: false, error: "Writing a script spends money, which is the owner's to spend." };

  const mode = input?.mode;
  if (!(LISTING_MODES as readonly string[]).includes(mode))
    return { ok: false, error: "Pick “Write short” or “Write tour”." };
  const brand = typeof input.brandId === "string" ? await getBrand(input.brandId) : null;
  if (!brand) return { ok: false, error: `Unknown brand "${String(input?.brandId)}".` };
  if (input.language !== undefined && !isScriptLanguage(input.language)) {
    return { ok: false, error: "Language must be one of en, es-PY, jopara." };
  }
  const listing = normalizeListing(input.listing ?? {});
  if (!listing.title && !listing.description && !listing.address) {
    return { ok: false, error: "Give the listing at least a title, a description or an address." };
  }

  const language = input.language ?? defaultScriptLanguage(brand);
  const { system, prompt } = listingScriptPrompt(
    listing,
    mode,
    brand,
    language,
    await loadStyleGuide(language),
  );

  let text: string;
  let costUsd: number;
  try {
    ({ text, costUsd } = await structuredJson({
      system,
      prompt,
      schema: SCRIPT_JSON_SCHEMA,
      webSearch: false,
      estimateUsd: estimateScriptCostUsd(),
      maxOutputTokens: LISTING_MAX_OUTPUT_TOKENS,
    }));
  } catch (error) {
    if (error instanceof SpendCapExceededError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  let body: ScriptBodyV1;
  try {
    const raw = JSON.parse(text) as RawScript;
    const title = raw.titleOptions?.[0]?.title?.trim() || listingTopic(listing);
    body = assembleScriptBody(raw, {
      topic: listingTopic(listing),
      title,
      targetMinutes: MODE_SPEC[mode].targetMinutes,
      language,
    });
    body = finishListingScript(body, listing, mode);
  } catch {
    return { ok: false, error: "The model's answer was not a usable script. Try again." };
  }
  const verdict = validateScriptBody(body);
  if (!verdict.ok) {
    return {
      ok: false,
      error: "The model's script does not match the script contract. Try again.",
      errors: verdict.errors,
    };
  }

  const script = await createScript(
    { brandId: brand.id, title: body.chosenTitle, language, body },
    validateScriptBody,
  );
  revalidatePath("/studio");
  return { ok: true, id: script.id, costUsd };
}

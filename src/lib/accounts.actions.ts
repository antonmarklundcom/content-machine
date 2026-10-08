"use server";
import { insertReturning, updateReturning, upsertReturning } from "@/db/mutations";

/**
 * Brands, families, social accounts and brand kits, from the UI (PLAN.md §6.S13).
 *
 * Every write is owner-only: these rows decide what generation writes for whom
 * (§1.39), so an employee can read them but not change them. Like the other
 * `*.actions.ts`, each action returns `{ ok } | { ok: false, error }` rather
 * than throwing, because production strips a thrown action's message.
 *
 * The bridge only reads these tables (O9), and lane 2 may not add to it
 * (§4.7), so the writes live here, against the schema O9 fixed (log §10).
 */

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
  brandFamilies,
  brandKits,
  brands,
  socialAccounts,
  type AccountStatus,
  type KitColor,
  type KitFont,
  type SocialPlatform,
} from "@/db/schema";
import { getAsset } from "@/lib/bridge/assets";
import { getBrand } from "@/lib/bridge/brands";
import { getFamily } from "@/lib/bridge/families";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";

export type AccountsActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

class InvalidInputError extends Error {}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,4})?$/;
const HEX = /^#[0-9a-f]{6}$/;
/** Platform handles: letters, digits, dot, underscore, hyphen. No `@`, no spaces. */
const HANDLE = /^[A-Za-z0-9._-]{1,255}$/;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function required(form: FormData, name: string, label: string, max = 255): string {
  const value = text(form, name);
  if (!value) throw new InvalidInputError(`${label} is required.`);
  if (value.length > max) throw new InvalidInputError(`${label} is longer than ${max} characters.`);
  return value;
}

function optional(form: FormData, name: string): string | null {
  return text(form, name) || null;
}

function slug(form: FormData, name: string, label: string): string {
  const value = text(form, name).toLowerCase();
  if (!SLUG.test(value) || value.length > 64) {
    throw new InvalidInputError(
      `${label} must be a slug: lower-case letters, digits and single hyphens (max 64).`,
    );
  }
  return value;
}

function language(form: FormData, name: string): string | null {
  const value = text(form, name);
  if (!value) return null;
  if (!LANGUAGE.test(value)) throw new InvalidInputError(`"${value}" is not a language code.`);
  return value;
}

function checkbox(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === "on" || value === "true" || value === "1";
}

/** One entry per line or comma; blanks dropped, duplicates removed, order kept. */
function list(form: FormData, name: string, { commas = true } = {}): string[] {
  const raw = text(form, name);
  const parts = raw.split(commas ? /[\n,]/ : /\n/).map((s) => s.trim());
  return [...new Set(parts.filter(Boolean))];
}

/** Hex as `#rrggbb`: accepts `abc`, `#ABC`, `aabbcc`. Anything else is refused, not guessed. */
function normaliseHex(value: string): string | null {
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
  return HEX.test(hex) ? hex : null;
}

/** Owner gate + input errors → `{ ok: false }`; anything else is a real failure and throws. */
async function guarded<T>(
  action: string,
  run: () => Promise<AccountsActionResult<T>>,
): Promise<AccountsActionResult<T>> {
  try {
    await requireOwner(action);
    return await run();
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof InvalidInputError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}

async function familyRef(form: FormData): Promise<string | null> {
  const id = text(form, "familyId");
  if (!id) return null;
  if (!(await getFamily(id))) throw new InvalidInputError(`No family "${id}".`);
  return id;
}

function revalidateBrand(id: string) {
  revalidatePath("/brands");
  revalidatePath("/families");
  revalidatePath("/accounts");
  revalidatePath(`/brands/${id}`);
  revalidatePath(`/brand/${id}`);
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

/**
 * Create a brand (`mode=create`) or edit one (`mode=edit`). The id is the slug
 * and never changes after create: ideas, posts, facts and accounts point at it
 * by value (§1.4 soft links), so an edit reads it and ignores any other id.
 */
export async function saveBrandAction(
  _prev: AccountsActionResult<{ id: string }> | null,
  form: FormData,
): Promise<AccountsActionResult<{ id: string }>> {
  return guarded<{ id: string }>("edit brands", async () => {
    const editing = text(form, "mode") === "edit";
    const id = slug(form, "id", "The brand id");
    const platforms = form
      .getAll("platforms")
      .filter((p): p is SocialPlatform => (SOCIAL_PLATFORMS as readonly unknown[]).includes(p));
    const values = {
      name: required(form, "name", "The name"),
      domain: text(form, "domain"),
      niche: required(form, "niche", "The niche"),
      market: required(form, "market", "The market", 64),
      language: language(form, "language") ?? "en",
      voice: optional(form, "voice"),
      platforms: [...new Set(platforms)],
      familyId: await familyRef(form),
      active: checkbox(form, "active"),
    };

    const existing = await getBrand(id);
    if (editing) {
      if (!existing) return { ok: false, error: `No brand "${id}".` };
      await db.update(brands).set(values).where(eq(brands.id, id));
    } else {
      if (existing) return { ok: false, error: `A brand "${id}" already exists.` };
      await db.insert(brands).values({ id, ...values });
    }
    revalidateBrand(id);
    return { ok: true, id };
  });
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

/** Create (`mode=create`) or rename/re-note (`mode=edit`) a family. Its id is fixed too. */
export async function saveFamilyAction(
  _prev: AccountsActionResult<{ id: string }> | null,
  form: FormData,
): Promise<AccountsActionResult<{ id: string }>> {
  return guarded<{ id: string }>("edit families", async () => {
    const editing = text(form, "mode") === "edit";
    const id = slug(form, "id", "The family id");
    const values = { name: required(form, "name", "The name"), notes: optional(form, "notes") };
    const existing = await getFamily(id);
    if (editing) {
      if (!existing) return { ok: false, error: `No family "${id}".` };
      await db.update(brandFamilies).set(values).where(eq(brandFamilies.id, id));
    } else {
      if (existing) return { ok: false, error: `A family "${id}" already exists.` };
      await db.insert(brandFamilies).values({ id, ...values });
    }
    revalidatePath("/families");
    revalidatePath("/brands");
    return { ok: true, id };
  });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function platform(form: FormData): SocialPlatform {
  const value = text(form, "platform");
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(value)) {
    throw new InvalidInputError(`Unknown platform "${value}".`);
  }
  return value as SocialPlatform;
}

function status(value: unknown): AccountStatus {
  if (!(ACCOUNT_STATUSES as readonly unknown[]).includes(value)) {
    throw new InvalidInputError(`Unknown status "${String(value)}".`);
  }
  return value as AccountStatus;
}

/**
 * Add an account to a brand, or edit one (`accountId` set). Platform + handle
 * is unique across every brand, so a clash names the brand that holds it.
 */
export async function saveAccountAction(
  _prev: AccountsActionResult<{ id: number }> | null,
  form: FormData,
): Promise<AccountsActionResult<{ id: number }>> {
  return guarded<{ id: number }>("edit accounts", async () => {
    const accountId = text(form, "accountId") ? Number(text(form, "accountId")) : null;
    if (accountId !== null && !(Number.isInteger(accountId) && accountId > 0)) {
      return { ok: false, error: "That is not an account id." };
    }
    const brandId = text(form, "brandId");
    if (!(await getBrand(brandId))) return { ok: false, error: `No brand "${brandId}".` };
    const handle = text(form, "handle").replace(/^@/, "");
    if (!HANDLE.test(handle)) {
      return { ok: false, error: `"${handle}" is not a handle (letters, digits, . _ - only).` };
    }
    const values = {
      brandId,
      platform: platform(form),
      handle,
      language: language(form, "language"),
      status: status(text(form, "status") || "planned"),
      isProfessional: checkbox(form, "isProfessional"),
      notes: optional(form, "notes"),
    };

    const [clash] = await db
      .select({ id: socialAccounts.id, brandId: socialAccounts.brandId })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.platform, values.platform),
          eq(socialAccounts.handle, handle),
          accountId !== null ? ne(socialAccounts.id, accountId) : undefined,
        ),
      )
      .limit(1);
    if (clash) {
      return {
        ok: false,
        error: `@${handle} on ${values.platform} already belongs to "${clash.brandId}".`,
      };
    }

    let id: number;
    if (accountId !== null) {
      const updated = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(socialAccounts)
          .where(eq(socialAccounts.id, accountId))
          .limit(1)
          .for("update");
        if (!current) return false;
        const identityChanged =
          current.brandId !== values.brandId ||
          current.platform !== values.platform ||
          current.handle !== values.handle;
        if (identityChanged && (current.externalId || current.integrationId))
          throw new InvalidInputError(
            "Unlink this account before changing its brand, platform or handle; reconnect and verify the destination afterward.",
          );
        await tx.update(socialAccounts).set(values).where(eq(socialAccounts.id, accountId));
        return true;
      });
      if (!updated) return { ok: false, error: "That account no longer exists." };
      id = accountId;
    } else {
      const [row] = await insertReturning(db, socialAccounts, values, { id: socialAccounts.id });
      id = row.id;
    }
    revalidateBrand(brandId);
    return { ok: true, id };
  });
}

/** The one-click status change on an account row. */
export async function setAccountStatusAction(
  accountId: number,
  next: AccountStatus,
): Promise<AccountsActionResult> {
  return guarded("edit accounts", async () => {
    if (!(Number.isInteger(accountId) && accountId > 0)) {
      return { ok: false, error: "That is not an account id." };
    }
    const value = status(next);
    const [row] = await updateReturning(
      db,
      socialAccounts,
      { status: value },
      eq(socialAccounts.id, accountId),
      { brandId: socialAccounts.brandId },
    );
    if (!row) return { ok: false, error: "That account no longer exists." };
    revalidateBrand(row.brandId);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Brand kits
// ---------------------------------------------------------------------------

function colors(form: FormData): KitColor[] {
  const names = form.getAll("colorName").map(String);
  const hexes = form.getAll("colorHex").map(String);
  const out: KitColor[] = [];
  hexes.forEach((raw, i) => {
    const name = (names[i] ?? "").trim();
    if (!raw.trim() && !name) return; // an empty row
    const hex = normaliseHex(raw);
    if (!hex) throw new InvalidInputError(`"${raw}" is not a hex colour (#rrggbb).`);
    out.push({ name: name || hex, hex });
  });
  return out;
}

function fonts(form: FormData): KitFont[] {
  const roles = form.getAll("fontRole").map(String);
  const families = form.getAll("fontFamily").map(String);
  return families
    .map((family, i) => ({ role: (roles[i] ?? "").trim(), family: family.trim() }))
    .filter((f) => f.family)
    .map((f) => ({ role: f.role || "body", family: f.family }));
}

/**
 * Save a brand's kit (upsert: a brand has at most one, §2). The logo is picked
 * from the media library, never uploaded here, so it must be an image asset of
 * this brand or an unsorted one.
 */
export async function saveKitAction(
  _prev: AccountsActionResult | null,
  form: FormData,
): Promise<AccountsActionResult> {
  return guarded("edit brand kits", async () => {
    const brandId = text(form, "brandId");
    if (!(await getBrand(brandId))) return { ok: false, error: `No brand "${brandId}".` };

    let logoAssetId: number | null = null;
    const logo = text(form, "logoAssetId");
    if (logo) {
      const asset = /^\d{1,9}$/.test(logo) ? await getAsset(Number(logo)) : null;
      if (!asset || asset.kind !== "image") {
        return { ok: false, error: "The logo must be an image from the media library." };
      }
      if (asset.brandId && asset.brandId !== brandId) {
        return { ok: false, error: "That image belongs to another brand." };
      }
      logoAssetId = asset.id;
    }

    const values = {
      colors: colors(form),
      fonts: fonts(form),
      logoAssetId,
      higgsfield: {
        elementIds: list(form, "elementIds"),
        characterIds: list(form, "characterIds"),
        styleNotes: text(form, "styleNotes"),
      },
      ctas: list(form, "ctas", { commas: false }),
      hashtags: [
        ...new Set(
          list(form, "hashtags")
            .flatMap((h) => h.split(/\s+/))
            .map((h) => h.replace(/^#+/, ""))
            .filter(Boolean),
        ),
      ],
      dos: optional(form, "dos"),
      donts: optional(form, "donts"),
      updatedAt: new Date(),
    };
    await upsertReturning(
      db,
      brandKits,
      { brandId, ...values },
      { target: brandKits.brandId, set: values },
    );
    revalidatePath(`/brand/${brandId}/kit`);
    revalidatePath(`/brands/${brandId}`);
    return { ok: true };
  });
}

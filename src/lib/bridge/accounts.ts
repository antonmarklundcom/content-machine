import "server-only";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  integrations,
  socialAccounts,
  type AccountStatus,
  type Integration,
  type IntegrationProvider,
  type SocialAccount,
  type SocialPlatform,
} from "@/db/schema";

/**
 * Reads over social accounts and integrations (PLAN.md §1.40, §2). An account
 * is one handle on one platform in one language; posts belong to it.
 */

export type AccountsQuery = {
  brandId?: string;
  familyId?: string;
  platform?: SocialPlatform;
  status?: AccountStatus;
};

/**
 * An account with the brand fields every list shows next to it.
 * `effectiveLanguage` resolves "null = the brand's language" once, here.
 */
export type AccountWithBrand = SocialAccount & {
  brandName: string;
  familyId: string | null;
  effectiveLanguage: string;
};

const accountColumns = {
  ...getTableColumns(socialAccounts),
  brandName: brands.name,
  familyId: brands.familyId,
  brandLanguage: brands.language,
};

type AccountRow = SocialAccount & {
  brandName: string | null;
  familyId: string | null;
  brandLanguage: string | null;
};

function withBrand(row: AccountRow): AccountWithBrand {
  const { brandLanguage, ...rest } = row;
  return {
    ...rest,
    brandName: row.brandName ?? row.brandId,
    effectiveLanguage: row.language ?? brandLanguage ?? "en",
  };
}

/** Accounts, by brand name then platform then handle. */
export async function listAccounts(query: AccountsQuery = {}): Promise<AccountWithBrand[]> {
  const rows = await db
    .select(accountColumns)
    .from(socialAccounts)
    .leftJoin(brands, eq(brands.id, socialAccounts.brandId))
    .where(
      and(
        query.brandId ? eq(socialAccounts.brandId, query.brandId) : undefined,
        query.familyId ? eq(brands.familyId, query.familyId) : undefined,
        query.platform ? eq(socialAccounts.platform, query.platform) : undefined,
        query.status ? eq(socialAccounts.status, query.status) : undefined,
      ),
    )
    .orderBy(asc(brands.name), asc(socialAccounts.platform), asc(socialAccounts.handle));
  return rows.map(withBrand);
}

export async function getAccount(id: number): Promise<AccountWithBrand | null> {
  const [row] = await db
    .select(accountColumns)
    .from(socialAccounts)
    .leftJoin(brands, eq(brands.id, socialAccounts.brandId))
    .where(eq(socialAccounts.id, id))
    .limit(1);
  return row ? withBrand(row) : null;
}

/** One account by platform + handle (the unique key); the handle without `@`. */
export async function getAccountByHandle(
  platform: SocialPlatform,
  handle: string,
): Promise<AccountWithBrand | null> {
  const [row] = await db
    .select(accountColumns)
    .from(socialAccounts)
    .leftJoin(brands, eq(brands.id, socialAccounts.brandId))
    .where(
      and(
        eq(socialAccounts.platform, platform),
        eq(socialAccounts.handle, handle.replace(/^@/, "")),
      ),
    )
    .limit(1);
  return row ? withBrand(row) : null;
}

/**
 * The accounts a post on `accountId` is adapted to (§1.47): every other
 * active account on the same platform whose brand is in the same family.
 * Empty when the account's brand has no family.
 */
export async function listSiblingAccounts(accountId: number): Promise<AccountWithBrand[]> {
  const account = await getAccount(accountId);
  if (!account?.familyId) return [];
  const all = await listAccounts({
    familyId: account.familyId,
    platform: account.platform,
    status: "active",
  });
  return all.filter((a) => a.id !== accountId);
}

/** An integration without its token: the ciphertext only ever leaves the DB through src/lib/crypto.ts (O12). */
export type IntegrationSummary = Omit<Integration, "tokenCiphertext"> & { hasToken: boolean };

function summarise(row: Integration): IntegrationSummary {
  const { tokenCiphertext, ...rest } = row;
  return { ...rest, hasToken: !!tokenCiphertext };
}

export async function listIntegrations(
  provider?: IntegrationProvider,
): Promise<IntegrationSummary[]> {
  const rows = await db
    .select()
    .from(integrations)
    .where(provider ? eq(integrations.provider, provider) : undefined)
    .orderBy(asc(integrations.provider), asc(integrations.label));
  return rows.map(summarise);
}

export async function getIntegration(id: number): Promise<IntegrationSummary | null> {
  const [row] = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
  return row ? summarise(row) : null;
}

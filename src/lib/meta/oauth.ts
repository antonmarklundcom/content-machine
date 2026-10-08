import { META_SCOPES, type MetaConfig } from "./config";
import { GraphClient, graphFetch, graphGetPublic, type GraphFetch } from "./graph";

/**
 * Facebook Login for Business (PLAN.md §5.O12): the dialog URL, and turning
 * the returned `code` into a long-lived user token (about 60 days).
 */

export function loginDialogUrl(config: MetaConfig, redirect: string, state: string): string {
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  // A Login for Business configuration carries its own permission list.
  if (config.loginConfigId) url.searchParams.set("config_id", config.loginConfigId);
  else url.searchParams.set("scope", META_SCOPES.join(","));
  return url.toString();
}

type TokenAnswer = { access_token: string; token_type?: string; expires_in?: number };

export type MetaConnection = {
  token: string;
  /** Null when Meta gave no lifetime (a token that does not expire). */
  expiresAt: Date | null;
  userId: string;
  userName: string;
  scopes: string[];
};

/** Code → short-lived token → long-lived token → who it is and what it may do. */
export async function exchangeCode(
  config: MetaConfig,
  code: string,
  redirect: string,
  fetchImpl: GraphFetch = graphFetch(),
  now = new Date(),
): Promise<MetaConnection> {
  const short = await graphGetPublic<TokenAnswer>(
    "oauth/access_token",
    {
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: redirect,
      code,
    },
    fetchImpl,
  );
  const long = await graphGetPublic<TokenAnswer>(
    "oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: short.access_token,
    },
    fetchImpl,
  );
  const client = new GraphClient(long.access_token, fetchImpl);
  const me = await client.get<{ id: string; name?: string }>("me", { fields: "id,name" });
  const perms = await client.list<{ permission: string; status: string }>("me/permissions");
  return {
    token: long.access_token,
    expiresAt: long.expires_in ? new Date(now.getTime() + long.expires_in * 1000) : null,
    userId: me.id,
    userName: me.name ?? me.id,
    scopes: perms.filter((p) => p.status === "granted").map((p) => p.permission),
  };
}

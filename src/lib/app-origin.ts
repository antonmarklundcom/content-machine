/** Public origin shared by Edge middleware, OAuth and settings displays. */
export type OriginRequest = { url: string; headers: Pick<Headers, "get"> };
export type OriginConfig = { appUrl?: string; appMode?: string };

function validatedOrigin(value: string, online: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_URL must be a valid absolute HTTP(S) origin.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (online && url.protocol !== "https:")
  ) {
    throw new Error("APP_URL must contain only the canonical origin, using HTTPS online.");
  }
  return url.origin;
}

export function applicationOrigin(
  request: OriginRequest,
  config: OriginConfig = { appUrl: process.env.APP_URL, appMode: process.env.APP_MODE },
): string {
  const online = config.appMode?.trim().toLowerCase() === "online";
  const configured = config.appUrl?.trim();
  if (configured) return validatedOrigin(configured, online);
  if (online) throw new Error("APP_URL is required in online mode.");

  // Preserve the local-development proxy behavior. Hosted requests always use
  // configured APP_URL, never arbitrary Host or forwarded headers.
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host)
    .split(",")[0]
    .trim();
  const proto = (request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, ""))
    .split(",")[0]
    .trim();
  return validatedOrigin(`${proto}://${host}`, false);
}

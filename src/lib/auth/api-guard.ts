import { getSession } from "./session";
import { canAccessAuthoringMedia } from "./roles";

/** Re-read the user row on every API request; middleware only checks the token. */
export async function authoringApiGuard(): Promise<Response | null> {
  const user = await getSession();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!canAccessAuthoringMedia(user)) {
    return Response.json({ error: "Authoring access required." }, { status: 403 });
  }
  // Editing and free metadata/caption ingestion are allowed to employees.
  // Paid generation and publication retain their separate owner gates.
  return null;
}

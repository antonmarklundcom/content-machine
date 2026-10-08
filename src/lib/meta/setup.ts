/**
 * The Settings page's Meta setup checklist (PLAN.md §1.49, §5.O12). Pure: the
 * page gathers the facts, this decides which step is done. A step the app
 * cannot check yet is `unknown`, never a guessed `done`.
 */

export type StepId = "professional" | "pageLink" | "app" | "credentials" | "connect" | "mapping";
export type StepState = "done" | "todo" | "unknown";

export type SetupAccount = {
  id: number;
  handle: string;
  platform: string;
  status: string;
  isProfessional: boolean;
  externalId: string | null;
};

export type SetupFacts = {
  accounts: SetupAccount[];
  appIdSet: boolean;
  appSecretSet: boolean;
  encryptionKeyOk: boolean;
  connected: "none" | "ok" | "expired" | "error";
  /** IG usernames Meta lists (Professional + linked to a Page); null when not fetched. */
  metaIgUsernames: string[] | null;
};

export type SetupStep = {
  id: StepId;
  state: StepState;
  /** Handles still missing this step, for the "still to do" line. */
  missing: string[];
};

const bare = (h: string) => h.replace(/^@/, "").trim().toLowerCase();

export function setupSteps(f: SetupFacts): SetupStep[] {
  const live = f.accounts.filter((a) => a.status !== "paused");
  const ig = live.filter((a) => a.platform === "instagram");
  const metaLinkable = live.filter((a) => a.platform === "instagram" || a.platform === "facebook");
  const seen = f.metaIgUsernames ? new Set(f.metaIgUsernames.map(bare)) : null;

  const notPro = ig.filter((a) => !a.isProfessional && !(seen?.has(bare(a.handle)) ?? false));
  const notOnPage = seen ? ig.filter((a) => !seen.has(bare(a.handle)) && !a.externalId) : [];
  const unmapped = metaLinkable.filter((a) => !a.externalId);

  const credentials = f.appIdSet && f.appSecretSet && f.encryptionKeyOk;
  return [
    {
      id: "professional",
      state: ig.length === 0 ? "todo" : notPro.length === 0 ? "done" : "todo",
      missing: notPro.map((a) => a.handle),
    },
    {
      id: "pageLink",
      state:
        ig.length === 0 ? "todo" : !seen ? "unknown" : notOnPage.length === 0 ? "done" : "todo",
      missing: notOnPage.map((a) => a.handle),
    },
    // The app's type, admin and mode are not visible to us; an App ID is the proof we have.
    { id: "app", state: f.appIdSet ? "done" : "todo", missing: [] },
    { id: "credentials", state: credentials ? "done" : "todo", missing: [] },
    { id: "connect", state: f.connected === "ok" ? "done" : "todo", missing: [] },
    {
      id: "mapping",
      state:
        f.connected === "none" || metaLinkable.length === 0
          ? "todo"
          : unmapped.length === 0
            ? "done"
            : "todo",
      missing: unmapped.map((a) => `${a.platform === "facebook" ? "FB " : "@"}${a.handle}`),
    },
  ];
}

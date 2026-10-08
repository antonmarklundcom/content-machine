import assert from "node:assert/strict";
import { test } from "node:test";

import { setupSteps, type SetupFacts } from "./setup";

const base: SetupFacts = {
  accounts: [],
  appIdSet: false,
  appSecretSet: false,
  encryptionKeyOk: false,
  connected: "none",
  metaIgUsernames: null,
};

const ig = (handle: string, extra: Partial<SetupFacts["accounts"][number]> = {}) => ({
  id: handle.length,
  handle,
  platform: "instagram",
  status: "active",
  isProfessional: false,
  externalId: null,
  ...extra,
});

const state = (f: SetupFacts) => Object.fromEntries(setupSteps(f).map((s) => [s.id, s.state]));

test("nothing set up: every step is todo, page link unknown needs accounts first", () => {
  assert.deepEqual(state(base), {
    professional: "todo",
    pageLink: "todo",
    app: "todo",
    credentials: "todo",
    connect: "todo",
    mapping: "todo",
  });
});

test("before connecting, the page link cannot be checked", () => {
  const s = state({ ...base, accounts: [ig("residency", { isProfessional: true })] });
  assert.equal(s.professional, "done");
  assert.equal(s.pageLink, "unknown");
});

test("credentials need the encryption key too", () => {
  const s = state({ ...base, appIdSet: true, appSecretSet: true });
  assert.equal(s.app, "done");
  assert.equal(s.credentials, "todo");
  assert.equal(
    state({ ...base, appIdSet: true, appSecretSet: true, encryptionKeyOk: true }).credentials,
    "done",
  );
});

test("after connecting, Meta's list proves Professional + Page link and mapping counts", () => {
  const steps = setupSteps({
    ...base,
    connected: "ok",
    accounts: [
      ig("residency"),
      ig("flytta"),
      ig("paused", { status: "paused" }),
      { ...ig("pyresidency"), platform: "facebook", externalId: "p1" },
    ],
    metaIgUsernames: ["Residency"],
  });
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  assert.equal(by.professional.state, "todo");
  assert.deepEqual(by.professional.missing, ["flytta"]);
  assert.deepEqual(by.pageLink.missing, ["flytta"]);
  assert.equal(by.mapping.state, "todo");
  assert.deepEqual(by.mapping.missing, ["@residency", "@flytta"]);
});

test("expired connection is not done", () => {
  assert.equal(state({ ...base, connected: "expired" }).connect, "todo");
});

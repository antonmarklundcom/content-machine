import assert from "node:assert/strict";
import { test } from "node:test";
import type { SocialAccount } from "@/db/schema";
import {
  approvalProblem,
  assetProblem,
  publicationBlock,
  sameTarget,
  targetSnapshot,
  type SendAsset,
} from "./safety";

const account = {
  id: 1,
  brandId: "a",
  platform: "facebook",
  integrationId: 1,
  externalId: "target-a",
} as SocialAccount;
const asset: SendAsset = {
  assetId: 1,
  sha256: "a".repeat(64),
  localPath: "_originals/a.png",
  bytes: 10,
  role: "slide",
  position: 1,
  kind: "image",
  mime: "image/png",
  altText: null,
  width: 1,
  height: 1,
  durationSec: null,
  brandId: "a",
  accountId: null,
  status: "approved",
  name: "a.png",
};
test("a provider result and an ambiguous send permanently block a new creation", () => {
  assert.match(
    publicationBlock({ externalMediaId: "live", publishedAt: null, publishState: "idle" })!,
    /cannot be sent again/,
  );
  assert.match(
    publicationBlock({ externalMediaId: null, publishedAt: null, publishState: "ambiguous" })!,
    /Reconcile/,
  );
  assert.equal(
    publicationBlock({ externalMediaId: null, publishedAt: null, publishState: "idle" }),
    null,
  );
});
test("send assets require exact brand, intended account and approval; deliberate used reuse is allowed", () => {
  assert.equal(assetProblem({ brandId: "a", accountId: 1 }, asset), null);
  assert.equal(assetProblem({ brandId: "a", accountId: 1 }, { ...asset, status: "used" }), null);
  for (const status of ["new", "rejected", "archived"])
    assert.match(assetProblem({ brandId: "a", accountId: 1 }, { ...asset, status })!, /approved/);
  assert.match(assetProblem({ brandId: "a", accountId: 1 }, { ...asset, brandId: "b" })!, /brand/);
  assert.match(assetProblem({ brandId: "a", accountId: 1 }, { ...asset, brandId: null })!, /brand/);
  assert.match(
    assetProblem({ brandId: "a", accountId: 1 }, { ...asset, accountId: 2 })!,
    /account/,
  );
});
test("approval binds revision, account destination and ordered asset metadata", () => {
  const target = targetSnapshot(account, [asset]);
  const approval = {
    revision: 2,
    publishApprovedRevision: 2,
    publishApprovedBy: 1,
    publishTarget: target,
  };
  assert.equal(approvalProblem(approval, target), null);
  assert.match(approvalProblem({ ...approval, revision: 3 }, target)!, /revision/);
  for (const changed of [
    targetSnapshot({ ...account, externalId: "other" }, [asset]),
    targetSnapshot(account, [{ ...asset, sha256: "b".repeat(64) }]),
    targetSnapshot(account, [{ ...asset, altText: "changed" }]),
    targetSnapshot(account, [{ ...asset, position: 2 }]),
  ])
    assert.match(approvalProblem(approval, changed)!, /changed/);
  const reordered = JSON.parse(JSON.stringify(target)) as typeof target;
  assert.ok(sameTarget(reordered, target));
});

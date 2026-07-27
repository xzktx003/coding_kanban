import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptAppRevision,
  consumeRestoreAfterReload,
  dismissAppRevision,
  initializeAcceptedAppRevision,
  readAcceptedAppRevision,
  readDismissedAppRevision,
  shouldOfferAppUpdate,
} from "./app-update.js";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test("offers an update only when the current source revision differs from the accepted revision", () => {
  assert.equal(shouldOfferAppUpdate(null, "revision-a"), false);
  assert.equal(shouldOfferAppUpdate("revision-a", "revision-a"), false);
  assert.equal(shouldOfferAppUpdate("revision-a", "revision-b"), true);
});

test("keeps a dismissed revision hidden until a different revision appears", () => {
  const storage = createStorage();

  dismissAppRevision(storage, "revision-b");

  assert.equal(readDismissedAppRevision(storage), "revision-b");
  assert.equal(
    shouldOfferAppUpdate("revision-a", "revision-b", "revision-b"),
    false,
  );
  assert.equal(
    shouldOfferAppUpdate("revision-a", "revision-c", "revision-b"),
    true,
  );
});

test("accepting a revision records a one-shot restore intent", () => {
  const storage = createStorage();

  acceptAppRevision(storage, "revision-b");

  assert.equal(readAcceptedAppRevision(storage), "revision-b");
  assert.equal(consumeRestoreAfterReload(storage), true);
  assert.equal(consumeRestoreAfterReload(storage), false);
});

test("initializing the first observed revision does not create a restore intent", () => {
  const storage = createStorage();

  assert.equal(
    initializeAcceptedAppRevision(storage, "revision-initial"),
    "revision-initial",
  );
  assert.equal(readAcceptedAppRevision(storage), "revision-initial");
  assert.equal(consumeRestoreAfterReload(storage), false);
  assert.equal(
    initializeAcceptedAppRevision(storage, "revision-newer"),
    "revision-initial",
  );
});

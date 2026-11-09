import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopSurfaceActivation } from "../src/surface-activation.mjs";

const profileId = "43e56e8a-de3f-40fb-8cf3-7177d17d24f1",
  generation = "b94128f4-288c-4c97-a5cb-891555dc8199";
const scope = {
  profileId,
  generation,
  viewId: "9d79066f-f08f-4f00-a75e-e24cc65e5d00",
};
function fixture() {
  const owner = createDesktopSurfaceActivation({ profileId, generation });
  let document = {};
  const bind = () => {
    const captured = document;
    return owner.bind({
      scope,
      document: captured,
      isCurrentDocument: (value) => value === document,
    });
  };
  return {
    owner,
    bind,
    replaceDocument() {
      document = {};
    },
  };
}

test("a registered document stays inactive until its actual host confirms the active mode", () => {
  const f = fixture(),
    lease = f.bind();
  assert.equal(lease.getSnapshot(), null);
  f.owner.confirmActive(true);
  const token = lease.getSnapshot();
  assert.ok(token);
  assert.equal(lease.getSnapshot(), token);
  assert.equal(lease.isCurrent(token), true);
  assert.equal(lease.isCurrent({ ...token }), false);
  assert.equal(Object.hasOwn(lease, "confirmActive"), false);
  assert.equal(Object.hasOwn(lease, "bind"), false);
});

test("hide, re-show and equal host confirmation synchronously revoke previously captured tokens", () => {
  const f = fixture(),
    lease = f.bind(),
    seen = [];
  lease.subscribe(() => seen.push(lease.getSnapshot()));
  f.owner.confirmActive(true);
  const first = lease.getSnapshot();
  f.owner.confirmActive(true);
  const second = lease.getSnapshot();
  assert.notEqual(first, second);
  assert.equal(lease.isCurrent(first), false);
  assert.ok(seen.includes(null));
  f.owner.confirmActive(false);
  assert.equal(lease.isCurrent(second), false);
  assert.equal(lease.getSnapshot(), null);
  f.owner.confirmActive(true);
  assert.notEqual(lease.getSnapshot(), second);
});

test("new document or native view replacement revokes the old lease and late disposal cannot clear the new one", () => {
  const f = fixture();
  f.owner.confirmActive(true);
  const first = f.bind(),
    token = first.getSnapshot();
  f.replaceDocument();
  assert.equal(first.isCurrent(token), false);
  const second = f.bind(),
    next = second.getSnapshot();
  assert.ok(next);
  first.dispose();
  assert.equal(second.isCurrent(next), true);
  assert.equal(first.getSnapshot(), null);
  f.owner.close();
  assert.equal(second.isCurrent(next), false);
});

test("invalid metadata never creates an active document and document verification failure fails closed", () => {
  const f = fixture();
  f.owner.confirmActive(true);
  assert.throws(
    () =>
      f.owner.bind({
        scope: { ...scope, generation: scope.profileId },
        document: {},
        isCurrentDocument: () => true,
      }),
    { code: "SURFACE_ACTIVATION_INVALID_SCOPE" },
  );
  const lease = f.owner.bind({
    scope,
    document: {},
    isCurrentDocument: () => {
      throw Error("private");
    },
  });
  assert.equal(lease.getSnapshot(), null);
  assert.equal(lease.isCurrent({}), false);
});

test("revocation subscribers cannot obtain a replacement before every old capability is withdrawn", () => {
  const f = fixture();
  f.owner.confirmActive(true);
  const lease = f.bind(),
    first = lease.getSnapshot(),
    observations = [];
  lease.subscribe(() =>
    observations.push({
      current: lease.isCurrent(first),
      snapshot: lease.getSnapshot(),
    }),
  );
  f.owner.confirmActive(true);
  assert.equal(observations[0].current, false);
  assert.equal(observations[0].snapshot, null);
  assert.notEqual(lease.getSnapshot(), first);
});

test("invalid activation and owner close revoke before returning, even with a failing subscriber", () => {
  let errors = 0;
  const owner = createDesktopSurfaceActivation({
    profileId,
    generation,
    onSubscriberError: () => errors++,
  });
  const lease = owner.bind({
    scope,
    document: {},
    isCurrentDocument: () => true,
  });
  owner.confirmActive(true);
  const first = lease.getSnapshot();
  let observed = 0;
  lease.subscribe(() => {
    throw Error("private listener");
  });
  lease.subscribe(() => observed++);
  assert.throws(() => owner.confirmActive("yes"), {
    code: "SURFACE_ACTIVATION_INVALID_ACTIVE",
  });
  assert.equal(lease.isCurrent(first), false);
  assert.equal(observed, 1);
  assert.equal(errors, 1);
  owner.close();
  assert.throws(() => owner.confirmActive(true), {
    code: "SURFACE_ACTIVATION_CLOSED",
  });
  assert.equal(lease.getSnapshot(), null);
});

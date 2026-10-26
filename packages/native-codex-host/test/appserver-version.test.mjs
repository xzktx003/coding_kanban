import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { createNativeAppServerSender } = createRequire(import.meta.url)(
  "../companion/appserver-send.cjs",
);

test("unknown official versions remain unavailable without probing or registering a provider", () => {
  let probes = 0;
  const provider = {
    get codexMcpConnection() {
      probes++;
      throw Error("unknown provider must not be inspected");
    },
  };
  for (const officialVersion of [
    undefined,
    null,
    "",
    "26.51007.21435",
    "26.51007.21434-extra",
    " 26.51007.21434",
    "26.51002.51308-extra",
  ]) {
    const sender = createNativeAppServerSender({ provider, officialVersion });
    assert.equal(sender.available, false);
    sender.dispose();
  }
  assert.equal(probes, 0);
});
test("a known version still requires the exact original connection methods", () => {
  for (const officialVersion of ["26.51002.51308", "26.51007.21434"]) {
    for (const codexMcpConnection of [
      undefined,
      {},
      { registerProvider() {} },
    ]) {
      const sender = createNativeAppServerSender({
        provider: { codexMcpConnection },
        officialVersion,
      });
      assert.equal(sender.available, false);
      sender.dispose();
    }
  }
});

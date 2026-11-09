import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePrivateRuntime } from "../src/private-runtime.mjs";

test("shared runtime opt-in is a literal server-only boolean and never invokes accessors", async () => {
  const base = {
    sourceRoot: "/tmp/source",
    runtimeRoot: "/tmp/runtime",
    profileId: randomUUID(),
    generation: randomUUID(),
  };
  for (const sharedThread of [null, "true", 1, {}, []])
    await assert.rejects(preparePrivateRuntime({ ...base, sharedThread }), {
      code: "PRIVATE_INVALID_SHARED_CONFIG",
    });
  let accessed = false;
  const value = { ...base };
  Object.defineProperty(value, "sharedThread", {
    get() {
      accessed = true;
      return true;
    },
  });
  await assert.rejects(preparePrivateRuntime(value), {
    code: "PRIVATE_INVALID_SHARED_CONFIG",
  });
  assert.equal(accessed, false);
  for(const sharedAppTools of [null,'true',1,{},[]])await assert.rejects(preparePrivateRuntime({...base,sharedThread:true,sharedAppTools}),{code:'PRIVATE_INVALID_SHARED_CONFIG'});
  await assert.rejects(preparePrivateRuntime({...base,sharedAppTools:true}),{code:'PRIVATE_INVALID_SHARED_CONFIG'});
  const tools={...base,sharedThread:true};let toolsAccessed=false;
  Object.defineProperty(tools,'sharedAppTools',{get(){toolsAccessed=true;return true;}});
  await assert.rejects(preparePrivateRuntime(tools),{code:'PRIVATE_INVALID_SHARED_CONFIG'});assert.equal(toolsAccessed,false);
});

test(
  "the explicit shared runtime contains the complete pinned native integration",
  { skip: !process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT, timeout: 90000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "cgs-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const profileId = randomUUID(),
      generation = randomUUID();
    const result = await preparePrivateRuntime({
      sourceRoot: process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT,
      runtimeRoot: join(dir, "runtime"),
      profileId,
      generation,
      sharedThread: true,
      sharedAppTools: process.env.CHATGPT_DESKTOP_TEST_SHARED_APP_TOOLS === '1',
    });
    const config = JSON.parse(await readFile(result.configPath, "utf8"));
    assert.deepEqual(config.sharedThread, { version: process.env.CHATGPT_DESKTOP_TEST_SHARED_APP_TOOLS === '1' ? 2 : 1 });
    const wrapper = await readFile(
      join(dir, "runtime", "resources", "app.asar"),
    );
    const index = JSON.parse(
        wrapper.subarray(16, 16 + wrapper.readUInt32LE(12)).toString(),
      ),
      start = 8 + wrapper.readUInt32LE(4);
    for (const name of [
      "native-shared-desktop-transport.cjs",
      "native-shared-host-factory.cjs",
      "native-shared-mcp-relay.cjs",
      "shared-mcp-wire.cjs",
      "native-shared-host-policy.cjs",
      "shared-host-registration.cjs",
      "native-shared-thread-integration.cjs",
      "native-shared-thread-routing.cjs",
      "native-shared-thread-policy.cjs",
      "shared-thread-authority-channel.cjs",
      "shared-thread-authority-wire.cjs",
      "shared-permissions-schema.cjs",
      "shared-rpc-trace-schema.cjs",
    ]) {
      const entry = index.files[name];
      assert.ok(entry, `missing ${name}`);
      assert.equal(
        wrapper
          .subarray(
            start + Number(entry.offset),
            start + Number(entry.offset) + entry.size,
          )
          .toString(),
        await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"),
      );
    }
    const bootstrapEntry = index.files["native-bootstrap.cjs"],
      bootstrap = wrapper
        .subarray(
          start + Number(bootstrapEntry.offset),
          start + Number(bootstrapEntry.offset) + bootstrapEntry.size,
        )
        .toString();
    assert.match(bootstrap, /adaptNativeSharedHostChunk/);
    assert.match(bootstrap, /__kanbanRegisterSharedSource/);
    assert.match(bootstrap, /__kanbanSelectSharedDesktopTransport/);
    assert.match(bootstrap, /__kanbanSharedConnectLifecycle/);
    assert.match(bootstrap, /__kanbanSharedApprovalIntent/);
    assert.match(bootstrap, /__kanbanGuardSharedThreadRequest/);
    assert.match(bootstrap, /__kanbanExchangeSharedThreadRequest/);
    assert.match(bootstrap, /__kanbanRegisterSharedHostEvents/);
    assert.match(bootstrap, /__kanbanIsSharedServerResponse/);
    assert.match(bootstrap, /sharedThread\.retire/);
    assert.match(bootstrap, /sharedThread\.dispose/);
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginMutations } from "./plugin-mutations.js";
import type { Json } from "../core/json.js";
const target = {
    marketplacePath: "/private/market",
    remoteMarketplaceName: null,
    pluginName: "example",
  },
  scope = "a".repeat(64);
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "kanban-plugin-mutation-"));
  let installed = false,
    unknown = false,
    current = true;
  const calls: string[] = [];
  const options = {
    home,
    context: async () => ({ scope, namespace: "private-native-domain" }),
    current: (value: string) => current && value === scope,
    call: async (
      method: string,
      _params: unknown,
      expected: string,
      beforeSend?: () => void,
    ): Promise<Json> => {
      assert.equal(expected, scope);
      if (!current) throw new Error("NOT_SENT: scope changed");
      calls.push(method);
      beforeSend?.();
      if (method === "plugin/read")
        return {
          plugin: {
            marketplaceName: "Private",
            marketplacePath: target.marketplacePath,
            summary: {
              id: "native-opaque-id",
              name: "example",
              source: { type: "local", path: "/private/plugin" },
              installed,
              authPolicy: "ON_INSTALL",
            },
            apps: [],
          },
        };
      if (method === "plugin/install") {
        installed = true;
        if (unknown) throw new Error("connection lost after native write");
        return {
          authPolicy: "ON_INSTALL",
          appsNeedingAuth: [
            { id: "a", name: "A", installUrl: "https://example.invalid/a" },
            { id: "b", name: "B", installUrl: "https://example.invalid/b" },
          ],
        };
      }
      if (method === "plugin/uninstall") {
        assert.deepEqual(_params, { pluginId: "native-opaque-id" });
        installed = false;
        return {};
      }
      throw new Error(method);
    },
  };
  return {
    home,
    options,
    calls,
    manager: new PluginMutations(options),
    setUnknown: () => {
      unknown = true;
    },
    revoke: () => {
      current = false;
    },
    setInstalled: (value: boolean) => {
      installed = value;
    },
    close: () => rm(home, { recursive: true, force: true }),
  };
}
test("concurrent pages install one exact native target once and return every authentication target", async () => {
  const f = await fixture();
  try {
    const result = await Promise.all(
      ["one", "two"].map((operationId) =>
        f.manager.change({
          target,
          expectedScope: scope,
          operationId,
          operation: "install",
        }),
      ),
    );
    assert.equal(
      f.calls.filter((method) => method === "plugin/install").length,
      1,
    );
    assert.equal(result[0].appsNeedingAuth.length, 2);
    assert.equal(result[1].status, "state-confirmed");
    await f.manager.change({
      target,
      expectedScope: scope,
      operationId: "three",
      operation: "uninstall",
    });
    assert.equal(
      f.calls.filter((method) => method === "plugin/uninstall").length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("unknown receipts survive a coordinator restart and only read the original target before confirming state", async () => {
  const f = await fixture();
  try {
    f.setUnknown();
    const first = await f.manager.change({
      target,
      expectedScope: scope,
      operationId: "unknown",
      operation: "install",
    });
    assert.equal(first.status, "unknown");
    const recovered = new PluginMutations(f.options);
    const inspected = await recovered.change({
      target,
      expectedScope: scope,
      operationId: "do-not-resend",
      operation: "install",
    });
    assert.equal(inspected.status, "state-confirmed");
    assert.equal(
      f.calls.filter((method) => method === "plugin/install").length,
      1,
    );
    assert.equal(inspected.plugin?.summary.installed, true);
  } finally {
    await f.close();
  }
});
test("unsettled native state never unlocks a repeat and an account revocation prevents writes", async () => {
  const f = await fixture();
  try {
    f.setUnknown();
    await f.manager.change({
      target,
      expectedScope: scope,
      operationId: "unknown",
      operation: "install",
    });
    f.setInstalled(false);
    const result = await f.manager.change({
      target,
      expectedScope: scope,
      operationId: "repeat",
      operation: "install",
    });
    assert.equal(result.status, "unknown");
    assert.equal(
      f.calls.filter((method) => method === "plugin/install").length,
      1,
    );
    f.revoke();
    await assert.rejects(
      f.manager.change({
        target,
        expectedScope: scope,
        operationId: "late",
        operation: "uninstall",
      }),
      /changed|scope/,
    );
    assert.equal(
      f.calls.filter((method) => method === "plugin/uninstall").length,
      0,
    );
  } finally {
    await f.close();
  }
});
test("a known accepted receipt can be read after another client changes state, without re-executing its original intent", async () => {
  const f = await fixture();
  try {
    await f.manager.change({
      target,
      expectedScope: scope,
      operationId: "accepted",
      operation: "install",
    });
    f.setInstalled(false);
    const recovered = await f.manager.change({
      target,
      expectedScope: scope,
      operationId: "accepted",
      operation: "install",
      inspectOnly: true,
    });
    assert.equal(recovered.status, "accepted");
    assert.equal(recovered.plugin?.summary.installed, false);
    assert.equal(
      f.calls.filter((method) => method === "plugin/install").length,
      1,
    );
    await f.manager.change({
      target,
      expectedScope: scope,
      operationId: "new-explicit-intent",
      operation: "install",
    });
    assert.equal(
      f.calls.filter((method) => method === "plugin/install").length,
      2,
    );
  } finally {
    await f.close();
  }
});
test("authentication reads only exact plugin apps and bounds native detail bytes before catalog access", async () => {
  const f = await fixture();
  try {
    const original = f.options.call;
    let oversized = false;
    const manager = new PluginMutations({
      ...f.options,
      call: async (method, params, scope, beforeSend) => {
        if (method === "plugin/read") {
          const result = (await original(
            method,
            params,
            scope,
            beforeSend,
          )) as any;
          result.plugin.apps = [{ id: "a" }, { id: "b" }];
          if (oversized)
            result.plugin.description = "x".repeat(2 * 1024 * 1024);
          return result;
        }
        if (method === "app/list")
          return {
            data: [
              { id: "a", isAccessible: true },
              { id: "b", isAccessible: false },
              { id: "foreign", isAccessible: true },
            ],
            nextCursor: null,
          };
        return original(method, params, scope, beforeSend);
      },
    });
    assert.deepEqual(
      await manager.authentication({
        target,
        expectedScope: scope,
        appIds: ["a", "b", "foreign", "missing"],
      }),
      {
        apps: [
          { id: "a", isAccessible: true },
          { id: "b", isAccessible: false },
          { id: "foreign", isAccessible: null },
          { id: "missing", isAccessible: null },
        ],
      },
    );
    oversized = true;
    await assert.rejects(
      manager.authentication({ target, expectedScope: scope, appIds: ["a"] }),
      /budget|oversized/,
    );
  } finally {
    await f.close();
  }
});

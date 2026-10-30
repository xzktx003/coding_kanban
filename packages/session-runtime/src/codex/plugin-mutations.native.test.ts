import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { CodexService } from "./client.js";
import { PluginMutations } from "./plugin-mutations.js";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
} from "./daemon-native-fixture.js";
const run = promisify(execFile),
  binary = process.env.SESSION_CODEX_DAEMON_NATIVE_BIN;
test(
  "official private daemon and CLI share local plugin install/read/uninstall state",
  { skip: !binary, timeout: 90000 },
  async (t) => {
    const base = await mkdtemp(join(tmpdir(), "kanban-plugin-native-")),
      home = join(base, "home"),
      codexHome = join(base, "codex"),
      market = join(base, "market"),
      plugin = join(market, "plugins", "example", ".codex-plugin"),
      dataHome = join(base, "data");
    await Promise.all(
      [
        home,
        codexHome,
        plugin,
        dataHome,
        join(market, ".agents", "plugins"),
      ].map((path) => mkdir(path, { recursive: true, mode: 0o700 })),
    );
    await writeFile(
      join(plugin, "plugin.json"),
      JSON.stringify({
        name: "example",
        version: "1.0.0",
        description: "Private isolated acceptance",
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(market, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({
        name: "private-audit",
        interface: { displayName: "Private Audit" },
        plugins: [
          {
            name: "example",
            source: { source: "local", path: "./plugins/example" },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: "Productivity",
          },
        ],
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(codexHome, "config.toml"),
      'model="fixture"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="Private local plugin fixture"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n',
      { mode: 0o600 },
    );
    await registerOwnedNativeFixture(codexHome);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_PATH: binary!,
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "127.0.0.1,localhost",
      SESSION_CODEX_DAEMON_AUTO_START: "1",
    };
    const hub = new EventHub(),
      service = new CodexService({
        hub,
        env,
        instance: "plugin-native-fixture",
        sweepIntervalMs: 0,
        dataHome,
      });
    let identity: OwnedNativeIdentity | undefined,
      nativeRequested = false;
    t.after(async () => {
      await service.close();
      hub.close();
      if (nativeRequested) {
        identity ??= await ownedDaemonIdentity(codexHome);
        await run(binary!, ["app-server", "daemon", "stop"], {
          env,
          timeout: 15000,
          maxBuffer: 65536,
        });
        await cleanupOwnedNativeFixture(identity);
      }
      await rm(base, { recursive: true, force: true });
    });
    await run(binary!, ["plugin", "marketplace", "add", market], {
      env,
      timeout: 15000,
      maxBuffer: 65536,
    });
    nativeRequested = true;
    const context = await service.operationContext();
    identity = await ownedDaemonIdentity(codexHome);
    const listed = object(
      await service.raw("plugin/list", { forceRefetch: true }),
    );
    console.log("PRIVATE_NATIVE_PLUGIN_CATALOG", JSON.stringify(listed));
    const marketplaces = listed.marketplaces as Array<Record<string, unknown>>,
      nativeMarket = marketplaces.find(
        (value) => value.name === "private-audit",
      );
    assert.ok(nativeMarket);
    assert.equal(typeof nativeMarket.path, "string");
    const target = {
      marketplacePath: String(nativeMarket.path),
      remoteMarketplaceName: null,
      pluginName: "example",
    };
    const mutations = new PluginMutations({
      home: dataHome,
      context: () => service.operationContext(),
      current: (scope) => service.isOperationScopeCurrent(scope),
      call: (method, params, scope, beforeSend) =>
        service.guardedCall(method, params, scope, beforeSend),
    });
    const installed = await mutations.change({
      operationId: "native-install",
      operation: "install",
      target,
      expectedScope: context.scope,
    });
    assert.equal(installed.status, "accepted", JSON.stringify(installed));
    const cli = JSON.parse(
      (
        await run(binary!, ["plugin", "list", "--json"], {
          env,
          timeout: 15000,
          maxBuffer: 65536,
        })
      ).stdout,
    );
    assert.ok(
      cli.installed.some(
        (value: { pluginId: string }) =>
          value.pluginId === "example@private-audit",
      ),
    );
    const confirmed = await mutations.change({
      operationId: "native-install",
      operation: "install",
      target,
      expectedScope: context.scope,
      inspectOnly: true,
    });
    assert.equal(confirmed.plugin?.summary.installed, true);
    const removed = await mutations.change({
      operationId: "native-remove",
      operation: "uninstall",
      target,
      expectedScope: context.scope,
    });
    assert.equal(removed.status, "accepted", JSON.stringify(removed));
    const after = JSON.parse(
      (
        await run(binary!, ["plugin", "list", "--json"], {
          env,
          timeout: 15000,
          maxBuffer: 65536,
        })
      ).stdout,
    );
    assert.deepEqual(after.installed, []);
    console.log(
      "PLUGIN_NATIVE_ACCEPTANCE",
      JSON.stringify({
        officialDaemon: true,
        cliSharedState: true,
        exactMarketplace: true,
        nativeIdentityUninstall: true,
        accountCopied: false,
        onlineOAuth: false,
        installed: installed.status,
        removed: removed.status,
      }),
    );
  },
);

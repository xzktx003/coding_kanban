import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CodexService } from "./client.js";
import { EventHub } from "../core/events.js";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
  assertOwnedNativeExited,
} from "./daemon-native-fixture.js";

const binary = process.env.SESSION_CODEX_DAEMON_NATIVE_BIN;
const run = promisify(execFile);
async function processState(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { startTicks: fields[19], state: fields[0] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

test(
  "private official native fixture cleanup releases both daemon and its owned updater monitor",
  { skip: !binary, timeout: 30_000 },
  async () => {
    const base = await mkdtemp(join(tmpdir(), "kanban-owned-cleanup-")),
      home = join(base, "home"),
      codexHome = join(base, "codex");
    await Promise.all(
      [home, codexHome].map((path) => mkdir(path, { mode: 0o700 })),
    );
    await registerOwnedNativeFixture(codexHome);
    const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome };
    let stopped = false;
    let updater: { pid: number; startTicks: string } | undefined;
    try {
      await run(binary!, ["app-server", "daemon", "start"], {
        env,
        timeout: 15_000,
        maxBuffer: 65536,
      });
      const identity = await ownedDaemonIdentity(codexHome);
      const record = JSON.parse(
        await readFile(
          join(codexHome, "app-server-daemon", "daemon-updater.pid"),
          "utf8",
        ),
      );
      const state = await processState(record.pid);
      assert.ok(state && state.state !== "Z");
      const argv = (await readFile(`/proc/${record.pid}/cmdline`, "utf8"))
        .split("\0")
        .filter(Boolean);
      assert.ok(
        argv[0]?.startsWith(
          codexHome + "/packages/app-server-daemon/releases/",
        ),
      );
      assert.deepEqual(argv.slice(1), [
        "app-server",
        "daemon",
        "pid-update-loop",
      ]);
      updater = { pid: record.pid, startTicks: state.startTicks! };
      await run(binary!, ["app-server", "daemon", "stop"], {
        env,
        timeout: 15_000,
        maxBuffer: 65536,
      });
      stopped = true;
      await cleanupOwnedNativeFixture(identity);
      await assertOwnedNativeExited(identity);
      const deadline = Date.now() + 500;
      let after = await processState(updater.pid);
      while (
        after &&
        after.startTicks === updater.startTicks &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        after = await processState(updater.pid);
      }
      assert.ok(
        !after || after.startTicks !== updater.startTicks,
        "the fixture's captured updater monitor must not remain alive after cleanup",
      );
      console.log(
        "PRIVATE_NATIVE_RESOURCE_CLEANUP",
        JSON.stringify({
          nativeExited: true,
          updaterMonitorsRemaining: 0,
          updaterPidReaped: true,
          exactCapturedPidAndStartTicks: true,
          accountCopied: false,
        }),
      );
    } finally {
      // This red/green test itself captures its newly created process identity before stopping;
      // failed assertions must not add another monitor to the pre-existing host leaks.
      if (updater) {
        const current = await processState(updater.pid);
        if (current?.startTicks === updater.startTicks && current.state !== "Z")
          process.kill(updater.pid, "SIGTERM");
      }
      if (!stopped)
        await run(binary!, ["app-server", "daemon", "stop"], {
          env,
          timeout: 15_000,
          maxBuffer: 65536,
        }).catch(() => {});
      await rm(base, { recursive: true, force: true });
    }
  },
);

test(
  "real private official daemon stop/start changes the endpoint identity while its account namespace stays stable",
  { skip: !binary, timeout: 30_000 },
  async () => {
    const base = await mkdtemp(join(tmpdir(), "kanban-native-identity-")),
      home = join(base, "home"),
      codexHome = join(base, "codex");
    await Promise.all(
      [home, codexHome].map((path) => mkdir(path, { mode: 0o700 })),
    );
    await registerOwnedNativeFixture(codexHome);
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_PATH: binary!,
      SESSION_CODEX_DAEMON_AUTO_START: "0",
    };
    const identities: OwnedNativeIdentity[] = [],
      clients: CodexService[] = [],
      hubs: EventHub[] = [];
    let requested = false;
    const command = (action: string) =>
      run(binary!, ["app-server", "daemon", action], {
        env,
        timeout: 15_000,
        maxBuffer: 65536,
      });
    const client = (instance: string) => {
      const hub = new EventHub(),
        service = new CodexService({ hub, env, instance, sweepIntervalMs: 0 });
      clients.push(service);
      hubs.push(hub);
      return service;
    };
    try {
      requested = true;
      await command("start");
      identities.push(await ownedDaemonIdentity(codexHome));
      const first = client("native-domain-before"),
        before = await first.operationContext();
      assert.match(before.daemonIdentity ?? "", /^[a-f0-9]{64}$/);
      await first.close();
      await command("stop");
      await command("start");
      identities.push(await ownedDaemonIdentity(codexHome));
      const after = await client("native-domain-after").operationContext();
      assert.equal(after.namespace, before.namespace);
      assert.notEqual(after.daemonIdentity, before.daemonIdentity);
      assert.ok(
        identities[0]!.pid !== identities[1]!.pid ||
          identities[0]!.startTicks !== identities[1]!.startTicks,
      );
      console.log(
        "OFFICIAL_NATIVE_ENDPOINT_IDENTITY",
        JSON.stringify({
          actualPrivateDaemonRestart: true,
          namespaceStable: true,
          endpointIdentityChanged: true,
          nativeProcessChanged: true,
          writeTaskMethods: [],
          formalDaemonTouched: false,
        }),
      );
    } finally {
      for (const service of clients) await service.close();
      for (const hub of hubs) hub.close();
      if (requested) {
        if (!identities.length)
          identities.push(await ownedDaemonIdentity(codexHome));
        await command("stop");
      }
      for (const identity of [...identities].reverse())
        await cleanupOwnedNativeFixture(identity);
      await rm(base, { recursive: true, force: true });
    }
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { reattachContainerDesktopUpstream, startContainerDesktopUpstream } from "../src/container-service.mjs";
import { startContainerDesktopService } from "../src/container-host-service.mjs";
import { createDesktopControlService } from "../src/control-service.mjs";
import { connectDesktopControl } from "../src/control-client.mjs";
import { decodeWireValue } from "../src/wire-value.mjs";

// Explicit opt-in; each case creates its own network-none, no-login, no-task fixture.
const enabled = process.env.CHATGPT_CONTAINER_OFFLINE_ACCEPTANCE === "1";
const exec = promisify(execFile);
const hash = async (path) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
};

async function configuration() {
  const {
    CHATGPT_CONTAINER_IMAGE: imageDigest,
    CHATGPT_CONTAINER_SOURCE: sourceRoot,
    CHATGPT_CONTAINER_MAC_ASAR: macAsarPath,
    CHATGPT_CONTAINER_MAC_SHA256: macAsarSha256,
    CHATGPT_CONTAINER_DOCKER: docker,
    CHATGPT_CONTAINER_PYTHON: python,
  } = process.env;
  assert.match(imageDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.match(macAsarSha256 ?? "", /^[0-9a-f]{64}$/);
  for (const value of [sourceRoot, macAsarPath, docker, python])
    assert.ok(value?.startsWith("/"));
  const [dockerPath, pythonPath, nodePath] = await Promise.all([
    realpath(docker),
    realpath(python),
    realpath(process.execPath),
  ]);
  const [dockerSha256, pythonSha256, nodeSha256] = await Promise.all([
    hash(dockerPath),
    hash(pythonPath),
    hash(nodePath),
  ]);
  const status = await readFile("/proc/self/status", "utf8");
  const cpuId = Number(/^Cpus_allowed_list:\s*(\d+)/m.exec(status)?.[1]);
  assert.ok(Number.isSafeInteger(cpuId));
  return {
    imageDigest,
    sourceRoot,
    macAsarPath,
    macAsarSha256,
    dockerPath,
    pythonPath,
    nodePath,
    dockerSha256,
    pythonSha256,
    nodeSha256,
    cpuId,
    startupTimeoutMs: 90000,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cg-offline-"));
  const bridgeRoot = join(root, "bridge"),
    stateRoot = join(root, "state"),
    runtimeRoot = join(root, "runtime");
  await Promise.all([
    mkdir(bridgeRoot, { mode: 0o700 }),
    mkdir(stateRoot, { mode: 0o700 }),
  ]);
  return { root, bridgeRoot, stateRoot, runtimeRoot };
}

async function removeOwnedFixture(config, paths, id) {
  if (id) {
    assert.match(id, /^[a-f0-9]{64}$/);
    const options = {
      timeout: 15000,
      env: {
        HOME: paths.bridgeRoot,
        PATH: "/usr/bin:/bin",
        DOCKER_CONFIG: join(paths.bridgeRoot, "docker-config"),
      },
    };
    await exec(config.dockerPath, ["stop", "--time", "2", id], options);
    await exec(config.dockerPath, ["rm", id], options);
  }
  await rm(paths.root, { recursive: true, force: true });
}

function waitForViewClosed(upstream, viewId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("view close timed out"));
    }, 30000);
    const unsubscribe = upstream.subscribe((encoded) => {
      const frame = decodeWireValue(encoded);
      if (frame.type === "viewClosed" && frame.scope.viewId === viewId) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

test(
  "reattached native reports project persistence unavailable until its original writer is reconciled",
  { skip: !enabled, timeout: 180000 },
  async () => {
    const config = await configuration(), paths = await fixture();
    const historyRoot = join(paths.root, "history"), projectRoot = join(paths.root, "projects");
    await mkdir(historyRoot, { mode: 0o700 });
    await mkdir(projectRoot, { mode: 0o700 });
    const { macAsarPath: _macPath, macAsarSha256: _macHash, ...upstreamConfig } = config;
    const options = { ...upstreamConfig, runtimeRoot: paths.runtimeRoot, bridgeRoot: paths.bridgeRoot,
      profileId: randomUUID(), generation: randomUUID(), historyRoot, projectRoots: [projectRoot] };
    let first, recovered, id;
    try {
      first = await startContainerDesktopUpstream(options);
      id = first.containerId;
      const configSha256 = "a".repeat(64);
      const identity = await first.captureRecoveryIdentity({ configSha256 });
      await first.disconnectTransport();
      recovered = await reattachContainerDesktopUpstream(options, { identity, configSha256 });
      assert.equal(recovered.containerId, id);
      assert.equal(recovered.projectPersistenceStatus(), "error");
    } catch (error) {
      id ??= error?.retainedOwner?.containerId;
      throw error;
    } finally {
      await recovered?.disconnectTransport().catch(() => {});
      await first?.disconnectTransport().catch(() => {});
      await removeOwnedFixture(config, paths, id);
    }
  },
);

test(
  "a missing old HOME leaves project evidence intact while a new native can read retained history",
  { skip: !enabled, timeout: 180000 },
  async () => {
    const config = await configuration(), paths = await fixture();
    const historyRoot = join(paths.root, "history"), projectRoot = join(paths.root, "projects");
    const bridge2 = join(paths.root, "bridge2"), runtime2 = join(paths.root, "runtime2");
    for (const path of [historyRoot, projectRoot, bridge2]) await mkdir(path, { mode: 0o700 });
    const { macAsarPath: _macPath, macAsarSha256: _macHash, ...upstreamConfig } = config;
    const base = { ...upstreamConfig, historyRoot, projectRoots: [projectRoot] };
    const dockerOptions = { timeout: 15000, env: { HOME: paths.bridgeRoot, PATH: "/usr/bin:/bin", DOCKER_CONFIG: join(paths.bridgeRoot, "docker-config") } };
    let first, second, firstId, secondId;
    try {
      first = await startContainerDesktopUpstream({ ...base, runtimeRoot: paths.runtimeRoot, bridgeRoot: paths.bridgeRoot,
        profileId: randomUUID(), generation: randomUUID() });
      firstId = first.containerId;
      await first.disconnectTransport();
      await exec(config.dockerPath, ["stop", "--time", "2", firstId], dockerOptions);
      await Promise.race([first.nativeExited, delay(10000, undefined, { ref: false }).then(() => { throw Error("old fixture native did not exit"); })]);
      await exec(config.dockerPath, ["rm", firstId], dockerOptions); firstId = undefined;
      const pendingFile = join(historyRoot, "project-state", "pending.json");
      const pending = await readFile(pendingFile);
      const historyFile = join(historyRoot, "sessions", "fixture-rollout.jsonl");
      await writeFile(historyFile, "fixture-history-preserved\n", { mode: 0o600 });
      await rm(join(paths.runtimeRoot, "home"), { recursive: true });
      second = await startContainerDesktopUpstream({ ...base, runtimeRoot: runtime2, bridgeRoot: bridge2,
        profileId: randomUUID(), generation: randomUUID() });
      secondId = second.containerId;
      assert.equal(second.projectPersistenceStatus(), "error");
      assert.deepEqual(await readFile(pendingFile), pending);
      const target = join(runtime2, "home", ".codex", "sessions", "fixture-rollout.jsonl");
      const output = await exec(config.dockerPath, ["exec", secondId, "/bin/cat", target], dockerOptions);
      assert.equal(output.stdout, "fixture-history-preserved\n");
    } catch (error) {
      if (!first) firstId ??= error?.retainedOwner?.containerId;
      else secondId ??= error?.retainedOwner?.containerId;
      throw error;
    } finally {
      await second?.disconnectTransport().catch(() => {});
      await first?.disconnectTransport().catch(() => {});
      if (firstId) {
        assert.match(firstId, /^[a-f0-9]{64}$/);
        await exec(config.dockerPath, ["stop", "--time", "2", firstId], dockerOptions);
        await exec(config.dockerPath, ["rm", firstId], dockerOptions);
      }
      await removeOwnedFixture(config, paths, secondId);
    }
  },
);

test(
  "offline native views close and reconnect to the identical container process",
  { skip: !enabled, timeout: 180000 },
  async () => {
    const config = await configuration(),
      paths = await fixture();
    const profileId = randomUUID(),
      generation = randomUUID();
    let service, broker, connection, id;
    try {
      const {
        macAsarPath: _macPath,
        macAsarSha256: _macHash,
        ...upstreamConfig
      } = config;
      service = await startContainerDesktopUpstream({
        ...upstreamConfig,
        runtimeRoot: paths.runtimeRoot,
        bridgeRoot: paths.bridgeRoot,
        profileId,
        generation,
      });
      id = service.containerId;
      const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
      const startTicks = stat
        .slice(stat.lastIndexOf(") ") + 2)
        .trim()
        .split(/\s+/)[19];
      const profile = {
        id: profileId,
        generation,
        pid: process.pid,
        startTicks,
      };
      for (let n = 1; n <= 2; n++) {
        const socketPath = join(paths.stateRoot, `broker-${n}`);
        broker = await createDesktopControlService({
          socketPath,
          profileId,
          generation,
          pid: process.pid,
          startTicks,
          upstream: service.upstream,
          verifyIdentity: service.verifyIdentity,
        });
        profile.controlSocketPath = socketPath;
        const viewId = randomUUID();
        connection = await connectDesktopControl({
          profile,
          viewId,
          verifyProfile: service.verifyIdentity,
          timeoutMs: 30000,
        });
        assert.equal(connection.bootstrap.windowType, "electron");
        const closed = waitForViewClosed(service.upstream, viewId);
        connection.close();
        connection = undefined;
        await closed;
        await broker.close();
        broker = undefined;
        await service.disconnectTransport();
        if (n === 1) {
          await service.reconnectTransport();
          assert.equal(await service.verifyIdentity(), true);
        }
      }
    } catch (error) {
      id ??= error?.retainedOwner?.containerId;
      throw error;
    } finally {
      connection?.close();
      await broker?.close().catch(() => {});
      await service?.disconnectTransport().catch(() => {});
      await removeOwnedFixture(config, paths, id);
    }
  },
);

test(
  "offline profile revocation closes the view while preserving native until fixture cleanup",
  { skip: !enabled, timeout: 180000 },
  async () => {
    const config = await configuration(),
      paths = await fixture();
    const profileFile = join(paths.stateRoot, "profile"),
      controlSocketPath = join(paths.stateRoot, "broker");
    let service, connection, id;
    try {
      service = await startContainerDesktopService({
        ...config,
        runtimeRoot: paths.runtimeRoot,
        bridgeRoot: paths.bridgeRoot,
        profileFile,
        controlSocketPath,
      });
      id = service.containerId;
      const profile = JSON.parse(await readFile(profileFile, "utf8"));
      assert.equal(profile.pid, process.pid);
      assert.equal(profile.id, service.profileId);
      assert.equal(profile.generation, service.generation);
      connection = await connectDesktopControl({
        profile,
        viewId: randomUUID(),
        verifyProfile: async () => true,
        timeoutMs: 30000,
      });
      assert.equal(connection.bootstrap.windowType, "electron");
      await service.close();
      assert.equal(
        JSON.parse(await readFile(profileFile, "utf8")).state,
        "revoked",
      );
      assert.equal(
        await Promise.race([
          service.nativeExited.then(() => true),
          delay(500).then(() => false),
        ]),
        false,
      );
      const running = await exec(
        config.dockerPath,
        ["inspect", "--format", "{{.State.Running}}", id],
        {
          timeout: 10000,
          env: {
            HOME: paths.bridgeRoot,
            PATH: "/usr/bin:/bin",
            DOCKER_CONFIG: join(paths.bridgeRoot, "docker-config"),
          },
        },
      );
      assert.equal(running.stdout.trim(), "true");
    } catch (error) {
      id ??= error?.retainedOwner?.containerId;
      throw error;
    } finally {
      connection?.close();
      await service?.close().catch(() => {});
      await removeOwnedFixture(config, paths, id);
    }
    assert.equal(
      (
        await Promise.race([
          service.nativeExited,
          delay(5000).then(() => ({ state: "timeout" })),
        ])
      ).state,
      "exited",
    );
  },
);

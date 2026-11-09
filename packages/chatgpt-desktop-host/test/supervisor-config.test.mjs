import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  statfs,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDesktopSupervisorConfigFactory,
  validateDesktopSupervisorSocketPaths,
} from "../src/supervisor-config.mjs";
import { readDesktopServiceConfig } from "../src/service-cli.mjs";
import {
  initializeDesktopSupervisor,
  runDesktopSupervisor,
} from "../src/supervisor-service.mjs";
import { publishStableProfileAlias } from "../src/stable-profile-alias.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "cgs-"));
  const deploymentRoot = join(root, "deploy"),
    historyRoot = join(root, "history"),
    project = join(root, "project"),
    account = join(root, "account");
  for (const path of [deploymentRoot, historyRoot, project, account])
    await mkdir(path, { mode: 0o700 });
  const accountSourceFile = join(account, "auth.json"),
    templateFile = join(root, "template.json");
  await writeFile(accountSourceFile, "private fixture, not credentials\n", {
    mode: 0o600,
  });
  const template = {
    version: 1,
    deploymentId: randomUUID(),
    deploymentRoot,
    options: {
      imageDigest: `sha256:${"a".repeat(64)}`,
      sourceRoot: join(root, "source"),
      cpuId: 1,
      macAsarPath: join(root, "mac.asar"),
      macAsarSha256: "b".repeat(64),
      dockerPath: "/usr/bin/docker",
      dockerSha256: "c".repeat(64),
      pythonPath: "/usr/bin/python3",
      pythonSha256: "d".repeat(64),
      nodePath: process.execPath,
      nodeSha256: "e".repeat(64),
      networkMode: "bridge",
      projectRoots: [project],
      historyRoot,
      accountSourceFile,
    },
  };
  const save = () =>
    writeFile(templateFile, JSON.stringify(template, null, 2) + "\n", {
      mode: 0o600,
    });
  await save();
  const ownedHomes = new Set();
  t.after(async () => {
    for (const home of ownedHomes)
      await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    deploymentRoot,
    historyRoot,
    project,
    accountSourceFile,
    templateFile,
    template,
    save,
    id() {
      const value = randomUUID();
      ownedHomes.add(join("/dev/shm", `chatgpt-${value.replaceAll("-", "")}`));
      return value;
    },
    trackHome(home) {
      ownedHomes.add(home);
    },
  };
}

test("a fixed private template creates distinct fully validated empty generations without touching persistent data", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.historyRoot, "sentinel"), "history untouched", {
    mode: 0o600,
  });
  const alias = join(f.deploymentRoot, "current.profile.json");
  await writeFile(alias, "alias untouched", { mode: 0o600 });
  const factory = await createDesktopSupervisorConfigFactory({
    templateFile: f.templateFile,
  });
  assert.ok(Object.isFrozen(factory));
  assert.equal(factory.deploymentId, f.template.deploymentId);
  assert.equal(factory.stateDirectory, join(f.deploymentRoot, "supervisor"));
  assert.equal(factory.currentProfileFile, alias);
  const ids = [f.id(), f.id()];
  const first = await factory.createConfig({ attemptId: ids[0] });
  const second = await factory.createConfig({ attemptId: ids[1] });
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.options));
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(first.options.historyRoot, f.historyRoot);
  assert.deepEqual(first.options.projectRoots, [f.project]);
  assert.equal(first.options.accountSnapshot.sourceFile, f.accountSourceFile);
  for (const [id, config] of [
    [ids[0], first],
    [ids[1], second],
  ]) {
    const generation = join(f.deploymentRoot, `g${id.replaceAll("-", "")}`);
    assert.equal(
      (await lstat(generation, { bigint: true })).dev,
      (await lstat(f.deploymentRoot, { bigint: true })).dev,
    );
    assert.equal(config.options.runtimeRoot, join(generation, "r"));
    assert.equal(config.options.bridgeRoot, join(generation, "b"));
    assert.equal(config.options.profileFile, join(generation, "p.json"));
    assert.equal(config.options.controlSocketPath, join(generation, "c.sock"));
    assert.equal(
      config.options.accountSnapshot.homeRoot,
      join("/dev/shm", `chatgpt-${id.replaceAll("-", "")}`),
    );
    assert.deepEqual(await readdir(config.options.bridgeRoot), []);
    assert.deepEqual(
      await readdir(config.options.accountSnapshot.homeRoot),
      [],
    );
    assert.equal(
      (await statfs(config.options.accountSnapshot.homeRoot, { bigint: true }))
        .type,
      0x01021994n,
    );
    for (const missing of [
      config.options.runtimeRoot,
      config.options.profileFile,
      config.options.controlSocketPath,
    ])
      await assert.rejects(lstat(missing), { code: "ENOENT" });
    const reread = await readDesktopServiceConfig(
      join(generation, "config.json"),
    );
    assert.deepEqual(reread, config);
    assert.equal(
      (await lstat(join(generation, "config.json"))).mode & 0o777,
      0o600,
    );
  }
  assert.equal(await readFile(alias, "utf8"), "alias untouched");
  assert.equal(
    await readFile(join(f.historyRoot, "sentinel"), "utf8"),
    "history untouched",
  );
  assert.equal(
    await readFile(f.accountSourceFile, "utf8"),
    "private fixture, not credentials\n",
  );
});

test("recovery configuration reuses the exact owned runtime and account home but allocates a fresh broker", async (t) => {
  const f = await fixture(t), factory = await createDesktopSupervisorConfigFactory({ templateFile: f.templateFile });
  const oldId = f.id(), nextId = f.id(), old = await factory.createConfig({ attemptId: oldId });
  const prior = { attemptId: oldId, configSha256: old.fingerprint, recovery: {
    dockerPath: old.options.dockerPath, dockerSha256: old.options.dockerSha256,
    imageDigest: old.options.imageDigest, bridgeRoot: old.options.bridgeRoot, profileFile: old.options.profileFile,
  } };
  const recovered = await factory.createRecoveryConfig({ attemptId: nextId, previous: prior });
  assert.notEqual(recovered.fingerprint, old.fingerprint);
  for (const key of ["sourceRoot", "runtimeRoot", "bridgeRoot", "historyRoot", "accountSnapshot", "projectRoots", "connection"])
    assert.deepEqual(recovered.options[key], old.options[key]);
  const nextDir = join(f.deploymentRoot, `g${nextId.replaceAll("-", "")}`);
  assert.equal(recovered.options.profileFile, join(nextDir, "p.json"));
  assert.equal(recovered.options.controlSocketPath, join(nextDir, "c.sock"));
  assert.deepEqual(await readdir(nextDir), ["config.json"]);
  assert.deepEqual(await readdir(old.options.accountSnapshot.homeRoot), []);
  assert.deepEqual(await readdir(old.options.bridgeRoot), []);
  assert.deepEqual(await readDesktopServiceConfig(join(nextDir, "config.json")), recovered);
  const thirdId = f.id(), third = await factory.createRecoveryConfig({ attemptId: thirdId, previous: {
    attemptId: nextId, configSha256: recovered.fingerprint,
    recovery: { ...prior.recovery, profileFile: recovered.options.profileFile },
  } });
  assert.equal(third.options.runtimeRoot, old.options.runtimeRoot);
  assert.equal(third.options.bridgeRoot, old.options.bridgeRoot);
  assert.equal(third.options.accountSnapshot.homeRoot, old.options.accountSnapshot.homeRoot);
  const staleId = f.id();
  await assert.rejects(factory.createRecoveryConfig({ attemptId: staleId, previous: { ...prior, configSha256: "f".repeat(64) } }));
  await assert.rejects(lstat(join(f.deploymentRoot, `g${staleId.replaceAll("-", "")}`)), { code: "ENOENT" });
});

test("generation paths are exclusive and repeated or malformed attempt IDs never overwrite data", async (t) => {
  const f = await fixture(t),
    factory = await createDesktopSupervisorConfigFactory({
      templateFile: f.templateFile,
    }),
    id = f.id();
  const config = await factory.createConfig({ attemptId: id });
  await writeFile(join(config.options.bridgeRoot, "sentinel"), "keep", {
    mode: 0o600,
  });
  await assert.rejects(factory.createConfig({ attemptId: id }));
  await assert.rejects(factory.createConfig({ attemptId: "../invalid" }));
  await assert.rejects(factory.createConfig({ attemptId: id, extra: true }));
  let coerced = false;
  await assert.rejects(
    factory.createConfig({
      attemptId: {
        toString() {
          coerced = true;
          return id;
        },
      },
    }),
  );
  assert.equal(coerced, false);
  assert.equal(
    await readFile(join(config.options.bridgeRoot, "sentinel"), "utf8"),
    "keep",
  );
});

test("concurrent allocation of one attempt has only one owner", async (t) => {
  const f = await fixture(t),
    factory = await createDesktopSupervisorConfigFactory({
      templateFile: f.templateFile,
    }),
    id = f.id();
  const results = await Promise.allSettled([
    factory.createConfig({ attemptId: id }),
    factory.createConfig({ attemptId: id }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const config = results.find((result) => result.status === "fulfilled").value;
  assert.deepEqual(await readdir(config.options.bridgeRoot), []);
  assert.deepEqual(await readdir(config.options.accountSnapshot.homeRoot), []);
});

test("oversized native and broker socket paths fail before allocating a generation or tmpfs home", async (t) => {
  for (const nativeBytes of [108, 109]) {
    const f = await fixture(t),
      id = f.id(),
      generationName = `g${id.replaceAll("-", "")}`;
    const nativeSuffix = [
      generationName,
      "r",
      "home",
      ".codex",
      "ipc",
      "ipc.sock",
    ];
    const fixed = Buffer.byteLength(join(f.root, "x", ...nativeSuffix)) - 1;
    const nameBytes = nativeBytes - fixed;
    assert.ok(nameBytes > 0);
    const name =
      "界".repeat(Math.floor(nameBytes / 3)) + "x".repeat(nameBytes % 3);
    const deploymentRoot = join(f.root, name),
      generation = join(deploymentRoot, generationName);
    await mkdir(deploymentRoot, { mode: 0o700 });
    f.template.deploymentRoot = deploymentRoot;
    await f.save();
    assert.equal(
      Buffer.byteLength(
        join(generation, "r", "home", ".codex", "ipc", "ipc.sock"),
      ),
      nativeBytes,
    );
    assert.equal(
      Buffer.byteLength(join(generation, ".desktop-control-XXXXXX", "s")),
      nativeBytes - 1,
    );
    assert.ok(Buffer.byteLength(join(generation, "b", "socket")) <= 107);
    assert.ok(Buffer.byteLength(join(generation, "c.sock")) <= 107);
    const home = join("/dev/shm", `chatgpt-${id.replaceAll("-", "")}`);
    await assert.rejects(lstat(home), { code: "ENOENT" });
    const factory = await createDesktopSupervisorConfigFactory({
      templateFile: f.templateFile,
    });
    await assert.rejects(factory.createConfig({ attemptId: id }), {
      code: "DESKTOP_SUPERVISOR_INVALID_CONFIG",
    });
    assert.deepEqual(await readdir(deploymentRoot), []);
    await assert.rejects(lstat(home), { code: "ENOENT" });
  }
});

test("each native, broker, bridge and control Unix socket enforces 107 UTF-8 bytes", () => {
  const base = {
    runtimeRoot: "/tmp/ok/r",
    bridgeRoot: "/tmp/ok/b",
    controlSocketPath: "/tmp/ok/c.sock",
  };
  const segment = (size) =>
    "界".repeat(Math.floor(size / 3)) + "x".repeat(size % 3);
  const parentFor = (target, ...suffix) => {
    const fixed = Buffer.byteLength(join("/tmp", "x", ...suffix)) - 1;
    return join("/tmp", segment(target - fixed));
  };
  for (const size of [107, 108]) {
    const native = join(
      parentFor(size, "r", "home", ".codex", "ipc", "ipc.sock"),
      "r",
    );
    const brokerParent = parentFor(size, ".desktop-control-XXXXXX", "s");
    const bridge = join(parentFor(size, "b", "socket"), "b");
    const control = join("/tmp", segment(size - Buffer.byteLength("/tmp/")));
    const cases = [
      [
        { ...base, runtimeRoot: native },
        join(native, "home", ".codex", "ipc", "ipc.sock"),
      ],
      [
        { ...base, controlSocketPath: join(brokerParent, "c.sock") },
        join(brokerParent, ".desktop-control-XXXXXX", "s"),
      ],
      [{ ...base, bridgeRoot: bridge }, join(bridge, "socket")],
      [{ ...base, controlSocketPath: control }, control],
    ];
    for (const [paths, target] of cases) {
      assert.equal(Buffer.byteLength(target), size);
      if (size === 107)
        assert.doesNotThrow(() => validateDesktopSupervisorSocketPaths(paths));
      else
        assert.throws(() => validateDesktopSupervisorSocketPaths(paths), {
          code: "DESKTOP_SUPERVISOR_INVALID_CONFIG",
        });
    }
  }
});

test("a generation whose native socket is exactly 107 bytes remains usable", async (t) => {
  const f = await fixture(t),
    id = f.id(),
    generationName = `g${id.replaceAll("-", "")}`;
  const suffix = [generationName, "r", "home", ".codex", "ipc", "ipc.sock"];
  const fixed = Buffer.byteLength(join(f.root, "x", ...suffix)) - 1;
  const size = 107 - fixed;
  const name = "界".repeat(Math.floor(size / 3)) + "x".repeat(size % 3);
  const deploymentRoot = join(f.root, name);
  await mkdir(deploymentRoot, { mode: 0o700 });
  f.template.deploymentRoot = deploymentRoot;
  await f.save();
  const factory = await createDesktopSupervisorConfigFactory({
    templateFile: f.templateFile,
  });
  const config = await factory.createConfig({ attemptId: id });
  assert.equal(
    Buffer.byteLength(
      join(config.options.runtimeRoot, "home", ".codex", "ipc", "ipc.sock"),
    ),
    107,
  );
  assert.deepEqual(await readdir(config.options.accountSnapshot.homeRoot), []);
});

test("the real supervisor passes its recorded attempt to the factory without starting a native process", async (t) => {
  const f = await fixture(t),
    pythonPath = await realpath("/usr/bin/python3");
  const pythonSha256 = createHash("sha256")
    .update(await readFile(pythonPath))
    .digest("hex");
  f.template.options.pythonPath = pythonPath;
  f.template.options.pythonSha256 = pythonSha256;
  await f.save();
  const factory = await createDesktopSupervisorConfigFactory({
    templateFile: f.templateFile,
  });
  const { stateDirectory, deploymentId } = factory;
  await initializeDesktopSupervisor({ stateDirectory, deploymentId });
  const owner = {
    containerId: "a".repeat(64),
    generation: randomUUID(),
    profileId: randomUUID(),
  };
  let received;
  const result = await runDesktopSupervisor(
    {
      stateDirectory,
      deploymentId,
      pythonPath: factory.pythonPath,
      pythonSha256: factory.pythonSha256,
      signal: new AbortController().signal,
    },
    {
      createConfig: async (input) => {
        const config = await factory.createConfig(input);
        f.trackHome(config.options.accountSnapshot.homeRoot);
        return config;
      },
      runService: async (config, { onOwner }) => {
        received = config;
        await onOwner(owner);
        return { state: "native_exited", nativeState: "exited" };
      },
    },
  );
  assert.deepEqual(result, { state: "native_exited", nativeState: "exited" });
  const record = JSON.parse(
    await readFile(join(stateDirectory, "state.json"), "utf8"),
  );
  assert.equal(record.phase, "ended");
  assert.equal(
    received.options.profileFile,
    join(
      f.deploymentRoot,
      `g${record.attemptId.replaceAll("-", "")}`,
      "p.json",
    ),
  );
  assert.equal(record.configSha256, received.fingerprint);
});

test("factory, supervisor and stable profile alias publish owned generations in order", async (t) => {
  const f = await fixture(t),
    pythonPath = await realpath("/usr/bin/python3"),
    pythonSha256 = createHash("sha256")
      .update(await readFile(pythonPath))
      .digest("hex");
  f.template.options.pythonPath = pythonPath;
  f.template.options.pythonSha256 = pythonSha256;
  await f.save();
  const factory = await createDesktopSupervisorConfigFactory({
    templateFile: f.templateFile,
  });
  const { stateDirectory, deploymentId, currentProfileFile } = factory;
  await initializeDesktopSupervisor({ stateDirectory, deploymentId });
  const options = {
    stateDirectory,
    deploymentId,
    pythonPath,
    pythonSha256,
    signal: new AbortController().signal,
  };
  const proc = await readFile("/proc/self/stat", "utf8"),
    procEnd = proc.lastIndexOf(") "),
    startTicks = proc
      .slice(procEnd + 2)
      .trim()
      .split(/\s+/)[19];
  assert.ok(procEnd > 0 && /^(?:0|[1-9][0-9]*)$/.test(startTicks));
  const owners = [0, 1].map((i) => ({
    containerId: String(i + 1).repeat(64),
    generation: randomUUID(),
    profileId: randomUUID(),
  }));
  const profiles = [],
    publications = [],
    observations = [],
    eventErrors = [];
  let previousChecks = 0;
  const createConfig = async (input) => {
    const config = await factory.createConfig(input);
    f.trackHome(config.options.accountSnapshot.homeRoot);
    return config;
  };
  const publishProfile = async ({
    config,
    identity,
    previous,
    attemptId,
    verifyLease,
  }) => {
    const journal = JSON.parse(
      await readFile(join(stateDirectory, "state.json"), "utf8"),
    );
    assert.equal(journal.phase, "owned");
    assert.equal(journal.attemptId, attemptId);
    assert.deepEqual(journal.native, identity);
    assert.equal(await verifyLease(), true);
    const oldAttempt =
      previous.phase === "ready" ? undefined : previous.attemptId;
    if (oldAttempt !== undefined) {
      assert.equal(previous.recovery.profileFile, profiles[0].path);
      assert.deepEqual(previous.native, owners[0]);
      assert.equal(
        (await lstat(currentProfileFile, { bigint: true })).ino,
        (await lstat(profiles[0].path, { bigint: true })).ino,
      );
    }
    assert.deepEqual(
      await publishStableProfileAlias({
        deploymentRoot: factory.deploymentRoot,
        current: {
          attemptId,
          file: config.options.profileFile,
          profileId: identity.profileId,
          generation: identity.generation,
        },
        previousAttemptId: oldAttempt,
        verifyLease,
      }),
      { state: "published" },
    );
    const alias = await lstat(currentProfileFile, { bigint: true }),
      source = await lstat(config.options.profileFile, { bigint: true });
    assert.equal(alias.dev, source.dev);
    assert.equal(alias.ino, source.ino);
    publications.push({
      attemptId,
      previousAttemptId: oldAttempt,
      phase: journal.phase,
    });
  };
  function runGeneration(owner) {
    return runDesktopSupervisor(options, {
      createConfig,
      publishProfile,
      inspectPrevious: async ({ native }) => {
        previousChecks++;
        assert.deepEqual(native, owners[0]);
        return { state: "exited", ...owners[0] };
      },
      runService: async (config, { onOwner, onEvent }) => {
        const profile = {
          version: 1,
          id: owner.profileId,
          generation: owner.generation,
          pid: process.pid,
          startTicks,
          uid: process.getuid(),
          macAsarPath: config.options.macAsarPath,
          macAsarSha256: config.options.macAsarSha256,
          linuxAsarPath: join(
            config.options.sourceRoot,
            "resources",
            "app.asar",
          ),
          linuxAsarSha256: "f".repeat(64),
          controlSocketPath: config.options.controlSocketPath,
        };
        const text = JSON.stringify(profile) + "\n";
        await writeFile(config.options.profileFile, text, {
          mode: 0o600,
          flag: "wx",
        });
        profiles.push({ path: config.options.profileFile, text, profile });
        await onOwner(owner);
        onEvent({ state: "published" });
        return { state: "native_exited", nativeState: "exited" };
      },
      onEvent: ({ state }) => {
        if (state !== "published") return;
        try {
          const source = profiles.at(-1),
            aliasStat = lstatSync(currentProfileFile, { bigint: true }),
            profileStat = lstatSync(source.path, { bigint: true }),
            bytes = readFileSync(currentProfileFile, "utf8");
          assert.equal(aliasStat.dev, profileStat.dev);
          assert.equal(aliasStat.ino, profileStat.ino);
          assert.equal(bytes, source.text);
          assert.deepEqual(JSON.parse(bytes), source.profile);
          observations.push({ path: source.path, ino: aliasStat.ino });
        } catch (error) {
          eventErrors.push(error);
        }
      },
    });
  }
  assert.deepEqual(await runGeneration(owners[0]), {
    state: "native_exited",
    nativeState: "exited",
  });
  assert.equal(publications.length, 1);
  assert.equal(observations.length, 1);
  const firstInode = (await lstat(profiles[0].path, { bigint: true })).ino;
  assert.deepEqual(await runGeneration(owners[1]), {
    state: "native_exited",
    nativeState: "exited",
  });
  assert.deepEqual(eventErrors, []);
  assert.equal(publications.length, 2);
  assert.equal(observations.length, 2);
  assert.equal(publications[1].previousAttemptId, publications[0].attemptId);
  // Include the post-publication check before old alias candidates are pruned.
  assert.equal(previousChecks, 4);
  assert.notEqual(observations[1].ino, firstInode);
  assert.equal(
    (await lstat(profiles[0].path, { bigint: true })).ino,
    firstInode,
  );
  assert.equal(await readFile(profiles[0].path, "utf8"), profiles[0].text);
  assert.equal(
    (await lstat(currentProfileFile, { bigint: true })).ino,
    (await lstat(profiles[1].path, { bigint: true })).ino,
  );
  assert.equal(await readFile(currentProfileFile, "utf8"), profiles[1].text);
});

test("a colliding tmpfs home is never reused or modified", async (t) => {
  const f = await fixture(t),
    factory = await createDesktopSupervisorConfigFactory({
      templateFile: f.templateFile,
    }),
    id = f.id();
  const home = join("/dev/shm", `chatgpt-${id.replaceAll("-", "")}`);
  await mkdir(home, { mode: 0o700 });
  await writeFile(join(home, "sentinel"), "keep", { mode: 0o600 });
  await assert.rejects(factory.createConfig({ attemptId: id }));
  assert.equal(await readFile(join(home, "sentinel"), "utf8"), "keep");
});

test("template replacement or editing after enrollment cannot authorize a new generation", async (t) => {
  const f = await fixture(t),
    factory = await createDesktopSupervisorConfigFactory({
      templateFile: f.templateFile,
    }),
    id = f.id();
  await writeFile(
    f.templateFile,
    JSON.stringify({ ...f.template, version: 2 }) + "\n",
  );
  await assert.rejects(factory.createConfig({ attemptId: id }));
  assert.deepEqual(await readdir(f.deploymentRoot), []);
});

test("invalid template permissions, duplicate keys and symlinks fail closed", async (t) => {
  const f = await fixture(t);
  await chmod(f.templateFile, 0o644);
  await assert.rejects(
    createDesktopSupervisorConfigFactory({ templateFile: f.templateFile }),
  );
  await chmod(f.templateFile, 0o600);
  await writeFile(f.templateFile, '{"version":1,"\\u0076ersion":1}');
  await assert.rejects(
    createDesktopSupervisorConfigFactory({ templateFile: f.templateFile }),
  );
  await f.save();
  const alias = join(f.root, "alias.json");
  await symlink(f.templateFile, alias);
  await assert.rejects(
    createDesktopSupervisorConfigFactory({ templateFile: alias }),
  );
  assert.deepEqual(await readdir(f.deploymentRoot), []);
});

test("unsafe path overlap, nonprivate source and tmpfs history are rejected before allocation", async (t) => {
  const f = await fixture(t);
  f.template.options.historyRoot = f.deploymentRoot;
  await f.save();
  await assert.rejects(
    createDesktopSupervisorConfigFactory({ templateFile: f.templateFile }),
  );
  f.template.options.historyRoot = "/dev/shm";
  await f.save();
  await assert.rejects(
    createDesktopSupervisorConfigFactory({ templateFile: f.templateFile }),
  );
  f.template.options.historyRoot = f.historyRoot;
  await f.save();
  await chmod(f.accountSourceFile, 0o644);
  await assert.rejects(
    createDesktopSupervisorConfigFactory({ templateFile: f.templateFile }),
  );
  assert.deepEqual(await readdir(f.deploymentRoot), []);
});

test("deployment identity is a mandatory stable UUID", async (t) => {
  const f = await fixture(t);
  delete f.template.deploymentId;
  await f.save();
  await assert.rejects(
    createDesktopSupervisorConfigFactory({ templateFile: f.templateFile }),
  );
  f.template.deploymentId = "bad";
  await f.save();
  await assert.rejects(
    createDesktopSupervisorConfigFactory({ templateFile: f.templateFile }),
  );
  assert.deepEqual(await readdir(f.deploymentRoot), []);
});

test("supervisor carries only an explicitly granted private account sync path", async (t) => {
  const f = await fixture(t), grantRoot = join(f.root, "sync-grant"), grantFile = join(grantRoot, "permit");
  await mkdir(grantRoot, { mode: 0o700 });
  await writeFile(grantFile, "chatgpt-desktop-account-sync-v1\n", { mode: 0o600 });
  f.template.options.accountSyncGrantFile = grantFile; await f.save();
  const factory = await createDesktopSupervisorConfigFactory({ templateFile: f.templateFile });
  const config = await factory.createConfig({ attemptId: f.id() });
  assert.deepEqual(config.options.accountSync, { grantFile });
  assert.equal(config.options.accountSnapshot.sourceFile, f.accountSourceFile);
  assert.equal(await readFile(grantFile, "utf8"), "chatgpt-desktop-account-sync-v1\n");
});

test("supervisor fails closed for unsafe or revoked sync grants before a new generation", async (t) => {
  const f = await fixture(t), grantRoot = join(f.root, "sync-grant"), grantFile = join(grantRoot, "permit");
  await mkdir(grantRoot, { mode: 0o700 });
  await writeFile(grantFile, "chatgpt-desktop-account-sync-v1\n", { mode: 0o600 });
  f.template.options.accountSyncGrantFile = grantFile; await f.save();
  await chmod(grantFile, 0o644);
  await assert.rejects(createDesktopSupervisorConfigFactory({ templateFile: f.templateFile }));
  await chmod(grantFile, 0o600);
  const factory = await createDesktopSupervisorConfigFactory({ templateFile: f.templateFile });
  await unlink(grantFile); await writeFile(grantFile, "chatgpt-desktop-account-sync-v1\n", { mode: 0o600 });
  await assert.rejects(factory.createConfig({ attemptId: f.id() }));
  assert.deepEqual(await readdir(f.deploymentRoot), []);
});

test("factory arguments reject accessors and unknown fields without invoking them", async (t) => {
  const f = await fixture(t);
  let invoked = false;
  const options = {};
  Object.defineProperty(options, "templateFile", {
    enumerable: true,
    get() {
      invoked = true;
      return f.templateFile;
    },
  });
  await assert.rejects(createDesktopSupervisorConfigFactory(options));
  assert.equal(invoked, false);
  await assert.rejects(
    createDesktopSupervisorConfigFactory({
      templateFile: f.templateFile,
      extra: true,
    }),
  );
  await assert.rejects(
    createDesktopSupervisorConfigFactory({
      templateFile: f.templateFile,
      [Symbol("extra")]: true,
    }),
  );
});

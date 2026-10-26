import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { captureProcessIdentity } from "../refresh-prototype/resources.mjs";
const proof = {
  officialVersion: "26.51007.21434",
  cliVersion: "0.162.0-alpha.17.2",
  cliSha256: "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
  officialVsixSha256:
    "75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test("startup diagnostics reject extra payload fields instead of copying them into owner errors", async () => {
  const { validateControlStartupDiagnostic } =
    await import("../refresh-prototype/control-service.mjs");
  const valid = {
    state: "failed",
    stage: "manager",
    code: "UNAVAILABLE",
    category: "authorization",
  };
  assert.deepEqual(validateControlStartupDiagnostic(valid), valid);
  for (const changed of [
    { secret: "private" },
    { stage: "arbitrary text" },
    { code: "TOKEN=secret" },
    { category: "account response" },
  ])
    assert.equal(
      validateControlStartupDiagnostic({ ...valid, ...changed }),
      null,
    );
});
test("failed control startup publishes fixed diagnostic fields without config contents or original exception payload", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ck-control-diag-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, "control-config.json");
  await writeFile(config, "SECRET_MARKER_NOT_A_CONFIG", { mode: 0o600 });
  const child = spawn(
    process.execPath,
    [
      new URL("../refresh-prototype/control-worker.mjs", import.meta.url)
        .pathname,
      "--config",
      config,
    ],
    { env: { HOME: root }, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (bytes) => {
    if (stderr.length < 1024) stderr += bytes;
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.equal(stderr.includes("SECRET_MARKER"), false);
  const diagnostic = JSON.parse(
    await readFile(join(root, "control-startup.json"), "utf8"),
  );
  assert.deepEqual(diagnostic, {
    state: "failed",
    stage: "configuration",
    code: "UNAVAILABLE",
    category: "unknown",
  });
});
async function wait(check, label, timeoutMs = 8000) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    const v = await check();
    if (v) return v;
    await sleep(20);
  }
  throw Error(label);
}
async function stopOwned(record) {
  if (!record) return;
  try {
    const current = await captureProcessIdentity(record.pid);
    if (current.startTicks !== record.startTicks) return;
    process.kill(record.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ENOENT" && !/identity unavailable/.test(error.message))
      throw error;
    return;
  }
  await wait(
    async () => {
      try {
        await captureProcessIdentity(record.pid);
        return false;
      } catch {
        return true;
      }
    },
    "owned process exit",
    20000,
  );
}
test("persistent control refuses existing roots and invalid native identity without spawning or overwriting", async (t) => {
  const { startRefreshControlService } =
    await import("../refresh-prototype/control-service.mjs");
  const root = await mkdtemp(join(tmpdir(), "ck-control-refuse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    runtimeRoot: root,
    metadata: {
      ...proof,
      runtimeRoot: join(root, "native"),
      socketPath: join(root, "native/n.sock"),
      cliPath: join(root, "untrusted-cli"),
      officialVsix: join(root, "untrusted.vsix"),
    },
    scope: {
      domain: randomUUID(),
      generation: randomUUID(),
      ...(await captureProcessIdentity(process.pid)),
    },
    profiles: [randomUUID()],
    memoryBudgetBytes: 1024,
  };
  const file = join(root, "control-config.json");
  await writeFile(file, "PRESERVE", { mode: 0o600 });
  await assert.rejects(startRefreshControlService(options), /existing/);
  assert.equal(await readFile(file, "utf8"), "PRESERVE");
  await rm(file);
  await assert.rejects(
    startRefreshControlService({
      ...options,
      scope: { ...options.scope, generation: "default" },
    }),
  );
  await assert.rejects(
    startRefreshControlService({
      ...options,
      roots: Array.from({ length: 32 }, () => ({
        id: randomUUID(),
        kind: "host",
        ...options.scope,
      })),
    }),
  );
  await assert.rejects(readFile(join(root, "control-launch.json")), {
    code: "ENOENT",
  });
});
test(
  "real detached control survives its creating gateway and preserves a running native turn through reconnect and explicit control exit",
  { skip: !process.env.NATIVE_CODEX_REFRESH_CLI, timeout: 60000 },
  async (t) => {
    const { startPrivateService } =
      await import("../refresh-prototype/private-service.mjs");
    const { attachRefreshControlService, startRefreshControlService } =
      await import("../refresh-prototype/control-service.mjs");
    const { createRefreshModelFixture } =
      await import("./fixtures/refresh-model.mjs");
    const root = await mkdtemp(join(tmpdir(), "ck-control-live-")),
      model = await createRefreshModelFixture(),
      clients = [],
      wrappedClients = [];
    let native, control, lease, launcher;
    t.after(async () => {
      model.release();
      const errors = [],
        cleanup = async (work) => {
          try {
            await work();
          } catch (error) {
            errors.push(error);
          }
        };
      if (
        launcher &&
        launcher.exitCode === null &&
        launcher.signalCode === null
      ) {
        launcher.kill("SIGTERM");
        await once(launcher, "exit");
      }
      for (const c of clients) await cleanup(() => c.close());
      for (const c of wrappedClients) await cleanup(() => c.close());
      await cleanup(async () => {
        let record = control?.record;
        if (!record) {
          try {
            record = JSON.parse(
              await readFile(join(root, "control/control-launch.json"), "utf8"),
            );
            const command = (await readFile(`/proc/${record.pid}/cmdline`))
              .toString()
              .split("\0");
            assert.ok(
              command.includes(
                new URL(
                  "../refresh-prototype/control-worker.mjs",
                  import.meta.url,
                ).pathname,
              ),
            );
            assert.ok(
              command.includes(join(root, "control/control-config.json")),
            );
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
            return;
          }
        }
        await stopOwned(record);
      });
      for (const dir of ["control", "control-next"])
        await cleanup(async () => {
          const controlRoot = join(root, dir);
          let record;
          try {
            record = JSON.parse(
              await readFile(join(controlRoot, "control-launch.json"), "utf8"),
            );
            const actual = await captureProcessIdentity(record.pid);
            if (actual.startTicks !== record.startTicks) return;
          } catch (error) {
            if (
              error.code === "ENOENT" ||
              /identity unavailable/.test(error.message)
            )
              return;
            throw error;
          }
          const command = (await readFile(`/proc/${record.pid}/cmdline`))
            .toString()
            .split("\0");
          assert.ok(
            command.includes(
              new URL(
                "../refresh-prototype/control-worker.mjs",
                import.meta.url,
              ).pathname,
            ),
          );
          assert.ok(command.includes(join(controlRoot, "control-config.json")));
          await stopOwned(record);
        });
      await cleanup(() => stopOwned(native?.record));
      await cleanup(() => stopOwned(native?.record.authority));
      await cleanup(() => model.close());
      if (errors.length)
        throw new AggregateError(
          errors,
          `owned fixture cleanup failed; private root retained: ${root}`,
        );
      await rm(root, { recursive: true, force: true });
    });
    for (const dir of ["native", "control", "home", "codex", "project"])
      await mkdir(join(root, dir), { mode: 0o700 });
    await writeFile(
      join(root, "codex/config.toml"),
      `model="acceptance-model"\nmodel_provider="acceptance"\n[model_providers.acceptance]\nname="Private control fixture"\nbase_url="${model.url}"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
      { mode: 0o600 },
    );
    const metadata = {
      ...proof,
      runtimeRoot: join(root, "native"),
      socketPath: join(root, "native/n.sock"),
      cliPath: process.env.NATIVE_CODEX_REFRESH_CLI,
      officialVsix: new URL(
        "../../../third_party/openai.chatgpt-26.51007.21434-linux-x64.vsix",
        import.meta.url,
      ).pathname,
    };
    native = await startPrivateService({
      metadata,
      domain: randomUUID(),
      processHome: join(root, "home"),
      codexHome: join(root, "codex"),
      cwd: join(root, "project"),
      environment: { NO_PROXY: "127.0.0.1,localhost,::1" },
    });
    const completed = new Set();
    const a = await native.connect({
      onLifecycle(event) {
        if (
          event.method === "turn/completed" &&
          event.turnId &&
          completed.size < 4
        )
          completed.add(event.turnId);
      },
    });
    clients.push(a);
    const started = await a.request("thread/start", {
        cwd: join(root, "project"),
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
      threadId = started.thread.id;
    const accepted = await a.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "REFRESH_RUNNING", text_elements: [] }],
    });
    await wait(() => model.calls.length === 1, "native provider running");
    const idle = await a.request("thread/start", {
        cwd: join(root, "project"),
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
      idleId = idle.thread.id;
    const idleAccepted = await a.request("turn/start", {
      threadId: idleId,
      input: [{ type: "text", text: "REFRESH_IDLE", text_elements: [] }],
    });
    await wait(
      () => completed.has(idleAccepted.turn.id),
      "exact native idle turn completion notice",
    );
    const idleHistory = (
      await a.request("thread/read", { threadId: idleId, includeTurns: true })
    ).thread;
    assert.ok(
      idleHistory.turns.some(
        (turn) =>
          turn.id === idleAccepted.turn.id && turn.status === "completed",
      ),
    );
    const scope = {
        domain: native.record.domain,
        generation: native.record.generation,
        pid: native.record.pid,
        startTicks: native.record.startTicks,
      },
      profileId = randomUUID(),
      instanceId = randomUUID();
    const options = {
      metadata,
      scope,
      runtimeRoot: join(root, "control"),
      profiles: [profileId],
      roots: [
        {
          id: randomUUID(),
          kind: "gateway",
          ...(await captureProcessIdentity(process.pid)),
        },
      ],
      memoryBudgetBytes: 2 * 1024 ** 3,
    };
    const module = new URL(
      "../refresh-prototype/control-service.mjs",
      import.meta.url,
    ).href;
    launcher = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import{startRefreshControlService}from ${JSON.stringify(module)};const service=await startRefreshControlService(${JSON.stringify(options)});process.stdout.write(JSON.stringify({pid:service.record.pid,generation:service.record.generation}));`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    launcher.stdout.on("data", (bytes) => {
      if (output.length < 4096) output += bytes;
    });
    launcher.stderr.on("data", (bytes) => {
      if (error.length < 4096) error += bytes;
    });
    const [code] = await once(launcher, "exit");
    assert.equal(code, 0, error);
    const created = JSON.parse(output);
    control = await attachRefreshControlService({
      runtimeRoot: options.runtimeRoot,
      metadata,
      scope,
    });
    assert.equal(control.record.pid, created.pid);
    assert.equal(control.record.generation, created.generation);
    assert.notEqual(created.pid, launcher.pid);
    const c = await control.connect();
    clients.push(c);
    const visible = c.visibility(profileId),
      identity = { origin: "https://lan.example:8484", instanceId },
      hooks = { assertCurrent: async () => {}, onReplaced: () => {} };
    lease = await visible.attach(identity, hooks);
    await lease.update({ sequence: 1, threadIds: [threadId, idleId] });
    await c.close();
    await a.close();
    await sleep(1300);
    const d = await control.connect();
    clients.push(d);
    const resumed = await d
      .visibility(profileId)
      .attach({ ...identity, ...lease.identity }, hooks);
    await resumed.update({ sequence: 1, threadIds: [threadId, idleId] });
    const b = await native.connect();
    clients.push(b);
    assert.equal(
      (await b.request("thread/read", { threadId, includeTurns: false })).thread
        .status.type,
      "active",
    );
    assert.equal(
      (
        await b.request("thread/read", {
          threadId: idleId,
          includeTurns: false,
        })
      ).thread.status.type,
      "idle",
    );
    await resumed.update({ sequence: 2, threadIds: [] });
    await sleep(1300);
    assert.ok(
      (await b.request("thread/loaded/list", {})).data.includes(idleId),
      "idle stays in the pool after every page consumer leaves",
    );
    assert.equal(model.calls.length, 2);
    assert.equal(
      model.calls.filter((call) => call.mode === "running").length,
      1,
    );
    const persisted = JSON.parse(
      await readFile(join(options.runtimeRoot, "control-service.json"), "utf8"),
    );
    assert.deepEqual(persisted.nativeScope, scope);
    for (const replacement of [
      { generation: randomUUID() },
      { nativeScope: { ...scope, generation: randomUUID() } },
      { pid: process.pid + 10000000 },
    ]) {
      await writeFile(
        join(options.runtimeRoot, "control-service.json"),
        JSON.stringify({ ...persisted, ...replacement }),
        { mode: 0o600 },
      );
      await assert.rejects(
        attachRefreshControlService({
          runtimeRoot: options.runtimeRoot,
          metadata,
          scope,
        }),
      );
    }
    await writeFile(
      join(options.runtimeRoot, "control-service.json"),
      JSON.stringify(persisted),
      { mode: 0o600 },
    );
    await assert.rejects(startRefreshControlService(options), /existing/);
    const hostRoot = join(root, "bridge-host");
    await mkdir(hostRoot, { mode: 0o700 });
    const bridgeConfig = join(root, "native/bridge.json");
    await writeFile(bridgeConfig, JSON.stringify(metadata), { mode: 0o600 });
    const { prepareRefreshHost } =
      await import("../refresh-prototype/host-connection.mjs");
    const bridge = await prepareRefreshHost({
      runtimeRoot: hostRoot,
      refreshServiceConfig: bridgeConfig,
      refreshDomain: scope.domain,
      codexCli: metadata.cliPath,
      officialVsix: metadata.officialVsix,
      refreshControlRoot: options.runtimeRoot,
      reconnectionGraceSeconds: 60,
    });
    // Every invocation still pins both artifacts. A single startup must not
    // hash the same large CLI/VSIX again while attaching that verified config.
    const fs = (await import("node:fs")).default;
    const { syncBuiltinESMExports } = await import("node:module");
    const { runBridge: versionBridge } =
      await import("../refresh-prototype/cli-bridge.mjs");
    const artifactReads = new Map([
      [metadata.cliPath, 0],
      [metadata.officialVsix, 0],
    ]);
    const originalReadStream = fs.createReadStream;
    fs.createReadStream = function (file, ...args) {
      if (artifactReads.has(file))
        artifactReads.set(file, artifactReads.get(file) + 1);
      return originalReadStream.call(this, file, ...args);
    };
    syncBuiltinESMExports();
    const versionOutput = new PassThrough();
    let pinnedVersion = "";
    versionOutput.on("data", (bytes) => (pinnedVersion += bytes));
    try {
      for (let invocation = 1; invocation <= 2; invocation++) {
        await versionBridge({
          configPath: bridgeConfig,
          scope,
          controlRoot: options.runtimeRoot,
          controlScope: {
            generation: control.record.generation,
            pid: control.record.pid,
            startTicks: control.record.startTicks,
          },
          argv: ["--version"],
          input: new PassThrough(),
          output: versionOutput,
        });
        assert.deepEqual(
          [...artifactReads.values()],
          [invocation, invocation],
          "one full CLI and VSIX verification per invocation, without duplicate scans or cross-startup caching",
        );
      }
    } finally {
      fs.createReadStream = originalReadStream;
      syncBuiltinESMExports();
    }
    assert.equal(pinnedVersion, `codex-cli ${proof.cliVersion}\n`.repeat(2));
    const changedConfig = join(root, "native/changed-artifact.json");
    const changedArtifact = join(root, "changed.vsix");
    await writeFile(changedArtifact, "not the pinned official VSIX", {
      mode: 0o600,
    });
    await writeFile(
      changedConfig,
      JSON.stringify({ ...metadata, officialVsix: changedArtifact }),
      { mode: 0o600 },
    );
    const changedOutput = new PassThrough();
    let changedBytes = 0;
    changedOutput.on("data", (bytes) => (changedBytes += bytes.length));
    await assert.rejects(
      versionBridge({
        configPath: changedConfig,
        scope,
        argv: ["--version"],
        input: new PassThrough(),
        output: changedOutput,
      }),
      /binary version\/hash mismatch/,
    );
    assert.equal(
      changedBytes,
      0,
      "a previously successful startup cannot authorize changed artifacts",
    );
    assert.equal(bridge.control.generation, control.record.generation);
    const wrapper = await readFile(bridge.executable, "utf8");
    assert.equal(wrapper.includes(control.record.token), false);
    const { startRefreshStdioClient } =
      await import("./fixtures/refresh-stdio-client.mjs");
    const x = await startRefreshStdioClient(
        bridge.executable,
        "acceptance_bridge_a",
      ),
      y = await startRefreshStdioClient(
        bridge.executable,
        "acceptance_bridge_b",
      );
    wrappedClients.push(x, y);
    const [first, second] = await Promise.all([
      x.request(7, "thread/read", { threadId, includeTurns: false }),
      y.request(7, "thread/read", { threadId: idleId, includeTurns: false }),
    ]);
    assert.equal(first.thread.id, threadId);
    assert.equal(second.thread.id, idleId);
    await x.close();
    assert.equal((await x.closed).code, 0);
    assert.equal(
      (await y.request(8, "account/read", { refreshToken: false }))
        .requiresOpenaiAuth,
      false,
    );
    await stopOwned(control.record);
    assert.notEqual(
      (await y.closed).code,
      0,
      "control exit revokes the original official CLI connection",
    );
    await wait(
      () => !d.visibility(profileId).snapshot().available,
      "gateway sees control exit",
    );
    assert.ok((await native.readRss()) > 0);
    assert.equal(
      (await b.request("thread/read", { threadId, includeTurns: false })).thread
        .status.type,
      "active",
    );
    await wait(
      async () =>
        !(await b.request("thread/loaded/list", {})).data.includes(idleId),
      "only the control manager's idle subscription is released",
    );
    assert.equal(model.calls.length, 2);
    assert.equal(
      model.calls.filter((call) => call.mode === "running").length,
      1,
    );
    // A fresh, explicitly owned control process can bind the still-live native;
    // a real native account notice must revoke the corresponding CLI observer.
    const nextRoot = join(root, "control-next");
    await mkdir(nextRoot, { mode: 0o700 });
    control = await startRefreshControlService({
      ...options,
      runtimeRoot: nextRoot,
    });
    const { runBridge } = await import("../refresh-prototype/cli-bridge.mjs"),
      versionOut = new PassThrough();
    let versionBytes = 0;
    versionOut.on("data", (bytes) => (versionBytes += bytes.length));
    await assert.rejects(
      runBridge({
        configPath: bridgeConfig,
        scope,
        controlRoot: nextRoot,
        controlScope: {
          generation: bridge.control.generation,
          pid: bridge.control.pid,
          startTicks: bridge.control.startTicks,
        },
        argv: ["--version"],
        input: new PassThrough(),
        output: versionOut,
      }),
      /control identity changed/,
    );
    assert.equal(
      versionBytes,
      0,
      "an old control generation must not fall back to the new process",
    );
    const nextHost = join(root, "bridge-next");
    await mkdir(nextHost, { mode: 0o700 });
    const nextBridge = await prepareRefreshHost({
      runtimeRoot: nextHost,
      refreshServiceConfig: bridgeConfig,
      refreshDomain: scope.domain,
      codexCli: metadata.cliPath,
      officialVsix: metadata.officialVsix,
      refreshControlRoot: nextRoot,
      reconnectionGraceSeconds: 60,
    });
    const z = await startRefreshStdioClient(
      nextBridge.executable,
      "acceptance_bridge_logout",
    );
    wrappedClients.push(z);
    const cancelled = await startRefreshStdioClient(
      nextBridge.executable,
      "acceptance_bridge_cancel",
    );
    wrappedClients.push(cancelled);
    cancelled.cancel();
    assert.equal(
      (await cancelled.closed).code,
      0,
      "an explicit owner stop is a normal client-only exit",
    );
    // Owned-fixture oracle is separate from product admission. It can inspect
    // the original task after every anchored product connection is revoked.
    const { createNativeClient } =
      await import("../refresh-prototype/native-client.mjs");
    const oracle = createNativeClient({
      socketPath: metadata.socketPath,
      name: "acceptance_authority_oracle",
    });
    clients.push(oracle);
    await oracle.ready;
    await oracle.request("account/logout", {});
    let logoutTimer;
    const loggedOut = await Promise.race([
      z.closed,
      new Promise((resolve) => {
        logoutTimer = setTimeout(
          () => resolve({ code: 0, timedOut: true }),
          5000,
        );
      }),
    ]).finally(() => clearTimeout(logoutTimer));
    assert.notEqual(
      loggedOut.code,
      0,
      "real native account boundary revokes a same-value provider binding",
    );
    assert.equal(
      (await oracle.request("thread/read", { threadId, includeTurns: false }))
        .thread.status.type,
      "active",
      "revoking client authority does not interrupt the native turn",
    );
    model.release();
    await wait(async () => {
      const thread = (
        await oracle.request("thread/read", { threadId, includeTurns: true })
      ).thread;
      return thread.turns?.find(
        (turn) => turn.id === accepted.turn.id && turn.status === "completed",
      );
    }, "same native accepted turn completes once after both control exit and account revocation");
    assert.equal(model.calls.length, 2);
    await assert.rejects(native.connect(), /authority/);
    const { createRefreshManager } =
      await import("../refresh-prototype/lifecycle-manager.mjs");
    const { createRefreshResourceMonitor } =
      await import("../refresh-prototype/resources.mjs");
    await assert.rejects(
      createRefreshManager({
        service: native,
        resourceMonitor: createRefreshResourceMonitor({ service: native }),
        memoryBudgetBytes: 2 * 1024 ** 3,
      }),
      /authority/,
    );
    assert.ok((await native.readRss()) > 0);
    await assert.rejects(
      attachRefreshControlService({
        runtimeRoot: options.runtimeRoot,
        metadata,
        scope,
      }),
    );
    await assert.rejects(readFile(join(options.runtimeRoot, "control.sock")), {
      code: "ENOENT",
    });
  },
);

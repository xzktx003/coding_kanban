import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const proof = {
  officialVersion: "26.51007.21434",
  cliVersion: "0.162.0-alpha.17.2",
  cliSha256: "73b73b048546993298234a295de01ef2424e7a8b29def9d0ecb1ca7cb77500d4",
  officialVsixSha256:
    "75cee7497cf38c721cfeaa7383b579537b4e4439086f996258705de5da03ad56",
};
test("private service rejects unsafe paths and existing records before spawning any native process", async (t) => {
  const { startPrivateService } =
    await import("../refresh-prototype/private-service.mjs");
  const root = await mkdtemp(join(tmpdir(), "ck-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ["manager", "home", "codex", "project"])
    await mkdir(join(root, path), { mode: 0o700 });
  const metadata = {
    ...proof,
    runtimeRoot: join(root, "manager"),
    socketPath: join(root, "manager/control.sock"),
    cliPath: join(root, "untrusted-codex"),
    officialVsix: join(root, "untrusted.vsix"),
  };
  const options = {
    metadata,
    processHome: join(root, "home"),
    codexHome: join(root, "codex"),
    cwd: join(root, "project"),
    domain: "019aabcd-1234-7890-abcd-000000000001",
  };
  await writeFile(join(root, "manager/service.json"), "DO_NOT_OVERWRITE", {
    mode: 0o600,
  });
  await assert.rejects(startPrivateService(options), /existing service record/);
  const { readFile } = await import("node:fs/promises");
  assert.equal(
    await readFile(join(root, "manager/service.json"), "utf8"),
    "DO_NOT_OVERWRITE",
  );
  await rm(join(root, "manager/service.json"));
  await assert.rejects(
    startPrivateService({ ...options, processHome: "/tmp" }),
    /private directory/,
  );
  await assert.rejects(
    startPrivateService({ ...options, domain: "default-cli" }),
    /domain/,
  );
  await writeFile(metadata.socketPath, "unrelated endpoint", { mode: 0o600 });
  await assert.rejects(
    startPrivateService(options),
    /existing private endpoint/,
  );
  assert.equal(
    await readFile(metadata.socketPath, "utf8"),
    "unrelated endpoint",
  );
});

test(
  "real private native service survives the process which created it and rejects stale records without restarting",
  { skip: !process.env.NATIVE_CODEX_REFRESH_CLI, timeout: 60000 },
  async (t) => {
    const { startPrivateService, attachPrivateService } =
      await import("../refresh-prototype/private-service.mjs");
    const { createRefreshModelFixture } =
      await import("./fixtures/refresh-model.mjs");
    const { spawn } = await import("node:child_process");
    const { once } = await import("node:events");
    const { readFile, lstat } = await import("node:fs/promises");
    const { randomUUID } = await import("node:crypto");
    const root = await mkdtemp(join(tmpdir(), "ck-service-live-"));
    const model = await createRefreshModelFixture();
    let service, manager;
    const clients = [];
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    async function wait(check, label) {
      const end = Date.now() + 6000;
      while (Date.now() < end) {
        const result = await check();
        if (result) return result;
        await pause(25);
      }
      throw Error(label);
    }
    t.after(async () => {
      model.release();
      await manager?.close();
      for (const client of clients) await client.close();
      if (service) {
        try {
          const state = (
            await readFile(`/proc/${service.record.pid}/stat`, "utf8")
          )
            .split(") ")
            .at(-1)
            .split(" ");
          if (state[19] === service.record.startTicks && state[0] !== "Z") {
            process.kill(service.record.pid, "SIGTERM");
            await wait(async () => {
              try {
                const s = await readFile(
                  `/proc/${service.record.pid}/stat`,
                  "utf8",
                );
                return s.split(") ").at(-1).startsWith("Z ");
              } catch {
                return true;
              }
            }, "Owned service exit");
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await wait(async () => {
          try {
            const s = await readFile(
              `/proc/${service.record.authority.pid}/stat`,
              "utf8",
            );
            return s.split(") ").at(-1).startsWith("Z ");
          } catch (error) {
            if (error.code === "ENOENT") return true;
            throw error;
          }
        }, "Owned authorization observer exits after native");
      }
      await model.close();
      await rm(root, { recursive: true, force: true });
    });
    for (const path of ["manager", "home", "codex", "project"])
      await mkdir(join(root, path), { mode: 0o700 });
    await writeFile(
      join(root, "codex/config.toml"),
      `model="acceptance-model"\nmodel_provider="acceptance"\n[model_providers.acceptance]\nname="Private service fixture"\nbase_url="${model.url}"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
      { mode: 0o600 },
    );
    const metadata = {
      ...proof,
      runtimeRoot: join(root, "manager"),
      socketPath: join(root, "manager/control.sock"),
      cliPath: process.env.NATIVE_CODEX_REFRESH_CLI,
      officialVsix: new URL(
        "../../../third_party/openai.chatgpt-26.51007.21434-linux-x64.vsix",
        import.meta.url,
      ).pathname,
    };
    const options = {
      metadata,
      domain: randomUUID(),
      processHome: join(root, "home"),
      codexHome: join(root, "codex"),
      cwd: join(root, "project"),
      environment: { NO_PROXY: "127.0.0.1,localhost,::1" },
    };
    const module = new URL(
      "../refresh-prototype/private-service.mjs",
      import.meta.url,
    ).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const {startPrivateService}=await import(${JSON.stringify(module)});const service=await startPrivateService(JSON.parse(process.argv[1]));process.stdout.write(JSON.stringify(service.record));`,
        JSON.stringify(options),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (b) => {
      output += b;
      if (output.length > 4096) child.kill();
    });
    child.stderr.on("data", (b) => {
      if (error.length < 4096) error += b;
    });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, error);
    const created = JSON.parse(output);
    service = await attachPrivateService({ metadata, domain: options.domain });
    assert.equal(service.record.generation, created.generation);
    assert.deepEqual(service.record.authority, created.authority);
    assert.ok((await service.readRss()) > 0);
    await assert.rejects(
      attachPrivateService({ metadata, domain: randomUUID() }),
      /generation unavailable/,
    );
    const configPath = join(root, "manager/bridge.json");
    await writeFile(configPath, JSON.stringify(metadata), { mode: 0o600 });
    const hostRoot = join(root, "profile-host");
    await mkdir(hostRoot, { mode: 0o700 });
    const { prepareRefreshHost } =
      await import("../refresh-prototype/host-connection.mjs");
    const hostOptions = {
      runtimeRoot: hostRoot,
      codexCli: metadata.cliPath,
      officialVsix: metadata.officialVsix,
      refreshServiceConfig: configPath,
      refreshDomain: options.domain,
      reconnectionGraceSeconds: 60,
    };
    await assert.rejects(
      prepareRefreshHost({ ...hostOptions, refreshDomain: randomUUID() }),
      /generation/,
    );
    const bridge = await prepareRefreshHost(hostOptions);
    assert.equal(bridge.generation, created.generation);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const version = await promisify(execFile)(bridge.executable, ["--version"]);
    assert.equal(version.stdout.trim(), "codex-cli 0.162.0-alpha.17.2");
    const serviceFile = join(root, "manager/service.json");
    const originalRecord = await readFile(serviceFile, "utf8");
    try {
      for (const replacement of [
        { generation: randomUUID() },
        { domain: randomUUID() },
        { pid: created.pid + 1 },
        // Deterministically absent on Linux: reject the changed scope before
        // attempting a procfs read, regardless of host PID reuse/wraparound.
        { pid: Number.MAX_SAFE_INTEGER },
        { startTicks: String(BigInt(created.startTicks) + 1n) },
      ]) {
        await writeFile(
          serviceFile,
          JSON.stringify({ ...JSON.parse(originalRecord), ...replacement }),
        );
        await assert.rejects(
          promisify(execFile)(bridge.executable, ["--version"]),
          /generation|scope/,
        );
        await assert.rejects(service.readRss(), /generation|scope/);
        await assert.rejects(service.connect(), /generation|scope/);
      }
    } finally {
      await writeFile(serviceFile, originalRecord);
    }
    assert.equal(
      (
        await promisify(execFile)(bridge.executable, ["--version"])
      ).stdout.trim(),
      "codex-cli 0.162.0-alpha.17.2",
    );
    await assert.rejects(prepareRefreshHost(hostOptions), { code: "EEXIST" });
    assert.ok((await service.readRss()) > 0);
    const a = await service.connect();
    clients.push(a);
    const started = await a.request("thread/start", {
      cwd: options.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    const threadId = started.thread.id;
    await a.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "REFRESH_RUNNING", text_elements: [] }],
    });
    await wait(() => model.calls.length === 1, "Private model request");
    await a.close();
    await pause(1300);
    const recovered = await attachPrivateService({
      metadata,
      domain: options.domain,
    });
    assert.equal(recovered.record.generation, created.generation);
    const { createRefreshManager } =
      await import("../refresh-prototype/lifecycle-manager.mjs");
    const { createRefreshResourceMonitor, captureProcessIdentity } =
      await import("../refresh-prototype/resources.mjs");
    const resourceMonitor = createRefreshResourceMonitor({
      service: recovered,
      roots: [
        {
          id: randomUUID(),
          kind: "manager",
          ...(await captureProcessIdentity(process.pid)),
        },
      ],
    });
    manager = await createRefreshManager({
      service: recovered,
      resourceMonitor,
      idleLimit: 10,
      memoryBudgetBytes: 2 * 1024 * 1024 * 1024,
    });
    assert.equal(manager.snapshot().ready, true);
    assert.equal(manager.snapshot().resources.available, true);
    assert.ok(manager.snapshot().resources.processCount >= 2);
    assert.ok(
      (await resourceMonitor.read()).roots.some(
        (root) =>
          root.kind === "authority" && root.pid === created.authority.pid,
      ),
    );
    assert.ok(
      manager.snapshot().resources.rssBytes > (await recovered.readRss()),
    );
    assert.equal(
      manager.snapshot().entries.find((entry) => entry.threadId === threadId)
        .status,
      "active",
    );
    const b = await recovered.connect();
    clients.push(b);
    const thread = await b.request("thread/resume", {
      threadId,
      excludeTurns: true,
    });
    assert.equal(thread.thread.status.type, "active");
    model.release();
    await wait(
      async () =>
        (await b.request("thread/read", { threadId, includeTurns: false }))
          .thread.status.type === "idle",
      "Preserved turn completion",
    );
    const history = await b.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    assert.equal(history.thread.turns.length, 1);
    assert.equal(model.calls.length, 1);
    await manager.settle();
    assert.equal(
      manager.snapshot().entries.find((entry) => entry.threadId === threadId)
        .status,
      "idle",
    );
    await t.test(
      "real native keeps a page lease across disconnect and evicts only idle invisible LRU contexts",
      async () => {
        const { createVisibleLeaseController } =
          await import("../refresh-prototype/visibility-leases.mjs");
        const controller = createVisibleLeaseController({
          manager,
          profileId: randomUUID(),
          leaseGraceMs: 3000,
        });
        try {
          const input = {
            origin: "https://native-visibility.invalid",
            instanceId: randomUUID(),
          };
          const hooks = {
            assertCurrent: async () => {
              assert.ok((await recovered.readRss()) > 0);
            },
          };
          const page = await controller.attach(input, hooks);
          await page.update({ sequence: 1, threadIds: [threadId] });
          await b.request("thread/unsubscribe", { threadId });
          page.disconnect();
          await pause(1300);
          const reconnected = await controller.attach(
            { ...input, ...page.identity },
            hooks,
          );
          await reconnected.update({ sequence: 1, threadIds: [threadId] });
          const keys = [];
          for (let index = 0; index < 11; index++) {
            const value = await b.request("thread/start", {
              cwd: options.cwd,
              approvalPolicy: "never",
              sandbox: "read-only",
            });
            await b.request("turn/start", {
              threadId: value.thread.id,
              input: [
                { type: "text", text: "REFRESH_IDLE", text_elements: [] },
              ],
            });
            await wait(
              async () =>
                (
                  await b.request("thread/read", {
                    threadId: value.thread.id,
                    includeTurns: false,
                  })
                ).thread.status.type === "idle",
              "persisted visibility fixture turn",
            );
            const key = await manager.scopeForThread(value.thread.id);
            keys.push(key);
            await manager.open(key, { warmOnly: true });
            await b.request("thread/unsubscribe", { threadId: key.threadId });
          }
          await manager.settle();
          const loaded = (await b.request("thread/loaded/list", {})).data;
          assert.ok(loaded.includes(threadId));
          assert.equal(
            manager.snapshot().entries.find((e) => e.threadId === threadId)
              .visibleConsumers,
            1,
          );
          assert.equal(
            manager.snapshot().entries.length,
            10,
            JSON.stringify(
              manager
                .snapshot()
                .entries.map(
                  ({ threadId, status, error, visibleConsumers }) => ({
                    threadId,
                    status,
                    error,
                    visibleConsumers,
                  }),
                ),
            ),
          );
          await reconnected.update({ sequence: 2, threadIds: [] });
          const next = await b.request("thread/start", {
            cwd: options.cwd,
            approvalPolicy: "never",
            sandbox: "read-only",
          });
          await b.request("turn/start", {
            threadId: next.thread.id,
            input: [{ type: "text", text: "REFRESH_IDLE", text_elements: [] }],
          });
          await wait(
            async () =>
              (
                await b.request("thread/read", {
                  threadId: next.thread.id,
                  includeTurns: false,
                })
              ).thread.status.type === "idle",
            "persisted final visibility turn",
          );
          await manager.open(await manager.scopeForThread(next.thread.id), {
            warmOnly: true,
          });
          await wait(
            async () =>
              !(await b.request("thread/loaded/list", {})).data.includes(
                threadId,
              ),
            "invisible LRU released",
          );
          const restored = await b.request("thread/resume", {
            threadId,
            excludeTurns: true,
          });
          assert.equal(restored.thread.id, threadId);
          assert.equal(restored.cwd, options.cwd);
          assert.equal(
            (await b.request("thread/read", { threadId, includeTurns: true }))
              .thread.turns.length,
            1,
          );
          assert.equal(
            model.calls.filter((call) => call.mode === "running").length,
            1,
          );
          assert.equal(model.calls.length, 13);
        } finally {
          assert.equal((await controller.close()).unreleasedConsumers, 0);
        }
      },
    );
    await manager.close();
    assert.equal((await recovered.readRss()) > 0, true);
    const { createNativeClient } =
      await import("../refresh-prototype/native-client.mjs");
    const oracle = createNativeClient({
      socketPath: metadata.socketPath,
      name: "acceptance_authority_loss_oracle",
    });
    clients.push(oracle);
    await oracle.ready;
    const authorityIdentity = await captureProcessIdentity(
      created.authority.pid,
    );
    assert.equal(authorityIdentity.startTicks, created.authority.startTicks);
    process.kill(created.authority.pid, "SIGKILL");
    await wait(async () => {
      try {
        await captureProcessIdentity(created.authority.pid);
        return false;
      } catch {
        return true;
      }
    }, "Owned authority observer abrupt exit");
    await assert.rejects(recovered.connect());
    await assert.rejects(readFile(join(root, "manager/authority-revoked")), {
      code: "ENOENT",
    });
    assert.equal(
      (await oracle.request("thread/read", { threadId, includeTurns: true }))
        .thread.turns.length,
      1,
    );
    assert.ok((await recovered.readRss()) > 0);
    await b.close();
    process.kill(service.record.pid, "SIGTERM");
    await wait(async () => {
      try {
        const s = await readFile(`/proc/${service.record.pid}/stat`, "utf8");
        return s.split(") ").at(-1).startsWith("Z ");
      } catch {
        return true;
      }
    }, "Explicit owned fixture service stop");
    await assert.rejects(
      attachPrivateService({ metadata, domain: options.domain }),
    );
    await assert.rejects(
      startPrivateService(options),
      /existing service record/,
    );
    assert.equal(
      (await lstat(join(root, "manager/service.json"))).isFile(),
      true,
    );
  },
);

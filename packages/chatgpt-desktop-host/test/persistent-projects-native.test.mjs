import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startContainerDesktopUpstream } from "../src/container-service.mjs";

// Explicit opt-in: two owned native containers, no network/login/view/model.
// This checks the empty project-state lifecycle, not GUI project creation.
const enabled = process.env.CHATGPT_CONTAINER_OFFLINE_ACCEPTANCE === "1";
const exec = promisify(execFile);
async function hash(path) { const h = createHash("sha256"); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest("hex"); }

test("two real offline native generations seal only after their owned predecessor exits", { skip: !enabled, timeout: 180000 }, async () => {
  const imageDigest = process.env.CHATGPT_CONTAINER_IMAGE, sourceRoot = process.env.CHATGPT_CONTAINER_SOURCE;
  assert.match(imageDigest ?? "", /^sha256:[a-f0-9]{64}$/); assert.ok(sourceRoot?.startsWith("/"));
  const [dockerPath, pythonPath, nodePath] = await Promise.all([realpath(process.env.CHATGPT_CONTAINER_DOCKER), realpath(process.env.CHATGPT_CONTAINER_PYTHON), realpath(process.execPath)]);
  const [dockerSha256, pythonSha256, nodeSha256] = await Promise.all([hash(dockerPath), hash(pythonPath), hash(nodePath)]);
  const cpuId = Number(/^Cpus_allowed_list:\s*(\d+)/m.exec(await readFile("/proc/self/status", "utf8"))?.[1]); assert.ok(Number.isSafeInteger(cpuId));
  const root = await mkdtemp(join(tmpdir(), "cg-project-native-generations-")), historyRoot = join(root, "history"), projectRoot = join(root, "project");
  await mkdir(historyRoot, { mode: 0o700 }); await mkdir(projectRoot, { mode: 0o700 });
  let owner, id, bridgeRoot, completed = false;
  async function cleanup() {
    if (!id) return;
    await owner?.disconnectTransport().catch(() => {});
    const env = { HOME: bridgeRoot, PATH: "/usr/bin:/bin", DOCKER_CONFIG: join(bridgeRoot, "docker-config") };
    await exec(dockerPath, ["stop", "--time", "2", id], { env, timeout: 15000 });
    await exec(dockerPath, ["rm", id], { env, timeout: 15000 });
    if (owner) {
      let timer; try { await Promise.race([owner.nativeExited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("owned native exit unconfirmed")), 10000); })]); }
      finally { clearTimeout(timer); }
    }
    owner = undefined; id = undefined;
  }
  async function launch(n) {
    const base = join(root, `g${n}`), runtimeRoot = join(base, "runtime"); bridgeRoot = join(base, "bridge");
    await mkdir(base, { mode: 0o700 }); await mkdir(bridgeRoot, { mode: 0o700 });
    try {
      owner = await startContainerDesktopUpstream({ imageDigest, sourceRoot, runtimeRoot, bridgeRoot, historyRoot, projectRoots: [projectRoot], cpuId, memoryLimitMiB: 4096, pidsLimit: 512, dockerPath, dockerSha256, pythonPath, pythonSha256, nodePath, nodeSha256, profileId: randomUUID(), generation: randomUUID(), startupTimeoutMs: 90000 });
      id = owner.containerId; return runtimeRoot;
    } catch (error) { id = error?.retainedOwner?.containerId; throw error; }
  }
  try {
    const first = await launch(1), markerPath = join(historyRoot, "project-state", "pending.json");
    assert.equal(owner.projectPersistenceStatus(), "waiting");
    let original;
    for (let n = 0; n < 150; n++) {
      try { original = JSON.parse(await readFile(join(first, "home", ".codex", ".codex-global-state.json"), "utf8")); if (Object.hasOwn(original, "local-projects")) break; } catch {}
      await delay(100);
    }
    assert.deepEqual(original?.["local-projects"], {});
    const firstMarker = JSON.parse(await readFile(markerPath, "utf8")); assert.equal(firstMarker.state, "pending"); assert.ok(firstMarker.native?.pid > 1);
    await cleanup();
    const second = await launch(2);
    assert.equal(owner.projectPersistenceStatus(), "waiting");
    const secondMarker = JSON.parse(await readFile(markerPath, "utf8"));
    assert.equal(secondMarker.state, "pending"); assert.notEqual(secondMarker.writer.containerId, firstMarker.writer.containerId);
    assert.match(secondMarker.prior?.name ?? "", /^sealed-[a-f0-9]{32}\.json$/);
    const sealed = JSON.parse(await readFile(join(historyRoot, "project-state", secondMarker.prior.name), "utf8"));
    assert.deepEqual(sealed.state.projects, []);
    assert.equal(secondMarker.source.homeRoot, join(second, "home"));
    await cleanup(); completed = true;
  } finally {
    await cleanup();
    if (completed) await rm(root, { recursive: true, force: true });
    else process.stderr.write(`Private no-account fixture preserved: ${root}\n`);
  }
});

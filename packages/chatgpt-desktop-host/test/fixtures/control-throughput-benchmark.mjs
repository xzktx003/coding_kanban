import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { connectDesktopControl } from "../../src/control-client.mjs";
import { decodeWireValue, encodeWireValue } from "../../src/wire-value.mjs";

// Offline owner-run benchmark: a fake native and real private Unix sockets.
// It does not load login data, connect a daemon, create a container or send turns.
const args = process.argv.slice(2);
assert.equal(args.length, 4);
assert.equal(args[0], "--baseline-module");
assert.equal(args[2], "--output-dir");
const baseline = args[1],
  output = args[3];
assert.ok(isAbsolute(baseline) && resolve(baseline) === baseline);
assert.ok(isAbsolute(output) && resolve(output) === output);
await mkdir(output, { mode: 0o700 });
const outputInfo = await lstat(output);
assert.equal(outputInfo.uid, process.getuid());
assert.equal(outputInfo.mode & 0o777, 0o700);
const current = fileURLToPath(
  new URL("../../src/control-service.mjs", import.meta.url),
);
const frameCount = 80,
  burst = 8,
  verificationDelayMs = 10;

async function measure(path, label) {
  const { createDesktopControlService } = await import(
    pathToFileURL(path).href
  );
  const root = await mkdtemp(join(tmpdir(), "desktop-throughput-"));
  await chmod(root, 0o700);
  const profile = {
    id: randomUUID(),
    generation: randomUUID(),
    pid: process.pid,
    startTicks: "12345",
    controlSocketPath: join(root, "socket"),
  };
  const listeners = new Set();
  const scope = (viewId) => ({
    profileId: profile.id,
    generation: profile.generation,
    viewId,
  });
  const emit = (frame) => {
    const encoded = encodeWireValue(frame);
    for (const listener of listeners) listener(encoded);
    return Buffer.byteLength(encoded);
  };
  const upstream = {
    explicitDispatch: true,
    async send(encoded, control) {
      const frame = decodeWireValue(encoded);
      control.onDispatch();
      if (frame.type === "createView")
        queueMicrotask(() =>
          emit({
            v: 1,
            type: "bootstrap",
            scope: scope(frame.viewId),
            bootstrap: {
              windowType: "electron",
              getters: {},
              sharedObjects: {},
            },
          }),
        );
      else if (frame.type === "destroyView")
        queueMicrotask(() =>
          emit({ v: 1, type: "viewClosed", scope: scope(frame.viewId) }),
        );
      else assert.fail("benchmark must not send ordinary native calls");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let checks = 0,
    service,
    connection;
  try {
    service = await createDesktopControlService({
      socketPath: profile.controlSocketPath,
      profileId: profile.id,
      generation: profile.generation,
      pid: profile.pid,
      startTicks: profile.startTicks,
      upstream,
      verifyIdentity: async () => {
        checks++;
        await delay(verificationDelayMs);
        return true;
      },
    });
    connection = await connectDesktopControl({
      profile,
      viewId: randomUUID(),
      verifyProfile: async () => true,
    });
    const frames = connection.frames[Symbol.asyncIterator]();
    checks = 0;
    let bytes = 0,
      received = 0;
    const began = performance.now();
    for (let offset = 0; offset < frameCount; offset += burst) {
      for (let step = 1; step <= burst; step++)
        bytes += emit({
          v: 1,
          type: "theme",
          scope: connection.scope,
          seq: offset + step,
          value: "dark",
        });
      for (let step = 1; step <= burst; step++) {
        const next = await frames.next();
        assert.equal(next.done, false);
        const frame = decodeWireValue(next.value);
        assert.equal(frame.type, "theme");
        assert.equal(frame.seq, ++received);
      }
    }
    const result = {
      label,
      sourceSha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
      frameCount,
      burst,
      bytes,
      identityChecks: checks,
      verificationDelayMs,
      elapsedMs: Number((performance.now() - began).toFixed(3)),
      limits: {
        maxFrameBytes: 8388608,
        maxClientBytes: 8388608,
        maxTotalBytes: 33554432,
        maxPending: 64,
        writeTimeoutMs: 10000,
      },
    };
    await service.close();
    return result;
  } finally {
    connection?.close();
    await service?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

const results = [];
for (let round = 1; round <= 2; round++) {
  results.push(await measure(baseline, `baseline-${round}`));
  results.push(await measure(current, `current-${round}`));
}
for (const row of results) {
  assert.equal(
    row.identityChecks,
    row.label.startsWith("baseline") ? frameCount : frameCount / burst,
  );
}
await writeFile(
  join(output, "results.json"),
  JSON.stringify(
    { schema: 1, fakeNative: true, realUnixSocket: true, results },
    null,
    2,
  ) + "\n",
  { mode: 0o600, flag: "wx" },
);
process.stdout.write(JSON.stringify({ complete: true, results }) + "\n");

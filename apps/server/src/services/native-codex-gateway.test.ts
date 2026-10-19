import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NativeCodexGateway } from "./native-codex-gateway.js";

const INSTANCE_ID = "019aabcd-1234-7890-abcd-0123456789ad";
const THREAD_ID = "019aabcd-1234-7890-abcd-0123456789ab";
const TOKEN =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function withinDeadline<T>(result: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      result,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("gateway response remained pending")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const operation of ["status", "instance", "send", "resume"] as const) {
  for (const failure of ["over-budget", "truncated"] as const) {
    test(`native ${operation} settles after a ${failure} broker response`, async () => {
      const dir = await mkdtemp(join(tmpdir(), "native-broker-response-"));
      const upstream = createServer((_request, response) => response.end("ok"));
      const broker = createServer((request, response) => {
        assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
        request.resume();
        if (failure === "over-budget") {
          // Leave the body open so budget enforcement itself closes the reader.
          response.write(
            JSON.stringify({
              padding: "x".repeat(operation === "instance" ? 65536 : 4096),
            }),
          );
        } else {
          response.writeHead(200, { "content-length": 100 });
          response.write("{");
          setImmediate(() => response.destroy());
        }
      });
      try {
        upstream.listen(0, "127.0.0.1");
        broker.listen(0, "127.0.0.1");
        await Promise.all([
          once(upstream, "listening"),
          once(broker, "listening"),
        ]);
        const upstreamAddress = upstream.address();
        const brokerAddress = broker.address();
        assert.ok(upstreamAddress && typeof upstreamAddress !== "string");
        assert.ok(brokerAddress && typeof brokerAddress !== "string");
        const authFile = join(dir, "companion-auth.json");
        await writeFile(
          authFile,
          JSON.stringify({ port: brokerAddress.port, token: TOKEN }),
          { mode: 0o600 },
        );
        await writeFile(
          join(dir, `companion-session-${INSTANCE_ID}.json`),
          JSON.stringify({
            instanceId: INSTANCE_ID,
            port: brokerAddress.port,
            token: TOKEN,
          }),
          { mode: 0o600 },
        );
        const gateway = new NativeCodexGateway();
        gateway.runtime = async () => ({
          upstream: new URL(`http://127.0.0.1:${upstreamAddress.port}`),
          projectDir: dir,
          runtimeRoot: dir,
          fixtures: [],
          brokerPort: brokerAddress.port,
          brokerAuthFile: authFile,
        });
        if (operation === "status") {
          const result = await withinDeadline(gateway.status());
          assert.equal(result.available, true);
          assert.equal(result.resumeAvailable, false);
          assert.equal(result.sendAvailable, false);
        } else if (operation === "instance") {
          assert.deepEqual(
            await withinDeadline(
              gateway.instanceStatus({ instanceId: INSTANCE_ID }),
            ),
            { status: 200, active: false },
          );
        } else if (operation === "send") {
          assert.deepEqual(
            await withinDeadline(
              gateway.sendToNativeThread({
                threadId: THREAD_ID,
                column: 1,
                cwd: dir,
                submissionId: INSTANCE_ID,
                text: "isolated response fixture",
                images: [],
                contexts: [],
                mentions: [],
              }),
            ),
            { status: 502 },
          );
        } else {
          assert.equal(
            await withinDeadline(
              gateway.resumeThreadInNativeWindow({
                threadId: THREAD_ID,
                column: 1,
              }),
            ),
            503,
          );
        }
      } finally {
        broker.closeAllConnections();
        upstream.closeAllConnections();
        await Promise.all([
          new Promise<void>((resolve) => broker.close(() => resolve())),
          new Promise<void>((resolve) => upstream.close(() => resolve())),
        ]);
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";

import { SftpService } from "./sftp-service.js";

type DirectoryCallback = (error?: Error, entries?: unknown[]) => void;

class LifecycleClient extends EventEmitter {
  connectCalls = 0;
  endCalls = 0;
  autoReady = false;
  homeError?: Error;
  readDirectory?: (callback: DirectoryCallback) => void;

  connect(): this {
    this.connectCalls += 1;
    if (this.autoReady) queueMicrotask(() => this.emit("ready"));
    return this;
  }

  sftp(callback: (error: undefined, sftp: unknown) => void): void {
    callback(undefined, {
      end() {},
      realpath: (
        _path: string,
        resolve: (error?: Error, path?: string) => void,
      ) => resolve(this.homeError, this.homeError ? undefined : "/home/demo"),
      readdir: (_path: string, resolve: DirectoryCallback) => {
        if (this.readDirectory) this.readDirectory(resolve);
        else resolve(undefined, []);
      },
    });
  }

  end(): this {
    this.endCalls += 1;
    return this;
  }
}

const target = { host: "example.invalid", username: "demo" };

async function readyList(service: SftpService, client: LifecycleClient) {
  const pending = service.list(target, "/workspace");
  await nextTurn();
  client.emit("ready");
  return pending;
}

if (process.argv.includes("--sftp-home-rejection-probe")) {
  const client = new LifecycleClient();
  client.autoReady = true;
  client.homeError = new Error("SFTP home lookup failed");
  const service = new SftpService(() => client as never);
  await service.list(target, "/workspace");
  await nextTurn();
  await assert.rejects(service.resolveRemotePath(target, "~"), {
    message: "SFTP home lookup failed",
  });
  process.stdout.write(
    "absolute path succeeded; home error remains observable\n",
  );
} else {
  test("authentication rejection keeps later SSH errors handled", async () => {
    const client = new LifecycleClient();
    const service = new SftpService(() => client as never);
    const request = service.list(target, "/workspace");
    const failed = assert.rejects(request, {
      message: "All configured authentication methods failed",
    });
    await nextTurn();
    client.emit(
      "error",
      new Error("All configured authentication methods failed"),
    );
    await failed;

    assert.doesNotThrow(() =>
      client.emit("error", new Error("Late authentication callback")),
    );
    assert.equal(client.endCalls, 1);
  });

  test("transport errors after readiness discard only the failed pooled client", async () => {
    const clients = [new LifecycleClient(), new LifecycleClient()];
    let created = 0;
    const service = new SftpService(() => clients[created++] as never);
    await readyList(service, clients[0]!);
    clients[0]!.emit("error", new Error("Connection reset"));
    assert.equal(clients[0]!.endCalls, 1);
    assert.doesNotThrow(() =>
      clients[0]!.emit("error", new Error("Late socket error")),
    );

    await readyList(service, clients[1]!);
    assert.equal(created, 2);
    assert.equal(clients[1]!.endCalls, 0);
  });

  test("a failed client's delayed close cannot dispose its replacement", async () => {
    const clients = [new LifecycleClient(), new LifecycleClient()];
    let created = 0;
    const service = new SftpService(() => clients[created++] as never);
    const request = service.list(target, "/workspace");
    const failed = assert.rejects(request, /Authentication failed/);
    await nextTurn();
    clients[0]!.emit("error", new Error("Authentication failed"));
    await failed;
    await readyList(service, clients[1]!);

    clients[0]!.emit("close");
    assert.equal(clients[1]!.endCalls, 0);
    await service.list(target, "/another-directory");
    assert.equal(created, 2);
  });

  test("an old in-flight operation cannot dispose a newer pooled connection", async () => {
    const clients = [new LifecycleClient(), new LifecycleClient()];
    let created = 0;
    let rejectDirectory: DirectoryCallback | undefined;
    clients[0]!.readDirectory = (callback) => {
      rejectDirectory = callback;
    };
    const service = new SftpService(() => clients[created++] as never);
    const request = service.list(target, "/workspace");
    const failed = assert.rejects(request, /Channel closed/);
    await nextTurn();
    clients[0]!.emit("ready");
    await nextTurn();
    assert.ok(rejectDirectory);
    clients[0]!.emit("close");
    await readyList(service, clients[1]!);

    rejectDirectory(new Error("Channel closed"));
    await failed;
    assert.equal(clients[1]!.endCalls, 0);
    await service.list(target, "/another-directory");
    assert.equal(created, 2);
  });

  test("closing before readiness rejects promptly rather than waiting for timeout", async () => {
    const client = new LifecycleClient();
    const service = new SftpService(() => client as never);
    const result = service.list(target, "/workspace").then(
      () => ({ error: null }),
      (error: Error) => ({ error }),
    );
    await nextTurn();
    client.emit("close");
    const settled = await Promise.race([result, nextTurn().then(() => null)]);
    // Clear the original implementation's pending timeout even on a red run.
    if (!settled) client.emit("error", new Error("Fixture cleanup"));
    await result;
    assert.ok(settled, "connection close left the request pending");
    assert.match(settled.error?.message ?? "", /closed/);
    assert.equal(client.endCalls, 1);
  });

  test("background home lookup rejection cannot terminate the Node gateway", async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        "--sftp-home-rejection-probe",
      ],
      { timeout: 10_000 },
    );
    assert.match(
      stdout,
      /absolute path succeeded; home error remains observable/,
    );
  });

  test("connection timeout ends its client and continues handling delayed errors", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new LifecycleClient();
    const service = new SftpService(() => client as never);
    const failed = assert.rejects(
      service.list(target, "/workspace"),
      /timed out/,
    );
    await nextTurn();
    t.mock.timers.tick(30_000);
    await failed;
    assert.equal(client.endCalls, 1);
    assert.doesNotThrow(() =>
      client.emit("error", new Error("Late handshake failure")),
    );
  });

  test("synchronous connect failure cleans up the same client", async () => {
    class ThrowingClient extends LifecycleClient {
      override connect(): this {
        throw new Error("Invalid connection configuration");
      }
    }
    const client = new ThrowingClient();
    const service = new SftpService(() => client as never);
    await assert.rejects(
      service.list(target, "/workspace"),
      /Invalid connection configuration/,
    );
    assert.equal(client.endCalls, 1);
    assert.doesNotThrow(() =>
      client.emit("error", new Error("Late connection failure")),
    );
  });

  test("synchronous close and error from end do not recurse or escape", async () => {
    class ClosingClient extends LifecycleClient {
      override end(): this {
        super.end();
        this.emit("close");
        this.emit("error", new Error("Socket closed"));
        return this;
      }
    }
    const client = new ClosingClient();
    const service = new SftpService(() => client as never);
    const failed = assert.rejects(
      service.list(target, "/workspace"),
      /Authentication failed/,
    );
    await nextTurn();
    assert.doesNotThrow(() =>
      client.emit("error", new Error("Authentication failed")),
    );
    await failed;
    assert.equal(client.endCalls, 1);
  });
}

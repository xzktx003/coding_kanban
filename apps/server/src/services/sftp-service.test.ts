import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";

import {
  resolveSftpAuthenticationOptions,
  SftpService,
  type SftpAuthenticationDependencies,
} from "./sftp-service.js";

function createDependencies(
  existingFiles: string[],
): SftpAuthenticationDependencies {
  const files = new Set(existingFiles);
  return {
    homeDirectory: "/tmp/demo-home",
    env: {},
    fileExists: (pathValue) => files.has(pathValue),
    readFile: (pathValue) => Buffer.from(`key:${pathValue}`, "utf8"),
  };
}

class FakeSftpSession {
  constructor(private readonly content = Buffer.alloc(0)) {}

  end(): void {}

  realpath(
    remotePath: string,
    callback: (error: Error | undefined, resolvedPath?: string) => void,
  ): void {
    callback(undefined, remotePath === "." ? "/home/demo" : remotePath);
  }

  readdir(
    _remotePath: string,
    callback: (
      error: Error | undefined,
      items?: Array<{
        filename: string;
        longname: string;
        attrs: { mode: number; size: number; mtime: number; uid?: number };
      }>,
    ) => void,
  ): void {
    callback(undefined, [
      {
        filename: "workspace",
        longname: "drwxr-xr-x 2 demo staff 0 May 30 12:00 workspace",
        attrs: { mode: 0o040755, size: 0, mtime: 1_717_000_000, uid: 501 },
      },
    ]);
  }

  stat(
    _remotePath: string,
    callback: (
      error: Error | undefined,
      attributes?: { mode: number; size: number; mtime: number },
    ) => void,
  ): void {
    callback(undefined, {
      mode: 0o100644,
      size: this.content.length,
      mtime: 1_717_000_000,
    });
  }

  createReadStream(
    _remotePath: string,
    options: { start?: number; end?: number },
  ): Readable {
    const start = options.start ?? 0;
    const end = Math.min(this.content.length, (options.end ?? -1) + 1);
    return Readable.from([this.content.subarray(start, end)]);
  }

  open(
    _remotePath: string,
    _mode: string,
    callback: (error: Error | undefined, handle?: Buffer) => void,
  ): void {
    callback(undefined, Buffer.from("fake-handle"));
  }

  read(
    _handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (
      error: Error | undefined,
      bytesRead: number,
      buffer: Buffer,
      position: number,
    ) => void,
  ): void {
    const chunk = this.content.subarray(position, position + length);
    chunk.copy(buffer, offset);
    callback(undefined, chunk.length, buffer, position + chunk.length);
  }

  close(_handle: Buffer, callback: (error?: Error) => void): void {
    callback();
  }
}

class FakeSshClient extends EventEmitter {
  private ready = false;

  connectCalls = 0;

  constructor(private readonly content = Buffer.alloc(0)) {
    super();
  }

  connect(): this {
    this.connectCalls += 1;
    setImmediate(() => {
      this.ready = true;
      this.emit("ready");
    });
    return this;
  }

  sftp(
    callback: (error: Error | undefined, sftp?: FakeSftpSession) => void,
  ): void {
    if (!this.ready) {
      callback(new Error("No response from server"));
      return;
    }

    callback(undefined, new FakeSftpSession(this.content));
  }

  end(): this {
    this.ready = false;
    return this;
  }
}

test("resolveSftpAuthenticationOptions prefers the explicit identity file", () => {
  const options = resolveSftpAuthenticationOptions(
    {
      host: "example.com",
      username: "demo",
      identityFile: "/tmp/explicit-key",
    },
    createDependencies(["/tmp/explicit-key", "/tmp/demo-home/.ssh/id_rsa"]),
  );

  assert.equal(options.privateKey?.toString("utf8"), "key:/tmp/explicit-key");
});

test("resolveSftpAuthenticationOptions falls back to the default ssh private key when no identity file is configured", () => {
  const options = resolveSftpAuthenticationOptions(
    {
      host: "example.com",
      username: "demo",
    },
    createDependencies(["/tmp/demo-home/.ssh/id_rsa"]),
  );

  assert.equal(
    options.privateKey?.toString("utf8"),
    "key:/tmp/demo-home/.ssh/id_rsa",
  );
});

test("resolveSftpAuthenticationOptions prefers standard default keys before unrelated custom keys", () => {
  const options = resolveSftpAuthenticationOptions(
    {
      host: "example.com",
      username: "demo",
    },
    createDependencies([
      "/tmp/demo-home/.ssh/id_ed25519_gerrit_houmo",
      "/tmp/demo-home/.ssh/id_rsa",
    ]),
  );

  assert.equal(
    options.privateKey?.toString("utf8"),
    "key:/tmp/demo-home/.ssh/id_rsa",
  );
});

test("list reuses a single pending connection safely for concurrent requests", async () => {
  const client = new FakeSshClient();
  const service = new SftpService(() => client as never);
  const target = {
    host: "example.com",
    username: "demo",
  };

  const results = await Promise.allSettled([
    service.list(target, "~"),
    service.list(target, "~"),
  ]);

  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled"],
  );
  assert.equal(client.connectCalls, 1);

  for (const result of results) {
    assert.equal(result.status, "fulfilled");
    assert.equal(result.value.path, "/home/demo");
    assert.equal(result.value.entries[0]?.name, "workspace");
    assert.equal(result.value.entries[0]?.owner, "demo");
  }
});

test("preview reads only the requested SFTP window", async () => {
  const client = new FakeSshClient(Buffer.from("first-second-third", "utf8"));
  const service = new SftpService(() => client as never);
  const preview = await service.preview(
    { host: "example.com", username: "demo" },
    "/home/demo/window.txt",
    6,
    6,
  );

  assert.equal(preview.content, "second");
  assert.equal(preview.offset, 6);
  assert.equal(preview.bytesRead, 6);
  assert.equal(preview.previousOffset, 0);
  assert.equal(preview.nextOffset, 12);
});

test("readRange returns a bounded raw SFTP byte window", async () => {
  const client = new FakeSshClient(Buffer.from("first-second-third", "utf8"));
  const service = new SftpService(() => client as never);
  const result = await service.readRange(
    { host: "example.com", username: "demo" },
    "/home/demo/transcript.jsonl",
    6,
    6,
  );

  assert.equal(result.path, "/home/demo/transcript.jsonl");
  assert.equal(result.size, Buffer.byteLength("first-second-third"));
  assert.equal(result.buffer.toString("utf8"), "second");
});

test("readRanges reuses one SFTP channel for multiple metadata windows", async () => {
  const client = new FakeSshClient(Buffer.from("first-second-third", "utf8"));
  const service = new SftpService(() => client as never);
  const results = await service.readRanges(
    { host: "example.com", username: "demo" },
    [
      { path: "/home/demo/first.jsonl", offset: 0, length: 5 },
      { path: "/home/demo/second.jsonl", offset: 6, length: 6 },
    ],
  );

  assert.deepEqual(
    results.map((result) => result.buffer.toString("utf8")),
    ["first", "second"],
  );
  assert.equal(client.connectCalls, 1);
});

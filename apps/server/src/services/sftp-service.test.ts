import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
}

class FakeSshClient extends EventEmitter {
  private ready = false;

  connectCalls = 0;

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

    callback(undefined, new FakeSftpSession());
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

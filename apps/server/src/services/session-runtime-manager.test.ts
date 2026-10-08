import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { SessionRuntimeManager } from "./session-runtime-manager.js";
test("disabled and missing runtimes leave terminal startup available", async () => {
  assert.equal(
    await new SessionRuntimeManager(process.cwd(), {
      SESSION_MODE_ENABLED: "0",
    }).start(),
    undefined,
  );
  const data = mkdtempSync(join(tmpdir(), "session-manager-"));
  try {
    assert.equal(
      await new SessionRuntimeManager(process.cwd(), {
        SESSION_DATA_HOME: data,
        SESSION_RUNTIME_BIN: resolve(data, "absent"),
      }).start(),
      undefined,
    );
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
test("runtime startup validates configured ports and paths before spawning", async () => {
  const data = mkdtempSync(join(tmpdir(), "session-manager-"));
  try {
    const binary = process.execPath;
    await assert.rejects(
      new SessionRuntimeManager(process.cwd(), {
        SESSION_DATA_HOME: data,
        SESSION_RUNTIME_BIN: binary,
        SESSION_RUNTIME_PORT: "0",
      }).start(),
      /PORT/,
    );
    await assert.rejects(
      new SessionRuntimeManager(process.cwd(), {
        SESSION_DATA_HOME: data,
        SESSION_RUNTIME_BIN: "bad\0bin",
      }).start(),
      /paths/,
    );
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test("relative runtime binaries resolve against the repository rather than server cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-relative-"));
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin/runtime"), "fixture");
    await assert.rejects(
      new SessionRuntimeManager(root, {
        SESSION_RUNTIME_BIN: "bin/runtime",
        SESSION_DATA_HOME: join(root, "data"),
        SESSION_RUNTIME_PORT: "0",
      }).start(),
      /PORT/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

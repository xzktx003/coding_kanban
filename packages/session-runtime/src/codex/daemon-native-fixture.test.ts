import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  registerOwnedNativeFixture,
  ownedDaemonIdentity,
  cleanupOwnedNativeFixture,
} from "./daemon-native-fixture.js";

test("native fixture registration rejects the ordinary Codex home before reading process records", async () => {
  await assert.rejects(
    registerOwnedNativeFixture(join(homedir(), ".codex")),
    /normal Codex home/,
  );
});

test("native fixture registration rejects existing services, symlinks and public directories", async () => {
  const base = await mkdtemp(join(tmpdir(), "native-fixture-authority-"));
  try {
    const existing = join(base, "existing"),
      publicHome = join(base, "public"),
      link = join(base, "linked");
    await mkdir(join(existing, "app-server-daemon"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      join(existing, "app-server-daemon", "daemon-updater.pid"),
      JSON.stringify({ pid: process.pid }),
    );
    await mkdir(publicHome, { mode: 0o755 });
    await symlink(existing, link);
    await assert.rejects(
      registerOwnedNativeFixture(existing),
      /registration must precede daemon/,
    );
    await assert.rejects(
      registerOwnedNativeFixture(publicHome),
      /must stay private/,
    );
    await assert.rejects(
      registerOwnedNativeFixture(link),
      /must not be a symlink/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("native cleanup refuses a real but uncaptured PID and cannot infer ownership from a PID file", async () => {
  const base = await mkdtemp(join(tmpdir(), "native-fixture-forged-"));
  const home = join(base, "private");
  try {
    await mkdir(home, { mode: 0o700 });
    await registerOwnedNativeFixture(home);
    await mkdir(join(home, "app-server-daemon"));
    await writeFile(
      join(home, "app-server-daemon", "daemon.pid"),
      JSON.stringify({ pid: process.pid }),
    );
    await assert.rejects(
      ownedDaemonIdentity(home),
      /must identify the registered private fixture domain/,
    );
    const stat = await readFile(`/proc/${process.pid}/stat`, "utf8"),
      fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    await assert.rejects(
      cleanupOwnedNativeFixture({ pid: process.pid, startTicks: fields[19]! }),
      /uncaptured/,
    );
    assert.equal(process.kill(process.pid, 0), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

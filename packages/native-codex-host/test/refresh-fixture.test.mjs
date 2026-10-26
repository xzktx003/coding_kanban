import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  chmod,
  symlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { captureProcessIdentity } from "../refresh-prototype/resources.mjs";

const ids = [
  "019aabcd-1234-7890-abcd-0123456789ab",
  "019aabcd-1234-7890-abcd-0123456789ac",
  "019aabcd-1234-7890-abcd-0123456789ad",
];
const profiles = ids.map((id, index) => ({
  id,
  startupId: id,
  root: "/tmp/ck-owned/profile" + index,
}));

test("fixture setup verification follows the exact current audit script and process identity", async (t) => {
  const { verifyRefreshSetupProcess } =
    await import("../../../tests/e2e/codex-refresh-fixture.mjs");
  const audit = await mkdtemp(join(tmpdir(), "ck-fixture-audit-"));
  const root = await mkdtemp(join(tmpdir(), "ck-ui-life-"));
  const script = join(audit, "setup.mjs");
  await writeFile(
    script,
    'process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
    { mode: 0o600 },
  );
  await writeFile(join(audit, "ready.json"), "{}", { mode: 0o600 });
  const child = spawn(process.execPath, [script], {
    cwd: audit,
    stdio: ["ignore", "pipe", "ignore"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(audit, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  await once(child.stdout, "data");
  const fixture = {
    root,
    noLoginCopied: true,
    setupPid: child.pid,
    setupIdentity: await captureProcessIdentity(child.pid),
  };
  const manifest = join(audit, "ready.json");
  assert.equal(await verifyRefreshSetupProcess(fixture, manifest), script);
  await assert.rejects(
    verifyRefreshSetupProcess(
      {
        ...fixture,
        setupIdentity: { ...fixture.setupIdentity, startTicks: "0" },
      },
      manifest,
    ),
    /identity/,
  );
  await assert.rejects(
    verifyRefreshSetupProcess({ ...fixture, setupPid: process.pid }, manifest),
    /identity/,
  );
  await assert.rejects(
    verifyRefreshSetupProcess({ ...fixture, noLoginCopied: false }, manifest),
    /fixture/,
  );
  const other = join(audit, "other");
  await mkdir(other, { mode: 0o700 });
  await writeFile(join(other, "ready.json"), "{}", { mode: 0o600 });
  await writeFile(join(other, "setup.mjs"), "", { mode: 0o600 });
  await assert.rejects(
    verifyRefreshSetupProcess(fixture, join(other, "ready.json")),
    /script/,
  );
  await symlink(manifest, join(audit, "alias.json"));
  await assert.rejects(
    verifyRefreshSetupProcess(fixture, join(audit, "alias.json")),
    /manifest/,
  );
  await chmod(script, 0o666);
  await assert.rejects(verifyRefreshSetupProcess(fixture, manifest), /script/);
  assert.equal(child.exitCode, null);
});
test("independent browser clients select their exact private profile without first-profile fallback", async () => {
  const { selectRefreshClientProfile } =
    await import("../../../tests/e2e/codex-refresh-fixture.mjs");
  for (let index = 0; index < 3; index++) {
    assert.equal(
      selectRefreshClientProfile({ root: "/tmp/ck-owned", profiles }, index),
      profiles[index],
    );
    assert.equal(
      selectRefreshClientProfile(
        { root: "/tmp/ck-owned", profiles: [profiles[0]] },
        index,
      ),
      profiles[0],
    );
  }
});
test("profile selection rejects missing, excessive or ambiguous client mappings", async () => {
  const { selectRefreshClientProfile } =
    await import("../../../tests/e2e/codex-refresh-fixture.mjs");
  for (const mapped of [
    [],
    profiles.slice(0, 2),
    [...profiles, profiles[0]],
    [profiles[0], profiles[0], profiles[2]],
    [profiles[0], { ...profiles[1], root: profiles[0].root }, profiles[2]],
    [
      profiles[0],
      { ...profiles[1], startupId: profiles[0].startupId },
      profiles[2],
    ],
    [profiles[0], { ...profiles[1], id: "invalid" }, profiles[2]],
    [profiles[0], { ...profiles[1], id: [profiles[1].id] }, profiles[2]],
    [
      profiles[0],
      { ...profiles[1], startupId: [profiles[1].startupId] },
      profiles[2],
    ],
    [
      profiles[0],
      { ...profiles[1], root: profiles[0].root + "/nested" },
      profiles[2],
    ],
    [
      profiles[0],
      { ...profiles[1], root: profiles[1].root + "\u0000" },
      profiles[2],
    ],
    [profiles[0], { ...profiles[1], root: "/another/root" }, profiles[2]],
  ])
    assert.throws(
      () =>
        selectRefreshClientProfile(
          { root: "/tmp/ck-owned", profiles: mapped },
          0,
        ),
      /profile|mapping/i,
    );
  for (const index of [-1, 3, "1", null])
    assert.throws(
      () =>
        selectRefreshClientProfile({ root: "/tmp/ck-owned", profiles }, index),
      /client|index/i,
    );
});

test("refresh profile evidence permits the exact owned fixture root and its private descendants", async (t) => {
  const { verifyRefreshProfileRoot } =
    await import("../../../tests/e2e/codex-refresh-fixture.mjs");
  const root = await mkdtemp(join(tmpdir(), "ck-fixture-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = join(root, "profile");
  await mkdir(child, { mode: 0o700 });
  assert.equal(await verifyRefreshProfileRoot(root, root), root);
  assert.equal(await verifyRefreshProfileRoot(root, child), child);
});

test("refresh profile evidence rejects a foreign, nonprivate or aliased directory before reading any registry", async (t) => {
  const { verifyRefreshProfileRoot } =
    await import("../../../tests/e2e/codex-refresh-fixture.mjs");
  const root = await mkdtemp(join(tmpdir(), "ck-fixture-path-"));
  const outside = await mkdtemp(join(tmpdir(), "ck-fixture-foreign-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await assert.rejects(verifyRefreshProfileRoot(root, outside));
  await symlink(outside, join(root, "alias"));
  await assert.rejects(verifyRefreshProfileRoot(root, join(root, "alias")));
  await assert.rejects(verifyRefreshProfileRoot(root + "/.", root));
  const child = join(root, "public");
  await mkdir(child, { mode: 0o700 });
  await chmod(child, 0o755);
  await assert.rejects(verifyRefreshProfileRoot(root, child));
  await chmod(root, 0o755);
  await assert.rejects(verifyRefreshProfileRoot(root, root));
});

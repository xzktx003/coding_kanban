import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  chmod,
  symlink,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateOptions,
  validateDirectories,
  buildHostStartup,
  buildHostArgs,
} from "../host.mjs";
const domain = "019aabcd-1234-7890-abcd-0123456789ab";
const input = (root = "/tmp/ck-workspace/runtime") => ({
  unsafeNoAuth: true,
  runtimeRoot: root,
  codeServer: "/tool/code-server",
  officialVsix: "/tool/official.vsix",
  codexCli: "/tool/codex",
  port: 34567,
  userDataDir: join(root, "user"),
  extensionsDir: join(root, "extensions"),
  projectDir: join(root, "project"),
  codexHome: join(root, "codex"),
  processHome: join(root, "home"),
  refreshServiceConfig: "/private/bridge.json",
  refreshDomain: domain,
  refreshControlRoot: "/private/control",
});

test("shared working directory requires explicit managed visible-window startup and full refresh configuration", () => {
  const value = {
    ...input(),
    refreshWorkspaceDir: "/tmp/ck-workspace/project",
  };
  assert.equal(
    buildHostStartup(value, { restoreVisibleWindows: true })
      .restoreVisibleWindows,
    true,
  );
  for (const flags of [
    {},
    { autoOpenNewChats: true },
    { autoOpenFixtures: true },
    { createThreads: true },
  ])
    assert.throws(() => buildHostStartup(value, flags), /workspace|visible/i);
  for (const field of [
    "refreshServiceConfig",
    "refreshDomain",
    "refreshControlRoot",
  ])
    assert.throws(
      () => validateOptions({ ...value, [field]: undefined }),
      /refresh|workspace/i,
    );
});

test("workspace spelling and overlap cannot expose a profile, login home, or ancestor", () => {
  const value = {
    ...input(),
    refreshWorkspaceDir: "/tmp/ck-workspace/project",
  };
  for (const refreshWorkspaceDir of [
    "",
    [],
    ["/tmp/project"],
    "relative",
    "/",
    "/tmp/../tmp/project",
    "/tmp/p\u0000",
    "/tmp/p\n",
    "/tmp/p\u007f",
    value.runtimeRoot,
    join(value.runtimeRoot, "workspace"),
    "/tmp/ck-workspace",
  ])
    assert.throws(
      () => validateOptions({ ...value, refreshWorkspaceDir }),
      /workspace/i,
    );
  assert.throws(
    () =>
      validateOptions({
        ...value,
        sharedCodexHome: "/tmp/ck-shared-home",
        refreshWorkspaceDir: "/tmp/ck-shared-home/project",
      }),
    /workspace/i,
  );
  assert.throws(
    () =>
      validateOptions({
        ...value,
        connectionProfileHome: "/tmp/ck-login-copy",
        refreshWorkspaceDir: "/tmp/ck-login-copy/project",
      }),
    /workspace/i,
  );
  assert.throws(
    () =>
      validateOptions({
        ...value,
        refreshControlRoot: "/tmp/ck-workspace/project/control",
      }),
    /workspace/i,
  );
  assert.throws(
    () =>
      validateOptions({
        ...value,
        refreshServiceConfig: "/tmp/ck-workspace/project/bridge.json",
      }),
    /workspace/i,
  );
});

test("independent private profiles open the same existing workspace without changing its contents or permissions", async (t) => {
  const { getHostWorkspace } = await import("../host.mjs");
  assert.equal(typeof getHostWorkspace, "function");
  const root = await mkdtemp(join(tmpdir(), "ck-workspace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "project");
  await mkdir(workspace, { mode: 0o755 });
  // Existing shared development repositories commonly use an owned 0775 root.
  await chmod(workspace, 0o775);
  const file = join(workspace, "existing.txt");
  await writeFile(file, "existing project\n", { mode: 0o640 });
  const before = await lstat(workspace);
  for (let i = 0; i < 2; i++) {
    const configured = validateOptions({
      ...input(join(root, "client" + i)),
      refreshWorkspaceDir: workspace,
    });
    await validateDirectories(configured);
    assert.equal(getHostWorkspace(configured), workspace);
    assert.equal(buildHostArgs(configured).at(-1), workspace);
    assert.equal((await lstat(configured.projectDir)).mode & 0o777, 0o700);
  }
  assert.equal(await readFile(file, "utf8"), "existing project\n");
  const after = await lstat(workspace);
  assert.equal(after.mode, before.mode);
  assert.equal(after.mtimeMs, before.mtimeMs);
  const ordinary = validateOptions(input(join(root, "ordinary")));
  assert.equal(getHostWorkspace(ordinary), ordinary.projectDir);
  assert.equal(buildHostArgs(ordinary).at(-1), ordinary.projectDir);
});

test("missing, aliased, file or externally writable workspace fails before creating profile directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ck-workspace-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project, { mode: 0o700 });
  const alias = join(root, "alias");
  await symlink(project, alias);
  const file = join(root, "file");
  await writeFile(file, "data");
  const writable = join(root, "writable");
  await mkdir(writable, { mode: 0o700 });
  await chmod(writable, 0o777);
  for (const refreshWorkspaceDir of [
    join(root, "missing"),
    alias,
    file,
    writable,
  ]) {
    const runtime = join(
      root,
      "runtime-" + Math.random().toString(36).slice(2),
    );
    await assert.rejects(
      validateDirectories(
        validateOptions({ ...input(runtime), refreshWorkspaceDir }),
      ),
      /workspace|symlink/i,
    );
    await assert.rejects(lstat(runtime), { code: "ENOENT" });
  }
});

test("workspace is rechecked before host launch if an existing path changes to a symlink", async (t) => {
  const { validateRefreshWorkspace } = await import("../host.mjs");
  assert.equal(typeof validateRefreshWorkspace, "function");
  const root = await mkdtemp(join(tmpdir(), "ck-workspace-recheck-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project"),
    other = join(root, "other");
  await mkdir(project, { mode: 0o700 });
  await mkdir(other, { mode: 0o700 });
  const options = validateOptions({
    ...input(join(root, "runtime")),
    refreshWorkspaceDir: project,
  });
  await validateDirectories(options);
  await rm(project, { recursive: true });
  await symlink(other, project);
  await assert.rejects(validateRefreshWorkspace(options), /workspace|symlink/i);
});

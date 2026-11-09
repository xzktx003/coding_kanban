import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createChatGptSshAliasDiscovery } from "./chatgpt-desktop-ssh-aliases.js";

const originalMain = process.env.CHATGPT_DESKTOP_SSH_ORIGINAL_CHUNK;
const original = { skip: !originalMain && "Set CHATGPT_DESKTOP_SSH_ORIGINAL_CHUNK to the independently extracted c23f63 original member" };
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "chatgpt-server-ssh-aliases-")); t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home"); await mkdir(home, { mode: 0o700 });
  const configPath = join(root, "config");
  return { root, home, configPath,
    create: () => createChatGptSshAliasDiscovery({ configPath, homeDirectory: home, nativeMainChunkFile: originalMain! }),
    save: (text: string) => writeFile(configPath, text, { mode: 0o600 }) };
}

test("unconfigured, arbitrary, or unknown original source cannot read SSH configuration", async (t) => {
  const f = await fixture(t), unknown = join(f.root, "not-the-original.js"); await writeFile(unknown, "do not execute");
  assert.throws(() => createChatGptSshAliasDiscovery({ configPath: "relative", nativeMainChunkFile: unknown }), /Invalid fixed SSH/);
  assert.throws(() => createChatGptSshAliasDiscovery({ configPath: f.configPath, nativeMainChunkFile: unknown }), { code: "SSH_DISCOVERY_VERSION_UNAVAILABLE" });
  assert.throws(() => createChatGptSshAliasDiscovery({ configPath: f.configPath, nativeMainChunkFile: unknown, command: "ssh" } as any), /Invalid fixed SSH/);
});

test("original alias semantics retain case and unknown aliases, first literal only, excluding colima", original, async (t) => {
  const f = await fixture(t);
  await f.save('hOsT Alpha second_alias\n  Hostname example.invalid\nHost alpha\nHost Alpha duplicate\nHost *.wild chosen second\nHost !excluded ?wild [ab]\nHost CoLiMa\nHost colima\nHost github\n HostName github.com\nHost odd:name\nHost 主机\nUnknownDirective untouched\n');
  const actual = f.create().discover();
  assert.deepEqual(actual, { sshAliases: ["Alpha", "alpha", "chosen", "github", "odd:name", "主机"].sort((a,b) => a.localeCompare(b)), configState: "ready" });
  assert.equal(JSON.stringify(actual).includes("example.invalid"), false);
});

test("top-level Includes use the entrypoint directory, glob and tilde, with cycle protection", original, async (t) => {
  const f = await fixture(t); await mkdir(join(f.root, "inc"));
  await writeFile(join(f.root, "inc", "a.cfg"), "Include root-relative.cfg\nHost included ignored_second\n", { mode: 0o600 });
  await writeFile(join(f.root, "root-relative.cfg"), "Include config\nHost rootRelative\n", { mode: 0o600 });
  await writeFile(join(f.root, "inc", "root-relative.cfg"), "Host wrongNestedRelative\n", { mode: 0o600 });
  await writeFile(join(f.home, "extra.cfg"), "Host fromHome\n", { mode: 0o600 });
  await f.save("Include inc/a.cfg\nInclude ~/extra.cfg\nInclude missing.cfg\nHost own\n Include inc/root-relative.cfg\n");
  assert.deepEqual(f.create().discover().sshAliases, ["included", "rootRelative", "fromHome", "own"].sort((a,b)=>a.localeCompare(b)));
});

test("glob matching is original, nested Host/Match Includes are not expanded and Match exec never runs", original, async (t) => {
  const f = await fixture(t); await mkdir(join(f.root, "inc"));
  await writeFile(join(f.root, "inc", "a.cfg"), "Host first\n", { mode: 0o600 });
  await writeFile(join(f.root, "inc", "b.cfg"), "Host second\n", { mode: 0o600 });
  await writeFile(join(f.root, "ignored.cfg"), "Host mustNotBeInvented\n", { mode: 0o600 });
  const sentinel = join(f.root, "must-not-execute");
  await f.save(`Include inc/*.cfg\nHost *\n Include ignored.cfg\nMatch exec "touch ${sentinel}"\n Include ignored.cfg\nHost final\n ProxyCommand touch ${sentinel}\n IdentityFile PRIVATE_KEY_PATH_DO_NOT_EXPOSE\n`);
  const value = f.create().discover();
  assert.deepEqual(value.sshAliases, ["first", "second", "final"].sort((a,b)=>a.localeCompare(b)));
  await assert.rejects(access(sentinel));
  assert.equal(JSON.stringify(value).includes("PRIVATE_KEY"), false);
});

test("missing remains distinguishable and reads are fresh without caching or command resolution", original, async (t) => {
  const f = await fixture(t), reader = f.create();
  assert.deepEqual(reader.discover(), { sshAliases: [], configState: "missing" });
  await f.save("Host nowPresent\n"); assert.deepEqual(reader.discover(), { sshAliases: ["nowPresent"], configState: "ready" });
  await f.save("Host changed\n"); assert.deepEqual(reader.discover(), { sshAliases: ["changed"], configState: "ready" });
});

test("bad syntax, unsafe includes and fixed read budgets fail explicitly rather than dropping entries", original, async (t) => {
  const f = await fixture(t);
  await f.save('Host "unterminated\n'); assert.throws(() => f.create().discover(), { code: "SSH_DISCOVERY_FAILED" });
  await writeFile(join(f.root, "unsafe.cfg"), "Host unsafe\n", { mode: 0o600 }); await chmod(join(f.root, "unsafe.cfg"), 0o666);
  await f.save("Include *.cfg\nHost safe\n"); assert.throws(() => f.create().discover(), { code: "SSH_CONFIG_UNSAFE" });
  await f.save("#".repeat(256*1024+1)); assert.throws(() => f.create().discover(), { code: "SSH_CONFIG_LIMIT" });
  await f.save(Array.from({length:513},(_,i)=>`Host alias_${i}\n`).join("")); assert.throws(() => f.create().discover(), { code: "SSH_CONFIG_LIMIT" });
});

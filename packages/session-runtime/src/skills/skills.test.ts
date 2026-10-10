import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import Fastify from "fastify";
import { registerSkillsRoutes, SkillsService } from "./index.js";
const exec = promisify(execFile);
async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "ts-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home"),
    codexHome = join(root, "native"),
    project = join(root, "project");
  await Promise.all([home, codexHome, project].map((p) => mkdir(p)));
  return {
    root,
    home,
    codexHome,
    project,
    service: new SkillsService({ home, codexHome }),
  };
}
async function skill(path: string, name = "example") {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "SKILL.md"),
    `---\nname: ${name}\ndescription: Description\nlicense: MIT\n---\nBody\n`,
  );
}
test("all 13 routes preserve payloads, central copies, native home links and groups", async (t) => {
  const f = await fixture(t);
  const app = Fastify();
  registerSkillsRoutes(app, { home: f.home, codexHome: f.codexHome });
  t.after(() => app.close());
  const post = async (route: string, body: object) => {
    const r = await app.inject({
      method: "POST",
      url: `/api/skills/${route}`,
      payload: body,
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const source = join(f.home, ".agents/plugins/local/repo/skills/example");
  await skill(source);
  const params = { selected_agent: "codex", scope: "user" };
  assert.equal((await post("list-marketplace", params))[0].installed, false);
  assert.equal(
    await post("install-marketplace", {
      ...params,
      skill_name: "example",
      skill_md_path: join(source, "SKILL.md"),
    }),
    join(f.codexHome, "skills/example"),
  );
  assert.equal(
    (await post("list-installed", params))[0].description,
    "Description",
  );
  assert.equal(
    (await post("list-central", { scope: "user" }))[0].linkedCodex,
    true,
  );
  assert.equal(
    await post("link-to-agent", {
      skill_name: "example",
      agent: "cc",
      scope: "project",
      cwd: f.project,
    }),
    null,
  );
  assert.equal(
    (await lstat(join(f.project, ".claude/skills/example"))).isSymbolicLink(),
    true,
  );
  await post("uninstall-installed", { ...params, skill_name: "example" });
  assert.equal(
    (await post("list-central", { scope: "user" }))[0].linkedCodex,
    false,
  );
  assert.equal((await post("list-marketplace", params))[0].installed, true);
  const config = {
    groups: [{ id: "g1", name: "Group", skillNames: ["example"] }],
  };
  await post("groups/write", { config });
  assert.deepEqual(
    (
      await app.inject({ method: "POST", url: "/api/skills/groups/read" })
    ).json(),
    config,
  );
  await post("delete-central", {
    skill_name: "example",
    scope: "project",
    cwd: f.project,
  });
  assert.deepEqual(await post("list-central", { scope: "user" }), []);
});
test("names, invalid scopes and redirected destination roots reject before writes", async (t) => {
  const f = await fixture(t);
  const source = join(f.root, "source");
  await skill(source);
  for (const name of [
    "",
    ".",
    "..",
    "../escape",
    "/absolute",
    "x\\y",
    "C:drive",
    "line\nbreak",
  ]) {
    await assert.rejects(
      f.service.installMarketplace(
        join(source, "SKILL.md"),
        name,
        "codex",
        "user",
      ),
    );
    await assert.rejects(f.service.deleteCentral(name, "user"));
  }
  await assert.rejects(
    f.service.installMarketplace(
      join(source, "SKILL.md"),
      "safe",
      "other",
      "user",
    ),
  );
  await assert.rejects(
    f.service.installMarketplace(
      join(source, "SKILL.md"),
      "safe",
      "codex",
      "project",
      "relative",
    ),
  );
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(f.home, ".agents"));
  await assert.rejects(
    f.service.installMarketplace(
      join(source, "SKILL.md"),
      "safe",
      "codex",
      "user",
    ),
    /symlink/,
  );
  assert.deepEqual(
    await import("node:fs/promises").then((fs) => fs.readdir(outside)),
    [],
  );
});
test("source escapes and cycles reject; internal symlinks are copied as content", async (t) => {
  const f = await fixture(t);
  const source = join(f.root, "source");
  await skill(source);
  await writeFile(join(f.root, "secret"), "private");
  await symlink(join(f.root, "secret"), join(source, "escape"));
  await assert.rejects(
    f.service.installMarketplace(
      join(source, "SKILL.md"),
      "example",
      "codex",
      "user",
    ),
    /leaves/,
  );
  await rm(join(source, "escape"));
  await symlink(source, join(source, "cycle"));
  await assert.rejects(
    f.service.installMarketplace(
      join(source, "SKILL.md"),
      "example",
      "codex",
      "user",
    ),
    /cycle/,
  );
  await rm(join(source, "cycle"));
  await symlink(join(source, "SKILL.md"), join(source, "copy"));
  await f.service.installMarketplace(
    join(source, "SKILL.md"),
    "example",
    "codex",
    "user",
  );
  assert.match(
    await readFile(join(f.home, ".agents/skills/example/copy"), "utf8"),
    /Description/,
  );
});
test("delete validates all roots first and unlinks leaf without touching external target", async (t) => {
  const f = await fixture(t);
  await skill(join(f.home, ".agents/skills/safe"), "safe");
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "sentinel"), "keep");
  await symlink(outside, join(f.home, ".claude"));
  await assert.rejects(f.service.deleteCentral("safe", "user"), /symlink/);
  assert.match(
    await readFile(join(f.home, ".agents/skills/safe/SKILL.md"), "utf8"),
    /safe/,
  );
  await rm(join(f.home, ".claude"));
  await symlink(outside, join(f.home, ".agents/skills/leaf"));
  await f.service.deleteCentral("leaf", "user");
  assert.equal(await readFile(join(outside, "sentinel"), "utf8"), "keep");
});
test("local git clone discovers marketplace and skills.sh installs with idempotent contents", async (t) => {
  const f = await fixture(t);
  const repo = join(f.root, "owner/repository");
  await skill(join(repo, "skills/first"), "renamed");
  await exec("git", ["init", repo]);
  await exec("git", ["-C", repo, "add", "."]);
  await exec("git", [
    "-C",
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  const service = new SkillsService({
    home: f.home,
    codexHome: f.codexHome,
    repositoryUrl: () => repo,
  });
  assert.equal(
    await service.cloneRepo(repo),
    join(f.home, ".agents/plugins/owner/repository"),
  );
  assert.equal((await service.listMarketplace())[0]?.name, "renamed");
  assert.equal(
    await service.cloneRepo(repo),
    join(f.home, ".agents/plugins/owner/repository"),
  );
  const installed = await service.installRemote(
    "owner/repository",
    "first",
    "project",
    f.project,
  );
  assert.equal(installed, join(f.home, ".agents/skills/renamed"));
  assert.equal(
    (await lstat(join(f.project, ".codex/skills/renamed"))).isSymbolicLink(),
    true,
  );
  await writeFile(join(installed, "SKILL.md"), "preserved");
  await service.installRemote(
    "owner/repository",
    "first",
    "project",
    f.project,
  );
  assert.equal(
    await readFile(join(installed, "SKILL.md"), "utf8"),
    "preserved",
  );
  for (const source of [
    "../repo",
    "owner/repo;bad",
    "https://github.com/owner/repo",
  ])
    await assert.rejects(service.installRemote(source, "first", "user"));
  await assert.rejects(service.cloneRepo("--upload-pack=bad"));
});
test("HTTP search normalizes upstream, escapes query and leaderboard merges maximum counts", async (t) => {
  const f = await fixture(t);
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url!);
    res.setHeader("content-type", "application/json");
    const query = new URL(req.url!, "http://localhost").searchParams.get("q");
    if (query === "fail") {
      res.statusCode = 503;
      res.end("unavailable");
      return;
    }
    res.end(
      JSON.stringify({
        skills: [
          {
            source: "owner/repo",
            skill_id: "first",
            installs: query === "code" ? 10 : 2,
          },
          { source: "", skillId: "bad" },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  );
  const address = server.address() as import("node:net").AddressInfo;
  const app = Fastify();
  registerSkillsRoutes(app, {
    home: f.home,
    codexHome: f.codexHome,
    searchUrl: `http://127.0.0.1:${address.port}/api/search`,
  });
  t.after(() => app.close());
  const search = await app.inject({
    method: "POST",
    url: "/api/skillssh/search",
    payload: { query: "a&b 技能", limit: 5 },
  });
  assert.deepEqual(search.json(), [
    {
      id: "owner/repo/first",
      source: "owner/repo",
      skillId: "first",
      name: "first",
      installs: 2,
    },
  ]);
  assert.equal(
    new URL(seen[0]!, "http://localhost").searchParams.get("q"),
    "a&b 技能",
  );
  const board = await app.inject({
    method: "POST",
    url: "/api/skillssh/leaderboard",
    payload: { board: "all-time" },
  });
  assert.equal(board.json()[0].installs, 10);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/skillssh/search",
        payload: { query: "fail", limit: 1 },
      })
    ).statusCode,
    500,
  );
});
test("group corruption errors without overwrite and symlinked group file is refused", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.home, ".agents"));
  const path = join(f.home, ".agents/skill-groups.json");
  await writeFile(path, "{broken");
  await assert.rejects(f.service.readGroups());
  assert.equal(await readFile(path, "utf8"), "{broken");
  await assert.rejects(f.service.writeGroups({ groups: [{ name: "bad" }] }));
  await rm(path);
  await writeFile(join(f.root, "outside"), "keep");
  await symlink(join(f.root, "outside"), path);
  await assert.rejects(f.service.writeGroups({ groups: [] }), /symlink/);
  assert.equal(await readFile(join(f.root, "outside"), "utf8"), "keep");
});

test("registration matches every skills method/path in the migration contract", async (t) => {
  const f = await fixture(t);
  const app = Fastify();
  registerSkillsRoutes(app, { home: f.home, codexHome: f.codexHome });
  t.after(() => app.close());
  await app.ready();
  const contract = JSON.parse(
    await readFile(
      new URL("../../route-contract.json", import.meta.url),
      "utf8",
    ),
  ) as { method: string; path: string }[];
  const relevant = contract.filter(
    (r) =>
      r.path.startsWith("/api/skills/") || r.path.startsWith("/api/skillssh/"),
  );
  assert.equal(relevant.length, 13);
  for (const route of relevant)
    assert.equal(
      app.hasRoute({ method: route.method as "POST", url: route.path }),
      true,
      `${route.method} ${route.path}`,
    );
});

test("clone-repo and skillssh install HTTP return JSON strings and native links", async (t) => {
  const f = await fixture(t),
    repo = join(f.root, "local/repo");
  await skill(join(repo, "nested/named-directory"), "front-name");
  await exec("git", ["init", repo]);
  await exec("git", ["-C", repo, "add", "."]);
  await exec("git", [
    "-C",
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  const app = Fastify();
  registerSkillsRoutes(app, {
    home: f.home,
    codexHome: f.codexHome,
    repositoryUrl: () => repo,
  });
  t.after(() => app.close());
  const cloned = await app.inject({
    method: "POST",
    url: "/api/skills/clone-repo",
    payload: { url: repo },
  });
  assert.equal(cloned.statusCode, 200);
  assert.equal(cloned.json(), join(f.home, ".agents/plugins/local/repo"));
  const installed = await app.inject({
    method: "POST",
    url: "/api/skillssh/install",
    payload: { source: "local/repo", skill_id: "front-name", scope: "user" },
  });
  assert.equal(installed.statusCode, 200, installed.body);
  assert.equal(installed.json(), join(f.home, ".agents/skills/front-name"));
  assert.equal(
    (await lstat(join(f.codexHome, "skills/front-name"))).isSymbolicLink(),
    true,
  );
  assert.equal(
    (await lstat(join(f.home, ".claude/skills/front-name"))).isSymbolicLink(),
    true,
  );
});

test("conflicting native link is rejected before central copy and concurrent install is idempotent", async (t) => {
  const f = await fixture(t),
    source = join(f.root, "source");
  await skill(source);
  const native = join(f.codexHome, "skills");
  await mkdir(native);
  await symlink(source, join(native, "example"));
  await assert.rejects(
    f.service.installMarketplace(
      join(source, "SKILL.md"),
      "example",
      "codex",
      "user",
    ),
    /different target/,
  );
  await assert.rejects(lstat(join(f.home, ".agents/skills/example")), {
    code: "ENOENT",
  });
  await rm(join(native, "example"));
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      f.service.installMarketplace(
        join(source, "SKILL.md"),
        "example",
        "codex",
        "user",
      ),
    ),
  );
  assert.equal(new Set(results).size, 1);
  assert.equal((await lstat(join(native, "example"))).isSymbolicLink(), true);
});

test("remote front matter traversal and cloned symlink escapes never install", async (t) => {
  const f = await fixture(t),
    repo = join(f.root, "repo");
  await skill(repo, "../../escaped");
  await exec("git", ["init", repo]);
  await exec("git", ["-C", repo, "add", "."]);
  await exec("git", [
    "-C",
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  const service = new SkillsService({
    home: f.home,
    codexHome: f.codexHome,
    repositoryUrl: () => repo,
  });
  await assert.rejects(
    service.installRemote("owner/repo", "safe-id", "user"),
    /single directory/,
  );
  await assert.rejects(lstat(join(f.home, ".agents/skills")), {
    code: "ENOENT",
  });
  await skill(repo, "safe");
  await symlink(f.home, join(repo, "external"));
  await exec("git", ["-C", repo, "add", "."]);
  await exec("git", [
    "-C",
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "unsafe-link",
  ]);
  await assert.rejects(
    service.installRemote("owner/repo", "safe-id", "user"),
    /leaves/,
  );
});

test("an unavailable leaderboard fails visibly instead of reporting empty success", async (t) => {
  const f = await fixture(t);
  const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.end("unavailable");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  );
  const address = server.address() as import("node:net").AddressInfo;
  const service = new SkillsService({
    home: f.home,
    codexHome: f.codexHome,
    searchUrl: `http://127.0.0.1:${address.port}/search`,
  });
  await assert.rejects(service.leaderboard("all-time"), /Failed to fetch/);
});

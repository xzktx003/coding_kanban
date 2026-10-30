import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir,
  stat,
  symlink,
  link,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { acpRecentHistory } from "./acp/history-projection.js";
import {
  createAuxiliaryHistoryReader,
  readClaudeHistoryWorker,
} from "./auxiliary-history-reader.js";
import { ClaudeSessionIdentity } from "./claude/session-identity.js";

test("ACP recent projection reads a readonly legacy source and writes only its private sidecar", async () => {
  const home = await mkdtemp(join(tmpdir(), "aux-history-source-"));
  const path = join(home, "source.db");
  const source = new Database(path);
  source.exec(
    "CREATE TABLE acp_session_updates(id INTEGER PRIMARY KEY,session_id TEXT,payload TEXT,created_at TEXT)",
  );
  const add = source.prepare("INSERT INTO acp_session_updates VALUES(?,?,?,?)");
  add.run(
    1,
    "session",
    JSON.stringify({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "first " },
    }),
    "now",
  );
  add.run(
    2,
    "session",
    JSON.stringify({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "second" },
    }),
    "now",
  );
  source.close();
  const before = await readFile(path);
  const readonly = new Database(path, { readonly: true, fileMustExist: true });
  readonly.pragma("query_only=ON");
  const sidecar = new Database(join(home, "private.db"));
  try {
    const page = await acpRecentHistory(sidecar, "session", {}, readonly);
    assert.equal(page.data[0].text, "first second");
    assert.equal(page.data[0].historySourceId, 2);
    assert.equal(page.metadata?.historySourceId, 2);
    assert.equal(page.revision, "2:2");
    assert.equal(
      (
        readonly
          .prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'acp_chat_projection%'",
          )
          .get() as { n: number }
      ).n,
      0,
    );
    assert.deepEqual(await readFile(path), before);
  } finally {
    readonly.close();
    sidecar.close();
    await rm(home, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aux-reader-")),
    dataHome = join(root, "runtime"),
    nativeHome = join(root, "native"),
    cacheHome = join(root, "gateway-cache");
  await mkdir(join(dataHome, ".codexia"), { recursive: true });
  await mkdir(join(nativeHome, ".claude/projects"), { recursive: true });
  const path = join(dataHome, ".codexia/cache.db"),
    db = new Database(path);
  db.exec(
    "CREATE TABLE acp_sessions(session_id TEXT PRIMARY KEY); CREATE TABLE acp_session_updates(id INTEGER PRIMARY KEY,session_id TEXT,payload TEXT,created_at TEXT)",
  );
  db.prepare("INSERT INTO acp_sessions VALUES(?)").run("session");
  db.close();
  let checks = 0;
  const options = {
    dataHome,
    cacheHome,
    sourceScope: "owned-runtime-generation",
    nativeEnv: {
      HOME: nativeHome,
      PATH: process.env.PATH,
      NODE_OPTIONS: "--not-a-valid-node-option",
    },
    verifySource: () => {
      checks++;
    },
  };
  return {
    root,
    path,
    dataHome,
    nativeHome,
    cacheHome,
    options,
    checks: () => checks,
    clean: () => rm(root, { recursive: true, force: true }),
  };
}
test("standalone ACP reader preserves source bytes and resumes its persistent sidecar after an append", async () => {
  const f = await fixture();
  try {
    const db = new Database(f.path),
      add = db.prepare("INSERT INTO acp_session_updates VALUES(?,?,?,?)");
    add.run(
      1,
      "session",
      JSON.stringify({
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "question" },
      }),
      "now",
    );
    add.run(
      2,
      "session",
      JSON.stringify({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "first " },
      }),
      "now",
    );
    add.run(
      3,
      "session",
      JSON.stringify({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "answer" },
      }),
      "now",
    );
    db.close();
    const before = await readFile(f.path),
      reader = createAuxiliaryHistoryReader(f.options);
    const recent = await reader.readRecent("acp", "session", { limit: 1 });
    assert.equal(recent.data.length, 1);
    assert.equal(recent.data[0]!.text, "first answer");
    assert.ok(recent.nextCursor);
    assert.equal(recent.metadata?.historySourceId, 3);
    assert.equal(recent.revision, "3:3");
    const earlier = await reader.readRecent("acp", "session", {
      cursor: recent.nextCursor!,
      limit: 1,
    });
    assert.equal(earlier.data[0]!.text, "question");
    assert.deepEqual(await readFile(f.path), before);
    assert.equal(f.checks(), 4);
    const sidecars = (await readdir(f.cacheHome)).filter((n) =>
      /^acp-.*\.db$/.test(n),
    );
    assert.equal(sidecars.length, 1);
    assert.equal((await stat(join(f.cacheHome, sidecars[0]!))).mode & 0o077, 0);
    const append = new Database(f.path);
    append.prepare("INSERT INTO acp_session_updates VALUES(?,?,?,?)").run(
      4,
      "session",
      JSON.stringify({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: " appended" },
      }),
      "now",
    );
    append.close();
    const restarted = createAuxiliaryHistoryReader(f.options),
      next = await restarted.readRecent("acp", "session", { limit: 1 });
    assert.equal(next.data[0]!.text, "first answer appended");
    assert.equal(next.revision, "4:4");
    assert.deepEqual(
      (await readdir(f.cacheHome)).filter((n) => /^acp-.*\.db$/.test(n)),
      sidecars,
    );
  } finally {
    await f.clean();
  }
});
test("ACP metadata only does not decode source bodies or create projection tables", async () => {
  const f = await fixture();
  try {
    const db = new Database(f.path);
    db.prepare(
      "INSERT INTO acp_session_updates VALUES(1,'session','not valid JSON','now')",
    ).run();
    db.close();
    const before = await readFile(f.path),
      page = await createAuxiliaryHistoryReader(f.options).readRecent(
        "acp",
        "session",
        { metadataOnly: true },
      );
    assert.deepEqual(page, {
      data: [],
      nextCursor: null,
      revision: "1:1",
      truncated: false,
      projection: "acp-entries",
    });
    const file = (await readdir(f.cacheHome)).find((n) => n.endsWith(".db"))!,
      projection = new Database(join(f.cacheHome, file), {
        readonly: true,
        fileMustExist: true,
      });
    assert.equal(
      (
        projection
          .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'")
          .get() as { n: number }
      ).n,
      0,
    );
    projection.close();
    assert.deepEqual(await readFile(f.path), before);
  } finally {
    await f.clean();
  }
});
test("missing ACP source is never created and revoked source results are not published", async () => {
  const f = await fixture();
  try {
    const reader = createAuxiliaryHistoryReader(f.options);
    await rm(f.path);
    await assert.rejects(reader.readRecent("acp", "session"), /ENOENT/);
    await assert.rejects(stat(f.path), /ENOENT/);
    const db = new Database(f.path);
    db.exec(
      "CREATE TABLE acp_sessions(session_id TEXT);CREATE TABLE acp_session_updates(id INTEGER PRIMARY KEY,session_id TEXT,payload TEXT)",
    );
    db.prepare("INSERT INTO acp_sessions VALUES('session')").run();
    db.close();
    let calls = 0;
    const revoked = createAuxiliaryHistoryReader({
      ...f.options,
      verifySource: () => {
        if (++calls === 2) throw Error("source scope changed");
      },
    });
    await assert.rejects(
      revoked.readRecent("acp", "session", { metadataOnly: true }),
      /source scope changed/,
    );
    assert.equal(calls, 2);
    assert.throws(
      () =>
        createAuxiliaryHistoryReader({
          ...f.options,
          cacheHome: join(f.nativeHome, ".claude/cache"),
        }),
      /overlaps/,
    );
  } finally {
    await f.clean();
  }
});
test("actual installed SDK reads private native files, paging/detail and metadata through the isolated factory", async () => {
  const f = await fixture(),
    id = randomUUID(),
    cwd = join(f.root, "project");
  const folder = join(
    f.nativeHome,
    ".claude/projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  await mkdir(folder, { recursive: true });
  let parent: string | null = null;
  const rows = Array.from({ length: 8 }, (_, i) => {
    const uuid = randomUUID(),
      type = i % 2 ? "assistant" : "user";
    const row = {
      type,
      uuid,
      parentUuid: parent,
      sessionId: id,
      cwd,
      timestamp: new Date(1700000000000 + i * 1000).toISOString(),
      message: {
        role: type,
        content: [
          {
            type: "text",
            text: `source-${i} ` + "x".repeat(i === 7 ? 150000 : 100),
          },
        ],
      },
    };
    parent = uuid;
    return row;
  });
  const path = join(folder, id + ".jsonl"),
    original = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(path, original);
  try {
    const reader = createAuxiliaryHistoryReader(f.options),
      page = await reader.readRecent("cc", id, { limit: 2 });
    assert.equal(page.data.length, 2);
    assert.equal(page.data.at(-1)!.uuid, rows[7]!.uuid);
    assert.ok(page.nextCursor);
    assert.ok(page.truncated);
    const older = await reader.readRecent("cc", id, {
      limit: 2,
      cursor: page.nextCursor!,
    });
    assert.equal(older.data.at(-1)!.uuid, rows[5]!.uuid);
    const detail = await reader.readDetail("cc", id, rows[7]!.uuid, {
      offset: 0,
      limit: 1024,
    });
    assert.ok(detail.text.includes("source-7"));
    const meta = await reader.readRecent("cc", id, { metadataOnly: true });
    assert.deepEqual(meta.data, []);
    assert.equal(meta.revision, page.revision);
    assert.equal(await readFile(path, "utf8"), original);
    assert.equal(f.checks(), 12);
    assert.ok((await stat(join(f.cacheHome, "cc/.codexia/cache.db"))).isFile());
  } finally {
    await f.clean();
  }
});
test("cancellation waits for only its owned readonly worker to exit and mutation methods never launch", async () => {
  const controller = new AbortController();
  let child: ReturnType<typeof spawn> | undefined;
  let launches = 0;
  const launch = ((binary: string, args: string[], options: any) => {
    launches++;
    assert.equal(args[args.length - 2], "getSessionMessages");
    child = spawn(binary, ["-e", "setInterval(()=>{},1000)"], options);
    child.once("spawn", () =>
      controller.abort(new DOMException("cancelled", "AbortError")),
    );
    return child;
  }) as typeof spawn;
  await assert.rejects(
    readClaudeHistoryWorker(
      "getSessionMessages",
      ["fixture"],
      { PATH: process.env.PATH },
      controller.signal,
      launch,
    ),
    { name: "AbortError" },
  );
  assert.equal(launches, 1);
  assert.ok(child?.exitCode !== null || child?.signalCode !== null);
  await assert.rejects(
    readClaudeHistoryWorker(
      "deleteSession" as any,
      [],
      {},
      new AbortController().signal,
      launch,
    ),
    /Readonly/,
  );
  assert.equal(launches, 1);
});

test("cache parents and existing metadata files cannot redirect writes into a source", async () => {
  const f = await fixture();
  try {
    const redirected = join(f.root, "redirected");
    await symlink(join(f.dataHome, ".codexia"), redirected);
    assert.throws(
      () =>
        createAuxiliaryHistoryReader({
          ...f.options,
          cacheHome: join(redirected, "must-not-create"),
        }),
      /overlaps/,
    );
    await assert.rejects(
      stat(join(f.dataHome, ".codexia/must-not-create")),
      /ENOENT/,
    );
    const metadata = join(f.cacheHome, "cc/.codexia");
    await mkdir(metadata, { recursive: true, mode: 0o700 });
    await link(f.path, join(metadata, "cache.db"));
    const before = await readFile(f.path);
    await assert.rejects(
      createAuxiliaryHistoryReader(f.options).readRecent("cc", randomUUID()),
      /owned private file/,
    );
    assert.deepEqual(await readFile(f.path), before);
  } finally {
    await f.clean();
  }
});

test("a verified Claude native alias keeps public cursor ownership and refuses a late mapping change", async () => {
  const f = await fixture(),
    nativeId = randomUUID(),
    owner = randomUUID(),
    cwd = join(f.root, "project");
  const folder = join(
    f.nativeHome,
    ".claude/projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  await mkdir(folder, { recursive: true });
  let parent: string | null = null;
  const rows = Array.from({ length: 4 }, (_, i) => {
    const uuid = randomUUID(),
      type = i % 2 ? "assistant" : "user";
    const row = {
      type,
      uuid,
      parentUuid: parent,
      sessionId: nativeId,
      cwd,
      timestamp: new Date(1700000000000 + i * 1000).toISOString(),
      message: {
        role: type,
        content: [{ type: "text", text: `aliased-${i}` }],
      },
    };
    parent = uuid;
    return row;
  });
  const path = join(folder, nativeId + ".jsonl"),
    original = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(path, original);
  try {
    const reader = createAuxiliaryHistoryReader({
      ...f.options,
      resolveClaudeSession: (id: string) => {
        assert.equal(id, owner);
        return nativeId;
      },
    });
    const page = await reader.readRecent("cc", owner, { limit: 1 });
    assert.equal(page.data[0]?.uuid, rows[3]!.uuid);
    assert.equal(page.data[0]?.session_id, owner);
    assert.equal(
      JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString())[2],
      owner,
    );
    const older = await reader.readRecent("cc", owner, {
      limit: 1,
      cursor: page.nextCursor!,
    });
    assert.equal(older.data[0]?.uuid, rows[2]!.uuid);
    const detail = await reader.readDetail("cc", owner, rows[3]!.uuid, {
      offset: 0,
      limit: 1024,
    });
    assert.match(detail.text, /aliased-3/);
    let calls = 0;
    const changed = createAuxiliaryHistoryReader({
      ...f.options,
      resolveClaudeSession: () => (++calls === 1 ? nativeId : randomUUID()),
    });
    await assert.rejects(
      changed.readRecent("cc", owner, { limit: 1 }),
      /identity.*changed/i,
    );
    const identityRoot = join(f.nativeHome, ".claude") + "/";
    await new ClaudeSessionIdentity(f.dataHome, identityRoot).remember(
      owner,
      nativeId,
    );
    const persisted = createAuxiliaryHistoryReader({
      ...f.options,
      claudeIdentityRoot: identityRoot,
      resolveClaudeSession: () => undefined,
    });
    assert.equal(
      (await persisted.readRecent("cc", owner, { limit: 1 })).data[0]?.uuid,
      rows[3]!.uuid,
    );
    const revoked=new Error("verified live alias scope revoked");
    const rejected=createAuxiliaryHistoryReader({
      ...f.options,claudeIdentityRoot:identityRoot,
      resolveClaudeSession:()=>{throw revoked;},
    });
    await assert.rejects(rejected.readRecent("cc",owner,{limit:1}),error=>error===revoked);
    const invalid=createAuxiliaryHistoryReader({
      ...f.options,claudeIdentityRoot:identityRoot,resolveClaudeSession:()=>"../foreign",
    });
    await assert.rejects(invalid.readRecent("cc",owner,{limit:1}),/session/i);
    await assert.rejects(
      persisted.readRecent("cc", randomUUID()),
      /身份暂不可核实/,
    );
    assert.equal(await readFile(path, "utf8"), original);
  } finally {
    await f.clean();
  }
});

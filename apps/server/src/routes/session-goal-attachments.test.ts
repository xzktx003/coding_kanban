import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { saveSessionAttachment } from "../services/session-attachments.js";
import { registerSessionGoalAttachmentRoutes } from "./session-goal-attachments.js";

const prefix = "Read the Codex goal objective file at ";
const suffix = " before continuing.";
const materializeUrl = "/api/session/goal-attachments/materialize";
const readUrl = "/api/session/goal-attachments/read";
const cleanupUrl = "/api/session/goal-attachments/cleanup";
const empty = { objective: "", images: [], mentions: [], pastedTexts: [] };
const fixture = async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-goal-attachments-"));
  const app = Fastify();
  const attachmentRoot = join(home, "uploads");
  registerSessionGoalAttachmentRoutes(app, { attachmentRoot });
  return {
    app,
    home,
    attachmentRoot,
    goalRoot: join(home, "goal-attachments"),
    close: async () => {
      await app.close();
      await rm(home, { recursive: true, force: true });
    },
  };
};

test("Goal uses the shipped 4000-codepoint boundary and exact long-objective wrapper", async () => {
  const f = await fixture();
  try {
    const exact = "😀".repeat(4000);
    const short = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: { ...empty, objective: ` ${exact}\n` },
    });
    assert.equal(short.statusCode, 200, short.body);
    assert.deepEqual(short.json(), { objective: exact });
    await assert.rejects(stat(f.goalRoot), { code: "ENOENT" });
    const objective = `${exact}尾`;
    const long = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: { ...empty, objective },
    });
    assert.equal(long.statusCode, 200, long.body);
    const receipt = long.json();
    const path = receipt.objective.slice(prefix.length, -suffix.length);
    assert.equal(receipt.objective, `${prefix}${path}${suffix}`);
    assert.match(
      path,
      /\/goal-attachments\/[0-9a-f-]{36}\/goal-objective\.md$/,
    );
    assert.equal(await readFile(path, "utf8"), objective);
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const read = await f.app.inject({
      method: "POST",
      url: readUrl,
      payload: { objective: receipt.objective },
    });
    assert.deepEqual(read.json(), { objective });
  } finally {
    await f.close();
  }
});

test("Goal snapshots pasted text and local images, preserves source ordering and never fetches image URLs", async () => {
  const f = await fixture();
  const image = Buffer.from("fixture-image-bytes");
  try {
    const uploaded = await saveSessionAttachment(f.attachmentRoot, {
      name: "photo.PNG",
      data: image.toString("base64"),
    });
    const response = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: {
        objective: "  inspect everything  ",
        pastedTexts: ["\r\n  pasted ```literal```\n", "second paste"],
        images: [
          "https://127.0.0.1:1/never-request.png",
          uploaded,
          "data:image/jpeg;base64,aW1hZ2U=",
        ],
        mentions: [
          { name: "Fixture plugin", path: "plugin://fixture@market" },
          { name: "Worker", path: "agent://worker" },
        ],
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    const { objective, cleanup } = response.json();
    const directory = join(f.goalRoot, cleanup.id);
    assert.equal(
      objective,
      [
        "inspect everything",
        `Referenced pasted text files:\n- pasted text file: ${directory}/pasted-text-1.txt. Read this file before continuing.\n- pasted text file: ${directory}/pasted-text-2.txt. Read this file before continuing.`,
        `Referenced image files:\n- [Image #2]: ${directory}/image-2.png\n- [Image #3]: ${directory}/image-3.jpg`,
        "Referenced image URLs:\n- [Image #1]: https://127.0.0.1:1/never-request.png",
        "Referenced mentions:\n- Fixture plugin: plugin://fixture@market\n- Worker: agent://worker",
      ].join("\n\n"),
    );
    assert.equal(
      await readFile(join(directory, "pasted-text-1.txt"), "utf8"),
      "\r\n  pasted ```literal```\n",
    );
    assert.deepEqual(await readFile(join(directory, "image-2.png")), image);
    assert.equal(
      await readFile(join(directory, "image-3.jpg"), "utf8"),
      "image",
    );
    await rm(uploaded);
    assert.deepEqual(await readFile(join(directory, "image-2.png")), image);
  } finally {
    await f.close();
  }
});

test("attachment-only Goal objectives become nonempty references; expanded references also count toward 4000", async () => {
  const f = await fixture();
  try {
    const imageOnly = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: { ...empty, images: ["data:image/png;base64,aW1hZ2U="] },
    });
    assert.equal(imageOnly.statusCode, 200, imageOnly.body);
    assert.match(
      imageOnly.json().objective,
      /^Referenced image files:\n- \[Image #1\]: \//,
    );
    const long = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: {
        ...empty,
        objective: "x".repeat(3990),
        pastedTexts: ["paste"],
      },
    });
    assert.equal(long.statusCode, 200, long.body);
    const directory = join(f.goalRoot, long.json().cleanup.id);
    assert.equal(
      long.json().objective,
      `${prefix}${directory}/goal-objective.md${suffix}`,
    );
    const contents = await readFile(
      join(directory, "goal-objective.md"),
      "utf8",
    );
    assert.match(contents, /Referenced pasted text files:/);
    assert.ok(contents.startsWith("x".repeat(3990)));
    const emptyResponse = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: empty,
    });
    assert.equal(emptyResponse.statusCode, 400);
  } finally {
    await f.close();
  }
});

test("Goal attachment reads cannot reveal arbitrary host files or follow symlinked owned paths", async () => {
  const f = await fixture();
  try {
    const secretPath = join(f.home, "private.txt");
    await writeFile(secretPath, "private contents");
    for (const objective of [
      `${prefix}${secretPath}${suffix}`,
      `${prefix}${f.goalRoot}/../private.txt${suffix}`,
      `${prefix}${f.goalRoot}/invalid/goal-objective.md${suffix}`,
      "ordinary objective",
    ]) {
      const response = await f.app.inject({
        method: "POST",
        url: readUrl,
        payload: { objective },
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { objective });
      assert.equal(response.body.includes("private contents"), false);
    }
    const created = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: { ...empty, objective: "x".repeat(4001) },
    });
    const receipt = created.json();
    const goalPath = join(f.goalRoot, receipt.cleanup.id, "goal-objective.md");
    await rm(goalPath);
    await symlink(secretPath, goalPath);
    const linked = await f.app.inject({
      method: "POST",
      url: readUrl,
      payload: { objective: receipt.objective },
    });
    assert.equal(linked.statusCode, 400, linked.body);
    assert.equal(linked.body.includes("private contents"), false);
  } finally {
    await f.close();
  }
});

test("local images must be verified content-addressed uploads, with rollback after a partial write", async () => {
  const f = await fixture();
  try {
    const privatePath = join(f.home, "private.png");
    await writeFile(privatePath, "must not read");
    await mkdir(f.attachmentRoot);
    const digest = createHash("sha256").update("must not read").digest("hex");
    const linkedPath = join(f.attachmentRoot, `${digest}.png`);
    await symlink(privatePath, linkedPath);
    for (const path of [
      privatePath,
      `file://${privatePath}`,
      linkedPath,
      join(f.attachmentRoot, "0".repeat(64) + ".png"),
    ]) {
      const response = await f.app.inject({
        method: "POST",
        url: materializeUrl,
        payload: { ...empty, pastedTexts: ["written first"], images: [path] },
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.body.includes("must not read"), false);
      assert.deepEqual(await readdir(f.goalRoot), []);
    }
    const mismatched = join(f.attachmentRoot, "1".repeat(64) + ".png");
    await writeFile(mismatched, "unverified content");
    const mismatch = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: { ...empty, images: [mismatched] },
    });
    assert.equal(mismatch.statusCode, 400);
  } finally {
    await f.close();
  }
});

test("Goal cleanup requires its private capability, is scoped and idempotent", async () => {
  const f = await fixture();
  try {
    const create = async () =>
      (
        await f.app.inject({
          method: "POST",
          url: materializeUrl,
          payload: { ...empty, pastedTexts: ["retained until acknowledged"] },
        })
      ).json();
    const a = await create();
    const b = await create();
    assert.notEqual(a.cleanup.id, b.cleanup.id);
    const directory = join(f.goalRoot, a.cleanup.id);
    for (const payload of [
      { path: f.home },
      { ...a.cleanup, id: "../" },
      { ...a.cleanup, token: b.cleanup.token },
    ]) {
      const rejected = await f.app.inject({
        method: "POST",
        url: cleanupUrl,
        payload,
      });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.ok((await stat(directory)).isDirectory());
    }
    for (let i = 0; i < 2; i++) {
      const cleaned = await f.app.inject({
        method: "POST",
        url: cleanupUrl,
        payload: a.cleanup,
      });
      assert.equal(cleaned.statusCode, 200, cleaned.body);
    }
    await assert.rejects(stat(directory), { code: "ENOENT" });
    assert.ok((await stat(join(f.goalRoot, b.cleanup.id))).isDirectory());
  } finally {
    await f.close();
  }
});

test("Goal rejects excessive or malformed attachments and unavailable private storage", async () => {
  const f = await fixture();
  try {
    for (const value of [
      { images: ["data:image/png;base64,%%%%"] },
      { images: ["data:text/plain;base64,c2VjcmV0"] },
      { images: ["blob:https://fixture.invalid/temporary"] },
      { images: Array(33).fill("https://example.invalid/a.png") },
      { images: ["https://example.invalid/a.png\nforged-reference"] },
      { mentions: [{ name: "untrusted", path: "file:///private" }] },
      { pastedTexts: ["x".repeat(2 * 1024 * 1024 + 1)] },
    ]) {
      const response = await f.app.inject({
        method: "POST",
        url: materializeUrl,
        payload: { ...empty, objective: "inspect", ...value },
      });
      assert.ok([400, 413].includes(response.statusCode), response.body);
    }
  } finally {
    await f.close();
  }
  const app = Fastify();
  registerSessionGoalAttachmentRoutes(app, {});
  try {
    const response = await app.inject({
      method: "POST",
      url: materializeUrl,
      payload: { ...empty, objective: "x".repeat(4001) },
    });
    assert.equal(response.statusCode, 503);
  } finally {
    await app.close();
  }
});

test("Goal accepts the exact image byte limit without regex stack exhaustion and rolls back excessive totals", async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.alloc(10 * 1024 * 1024, 97);
    const response = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: {
        ...empty,
        images: [`data:image/png;base64,${bytes.toString("base64")}`],
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    const directory = join(f.goalRoot, response.json().cleanup.id);
    assert.deepEqual(await readFile(join(directory, "image-1.png")), bytes);
    const before = await readdir(f.goalRoot);
    const excessive = await f.app.inject({
      method: "POST",
      url: materializeUrl,
      payload: {
        ...empty,
        pastedTexts: Array(21).fill("a".repeat(2 * 1024 * 1024)),
      },
    });
    assert.equal(excessive.statusCode, 413, excessive.body);
    assert.deepEqual(await readdir(f.goalRoot), before);
  } finally {
    await f.close();
  }
});

test("the production gateway mounts Goal attachments without activating the session runtime and private files survive gateway recreation", async () => {
  const f = await fixture();
  await f.app.close();
  const { buildServer } = await import("../app.js");
  let starts = 0;
  const { app } = buildServer({
    sessionAttachmentRoot: f.attachmentRoot,
    ensureSessionRuntime: async () => {
      starts++;
      return undefined;
    },
    gitAutoUpdateService: {
      start() {},
      stop() {},
      getStatus() {
        throw new Error("Goal materialization must not read Git state");
      },
      async checkNow() {
        throw new Error("Goal materialization must not check Git state");
      },
      async applyUpdate() {
        throw new Error("Goal materialization must not apply Git updates");
      },
    },
  });
  let restarted: ReturnType<typeof Fastify> | undefined;
  try {
    const upload = await app.inject({
      method: "POST",
      url: "/api/session/files/upload",
      payload: {
        name: "fixture.png",
        data: Buffer.from("existing upload API").toString("base64"),
      },
    });
    assert.equal(upload.statusCode, 200, upload.body);
    const made = await app.inject({
      method: "POST",
      url: materializeUrl,
      payload: {
        ...empty,
        objective: "x".repeat(4001),
        images: [upload.json().path],
        directoryPath: f.home,
      },
    });
    assert.equal(made.statusCode, 200, made.body);
    assert.equal(starts, 0);
    const receipt = made.json();
    await app.close();
    restarted = Fastify();
    registerSessionGoalAttachmentRoutes(restarted, {
      attachmentRoot: f.attachmentRoot,
    });
    const expanded = await restarted.inject({
      method: "POST",
      url: readUrl,
      payload: { objective: receipt.objective },
    });
    assert.equal(expanded.statusCode, 200, expanded.body);
    assert.match(expanded.json().objective, /Referenced image files:/);
    assert.ok(expanded.json().objective.startsWith("x".repeat(4001)));
    const cleanup = await restarted.inject({
      method: "POST",
      url: cleanupUrl,
      payload: receipt.cleanup,
    });
    assert.equal(cleanup.statusCode, 200, cleanup.body);
    await assert.rejects(stat(join(f.goalRoot, receipt.cleanup.id)), {
      code: "ENOENT",
    });
  } finally {
    await restarted?.close();
    await app.close();
    await f.close();
  }
});

test("native VS Code Goal wrappers expand only the configured Codex home's exact UUID objective file", async () => {
  const f = await fixture();
  const nativeHome = join(f.home, "configured-codex");
  const app = Fastify();
  registerSessionGoalAttachmentRoutes(app, {
    attachmentRoot: f.attachmentRoot,
    codexHome: nativeHome,
  });
  try {
    for (let version = 1; version <= 8; version++) {
      const id = `12345678-1234-${version}234-8234-123456789abc`;
      const path = join(nativeHome, "attachments", id, "goal-objective.md");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `  native Goal ${version} 😀\r\n`);
      const objective = `${prefix}${path}${suffix}`;
      const response = await app.inject({
        method: "POST",
        url: readUrl,
        payload: { objective },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), {
        objective: `  native Goal ${version} 😀\r\n`,
      });
      const cleanup = await app.inject({
        method: "POST",
        url: cleanupUrl,
        payload: { id, token: "0".repeat(64) },
      });
      assert.ok([200, 400].includes(cleanup.statusCode), cleanup.body);
      assert.equal(
        await readFile(path, "utf8"),
        `  native Goal ${version} 😀\r\n`,
      );
    }
    const id = "12345678-1234-4234-8234-123456789abc";
    const unrelated = join(
      f.home,
      "unrelated-codex",
      "attachments",
      id,
      "goal-objective.md",
    );
    await mkdir(dirname(unrelated), { recursive: true });
    await writeFile(unrelated, "must not read another Codex home");
    for (const path of [
      unrelated,
      join(nativeHome, "attachments", id, "auth.json"),
      `${nativeHome}/attachments/${id}/../${id}/goal-objective.md`,
      join(
        nativeHome,
        "attachments",
        "12345678-1234-0234-8234-123456789abc",
        "goal-objective.md",
      ),
      join(
        nativeHome,
        "attachments",
        "12345678-1234-9234-8234-123456789abc",
        "goal-objective.md",
      ),
      join(
        nativeHome,
        "attachments",
        "12345678-1234-4234-c234-123456789abc",
        "goal-objective.md",
      ),
    ]) {
      const objective = `${prefix}${path}${suffix}`;
      const response = await app.inject({
        method: "POST",
        url: readUrl,
        payload: { objective, codexHome: dirname(dirname(dirname(unrelated))) },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { objective });
      assert.equal(
        response.body.includes("must not read another Codex home"),
        false,
      );
    }
  } finally {
    await app.close();
    await f.close();
  }
});

test("native Goal reads reject symlinks at the Codex home, attachments directory, UUID directory and objective file", async () => {
  const f = await fixture();
  const nativeHome = join(f.home, "native-codex");
  const id = "12345678-1234-4234-8234-123456789abc";
  const path = join(nativeHome, "attachments", id, "goal-objective.md");
  const outside = join(f.home, "outside");
  await mkdir(outside);
  await writeFile(
    join(outside, "goal-objective.md"),
    "private outside contents",
  );
  const app = Fastify();
  registerSessionGoalAttachmentRoutes(app, {
    attachmentRoot: f.attachmentRoot,
    codexHome: nativeHome,
  });
  const read = async () => {
    const response = await app.inject({
      method: "POST",
      url: readUrl,
      payload: { objective: `${prefix}${path}${suffix}` },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.body.includes("private outside contents"), false);
  };
  try {
    await mkdir(dirname(path), { recursive: true });
    await symlink(join(outside, "goal-objective.md"), path);
    await read();
    await rm(dirname(path), { recursive: true });
    await symlink(outside, dirname(path));
    await read();
    await rm(join(nativeHome, "attachments"), { recursive: true });
    await mkdir(join(outside, id));
    await writeFile(
      join(outside, id, "goal-objective.md"),
      "private outside contents",
    );
    await symlink(outside, join(nativeHome, "attachments"));
    await read();
    await rm(nativeHome, { recursive: true });
    await mkdir(join(outside, "attachments", id), { recursive: true });
    await writeFile(
      join(outside, "attachments", id, "goal-objective.md"),
      "private outside contents",
    );
    await symlink(outside, nativeHome);
    await read();
  } finally {
    await app.close();
    await f.close();
  }
});

test("native Goal reads capture server CODEX_HOME configuration and reject ancestor symlink aliases", async () => {
  const f = await fixture();
  const nativeHome = join(f.home, "configured-by-environment");
  const id = "12345678-1234-4234-8234-123456789abc";
  const path = join(nativeHome, "attachments", id, "goal-objective.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "configured native objective");
  const app = Fastify();
  const previous = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = nativeHome;
    registerSessionGoalAttachmentRoutes(app, {
      attachmentRoot: f.attachmentRoot,
    });
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
  let aliasApp: ReturnType<typeof Fastify> | undefined;
  try {
    const response = await app.inject({
      method: "POST",
      url: readUrl,
      payload: { objective: `${prefix}${path}${suffix}`, codexHome: f.home },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      objective: "configured native objective",
    });
    const realParent = join(f.home, "real-parent");
    const aliasParent = join(f.home, "alias-parent");
    const aliasNativeHome = join(aliasParent, "nested-codex");
    const realPath = join(
      realParent,
      "nested-codex",
      "attachments",
      id,
      "goal-objective.md",
    );
    await mkdir(dirname(realPath), { recursive: true });
    await writeFile(realPath, "must not read through ancestor alias");
    await symlink(realParent, aliasParent);
    aliasApp = Fastify();
    registerSessionGoalAttachmentRoutes(aliasApp, {
      attachmentRoot: f.attachmentRoot,
      codexHome: aliasNativeHome,
    });
    const denied = await aliasApp.inject({
      method: "POST",
      url: readUrl,
      payload: {
        objective: `${prefix}${join(aliasNativeHome, "attachments", id, "goal-objective.md")}${suffix}`,
      },
    });
    assert.equal(denied.statusCode, 400, denied.body);
    assert.equal(
      denied.body.includes("must not read through ancestor alias"),
      false,
    );
  } finally {
    await aliasApp?.close();
    await app.close();
    await f.close();
  }
});

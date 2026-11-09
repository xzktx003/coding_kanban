import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  statfs,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const MAX_SOURCE_BYTES = 256 * 1024;
const TMPFS_MAGIC = 0x01021994n;
const failure = (code) =>
  Object.assign(new Error("Desktop account snapshot unavailable"), { code });
const pathOK = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  value.length <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const same = (a, b) =>
  ["dev", "ino", "uid", "gid", "mode", "size", "mtimeNs", "ctimeNs"].every(
    (key) => a[key] === b[key],
  );
const sameDirectory = (a, b) =>
  ["dev", "ino", "uid", "gid", "mode"].every((key) => a[key] === b[key]);
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const token = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 65536 &&
  !/[\x00-\x20\x7f]/.test(value);

async function privateDirectory(path, uid, code) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const info = await handle.stat({ bigint: true });
    if (
      !info.isDirectory() ||
      info.uid !== uid ||
      (info.mode & 0o7777n) !== 0o700n ||
      (await realpath(path)) !== path ||
      !sameDirectory(info, await lstat(path, { bigint: true }))
    )
      throw failure(code);
    return { handle, info };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Explicitly authorized ChatGPT access-token copy. The original source is
 * opened read-only; refresh credentials are never copied or used. The native
 * process may update its own tmpfs copy, whose persistence is not guaranteed.
 */
export async function seedDesktopAccountSnapshot(options) {
  if (
    !record(options) ||
    Object.keys(options).sort().join(",") !== "homeRoot,sourceFile" ||
    !pathOK(options.sourceFile) ||
    !pathOK(options.homeRoot) ||
    process.platform !== "linux" ||
    !process.getuid
  )
    throw failure("ACCOUNT_SNAPSHOT_INVALID_CONFIG");
  const { sourceFile, homeRoot } = options,
    uid = BigInt(process.getuid());
  let home, sourceParent, source, target, buffer;
  try {
    home = await privateDirectory(
      homeRoot,
      uid,
      "ACCOUNT_SNAPSHOT_UNSAFE_HOME",
    );
    const homeFdPath = `/proc/self/fd/${home.handle.fd}`;
    if (
      (await statfs(homeFdPath, { bigint: true })).type !== TMPFS_MAGIC ||
      (await readdir(homeFdPath)).length
    )
      throw failure("ACCOUNT_SNAPSHOT_UNSAFE_HOME");
    sourceParent = await privateDirectory(
      dirname(sourceFile),
      uid,
      "ACCOUNT_SNAPSHOT_UNSAFE_SOURCE",
    );
    const sourceFdPath = `/proc/self/fd/${sourceParent.handle.fd}/${basename(sourceFile)}`;
    source = await open(
      sourceFdPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const before = await source.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.uid !== uid ||
      (before.mode & 0o7777n) !== 0o600n ||
      before.size > BigInt(MAX_SOURCE_BYTES) ||
      (await realpath(sourceFile)) !== sourceFile ||
      !same(before, await lstat(sourceFile, { bigint: true }))
    )
      throw failure("ACCOUNT_SNAPSHOT_UNSAFE_SOURCE");
    // readFile could allocate beyond a changing file's stat size. Read through
    // this fixed buffer, including one overflow byte, instead.
    buffer = Buffer.alloc(MAX_SOURCE_BYTES + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await source.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
      if (length > MAX_SOURCE_BYTES)
        throw failure("ACCOUNT_SNAPSHOT_INVALID_SOURCE");
    }
    if (
      !same(before, await source.stat({ bigint: true })) ||
      !same(before, await lstat(sourceFile, { bigint: true })) ||
      !sameDirectory(
        sourceParent.info,
        await lstat(dirname(sourceFile), { bigint: true }),
      )
    )
      throw failure("ACCOUNT_SNAPSHOT_SOURCE_CHANGED");
    let auth;
    try {
      auth = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length),
        ),
      );
    } catch {
      throw failure("ACCOUNT_SNAPSHOT_INVALID_SOURCE");
    }
    if (
      !record(auth) ||
      auth.auth_mode !== "chatgpt" ||
      !record(auth.tokens) ||
      !token(auth.tokens.id_token) ||
      !token(auth.tokens.access_token) ||
      (auth.tokens.account_id !== undefined &&
        auth.tokens.account_id !== null &&
        (!token(auth.tokens.account_id) ||
          auth.tokens.account_id.length > 256)) ||
      (auth.last_refresh !== undefined &&
        (typeof auth.last_refresh !== "string" ||
          auth.last_refresh.length > 64 ||
          !Number.isFinite(Date.parse(auth.last_refresh))))
    )
      throw failure("ACCOUNT_SNAPSHOT_INVALID_SOURCE");
    const snapshot = {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: auth.tokens.id_token,
        access_token: auth.tokens.access_token,
        refresh_token: "",
      },
    };
    if (auth.tokens.account_id != null)
      snapshot.tokens.account_id = auth.tokens.account_id;
    if (auth.last_refresh !== undefined)
      snapshot.last_refresh = auth.last_refresh;
    if (
      !sameDirectory(home.info, await lstat(homeRoot, { bigint: true })) ||
      (await realpath(homeRoot)) !== homeRoot ||
      (await readdir(homeFdPath)).length
    )
      throw failure("ACCOUNT_SNAPSHOT_UNSAFE_HOME");
    const codexPath = join(homeFdPath, ".codex");
    await mkdir(codexPath, { mode: 0o700 });
    target = await open(
      join(codexPath, "auth.json"),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await target.writeFile(JSON.stringify(snapshot) + "\n");
    await target.sync();
    if (
      !sameDirectory(home.info, await lstat(homeRoot, { bigint: true })) ||
      (await realpath(homeRoot)) !== homeRoot
    )
      throw failure("ACCOUNT_SNAPSHOT_UNSAFE_HOME");
    return Object.freeze({
      kind: "chatgpt-access-snapshot",
      refreshEnabled: false,
    });
  } catch (error) {
    throw failure(
      typeof error?.code === "string" &&
        /^ACCOUNT_SNAPSHOT_[A-Z_]+$/.test(error.code)
        ? error.code
        : "ACCOUNT_SNAPSHOT_UNAVAILABLE",
    );
  } finally {
    buffer?.fill(0);
    await Promise.allSettled([
      target?.close(),
      source?.close(),
      sourceParent?.handle.close(),
      home?.handle.close(),
    ]);
  }
}

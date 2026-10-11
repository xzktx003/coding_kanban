import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  copyFile,
  readdir,
  lstat,
  mkdir,
  readFile,
  readlink,
  open,
  realpath,
  rm,
  symlink,
  chmod,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { FastifyInstance } from "fastify";
import { bodyObject, HttpError, type JsonObject } from "../core/json.js";

export interface GitOptions {
  dataHome: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}
interface GitOutput {
  stdout: Buffer;
  stderr: string;
  code: number;
}
interface StatusEntry {
  path: string;
  index_status: string;
  worktree_status: string;
}
const EMPTY = Buffer.alloc(0);
function text(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.length > 1024 * 1024
  )
    throw new HttpError(400, `Invalid ${name}`);
  return value;
}
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}
async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function binary(value: Buffer) {
  return value.subarray(0, 8000).includes(0);
}

/** Git plumbing runs in a bounded child process with literal paths and no shell. */
export class GitService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly env: NodeJS.ProcessEnv;
  constructor(readonly options: GitOptions) {
    if (!isAbsolute(options.dataHome) || options.dataHome.includes("\0"))
      throw new Error("dataHome must be absolute");
    this.env = {
      ...(options.env ?? process.env),
      GIT_TERMINAL_PROMPT: "0",
      GIT_LITERAL_PATHSPECS: "1",
    };
    // A parent CLI may set these for its own checkout; never inherit repository overrides.
    for (const key of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
      "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_CONFIG_COUNT",
    ])
      delete this.env[key];
  }
  private async run(
    cwd: string,
    args: string[],
    input?: Buffer | string,
    prefixOnly = false,
  ): Promise<GitOutput> {
    return new Promise((resolveOutput, reject) => {
      const child = spawn(
        "git",
        ["--no-pager", "-c", "core.quotePath=false", ...args],
        { cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"], shell: false },
      );
      const out: Buffer[] = [],
        err: Buffer[] = [];
      let bytes = 0,
        failed = false;
      const fail = (error: Error) => {
        if (failed) return;
        failed = true;
        child.kill("SIGKILL");
        reject(error);
      };
      const timer = setTimeout(
        () =>
          fail(new Error("Git operation timed out; outcome may be unknown")),
        this.options.timeoutMs ?? 120000,
      );
      timer.unref();
      const collect = (chunks: Buffer[], data: Buffer) => {
        bytes += data.length;
        if (bytes > (this.options.maxOutputBytes ?? 32 * 1024 * 1024))
          fail(new Error("Git output exceeds limit"));
        else chunks.push(data);
      };
      let prefixBytes = 0;
      child.stdout.on("data", (data: Buffer) => {
        if (!prefixOnly) collect(out, data);
        else if (prefixBytes < 8000) {
          const prefix = data.subarray(0, 8000 - prefixBytes);
          out.push(prefix);
          prefixBytes += prefix.length;
        }
      });
      child.stderr.on("data", (data) => collect(err, data));
      child.on("error", (error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.stdin.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code !== "EPIPE") fail(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (!failed)
          resolveOutput({
            stdout: Buffer.concat(out),
            stderr: Buffer.concat(err).toString(),
            code: code ?? -1,
          });
      });
      child.stdin.end(input);
    });
  }
  private async git(cwd: string, args: string[], input?: Buffer | string) {
    const result = await this.run(cwd, args, input);
    if (result.code !== 0)
      throw new Error(
        `git ${args[0]} failed: ${result.stderr.trim() || `exit ${result.code}`}`,
      );
    return result;
  }
  private async root(cwd: string) {
    text(cwd, "cwd");
    if (!isAbsolute(cwd))
      throw new HttpError(400, "cwd must be an absolute path");
    return realpath(
      (await this.git(cwd, ["rev-parse", "--show-toplevel"])).stdout
        .toString()
        .trimEnd(),
    );
  }
  private async serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.locks.set(key, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }
  private async path(root: string, input: string) {
    text(input, "file path");
    const absolute = resolve(root, input);
    const rel = relative(root, absolute);
    if (
      !rel ||
      !inside(root, absolute) ||
      rel.split(sep).some((p) => p.toLowerCase() === ".git")
    )
      throw new HttpError(400, "Path is outside repository files");
    let parent = dirname(absolute);
    while (inside(root, parent)) {
      if (await stat(parent)) {
        if (!inside(root, await realpath(parent)))
          throw new HttpError(400, "Path escapes repository through symlink");
        break;
      }
      parent = dirname(parent);
    }
    return rel.split(sep).join("/");
  }
  private async paths(root: string, files: string[]) {
    if (!Array.isArray(files) || files.length > 10000)
      throw new HttpError(400, "Invalid filePaths");
    return Promise.all(files.map((file) => this.path(root, file)));
  }
  private async head(root: string): Promise<string | undefined> {
    const result = await this.run(root, ["rev-parse", "--verify", "HEAD"]);
    if (result.code === 0) return result.stdout.toString().trim();
    // A missing HEAD is valid only for an unborn symbolic branch, not arbitrary corruption.
    const symbolic = await this.run(root, ["symbolic-ref", "-q", "HEAD"]);
    if (
      symbolic.code === 0 &&
      (
        await this.run(root, [
          "show-ref",
          "--verify",
          "--quiet",
          symbolic.stdout.toString().trim(),
        ])
      ).code === 1
    )
      return undefined;
    throw new Error(`Failed to resolve HEAD: ${result.stderr.trim()}`);
  }
  async status(
    cwd: string,
  ): Promise<{ repo_root: string; entries: StatusEntry[] }> {
    const root = await this.root(cwd);
    const tokens = (
      await this.git(root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--renames",
      ])
    ).stdout
      .toString()
      .split("\0");
    const entries: StatusEntry[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token) continue;
      entries.push({
        path: token.slice(3),
        index_status: token[0]!,
        worktree_status: token[1]!,
      });
      if (
        token[0] === "R" ||
        token[0] === "C" ||
        token[1] === "R" ||
        token[1] === "C"
      )
        i++;
    }
    entries.sort((a, b) =>
      Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
    );
    return { repo_root: root, entries };
  }
  private async blobId(root: string, path: string, head: boolean) {
    let record: string | undefined;
    if (head) {
      if (!(await this.head(root))) return undefined;
      record = (
        await this.git(root, ["ls-tree", "-z", "HEAD", "--", path])
      ).stdout
        .toString()
        .split("\0")
        .find((item) => item.slice(item.indexOf("\t") + 1) === path);
    } else {
      record = (
        await this.git(root, ["ls-files", "--stage", "-z", "--", path])
      ).stdout
        .toString()
        .split("\0")
        .find(
          (item) =>
            item.slice(item.indexOf("\t") + 1) === path &&
            item.slice(0, item.indexOf("\t")).endsWith(" 0"),
        );
    }
    if (!record) return undefined;
    const fields = record.slice(0, record.indexOf("\t")).split(" ");
    if (fields[0] === "160000" || fields[0] === "040000") return undefined;
    const oid = fields[head ? 2 : 1]!;
    if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error("Invalid git object");
    return oid;
  }
  private async blob(root: string, path: string, head: boolean) {
    const oid = await this.blobId(root, path, head);
    return oid
      ? (await this.git(root, ["cat-file", "blob", oid])).stdout
      : EMPTY;
  }
  private async working(root: string, path: string) {
    const absolute = join(root, path),
      info = await stat(absolute);
    if (!info) return EMPTY;
    if (info.isSymbolicLink()) return Buffer.from(await readlink(absolute));
    if (!info.isFile()) return EMPTY;
    if (info.size > (this.options.maxOutputBytes ?? 32 * 1024 * 1024))
      throw new HttpError(413, "File exceeds diff size limit");
    return readFile(absolute);
  }
  private async pair(cwd: string, file: string, staged: boolean) {
    const root = await this.root(cwd),
      path = await this.path(root, file);
    return Promise.all(
      staged
        ? [this.blob(root, path, true), this.blob(root, path, false)]
        : [this.blob(root, path, false), this.working(root, path)],
    );
  }
  async blameLine(cwd: string, file: string, line: number) {
    if (!Number.isSafeInteger(line) || line < 1)
      throw new HttpError(400, "Invalid line");
    const root = await this.root(cwd);
    const path = await this.path(root, file);
    const result = await this.run(root, [
      "blame",
      "-L",
      `${line},${line}`,
      "--porcelain",
      "HEAD",
      "--",
      path,
    ]);
    if (result.code !== 0) {
      const detail = result.stderr.trim();
      if (/no such path|fatal: no such/i.test(detail))
        return { present: false };
      throw new Error(`git blame failed: ${detail || `exit ${result.code}`}`);
    }
    const textOut = result.stdout.toString("utf8");
    const hash = textOut.slice(0, textOut.indexOf(" "));
    const value = (name: string) => {
      const prefix = `${name} `;
      const row = textOut
        .split("\n")
        .find((item) => item.startsWith(prefix));
      return row ? row.slice(prefix.length) : "";
    };
    const authorTime = Number(value("author-time"));
    const date = Number.isFinite(authorTime)
      ? new Date(authorTime * 1000).toISOString().slice(0, 10)
      : "";
    return {
      present: true,
      hash,
      shortHash: hash.slice(0, 7),
      author: value("author"),
      date,
      summary: value("summary"),
    };
  }
  async fileDiff(cwd: string, file: string, staged: boolean) {
    const [old, fresh] = (await this.pair(cwd, file, staged)) as [
      Buffer,
      Buffer,
    ];
    const is_binary = binary(old) || binary(fresh);
    return {
      old_content: is_binary ? "" : old.toString(),
      new_content: is_binary ? "" : fresh.toString(),
      has_changes: is_binary || !old.equals(fresh),
      is_binary,
    };
  }
  async fileDiffMeta(cwd: string, file: string, staged: boolean) {
    const root = await this.root(cwd),
      path = await this.path(root, file);
    const blobMeta = async (head: boolean) => {
      const oid = await this.blobId(root, path, head);
      if (!oid) return { size: 0, binary: false };
      const size = Number(
        (await this.git(root, ["cat-file", "-s", oid])).stdout
          .toString()
          .trim(),
      );
      const prefix = await this.run(
        root,
        ["cat-file", "blob", oid],
        undefined,
        true,
      );
      if (prefix.code)
        throw new Error(`Failed to inspect blob: ${prefix.stderr}`);
      return { size, binary: binary(prefix.stdout) };
    };
    const workingMeta = async () => {
      const absolute = join(root, path),
        info = await stat(absolute);
      if (!info) return { size: 0, binary: false };
      if (info.isSymbolicLink())
        return {
          size: Buffer.byteLength(await readlink(absolute)),
          binary: false,
        };
      if (!info.isFile()) return { size: 0, binary: false };
      const handle = await open(absolute, "r");
      try {
        const prefix = Buffer.alloc(8000);
        const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
        return {
          size: info.size,
          binary: binary(prefix.subarray(0, bytesRead)),
        };
      } finally {
        await handle.close();
      }
    };
    const [old, fresh] = await Promise.all(
      staged
        ? [blobMeta(true), blobMeta(false)]
        : [blobMeta(false), workingMeta()],
    );
    return {
      old_bytes: old!.size,
      new_bytes: fresh!.size,
      total_bytes: old!.size + fresh!.size,
      is_binary: old!.binary || fresh!.binary,
    };
  }
  async diffStats(cwd: string) {
    const root = await this.root(cwd);
    const count = async (staged: boolean) => {
      const tokens = (
        await this.git(root, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--diff-algorithm=myers",
          "--numstat",
          "-z",
          ...(staged ? ["--cached"] : []),
        ])
      ).stdout
        .toString()
        .split("\0");
      const counts = { additions: 0, deletions: 0 };
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (!token) continue;
        const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(token);
        if (!match) throw new Error("Invalid git numstat");
        counts.additions += Number(match[1]) || 0;
        counts.deletions += Number(match[2]) || 0;
        if (!match[3]) i += 2;
      }
      return counts;
    };
    return { staged: await count(true), unstaged: await count(false) };
  }
  /** Per-file additions and deletions across the index and the working tree. */
  async fileNumstat(cwd: string) {
    const root = await this.root(cwd);
    const totals = new Map<string, { additions: number; deletions: number }>();
    const collect = async (staged: boolean) => {
      const tokens = (
        await this.git(root, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--diff-algorithm=myers",
          "--numstat",
          "-z",
          ...(staged ? ["--cached"] : []),
        ])
      ).stdout
        .toString()
        .split("\0");
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (!token) continue;
        const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(token);
        if (!match) throw new Error("Invalid git numstat");
        let path = match[3];
        if (!path) path = tokens[(i += 2)] || tokens[i - 1] || "";
        if (!path) continue;
        const current = totals.get(path) ?? { additions: 0, deletions: 0 };
        current.additions += Number(match[1]) || 0;
        current.deletions += Number(match[2]) || 0;
        totals.set(path, current);
      }
    };
    await collect(true);
    await collect(false);
    return [...totals.entries()]
      .map(([path, counts]) => ({ path, ...counts }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  async stageFiles(cwd: string, files: string[]) {
    const root = await this.root(cwd);
    return this.serial(root, async () => {
      const paths = await this.paths(root, files);
      if (paths.length) await this.git(root, ["add", "--all", "--", ...paths]);
    });
  }
  async unstageFiles(cwd: string, files: string[]) {
    const root = await this.root(cwd);
    return this.serial(root, async () => {
      const paths = await this.paths(root, files);
      if (!paths.length) return;
      if (await this.head(root))
        await this.git(root, ["reset", "-q", "HEAD", "--", ...paths]);
      else
        await this.git(root, [
          "rm",
          "--cached",
          "-f",
          "-r",
          "--ignore-unmatch",
          "--",
          ...paths,
        ]);
    });
  }
  async reverseFiles(cwd: string, files: string[], staged: boolean) {
    if (staged) return this.unstageFiles(cwd, files);
    const root = await this.root(cwd);
    return this.serial(root, async () => {
      const paths = await this.paths(root, files);
      const tracked: string[] = [],
        untracked: string[] = [];
      for (const path of paths) {
        const records = (
          await this.git(root, ["ls-files", "--stage", "-z", "--", path])
        ).stdout
          .toString()
          .split("\0")
          .filter(Boolean);
        if (
          records.some(
            (line) => !line.slice(0, line.indexOf("\t")).endsWith(" 0"),
          )
        )
          throw new Error("Cannot reverse an unresolved conflict");
        if (records.length) tracked.push(path);
        else untracked.push(path);
      }
      if (tracked.length)
        await this.git(root, ["restore", "--worktree", "--", ...tracked]);
      for (const path of untracked)
        await rm(join(root, path), { recursive: true, force: true });
    });
  }
  private async branch(root: string, branch: string) {
    text(branch, "branch");
    if (branch.startsWith("-") || branch.includes("@{"))
      throw new HttpError(400, "Invalid branch");
    if (
      (await this.run(root, ["check-ref-format", `refs/heads/${branch}`])).code
    )
      throw new HttpError(400, "Invalid branch");
    return branch;
  }
  async listBranches(cwd: string) {
    const root = await this.root(cwd);
    const current = await this.run(root, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
    return {
      current: current.code === 0 ? current.stdout.toString().trim() : "",
      branches: (
        await this.git(root, [
          "for-each-ref",
          "--format=%(refname:short)",
          "refs/heads/",
        ])
      ).stdout
        .toString()
        .split("\n")
        .filter(Boolean)
        .sort(),
    };
  }
  async branchInfo(cwd: string) {
    const root = await this.root(cwd);
    const { current } = await this.listBranches(root);
    const branch = current || (await this.head(root))?.slice(0, 7) || "HEAD";
    const remote = await this.run(root, [
      "config",
      "--get",
      "remote.origin.url",
    ]);
    let owner = "",
      repo = basename(root);
    if (remote.code === 0) {
      const url = remote.stdout.toString().trim();
      const parts = (url.includes("://") ? url : url.replace(":", "/"))
        .split("/")
        .filter(Boolean);
      if (parts.length >= 2) {
        owner = parts.at(-2)!;
        repo = parts.at(-1)!.replace(/\.git$/, "");
      }
    }
    return { owner, repo, branch };
  }
  async createBranch(cwd: string, name: string) {
    const root = await this.root(cwd);
    return this.serial(root, async () => {
      await this.branch(root, name);
      await this.git(root, ["checkout", "-b", name]);
    });
  }
  async checkoutBranch(cwd: string, name: string) {
    const root = await this.root(cwd);
    return this.serial(root, async () => {
      await this.branch(root, name);
      await this.git(root, ["show-ref", "--verify", `refs/heads/${name}`]);
      await this.git(root, ["checkout", name, "--"]);
    });
  }
  async commit(cwd: string, message: string) {
    text(message, "message");
    const root = await this.root(cwd);
    return this.serial(root, async () => {
      const tree = (await this.git(root, ["write-tree"])).stdout
        .toString()
        .trim();
      const head = await this.head(root);
      const oid = (
        await this.git(
          root,
          ["commit-tree", tree, ...(head ? ["-p", head] : []), "-F", "-"],
          message,
        )
      ).stdout
        .toString()
        .trim();
      await this.git(root, [
        "update-ref",
        "-m",
        `commit: ${message.split("\n")[0]}`,
        "HEAD",
        oid,
        head ?? "0".repeat(oid.length),
      ]);
      return oid;
    });
  }
  async push(cwd: string, remote?: string, branch?: string) {
    const root = await this.root(cwd);
    const current = (await this.listBranches(root)).current;
    if (remote === undefined) {
      const configured = await this.run(root, [
        "config",
        "--get",
        `branch.${current}.pushRemote`,
      ]);
      const pushDefault = await this.run(root, [
        "config",
        "--get",
        "remote.pushDefault",
      ]);
      const upstream = await this.run(root, [
        "config",
        "--get",
        `branch.${current}.remote`,
      ]);
      remote =
        [configured, pushDefault, upstream]
          .find((r) => r.code === 0)
          ?.stdout.toString()
          .trim() || "origin";
    }
    text(remote, "remote");
    if (remote.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(remote))
      throw new HttpError(400, "Invalid remote name");
    const remotes = (await this.git(root, ["remote"])).stdout
      .toString()
      .split("\n");
    if (!remotes.includes(remote))
      throw new HttpError(400, "Remote is not configured");
    branch ??= current || "HEAD";
    if (branch !== "HEAD") await this.branch(root, branch);
    // Git validates configured transport URLs. Disable arbitrary external helper protocols.
    return this.serial(root, async () => {
      const result = await this.git(root, [
        "-c",
        "protocol.ext.allow=never",
        "push",
        "--",
        remote!,
        branch!,
      ]);
      return result.stdout.toString() || result.stderr;
    });
  }
  /** Read-only startup inventory. Clean status does not prove that an Agent released ownership. */
  async scanWorktrees(): Promise<
    Array<{
      path: string;
      state: "clean" | "dirty" | "unknown";
      error?: string;
    }>
  > {
    const base = join(this.options.dataHome, ".codexia", "worktrees");
    const inventory: Array<{
      path: string;
      state: "clean" | "dirty" | "unknown";
      error?: string;
    }> = [];
    if (!(await stat(base))) return inventory;
    if ((await lstat(base)).isSymbolicLink())
      return [
        { path: base, state: "unknown", error: "Worktree root is a symlink" },
      ];
    for (const repo of await readdir(base, { withFileTypes: true })) {
      const bucket = join(base, repo.name);
      if (!repo.isDirectory() || repo.isSymbolicLink()) {
        inventory.push({ path: bucket, state: "unknown" });
        continue;
      }
      for (const entry of await readdir(bucket, { withFileTypes: true })) {
        const path = join(bucket, entry.name);
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          !(await stat(join(path, ".git")))?.isFile()
        ) {
          inventory.push({ path, state: "unknown" });
          continue;
        }
        try {
          if (
            (await this.root(path)) !== path ||
            !(await this.registered(path, path))
          ) {
            inventory.push({ path, state: "unknown" });
            continue;
          }
          inventory.push({
            path,
            state: (await this.status(path)).entries.length ? "dirty" : "clean",
          });
        } catch (error) {
          inventory.push({
            path,
            state: "unknown",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return inventory;
  }
  /** Explicit clone helper for trusted local workflows; failure never deletes an existing destination. */
  async cloneRepository(url: string, destination: string): Promise<string> {
    text(url, "repository URL");
    text(destination, "destination");
    if (!isAbsolute(destination) || destination === dirname(destination))
      throw new HttpError(400, "Invalid clone destination");
    if (!isAbsolute(url)) {
      const ssh = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(url);
      if (!ssh) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new HttpError(400, "Invalid repository URL");
        }
        if (
          !["https:", "http:", "ssh:", "git:", "file:"].includes(
            parsed.protocol,
          ) ||
          (parsed.protocol !== "file:" && !parsed.hostname) ||
          parsed.password
        )
          throw new HttpError(400, "Invalid repository transport URL");
      }
    }
    return this.serial(destination, async () => {
      const info = await stat(destination);
      if (info) {
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("Clone destination is not a regular directory");
        if (await stat(join(destination, ".git"))) {
          if ((await this.root(destination)) !== (await realpath(destination)))
            throw new Error("Invalid cloned repository");
          return destination;
        }
        if ((await readdir(destination)).length)
          throw new Error("Clone destination is not empty");
      }
      await mkdir(dirname(destination), { recursive: true });
      await this.git(dirname(destination), [
        "-c",
        "protocol.ext.allow=never",
        "clone",
        "--",
        url,
        destination,
      ]);
      if ((await this.root(destination)) !== (await realpath(destination)))
        throw new Error("Clone completed without a valid repository");
      return destination;
    });
  }

  private async location(cwd: string, key: string) {
    const root = await this.root(cwd);
    text(key, "worktreeKey");
    const safe =
      key.replace(/[^A-Za-z0-9_-]/gu, "-").replace(/^-+|-+$/g, "") ||
      "worktree";
    if (safe.length > 200) throw new HttpError(400, "worktreeKey is too long");
    let hash = 0;
    for (const byte of Buffer.from(root))
      hash = (Math.imul(hash, 31) + byte) >>> 0;
    const base = join(this.options.dataHome, ".codexia", "worktrees");
    const path = join(
      base,
      `${basename(root)}-${(hash & 0xffffff).toString(16).padStart(6, "0")}`,
      safe,
    );
    // Reject redirected application worktree parents, including existing malicious symlinks.
    let parent = dirname(path);
    while (inside(this.options.dataHome, parent)) {
      if ((await stat(parent))?.isSymbolicLink())
        throw new HttpError(400, "Worktree directory cannot be a symlink");
      if (parent === this.options.dataHome) break;
      parent = dirname(parent);
    }
    return { root, path };
  }
  private async registered(root: string, path: string) {
    const tokens = (
      await this.git(root, ["worktree", "list", "--porcelain", "-z"])
    ).stdout
      .toString()
      .split("\0");
    return tokens.some((token) => token === `worktree ${path}`);
  }
  private async validWorktree(root: string, path: string) {
    if (!(await this.registered(root, path)) || !(await stat(path)))
      return false;
    if ((await lstat(path)).isSymbolicLink())
      throw new HttpError(400, "Worktree cannot be a symlink");
    const common = async (cwd: string) =>
      realpath(
        resolve(
          cwd,
          (await this.git(cwd, ["rev-parse", "--git-common-dir"])).stdout
            .toString()
            .trimEnd(),
        ),
      );
    if (
      (await this.root(path)) !== path ||
      (await common(path)) !== (await common(root))
    )
      throw new Error("Worktree metadata belongs to another repository");
    return true;
  }
  async createWorktree(cwd: string, key: string) {
    const { root, path } = await this.location(cwd, key);
    return this.serial(root, async () => {
      const result = {
        repo_root: root,
        worktree_path: path,
        existed: false,
        copied_env_files: [] as string[],
      };
      if (await this.validWorktree(root, path))
        return { ...result, existed: true };
      if (await stat(path))
        throw new Error("Refusing to replace an unmanaged worktree directory");
      if (await this.registered(root, path))
        await this.git(root, ["worktree", "remove", "--force", "--", path]);
      await mkdir(dirname(path), { recursive: true });
      await this.git(root, ["worktree", "add", "--detach", "--", path]);
      if (!(await this.validWorktree(root, path)))
        throw new Error("Created worktree could not be verified");
      for (const name of [
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
        ".env.test",
        ".env.test.local",
        ".env.production",
        ".env.production.local",
      ]) {
        const source = join(root, name);
        const info = await stat(source);
        if (
          !info?.isFile() ||
          info.isSymbolicLink() ||
          (await stat(join(path, name)))
        )
          continue;
        await copyFile(source, join(path, name), constants.COPYFILE_EXCL);
        result.copied_env_files.push(name);
      }
      return result;
    });
  }
  async removeWorktree(cwd: string, key: string) {
    const { root, path } = await this.location(cwd, key);
    return this.serial(root, async () => {
      const registered = await this.registered(root, path);
      if (!registered) {
        if (await stat(path))
          throw new Error(
            "Refusing to remove an unregistered worktree directory",
          );
        return;
      }
      if (await stat(path)) await this.validWorktree(root, path);
      await this.git(root, ["worktree", "remove", "--force", "--", path]);
      if ((await stat(path)) || (await this.registered(root, path)))
        throw new Error("Worktree removal did not complete");
    });
  }
  private async changes(root: string, path: string) {
    const base = await this.head(root);
    if (!base) throw new Error("Repository has no HEAD");
    // Compare base with actual working tree, excluding rename folding so both old and new names survive.
    const tracked = (
      await this.git(path, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--name-only",
        "--no-renames",
        "-z",
        base,
        "--",
      ])
    ).stdout
      .toString()
      .split("\0")
      .filter(Boolean);
    const untracked = (
      await this.git(path, ["ls-files", "--others", "--exclude-standard", "-z"])
    ).stdout
      .toString()
      .split("\0")
      .filter(Boolean);
    if ((await this.git(path, ["ls-files", "--unmerged", "-z"])).stdout.length)
      throw new Error("Worktree has unresolved conflicts");
    return [...new Set([...tracked, ...untracked])].sort();
  }
  async hasWorktreeChanges(cwd: string, key: string) {
    const { root, path } = await this.location(cwd, key);
    return this.serial(root, async () => ({
      has_changes:
        (await this.validWorktree(root, path)) &&
        (await this.changes(root, path)).length > 0,
    }));
  }
  async applyWorktreeChanges(cwd: string, key: string) {
    const { root, path } = await this.location(cwd, key);
    return this.serial(root, async () => {
      if (root === path) throw new Error("Cannot apply worktree onto itself");
      if (!(await this.validWorktree(root, path)))
        throw new Error("Worktree is not available");
      const files = await this.changes(root, path);
      if (!files.length) throw new Error("No worktree changes to apply");
      // Validate every source/target before the first write. Symlinks are copied as links, never followed.
      const changes = await Promise.all(
        files.map(async (file) => {
          await this.path(root, file);
          await this.path(path, file);
          const src = join(path, file),
            dst = join(root, file),
            info = await stat(src),
            target = await stat(dst);
          if (info && !info.isFile() && !info.isSymbolicLink())
            throw new Error(`Unsupported worktree file: ${file}`);
          if (target?.isDirectory())
            throw new Error(`Destination is a directory: ${file}`);
          return { src, dst, info };
        }),
      );
      for (const { src, dst, info } of changes) {
        if (!info) {
          await rm(dst, { force: true });
          continue;
        }
        await mkdir(dirname(dst), { recursive: true });
        // Unlink first prevents following a target symlink outside the checkout.
        await rm(dst, { force: true });
        if (info.isSymbolicLink()) await symlink(await readlink(src), dst);
        else {
          await copyFile(src, dst);
          await chmod(dst, info.mode & 0o777);
        }
      }
      return { changed_files: files.length };
    });
  }
}

export function registerGitRoutes(
  app: FastifyInstance,
  options: GitOptions | GitService,
): GitService {
  const service =
    options instanceof GitService ? options : new GitService(options);
  const field = (body: JsonObject, key: string, alias?: string) =>
    text(body[key] ?? (alias ? body[alias] : undefined), key);
  const paths = (body: JsonObject) => {
    const value = body.filePaths ?? body.file_paths;
    if (!Array.isArray(value) || !value.every((p) => typeof p === "string"))
      throw new HttpError(400, "Invalid filePaths");
    return value as string[];
  };
  const staged = (body: JsonObject) => {
    if (typeof body.staged !== "boolean")
      throw new HttpError(400, "Invalid staged");
    return body.staged;
  };
  const optional = (body: JsonObject, key: string) =>
    body[key] === undefined || body[key] === null
      ? undefined
      : field(body, key);
  const routes: Record<
    string,
    (body: JsonObject, cwd: string) => Promise<unknown>
  > = {
    status: (_, cwd) => service.status(cwd),
    "blame-line": (b, cwd) => {
      const line = b.line;
      if (typeof line !== "number") throw new HttpError(400, "Invalid line");
      return service.blameLine(cwd, field(b, "filePath", "file_path"), line);
    },
    "file-diff": (b, cwd) =>
      service.fileDiff(cwd, field(b, "filePath", "file_path"), staged(b)),
    "file-diff-meta": (b, cwd) =>
      service.fileDiffMeta(cwd, field(b, "filePath", "file_path"), staged(b)),
    "diff-stats": (_, cwd) => service.diffStats(cwd),
    "file-numstat": (_, cwd) => service.fileNumstat(cwd),
    "stage-files": (b, cwd) => service.stageFiles(cwd, paths(b)),
    "unstage-files": (b, cwd) => service.unstageFiles(cwd, paths(b)),
    "reverse-files": (b, cwd) => service.reverseFiles(cwd, paths(b), staged(b)),
    "branch-info": (_, cwd) => service.branchInfo(cwd),
    "list-branches": (_, cwd) => service.listBranches(cwd),
    "create-branch": (b, cwd) => service.createBranch(cwd, field(b, "branch")),
    "checkout-branch": (b, cwd) =>
      service.checkoutBranch(cwd, field(b, "branch")),
    commit: (b, cwd) => service.commit(cwd, field(b, "message")),
    push: (b, cwd) =>
      service.push(cwd, optional(b, "remote"), optional(b, "branch")),
    "create-worktree": (b, cwd) =>
      service.createWorktree(cwd, field(b, "worktreeKey", "worktree_key")),
    "remove-worktree": (b, cwd) =>
      service.removeWorktree(cwd, field(b, "worktreeKey", "worktree_key")),
    "apply-worktree-changes": (b, cwd) =>
      service.applyWorktreeChanges(
        cwd,
        field(b, "worktreeKey", "worktree_key"),
      ),
    "has-worktree-changes": (b, cwd) =>
      service.hasWorktreeChanges(cwd, field(b, "worktreeKey", "worktree_key")),
  };
  for (const [route, handle] of Object.entries(routes))
    app.post(`/api/git/${route}`, async (request, reply) => {
      const body = bodyObject(request.body);
      const result = await handle(body, field(body, "cwd"));
      if (result === undefined) return reply.code(200).send();
      // Rust Json<String> must remain a JSON string, not Fastify text/plain.
      return reply
        .type("application/json")
        .send(typeof result === "string" ? JSON.stringify(result) : result);
    });
  return service;
}

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  applyPatch,
  createTwoFilesPatch,
  parsePatch,
  reversePatch,
} from "diff";
import type {
  SavedPatchBatch,
  SavedPatchChange,
  SavedPatchRequest,
  SavedPatchResult,
} from "@agent-orchestrator/shared";
import { writeDurableJson } from "./durable-json.js";

const exec = promisify(execFile);
const MAX_BYTES = 1024 * 1024;
function reject(message: string, statusCode = 409): never {
  throw Object.assign(new Error(message), { statusCode });
}
const fingerprint = (request: SavedPatchRequest) =>
  createHash("sha256").update(JSON.stringify(request)).digest("hex");
const receipts = (batches: SavedPatchBatch[]) =>
  JSON.stringify(
    batches.map((b) => ({
      id: b.id,
      changes: b.changes.map((c) => ({
        path: c.path,
        type: c.kind.type,
        move: c.kind.move_path ?? null,
        diff: c.diff,
      })),
    })),
  );
interface JournalEntry {
  request?: SavedPatchRequest;
  threadId?: string;
  fingerprint?: string;
  result: SavedPatchResult;
}
interface NativeThread {
  id: string;
  cwd: string;
  status?: { type: string };
  turns?: Array<{
    id: string;
    status: string;
    items: Array<{
      id: string;
      type: string;
      status?: string;
      changes?: SavedPatchChange[];
    }>;
  }>;
}

/** Verify native receipts, prepare in memory, then apply one checked Git patch.
 * Never checkout/reset a file, change the index, resume a thread or resend an
 * operation whose execution receipt is uncertain. Each gateway has one journal.
 */
export class CodexSavedPatch {
  private entries = new Map<string, JournalEntry>();
  private loaded = false;
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    private readThread: (id: string) => Promise<{ thread: NativeThread }>,
    private file?: string,
  ) {}

  private run<T>(work: () => Promise<T>) {
    const next = this.serial.then(async () => {
      const release = await this.lease();
      try {
        // A hot-reloaded gateway may overlap its predecessor briefly. Reload
        // under the kernel lease so the durable identity stays authoritative.
        if (this.file) {
          this.loaded = false;
          this.entries.clear();
        }
        await this.load();
        return await work();
      } finally {
        release();
      }
    });
    this.serial = next.catch(() => {});
    return next;
  }
  private async lease(): Promise<() => void> {
    if (!this.file) return () => {};
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    return new Promise((resolveLease, rejectLease) => {
      const child = spawn(
        "flock",
        [
          "-w",
          "20",
          this.file + ".lock",
          process.execPath,
          "-e",
          "process.stdout.write('locked');process.stdin.resume()",
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      let acquired = false;
      child.once("error", rejectLease);
      child.stdout.once("data", () => {
        acquired = true;
        resolveLease(() => child.stdin.end());
      });
      child.once("exit", () => {
        if (!acquired)
          rejectLease(
            Object.assign(new Error("保存 patch 的操作锁暂不可用"), {
              statusCode: 503,
            }),
          );
      });
    });
  }
  private async load() {
    if (this.loaded) return;
    if (this.file) {
      try {
        const saved = JSON.parse(await readFile(this.file, "utf8"));
        if (saved.version !== 1 || !Array.isArray(saved.operations))
          reject("保存的 patch 操作记录无效");
        for (const entry of saved.operations as JournalEntry[]) {
          if (
            !entry?.result?.requestId ||
            !["success", "conflict", "uncertain"].includes(entry.result.status)
          )
            reject("保存的 patch 操作记录损坏");
          this.entries.set(entry.result.requestId, {
            threadId: entry.threadId ?? entry.request?.threadId,
            fingerprint:
              entry.fingerprint ??
              (entry.request ? fingerprint(entry.request) : undefined),
            result: entry.result,
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.loaded = true;
  }
  private async save() {
    // Receipts carry hashes and results, never cached source or current file content.
    if (this.file)
      await writeDurableJson(this.file, {
        version: 1,
        operations: [...this.entries.values()],
      });
  }
  status(threadId: string, requestId: string) {
    return this.run(async () => {
      const entry = this.entries.get(requestId);
      if (entry && entry.threadId !== threadId) reject("操作请求不属于此会话");
      return entry?.result ?? null;
    });
  }

  apply(request: SavedPatchRequest): Promise<SavedPatchResult> {
    return this.run(async () => {
      const hash = fingerprint(request),
        previous = this.entries.get(request.requestId);
      if (previous) {
        if (previous.fingerprint !== hash) reject("操作请求身份已改变");
        return previous.result;
      }
      if (
        [...this.entries.values()].some(
          (entry) =>
            entry.threadId === request.threadId &&
            entry.result.status === "uncertain",
        )
      )
        reject(
          "此前保存 patch 的执行结果未确认，请先核对文件，不能发起新的操作",
        );
      const { thread } = await this.readThread(request.threadId);
      if (thread?.id !== request.threadId) reject("原生会话身份不匹配");
      if (thread.status?.type === "active")
        reject("会话正在运行，请等待任务结束后撤销或重新应用");
      const turn = thread.turns?.find((t) => t.id === request.turnId);
      if (!turn || !Array.isArray(turn.items)) reject("原生轮次尚未核实");
      if (!["completed", "interrupted", "failed"].includes(turn.status))
        reject("轮次仍在运行或状态未知");
      const batches: SavedPatchBatch[] = turn.items
        .filter(
          (i) =>
            i.type === "fileChange" &&
            i.status === "completed" &&
            i.changes?.length,
        )
        .map((i) => ({ id: i.id, changes: i.changes! }));
      if (
        !batches.length ||
        receipts(batches) !== receipts(request.expectedChanges)
      )
        reject("保存的变更记录已改变，请重新核对原生轮次");
      if (
        typeof thread.cwd !== "string" ||
        !isAbsolute(thread.cwd) ||
        /[\x00-\x1f]/.test(thread.cwd)
      )
        reject("会话项目路径无效");
      const cwd = await realpath(thread.cwd);
      const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        timeout: 5000,
        maxBuffer: MAX_BYTES,
      });
      const root = await realpath(stdout.trim());
      // A thread can run in a repository subdirectory; its relative paths use cwd.
      const pathFor = async (value: string) => {
        if (
          !value ||
          /[\x00-\x1f\\]/.test(value) ||
          value.startsWith("-") ||
          value.split("/").includes("..")
        )
          reject("保存的文件路径无效");
        const absolute = resolve(cwd, value),
          rel = relative(root, absolute);
        if (
          !rel ||
          rel.startsWith(".." + sep) ||
          rel === ".." ||
          isAbsolute(rel) ||
          rel.split(sep).some((p) => p.toLowerCase() === ".git")
        )
          reject("保存的文件路径越界");
        let current = root;
        for (const part of rel.split(sep)) {
          current = resolve(current, part);
          try {
            if ((await lstat(current)).isSymbolicLink())
              reject("保存的文件路径含符号链接");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        return rel.split(sep).join("/");
      };
      const all = batches.flatMap((b) => b.changes);
      if (
        all.length > 1000 ||
        Buffer.byteLength(receipts(batches), "utf8") > MAX_BYTES
      )
        reject("保存的 patch 过大，请分文件操作", 413);
      if (request.filePath && !all.some((c) => c.path === request.filePath))
        reject("文件不属于此轮保存的变更");
      const changes = all.filter(
        (c) => !request.filePath || c.path === request.filePath,
      );
      const paths = new Map<string, string>();
      for (const c of changes)
        for (const path of [c.path, c.kind.move_path].filter((p): p is string =>
          Boolean(p),
        ))
          paths.set(path, await pathFor(path));
      const before = new Map<string, string | null>(),
        after = new Map<string, string | null>();
      const beforeMode = new Map<string, string>(),
        afterMode = new Map<string, string>();
      let currentBytes = 0;
      for (const path of new Set(paths.values())) {
        try {
          const data = await readFile(resolve(root, path));
          if (data.length > MAX_BYTES || data.includes(0))
            reject(`无法应用二进制或过大文件：${path}`, 413);
          currentBytes += data.length;
          if (currentBytes > 8 * MAX_BYTES)
            reject("此轮涉及的当前文件过大，请分文件操作", 413);
          const text = data.toString("utf8");
          if (!Buffer.from(text, "utf8").equals(data))
            reject(`文件不是 UTF-8 文本：${path}`, 415);
          before.set(path, text);
          after.set(path, text);
          const mode =
            (await lstat(resolve(root, path))).mode & 0o111
              ? "100755"
              : "100644";
          beforeMode.set(path, mode);
          afterMode.set(path, mode);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          before.set(path, null);
          after.set(path, null);
          beforeMode.set(path, "100644");
          afterMode.set(path, "100644");
        }
      }
      const fail = (path: string): SavedPatchResult => ({
        requestId: request.requestId,
        status: "conflict",
        action: request.action,
        changedFiles: 0,
        error: `保存的 patch 与当前文件冲突：${path}；所有文件保持不变`,
      });
      const sequence =
        request.action === "undo" ? [...changes].reverse() : changes;
      for (const change of sequence) {
        const oldPath = paths.get(change.path)!,
          newPath = change.kind.move_path
            ? paths.get(change.kind.move_path)!
            : oldPath;
        const source = request.action === "undo" ? newPath : oldPath,
          target = request.action === "undo" ? oldPath : newPath;
        const kind =
          request.action === "undo"
            ? ({ add: "delete", delete: "add", update: "update" } as const)[
                change.kind.type
              ]
            : change.kind.type;
        const current = after.get(source) ?? null;
        if (kind === "add") {
          if (after.get(target) !== null) return fail(target);
          after.set(target, change.diff);
        } else if (kind === "delete") {
          if (current !== change.diff) return fail(source);
          after.set(source, null);
        } else {
          if (
            current === null ||
            (source !== target && after.get(target) !== null)
          )
            return fail(source);
          try {
            const parsed = parsePatch(change.diff);
            if (parsed.length !== 1 || !parsed[0].hunks.length)
              return fail(source);
            const patch =
              request.action === "undo" ? reversePatch(parsed[0]) : parsed[0];
            // Zero fuzz: offsets allowed, mismatched context is always a conflict.
            const content = applyPatch(current, patch, {
              fuzzFactor: 0,
              autoConvertLineEndings: false,
            });
            if (content === false) return fail(source);
            after.set(target, content);
            if (target !== source) {
              afterMode.set(target, afterMode.get(source)!);
              after.set(source, null);
            }
          } catch {
            return fail(source);
          }
        }
      }
      let net = "",
        count = 0;
      for (const [path, oldContent] of before) {
        const newContent = after.get(path)!;
        if (oldContent === newContent) continue;
        count++;
        const oldName =
            oldContent === null ? "/dev/null" : JSON.stringify(`a/${path}`),
          newName =
            newContent === null ? "/dev/null" : JSON.stringify(`b/${path}`);
        const diff = createTwoFilesPatch(
          oldName,
          newName,
          oldContent ?? "",
          newContent ?? "",
          "",
          "",
          { context: 3 },
        );
        const start = diff.indexOf("--- ");
        net += `diff --git ${JSON.stringify(`a/${path}`)} ${JSON.stringify(`b/${path}`)}\n${oldContent === null ? `new file mode ${afterMode.get(path)}\n` : newContent === null ? `deleted file mode ${beforeMode.get(path)}\n` : ""}${diff.slice(start)}`;
      }
      if (!count || Buffer.byteLength(net, "utf8") > 8 * MAX_BYTES)
        reject("没有可应用的保存变更，或 patch 超出上限");
      const check = await this.gitApply(root, net, true);
      if (check) return { ...fail("patch"), error: check };
      const result: SavedPatchResult = {
        requestId: request.requestId,
        action: request.action,
        status: "uncertain",
        changedFiles: 0,
        error: "执行结果待核对，请勿重复应用",
      };
      this.entries.set(request.requestId, {
        threadId: request.threadId,
        fingerprint: hash,
        result,
      });
      await this.save(); // Durable uncertainty marker precedes the only mutation.
      const error = await this.gitApply(root, net, false);
      if (error) {
        // Hunks are prechecked together. Disk failures during the write itself
        // can still be partial: only a verified unchanged worktree is rejection.
        let unchanged = true;
        for (const [path, content] of before) {
          try {
            const data = await readFile(resolve(root, path));
            const mode =
              (await lstat(resolve(root, path))).mode & 0o111
                ? "100755"
                : "100644";
            if (
              content === null ||
              !data.equals(Buffer.from(content, "utf8")) ||
              mode !== beforeMode.get(path)
            )
              unchanged = false;
          } catch (failure) {
            if (
              (failure as NodeJS.ErrnoException).code !== "ENOENT" ||
              content !== null
            )
              unchanged = false;
          }
        }
        result.status = unchanged ? "conflict" : "uncertain";
        result.error = unchanged
          ? error
          : `文件写入结果待核对，请勿再次应用：${error}`;
      } else {
        result.status = "success";
        result.changedFiles = count;
        delete result.error;
      }
      await this.save();
      return { ...result };
    });
  }
  private gitApply(
    cwd: string,
    patch: string,
    check: boolean,
  ): Promise<string | null> {
    return new Promise((resolve, rejectPromise) => {
      const child = spawn(
        "git",
        ["apply", ...(check ? ["--check"] : []), "--whitespace=nowarn", "-"],
        { cwd, stdio: ["pipe", "ignore", "pipe"] },
      );
      let error = "",
        timeout = false;
      const timer = setTimeout(() => {
        timeout = true;
        child.kill("SIGTERM");
      }, 10000);
      child.stderr.on("data", (data) => {
        if (error.length < 8192) error += String(data);
      });
      child.stdin.on("error", () => {});
      child.once("error", (e) => {
        clearTimeout(timer);
        rejectPromise(e);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        // Signal/timeout cannot establish whether Git wrote files; keep durable uncertainty.
        if (timeout || signal)
          rejectPromise(new Error("Git 操作结果未确认，请先核对文件"));
        else
          resolve(
            code === 0
              ? null
              : error.trim() || "保存的 patch 与当前文件冲突，未应用",
          );
      });
      child.stdin.end(patch);
    });
  }
}

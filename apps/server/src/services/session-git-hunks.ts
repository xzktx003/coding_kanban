import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createTwoFilesPatch } from "diff";
const exec = promisify(execFile);
const MAX_BYTES = 8 * 1024 * 1024;
export interface GitHunkRead { cwd: string; filePath: string; staged: boolean }
export interface GitHunkAction extends GitHunkRead {
  hunkIndex: number; expectedDigest: string; action: "stage" | "unstage" | "revert"; confirmRevert?: boolean;
}
export interface GitHunkSnapshot {
  digest: string; unifiedDiff: string; binary: boolean;
  hunks: Array<{ index: number; oldStart: number; oldCount: number; newStart: number; newCount: number }>;
}
function reject(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }
const git = async (cwd: string, args: string[]) => (await exec("git", ["-c", "core.quotepath=false", ...args], { cwd, timeout: 10000, maxBuffer: MAX_BYTES, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })).stdout;
function utf8(content: Buffer): string | null {
  if (content.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(content); } catch { return null; }
}
async function owner(input: GitHunkRead) {
  if (!isAbsolute(input.cwd) || /[\x00-\x1f]/.test(input.cwd) || !input.filePath || input.filePath.length > 4096 || /[\x00-\x1f]/.test(input.filePath) || input.filePath.startsWith("-") || input.filePath.split(/[\\/]/).includes("..")) reject("项目或文件路径无效", 400);
  const cwd = await realpath(input.cwd), root = await realpath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
  const absolute = resolve(cwd, input.filePath), filePath = relative(root, absolute);
  if (!filePath || isAbsolute(filePath) || filePath === ".." || filePath.startsWith(".." + sep) || filePath.split(sep).some(part => part.toLowerCase() === ".git")) reject("文件路径越界", 400);
  let current = root;
  for (const part of filePath.split(sep)) {
    current = resolve(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) reject("符号链接不能执行逐块变更", 400);
      if (current === absolute && !stat.isFile()) reject("只能查看普通文件的逐块变更", 400);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (await git(root, ["ls-files", "--unmerged", "--", filePath])) reject("文件包含未解决的 Git 冲突");
  const mode = await git(root, ["ls-files", "--stage", "--", filePath]);
  if (/^(?:120000|160000) /m.test(mode)) reject("符号链接或子模块不能执行逐块变更", 400);
  return { root, absolute, filePath, tracked: mode.length > 0 };
}
function parts(patch: string) {
  const first = patch.search(/^@@ /m);
  const header = first >= 0 ? patch.slice(0, first) : patch;
  const hunks = first >= 0 ? patch.slice(first).split(/(?=^@@ )/m).filter(Boolean) : [];
  return { header, hunks };
}
/** Computes patches from Git itself; the browser never supplies a patch or Git
 * argument. The full-file digest and kernel lease reject stale/duplicate scopes.
 * No checkout, reset, clean, resume, shell, hook or external diff driver runs. */
export class SessionGitHunks {
  private async snapshot(input: GitHunkRead, context: Awaited<ReturnType<typeof owner>>): Promise<GitHunkSnapshot> {
    const raw = (await exec("git", ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--full-index", "--no-color", "--unified=3", ...(input.staged ? ["--cached"] : []), "--", context.filePath], { cwd: context.root, timeout: 10000, maxBuffer: MAX_BYTES, encoding: "buffer", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })).stdout;
    const decoded = utf8(raw);
    let patch = decoded ?? "";
    let binary = decoded === null || /^(?:Binary files |GIT binary patch)/m.test(patch);
    if (!input.staged && !context.tracked && !patch) {
      const stat = await lstat(context.absolute);
      if (stat.size > MAX_BYTES) reject("文件超过逐块变更读取上限", 413);
      const content = await readFile(context.absolute);
      const text = utf8(content);
      binary = text === null;
      if (!binary) {
        const quote = (name: string) => /[\s"\\]/.test(name) ? JSON.stringify(name) : name;
        const body = createTwoFilesPatch("/dev/null", "b/" + context.filePath, "", text!, "", "", { context: 3 });
        patch = `diff --git ${quote("a/" + context.filePath)} ${quote("b/" + context.filePath)}\nnew file mode ${stat.mode & 0o111 ? "100755" : "100644"}\n--- /dev/null\n+++ ${quote("b/" + context.filePath)}\n` + body.slice(body.search(/^@@ /m));
      }
    }
    const digest = createHash("sha256").update(JSON.stringify([context.root, context.filePath, input.staged, binary, patch])).digest("hex");
    return { digest, unifiedDiff: patch, binary, hunks: binary ? [] : parts(patch).hunks.map((hunk, index) => {
      const coordinates = hunk.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!coordinates) reject("Git 变更块坐标无效");
      return { index, oldStart: Number(coordinates[1]), oldCount: Number(coordinates[2] ?? 1), newStart: Number(coordinates[3]), newCount: Number(coordinates[4] ?? 1) };
    }) };
  }
  async read(input: GitHunkRead) { return this.snapshot(input, await owner(input)); }
  private async lease(root: string): Promise<() => Promise<void>> {
    const lock = resolve(root, (await git(root, ["rev-parse", "--git-path", "coding-kanban-review.lock"])).trim());
    return new Promise((resolveLease, rejectLease) => {
      const child = spawn("flock", ["-w", "15", lock, process.execPath, "-e", "process.stdout.write('locked');process.stdin.resume()"], { stdio: ["pipe", "pipe", "ignore"] });
      let acquired = false;
      child.once("error", rejectLease);
      child.stdout.once("data", () => { acquired = true; resolveLease(() => new Promise(resolveRelease => { child.once("exit", () => resolveRelease()); child.stdin.end(); })); });
      child.once("exit", () => { if (!acquired) rejectLease(Object.assign(new Error("逐块变更锁暂不可用"), { statusCode: 503 })); });
    });
  }
  private apply(root: string, args: string[], patch: string, check: boolean) {
    return new Promise<void>((resolveApply, rejectApply) => {
      const child = spawn("git", ["apply", ...args, ...(check ? ["--check"] : []), "--whitespace=nowarn", "-"], { cwd: root, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "", timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, 15000);
      child.stderr.on("data", chunk => { if (stderr.length < 8192) stderr += chunk.toString(); });
      child.once("error", error => { clearTimeout(timeout); rejectApply(Object.assign(error, { statusCode: 503 })); });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) resolveApply();
        else if (!check && (signal || timedOut)) rejectApply(Object.assign(new Error("操作回执不明，请只读刷新工作区后核对，勿重复提交"), { statusCode: 503 }));
        else rejectApply(Object.assign(new Error(`Git 变更块冲突，未应用：${stderr.trim() || "操作失败"}`), { statusCode: 409 }));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(patch);
    });
  }
  async action(input: GitHunkAction) {
    if (!Number.isSafeInteger(input.hunkIndex) || input.hunkIndex < 0 || !/^[a-f0-9]{64}$/.test(input.expectedDigest)) reject("变更块身份无效", 400);
    if (!["stage", "unstage", "revert"].includes(input.action) || input.action === "stage" && input.staged || input.action === "unstage" && !input.staged) reject("逐块变更动作与范围不匹配", 400);
    if (input.action === "revert" && input.confirmRevert !== true) reject("请明确确认此文件及变更块的丢弃范围", 400);
    const context = await owner(input), release = await this.lease(context.root);
    try {
      // Revalidate filesystem and Git scope after acquiring the shared lock.
      const currentContext = await owner(input);
      if (currentContext.root !== context.root || currentContext.filePath !== context.filePath) reject("文件归属已改变");
      const current = await this.snapshot(input, currentContext);
      if (current.digest !== input.expectedDigest) reject("文件变更已改变，所选变更块已过期，请刷新后重新选择");
      const selected = parts(current.unifiedDiff);
      if (current.binary || !selected.hunks[input.hunkIndex]) reject("所选变更块不存在或不是文本变更");
      const patch = selected.header + selected.hunks[input.hunkIndex];
      const args = input.action === "stage" ? ["--cached"] : input.action === "unstage" ? ["--cached", "--reverse"] : input.staged ? ["--index", "--reverse"] : ["--reverse"];
      await this.apply(context.root, args, patch, true);
      await this.apply(context.root, args, patch, false);
      return { status: "success" as const, action: input.action, hunkIndex: input.hunkIndex };
    } finally { await release(); }
  }
}

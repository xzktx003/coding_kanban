import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createTwoFilesPatch } from "diff";
const exec = promisify(execFile), MAX_BYTES = 8 * 1024 * 1024;
export type GitReviewTarget = { type: "uncommittedChanges" } | { type: "baseBranch"; branch: string } | { type: "commit"; sha: string; title: string | null };
function reject(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
export function parseGitReviewRead(value: unknown): { cwd: string; target: GitReviewTarget } {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("审查快照请求无效");
  const b = value as Record<string, unknown>, target = b.target as Record<string, unknown>;
  if (Object.keys(b).some(key => !["cwd", "target"].includes(key)) || typeof b.cwd !== "string" || b.cwd.length > 4096 || !isAbsolute(b.cwd) || /[\x00-\x1f]/.test(b.cwd) || !target || typeof target !== "object" || Array.isArray(target)) reject("审查快照范围无效");
  const keys = target.type === "uncommittedChanges" ? ["type"] : target.type === "baseBranch" ? ["type", "branch"] : target.type === "commit" ? ["type", "sha", "title"] : [];
  if (!keys.length || Object.keys(target).some(key => !keys.includes(key))) reject("自定义审查没有可推断的 Git 比较范围");
  if (target.type === "baseBranch" && (typeof target.branch !== "string" || !target.branch || target.branch.length > 512 || target.branch.startsWith("-") || /[\x00-\x20~^:?*\[\\]/.test(target.branch) || target.branch.includes("..") || target.branch.includes("@{"))) reject("基准分支无效");
  if (target.type === "commit" && (typeof target.sha !== "string" || !/^[a-f0-9]{7,64}$/i.test(target.sha) || target.title !== null && (typeof target.title !== "string" || target.title.length > 4096))) reject("提交身份无效");
  return b as unknown as { cwd: string; target: GitReviewTarget };
}
function decode(buffer: Buffer) { try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { reject("变更包含非 UTF-8 内容，无法生成文本审查快照", 415); } }
/** Read-only snapshots have separate provenance from native saved-turn patches.
 * Fixed argv disables external diff/textconv. No Git write, refresh-index,
 * checkout, fetch, hook, shell or user-supplied flags are executed. */
export class SessionGitReview {
  async read(input: { cwd: string; target: GitReviewTarget }) {
    const cwd = await realpath(input.cwd);
    const git = async (...args: string[]) => (await exec("git", ["-c", "core.quotepath=false", ...args], { cwd, maxBuffer: MAX_BYTES, timeout: 10000, encoding: "buffer", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })).stdout;
    let root: string;
    try { root = await realpath(decode(await git("rev-parse", "--show-toplevel")).trim()); } catch { reject("此审查项目不是可读取的 Git 工作区", 409); }
    const head = decode(await git("rev-parse", "--verify", "HEAD^{commit}")).trim();
    const flags = ["--no-ext-diff", "--no-textconv", "--no-renames", "--full-index", "--no-color", "--unified=3"];
    const resolved: { head: string; base?: string; commit?: string } = { head };
    let unifiedDiff: string;
    if (input.target.type === "baseBranch") {
      let branch: string;
      try { branch = decode(await git("rev-parse", "--verify", "--end-of-options", `${input.target.branch}^{commit}`)).trim(); resolved.base = decode(await git("merge-base", head, branch)).trim(); } catch { reject("基准分支不存在或没有共同祖先", 409); }
      unifiedDiff = decode(await git("diff", ...flags, resolved.base!, head, "--"));
    } else if (input.target.type === "commit") {
      try { resolved.commit = decode(await git("rev-parse", "--verify", "--end-of-options", `${input.target.sha}^{commit}`)).trim(); } catch { reject("提交身份无法解析", 409); }
      const parents = decode(await git("rev-list", "--parents", "-n", "1", resolved.commit)).trim().split(" ");
      if (parents[1]) { resolved.base = parents[1]; unifiedDiff = decode(await git("diff", ...flags, parents[1], resolved.commit, "--")); }
      else unifiedDiff = decode(await git("show", "--format=", "--root", ...flags, resolved.commit, "--"));
    } else unifiedDiff = decode(await git("diff", ...flags, head, "--"));
    const omitted: Array<{ path: string; reason: string }> = [];
    if (input.target.type === "uncommittedChanges") {
      const untracked = decode(await git("ls-files", "--others", "--exclude-standard", "-z", "--")).split("\0").filter(Boolean);
      for (const path of untracked) {
        const absolute = resolve(cwd, path), inRoot = relative(root, absolute);
        if (isAbsolute(inRoot) || inRoot === ".." || inRoot.startsWith(".." + sep) || /[\x00-\x1f]/.test(path)) { omitted.push({ path, reason: "文件名或范围无法安全显示" }); continue; }
        const stat = await lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) { omitted.push({ path, reason: "非普通文件或超过读取上限" }); continue; }
        const content = await readFile(absolute);
        if (content.includes(0)) { omitted.push({ path, reason: "二进制文件" }); continue; }
        let text: string; try { text = decode(content); } catch { omitted.push({ path, reason: "非 UTF-8 文件" }); continue; }
        const quote = (name: string) => /[\s"\\]/.test(name) ? JSON.stringify(name) : name;
        const body = createTwoFilesPatch("/dev/null", "b/" + inRoot, "", text, "", "", { context: 3 });
        unifiedDiff += `diff --git ${quote("a/" + inRoot)} ${quote("b/" + inRoot)}\nnew file mode ${stat.mode & 0o111 ? "100755" : "100644"}\n--- /dev/null\n+++ ${quote("b/" + inRoot)}\n` + (body.search(/^@@ /m) >= 0 ? body.slice(body.search(/^@@ /m)) : "");
        if (Buffer.byteLength(unifiedDiff) > MAX_BYTES) reject("审查快照超过读取上限", 413);
      }
    }
    return { cwd: root, target: input.target, resolved, capturedAt: new Date().toISOString(), digest: createHash("sha256").update(JSON.stringify([root, input.target, resolved, unifiedDiff, omitted])).digest("hex"), unifiedDiff, omitted };
  }
}

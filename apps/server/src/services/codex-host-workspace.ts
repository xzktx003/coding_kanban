import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import type { CodexHostWorkspace } from "@agent-orchestrator/shared";
const execute = promisify(execFile);
const fail = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
const revision = (text: string | null) =>
  createHash("sha256")
    .update(text === null ? "missing" : "file\0" + text)
    .digest("hex");
const invalidBranch = (name: string) =>
  !name ||
  name.length > 160 ||
  name.startsWith("-") ||
  /[\x00-\x20\x7f]/.test(name);
/** Owner cwd is supplied by the authoritative route, never a free-form Git argument. */
export class CodexHostWorkspaceService {
  private catalogReady: Promise<string> | null = null;
  constructor(private dataHome: string) {}
  private async git(cwd: string, args: string[]) {
    try {
      return (
        await execute("git", ["-C", cwd, ...args], {
          encoding: "utf8",
          timeout: 15_000,
          maxBuffer: 4 * 1024 * 1024,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
          },
        })
      ).stdout;
    } catch {
      throw fail("Git 操作未完成，请核对仓库状态和分支");
    }
  }
  async gitState(
    cwd: string,
  ): Promise<
    Pick<CodexHostWorkspace, "git" | "branch" | "branches" | "dirty">
  > {
    const unavailable = (repoRoot: string | null = null) => ({
      git: {
        available: false,
        repoRoot,
        mutationAllowed: false,
        reason: "当前项目没有可读取的 Git 仓库；AGENTS.md 与项目技能仍可使用",
      },
      branch: null,
      branches: [],
      dirty: null,
    });
    const found = await this.git(cwd, ["rev-parse", "--show-toplevel"]).catch(
      () => null,
    );
    if (!found) return unavailable();
    const repoRoot = await realpath(found.trim()).catch(() => null);
    if (!repoRoot) return unavailable();
    try {
      const [branch, branches, status] = await Promise.all([
        this.git(cwd, ["branch", "--show-current"]),
        this.git(cwd, [
          "for-each-ref",
          "--format=%(refname:short)",
          "refs/heads/",
        ]),
        this.git(cwd, ["status", "--porcelain", "--untracked-files=normal"]),
      ]);
      const mutationAllowed = repoRoot === (await realpath(cwd));
      return {
        git: {
          available: true,
          repoRoot,
          mutationAllowed,
          reason: mutationAllowed
            ? null
            : "Git 仓库位于当前项目外；请明确打开仓库根目录后再修改分支或创建工作区",
        },
        branch: branch.trim(),
        branches: branches.split(/\r?\n/).filter(Boolean),
        dirty: !!status.trim(),
      };
    } catch {
      return unavailable(repoRoot);
    }
  }
  async requireGitMutationScope(cwd: string) {
    const state = await this.gitState(cwd);
    if (!state.git.available) throw fail(state.git.reason!);
    if (!state.git.mutationAllowed) throw fail(state.git.reason!);
    return state;
  }
  private async branch(cwd: string, name: string) {
    if (invalidBranch(name)) throw fail("分支名称无效", 400);
    try {
      await this.git(cwd, ["check-ref-format", "--branch", name]);
    } catch {
      throw fail("分支名称无效", 400);
    }
  }
  async createBranch(cwd: string, name: string) {
    await this.requireGitMutationScope(cwd);
    await this.branch(cwd, name);
    await this.git(cwd, ["branch", "--", name]);
    return this.gitState(cwd);
  }
  async checkout(cwd: string, name: string) {
    const state = await this.requireGitMutationScope(cwd);
    await this.branch(cwd, name);
    if (state.dirty) throw fail("项目存在未提交文件，未切换分支");
    if (!state.branches.includes(name))
      throw fail("请选择现有本地分支，未切换分支");
    await this.git(cwd, ["switch", "--no-guess", "--", name]);
    return this.gitState(cwd);
  }
  async createWorktree(cwd: string, branch: string) {
    await this.requireGitMutationScope(cwd);
    await this.branch(cwd, branch);
    const id = createHash("sha256")
        .update(cwd + "\0" + branch)
        .digest("hex")
        .slice(0, 24),
      directory = join(this.dataHome, "codex-host", "worktrees");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, id);
    if (await lstat(path).catch(() => null))
      throw fail("该分支的独立工作区已存在，请使用现有目录");
    await this.git(cwd, ["worktree", "add", "--", path, branch]);
    return { path, branch };
  }
  async instructions(cwd: string) {
    const file = join(cwd, "AGENTS.md"),
      info = await lstat(file).catch(() => null);
    if (!info) return { text: "", revision: revision(null), exists: false };
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink > 1 ||
      (await realpath(file)) !== file ||
      info.size > 512 * 1024
    )
      throw fail(
        "AGENTS.md 必须是该项目的普通文本文件，且不能链接到其他位置",
        400,
      );
    const text = await readFile(file, "utf8");
    if (text.includes("\0")) throw fail("AGENTS.md 不是文本文件", 400);
    return { text, revision: revision(text), exists: true };
  }
  async saveInstructions(cwd: string, text: string, expected: string) {
    if (
      typeof text !== "string" ||
      text.length > 512 * 1024 ||
      text.includes("\0") ||
      !/^[a-f0-9]{64}$/.test(expected)
    )
      throw fail("AGENTS.md 内容或版本无效", 400);
    const before = await this.instructions(cwd);
    if (before.revision !== expected)
      throw fail(
        "AGENTS.md 已被其他编辑器或 Agent 改变，请重新读取后合并，未覆盖文件",
      );
    const file = join(cwd, "AGENTS.md");
    if (!before.exists) await writeFile(file, text, { flag: "wx" });
    else {
      const temp = join(cwd, ".AGENTS.md.kanban-" + randomUUID());
      try {
        await writeFile(temp, text, { flag: "wx" });
        if ((await this.instructions(cwd)).revision !== expected)
          throw fail("AGENTS.md 已改变，未覆盖文件");
        await rename(temp, file);
      } finally {
        await rm(temp, { force: true });
      }
    }
    return this.instructions(cwd);
  }
  private async catalog(refresh = false) {
    if (refresh) this.catalogReady = null;
    if (this.catalogReady) return this.catalogReady;
    this.catalogReady = (async () => {
      const directory = join(this.dataHome, "codex-host", "recommended-skills");
      if (
        !refresh &&
        (await lstat(join(directory, "skills", ".curated")).catch(() => null))
      )
        return directory;
      const fresh = directory + "-" + randomUUID();
      await mkdir(join(this.dataHome, "codex-host"), {
        recursive: true,
        mode: 0o700,
      });
      try {
        await execute(
          "git",
          [
            "clone",
            "--depth",
            "1",
            "--",
            "https://github.com/openai/skills.git",
            fresh,
          ],
          {
            timeout: 60_000,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          },
        );
        await rm(directory, { recursive: true, force: true });
        await rename(fresh, directory);
        return directory;
      } catch {
        await rm(fresh, { recursive: true, force: true });
        throw fail("OpenAI 推荐技能目录暂时无法连接，请重试", 503);
      }
    })().catch((error) => {
      this.catalogReady = null;
      throw error;
    });
    return this.catalogReady;
  }
  async recommended(cwd: string, refresh = false) {
    const root = join(await this.catalog(refresh), "skills", ".curated"),
      skills = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_.-]+$/.test(entry.name))
        continue;
      const text = await readFile(
        join(root, entry.name, "SKILL.md"),
        "utf8",
      ).catch(() => "");
      const name =
        text.match(/^name:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "") ??
        entry.name;
      const description =
        text
          .match(/^description:\s*(.+)$/m)?.[1]
          ?.replace(/^["']|["']$/g, "") ?? "";
      skills.push({
        id: entry.name,
        name,
        description,
        installed: !!(await lstat(
          join(cwd, ".agents", "skills", entry.name, "SKILL.md"),
        ).catch(() => null)),
      });
    }
    return skills;
  }
  async installRecommended(cwd: string, skillId: string) {
    if (
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(skillId) ||
      [".", ".."].includes(skillId)
    )
      throw fail("推荐技能标识无效", 400);
    const source = join(await this.catalog(), "skills", ".curated", skillId),
      root = join(cwd, ".agents", "skills"),
      target = join(root, skillId);
    if (!(await lstat(join(source, "SKILL.md")).catch(() => null))?.isFile())
      throw fail("推荐技能不存在", 404);
    if (await lstat(target).catch(() => null))
      throw fail("项目已有同名技能，未覆盖安装");
    await mkdir(root, { recursive: true });
    const verified = await realpath(root),
      rel = relative(cwd, verified);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
      throw fail("项目技能目录指向项目外，未安装", 400);
    await cp(source, target, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    return { path: target };
  }
}

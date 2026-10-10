import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  sep,
} from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { JsonStore } from "../core/json-store.js";
import { KeyedSerial } from "../core/serial.js";
const exec = promisify(execFile);
const mutations = new KeyedSerial();
export interface SkillsOptions {
  home?: string;
  codexHome?: string;
  /** Trusted deployment/test configuration, never populated from request parameters. */
  searchUrl?: string;
  repositoryUrl?: (source: string) => string;
}
interface FrontMatter {
  name?: string;
  description?: string;
  license?: string;
}
export interface MarketSkill {
  id: string;
  source: string;
  skillId: string;
  name: string;
  installs: number;
}
export interface SkillGroups {
  groups: { id: string; name: string; skillNames: string[] }[];
}
function input(value: unknown, key: string): string {
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected JSON object");
  return value as Record<string, unknown>;
}
export function validateSkillName(value: string): string {
  const name = value.trim();
  if (
    !name ||
    Buffer.byteLength(name) > 255 ||
    name === "." ||
    name === ".." ||
    /[\x00-\x1f\x7f/\\:]/.test(name)
  )
    throw new Error("skill_name must be a single directory name");
  return name;
}
function validatePath(path: string) {
  if (!isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path))
    throw new Error("Path must be an absolute directory");
}
async function optionalLstat(path: string) {
  try {
    return await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
async function directory(path: string) {
  validatePath(path);
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory())
    throw new Error("Path must be a directory");
  return canonical;
}
async function checkRoot(path: string, create = false) {
  validatePath(path);
  if (path.split(sep).includes(".."))
    throw new Error("Skills root must not contain parent traversal");
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let info = await optionalLstat(current);
    if (!info && create) {
      await mkdir(current).catch((e) => {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      });
      info = await lstat(current);
    }
    if (info?.isSymbolicLink())
      throw new Error(`Skills root cannot contain a symlink: ${current}`);
    if (info && !info.isDirectory())
      throw new Error(`Skills root is not a directory: ${current}`);
  }
}
function within(root: string, path: string) {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}
async function validateTree(
  path: string,
  scope: string,
  active = new Set<string>(),
  budget = { entries: 0 },
) {
  if (++budget.entries > 100_000)
    throw new Error("Skill source exceeds entry limit");
  const canonical = await realpath(path);
  if (!within(scope, canonical))
    throw new Error(`Skill source leaves the cloned repository: ${path}`);
  const info = await stat(canonical);
  if (info.isDirectory()) {
    if (active.has(canonical))
      throw new Error(`Skill source contains a directory link cycle: ${path}`);
    active.add(canonical);
    for (const entry of await readdir(path))
      await validateTree(join(path, entry), scope, active, budget);
    active.delete(canonical);
  } else if (!info.isFile())
    throw new Error("Skill source is not a file or directory");
}
async function frontMatter(path: string): Promise<FrontMatter> {
  const info = await stat(path);
  if (info.size > 4 * 1024 * 1024)
    throw new Error("SKILL.md exceeds size limit");
  const content = await readFile(path, "utf8");
  const result: FrontMatter = {};
  for (const line of content.split(/\r?\n/).slice(0, 5)) {
    const match = /^(name|description|license)(?::\s*(.*))?$/i.exec(
      line.trim(),
    );
    if (!match) continue;
    const key = match[1]!.toLowerCase() as keyof FrontMatter;
    result[key] ??= (match[2] ?? "")
      .trim()
      .replace(/^"+|"+$/g, "")
      .replace(/^'+|'+$/g, "");
  }
  return result;
}
async function isFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? ""))
      return false;
    throw e;
  }
}
async function isDir(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? ""))
      return false;
    throw e;
  }
}
async function removeLeaf(path: string) {
  const info = await optionalLstat(path);
  if (info?.isSymbolicLink()) await unlink(path);
  else if (info?.isDirectory()) await rm(path, { recursive: true });
}
function groups(value: unknown): SkillGroups {
  const data = object(value);
  if (!Array.isArray(data.groups)) throw new Error("groups must be an array");
  return {
    groups: data.groups.map((v) => {
      const g = object(v);
      if (
        !Array.isArray(g.skillNames) ||
        !g.skillNames.every((n) => typeof n === "string")
      )
        throw new Error("skillNames must be a string array");
      return {
        id: input(g.id, "id"),
        name: input(g.name, "name"),
        skillNames: g.skillNames as string[],
      };
    }),
  };
}
function repository(value: string): { url: string; parts: string[] } {
  const url = value.trim();
  if (!url || url.startsWith("-") || /[\x00-\x20\x7f]/.test(url))
    throw new Error("Invalid repository url");
  let path: string;
  if (isAbsolute(url)) path = url;
  else if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(url))
    path = url.slice(url.indexOf(":") + 1);
  else {
    const parsed = new URL(url);
    if (
      !["https:", "http:", "ssh:", "git:", "file:"].includes(parsed.protocol) ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Unsupported repository url");
    path = decodeURIComponent(parsed.pathname);
  }
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean).slice(-2);
  if (!parts.length)
    throw new Error("Could not derive repository name from url");
  parts[parts.length - 1] = parts.at(-1)!.replace(/\.git$/, "");
  parts.forEach(validateSkillName);
  return { url, parts };
}
async function clone(url: string, destination: string) {
  repository(url);
  await exec(
    "git",
    ["-c", "protocol.ext.allow=never", "clone", "--", url, destination],
    {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    },
  );
  await exec("git", ["-C", destination, "rev-parse", "--git-dir"], {
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
}
export class SkillsService {
  private readonly home: string;
  constructor(private readonly options: SkillsOptions = {}) {
    this.home = options.home ?? homedir();
    validatePath(this.home);
  }
  private async central() {
    return join(await directory(this.home), ".agents/skills");
  }
  private async plugins() {
    return join(await directory(this.home), ".agents/plugins");
  }
  private async agentRoot(
    agentValue: string,
    scopeValue: string,
    cwd?: string,
  ) {
    const agent = agentValue.trim().toLowerCase(),
      scope = scopeValue.trim().toLowerCase();
    if (!["codex", "cc"].includes(agent))
      throw new Error(`Unsupported selected_agent: ${agentValue}`);
    if (!["user", "project"].includes(scope))
      throw new Error(`Unsupported scope: ${scopeValue}`);
    if (scope === "project") {
      if (!cwd?.trim())
        throw new Error("cwd is required when scope is project");
      return join(
        await directory(cwd.trim()),
        agent === "codex" ? ".codex" : ".claude",
        "skills",
      );
    }
    const codexHome = this.options.codexHome ?? process.env.CODEX_HOME;
    if (agent === "codex" && codexHome)
      return join(await directory(codexHome), "skills");
    return join(
      await directory(this.home),
      agent === "codex" ? ".codex" : ".claude",
      "skills",
    );
  }
  private async centralSkill(root: string, name: string) {
    await checkRoot(root);
    const path = await directory(join(root, name));
    if (!within(root, path) || path === root)
      throw new Error(`Skill '${name}' leaves its central store`);
    return path;
  }
  private async validateLink(central: string, root: string, name: string) {
    await checkRoot(root);
    const target = join(root, name);
    const info = await optionalLstat(target);
    if (info?.isSymbolicLink()) {
      const actual = await realpath(target).catch(() => null);
      if (actual !== central)
        throw new Error(
          `Existing skill link has a different target: ${target}`,
        );
    } else if (info && !info.isDirectory())
      throw new Error(`Existing skill target is not a directory: ${target}`);
  }
  private async link(central: string, root: string, name: string) {
    await this.validateLink(central, root, name);
    await checkRoot(root, true);
    const target = join(root, name);
    if (await optionalLstat(target)) return;
    if (process.platform === "win32")
      await cp(central, target, {
        recursive: true,
        dereference: true,
        errorOnExist: true,
        force: false,
      });
    else await symlink(central, target);
  }
  private async installTree(
    source: string,
    scope: string,
    name: string,
    roots: string[],
  ) {
    name = validateSkillName(name);
    const central = await this.central();
    await validateTree(source, await directory(scope));
    await checkRoot(central);
    for (const root of roots) await checkRoot(root);
    const target = join(central, name);
    const existing = await optionalLstat(target);
    const actual = existing ? await this.centralSkill(central, name) : target;
    for (const root of roots) await this.validateLink(actual, root, name);
    await checkRoot(central, true);
    if (!existing) {
      const temp = join(central, `.install-${randomUUID()}`);
      try {
        await cp(source, temp, {
          recursive: true,
          dereference: true,
          errorOnExist: true,
          force: false,
        });
        await rename(temp, target);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    for (const root of roots) await this.link(actual, root, name);
    return target;
  }
  async listMarketplace() {
    const plugins = await this.plugins();
    await checkRoot(plugins);
    if (!(await optionalLstat(plugins))) return [];
    const central = await this.central();
    await checkRoot(central);
    const paths: string[] = [];
    const walk = async (path: string, depth: number) => {
      if (depth > 64 || paths.length > 100_000)
        throw new Error("Marketplace scan exceeds limit");
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        // Never traverse repository symlinks when indexing marketplace content.
        if (entry.isDirectory() && entry.name !== ".git")
          await walk(child, depth + 1);
        else if (
          entry.isFile() &&
          entry.name.toLowerCase() === "skill.md" &&
          child.split(sep).some((s) => s.toLowerCase() === "skills")
        )
          paths.push(child);
      }
    };
    await walk(plugins, 0);
    const result = [];
    for (const path of paths) {
      const fm = await frontMatter(path);
      const name = (fm.name || basename(dirname(path))).trim();
      if (!name) continue;
      // Untrusted metadata cannot direct installed-state reads outside central storage.
      validateSkillName(name);
      result.push({
        name,
        description: fm.description || null,
        license: fm.license || null,
        skillMdPath: path,
        sourceDirPath: dirname(path),
        installed: await isFile(join(central, name, "SKILL.md")),
      });
    }
    return result.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  }
  async listInstalled(agent: string, scope: string, cwd?: string) {
    const root = await this.agentRoot(agent, scope, cwd);
    await checkRoot(root);
    if (!(await optionalLstat(root))) return [];
    const result = [];
    for (const name of await readdir(root)) {
      const path = join(root, name),
        md = join(path, "SKILL.md");
      if (!(await isDir(path)) || !(await isFile(md))) continue;
      result.push({
        name,
        path,
        skillMdPath: md,
        description: (await frontMatter(md)).description || null,
      });
    }
    return result.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  }
  async listCentral(scope: string, cwd?: string) {
    const central = await this.central();
    const codex = await this.agentRoot("codex", scope, cwd),
      cc = await this.agentRoot("cc", scope, cwd);
    await checkRoot(central);
    await checkRoot(codex);
    await checkRoot(cc);
    if (!(await optionalLstat(central))) return [];
    const result = [];
    for (const name of await readdir(central)) {
      const path = join(central, name),
        md = join(path, "SKILL.md");
      if (!(await isDir(path)) || !(await isFile(md))) continue;
      result.push({
        name,
        path,
        description: (await frontMatter(md)).description || null,
        linkedCodex: !!(await optionalLstat(join(codex, name))),
        linkedCc: !!(await optionalLstat(join(cc, name))),
      });
    }
    return result.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  }
  installMarketplace(
    md: string,
    name: string,
    agent: string,
    scope: string,
    cwd?: string,
  ) {
    return mutations.run(this.home, async () => {
      name = validateSkillName(name);
      validatePath(md);
      if (basename(md).toLowerCase() !== "skill.md" || !(await isFile(md)))
        throw new Error("skill_md_path must point to SKILL.md");
      const root = await this.agentRoot(agent, scope, cwd);
      await this.installTree(dirname(md), dirname(md), name, [root]);
      return join(root, name);
    });
  }
  uninstall(name: string, agent: string, scope: string, cwd?: string) {
    return mutations.run(this.home, async () => {
      name = validateSkillName(name);
      const root = await this.agentRoot(agent, scope, cwd);
      await checkRoot(root);
      const target = join(root, name);
      await removeLeaf(target);
      return target;
    });
  }
  linkToAgent(name: string, agent: string, scope: string, cwd?: string) {
    return mutations.run(this.home, async () => {
      name = validateSkillName(name);
      const central = await this.centralSkill(await this.central(), name);
      const root = await this.agentRoot(agent, scope, cwd);
      await this.link(central, root, name);
    });
  }
  deleteCentral(name: string, scope: string, cwd?: string) {
    return mutations.run(this.home, async () => {
      name = validateSkillName(name);
      const roots = [
        await this.agentRoot("codex", scope, cwd),
        await this.agentRoot("cc", scope, cwd),
        await this.central(),
      ];
      for (const root of roots) await checkRoot(root);
      for (const root of roots) await removeLeaf(join(root, name));
    });
  }
  private async groupStore(create: boolean) {
    const root = join(await directory(this.home), ".agents");
    await checkRoot(root, create);
    const path = join(root, "skill-groups.json");
    if ((await optionalLstat(path))?.isSymbolicLink())
      throw new Error("Skill groups file cannot be a symlink");
    return new JsonStore(path, () => ({ groups: [] }));
  }
  async readGroups() {
    return mutations.run(this.home, async () =>
      groups(await (await this.groupStore(false)).read()),
    );
  }
  async writeGroups(value: unknown) {
    const config = groups(value);
    return mutations.run(this.home, async () => {
      const store = await this.groupStore(true);
      await store.write({ groups: config.groups.map((g) => ({ ...g })) });
    });
  }
  cloneRepo(value: string) {
    return mutations.run(this.home, async () => {
      const { url, parts } = repository(value);
      const plugins = await this.plugins();
      const target = join(plugins, ...parts);
      await checkRoot(dirname(target), true);
      const existing = await optionalLstat(target);
      if (existing) {
        await checkRoot(target);
        if (await optionalLstat(join(target, ".git"))) {
          await exec("git", ["-C", target, "rev-parse", "--git-dir"], {
            timeout: 10_000,
            maxBuffer: 64 * 1024,
          });
          return target;
        }
        if ((await readdir(target)).length)
          throw new Error(`Clone destination already exists: ${target}`);
      }
      await clone(url, target);
      return target;
    });
  }
  async search(query: string, limit: number): Promise<MarketSkill[]> {
    if (!Number.isInteger(limit) || limit < 0 || limit > 0xffffffff)
      throw new Error("limit must be a u32");
    const url = new URL(
      this.options.searchUrl ?? "https://skills.sh/api/search",
    );
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    const response = await fetch(url, {
      headers: { "user-agent": "skills-manager" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Failed to fetch skills.sh: HTTP ${response.status}`);
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader)
      try {
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          bytes += chunk.byteLength;
          if (bytes > 8 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("skills.sh response exceeds size limit");
          }
          chunks.push(chunk);
        }
      } finally {
        reader.releaseLock();
      }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const items = Array.isArray(value) ? value : object(value).skills;
    if (!Array.isArray(items)) throw new Error("Invalid skills.sh response");
    const result: MarketSkill[] = [];
    for (const raw of items) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const source = typeof item.source === "string" ? item.source : "";
      const skillId =
        typeof (item.skillId ?? item.skill_id) === "string"
          ? ((item.skillId ?? item.skill_id) as string)
          : "";
      if (!source || !skillId) continue;
      result.push({
        id: `${source}/${skillId}`,
        source,
        skillId,
        name: typeof item.name === "string" && item.name ? item.name : skillId,
        installs:
          typeof item.installs === "number" &&
          Number.isInteger(item.installs) &&
          item.installs >= 0
            ? item.installs
            : 0,
      });
    }
    return result;
  }
  async leaderboard(_board: string) {
    const results = await Promise.allSettled(
      ["github", "code", "test", "ai", "react", "python", "skill"].map((term) =>
        this.search(term, 30),
      ),
    );
    if (results.every((r) => r.status === "rejected"))
      throw new Error("Failed to fetch skills.sh leaderboard");
    const merged = new Map<string, MarketSkill>();
    for (const result of results)
      if (result.status === "fulfilled")
        for (const item of result.value) {
          const previous = merged.get(item.id);
          if (!previous || item.installs > previous.installs)
            merged.set(item.id, item);
        }
    return [...merged.values()].sort((a, b) => b.installs - a.installs);
  }
  installRemote(source: string, skillId: string, scope: string, cwd?: string) {
    return mutations.run(this.home, async () => {
      const parts = source.split("/");
      if (
        parts.length !== 2 ||
        parts.some(
          (p) => !/^[A-Za-z0-9_.-]{1,255}$/.test(p) || p === "." || p === "..",
        )
      )
        throw new Error("Skill source must be a GitHub owner/repository");
      skillId = validateSkillName(skillId);
      const roots = [
        await this.agentRoot("codex", scope, cwd),
        await this.agentRoot("cc", scope, cwd),
      ];
      for (const root of roots) await checkRoot(root);
      const temp = await mkdtemp(join(tmpdir(), "session-skill-"));
      try {
        const repo = join(temp, "repo");
        await clone(
          this.options.repositoryUrl?.(source) ??
            `https://github.com/${source}.git`,
          repo,
        );
        const dir = await findSkillDir(repo, skillId);
        const md = join(dir, "SKILL.md");
        const name =
          ((await isFile(md)) ? (await frontMatter(md)).name : undefined) ||
          skillId;
        return await this.installTree(dir, repo, name, roots);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    });
  }
}
async function findSkillDir(repo: string, skillId: string) {
  for (const path of [join(repo, skillId), join(repo, "skills", skillId)])
    if (await isDir(path)) return path;
  let byName: string | undefined;
  let byDirectory: string | undefined;
  const walk = async (path: string, depth: number) => {
    if (basename(path) === skillId) {
      byDirectory ??= path;
      return;
    }
    if (
      !byName &&
      (await isFile(join(path, "SKILL.md"))) &&
      (await frontMatter(join(path, "SKILL.md"))).name === skillId
    )
      byName = path;
    if (depth >= 6) return;
    for (const entry of await readdir(path, { withFileTypes: true }))
      if (entry.isDirectory() && entry.name !== ".git")
        await walk(join(path, entry.name), depth + 1);
  };
  await walk(repo, 0);
  if (byDirectory || byName) return (byDirectory ?? byName)!;
  if (
    (await isFile(join(repo, "SKILL.md"))) ||
    (await isFile(join(repo, "CLAUDE.md")))
  )
    return repo;
  for (const name of ["skills", "skill"])
    if (await isDir(join(repo, name))) return join(repo, name);
  return repo;
}
export function registerSkillsRoutes(
  app: FastifyInstance,
  options: SkillsOptions = {},
) {
  const service = new SkillsService(options);
  const routes: Record<
    string,
    (b: Record<string, unknown>) => Promise<unknown>
  > = {
    "skills/list-marketplace": async (b) => {
      input(b.selected_agent, "selected_agent");
      input(b.scope, "scope");
      return service.listMarketplace();
    },
    "skills/list-installed": (b) =>
      service.listInstalled(
        input(b.selected_agent, "selected_agent"),
        input(b.scope, "scope"),
        cwd(b),
      ),
    "skills/install-marketplace": (b) =>
      service.installMarketplace(
        input(b.skill_md_path, "skill_md_path"),
        input(b.skill_name, "skill_name"),
        input(b.selected_agent, "selected_agent"),
        input(b.scope, "scope"),
        cwd(b),
      ),
    "skills/uninstall-installed": (b) =>
      service.uninstall(
        input(b.skill_name, "skill_name"),
        input(b.selected_agent, "selected_agent"),
        input(b.scope, "scope"),
        cwd(b),
      ),
    "skills/clone-repo": (b) => service.cloneRepo(input(b.url, "url")),
    "skills/groups/write": async (b) => {
      await service.writeGroups(b.config);
      return null;
    },
    "skills/list-central": (b) =>
      service.listCentral(input(b.scope, "scope"), cwd(b)),
    "skills/link-to-agent": async (b) => {
      await service.linkToAgent(
        input(b.skill_name, "skill_name"),
        input(b.agent, "agent"),
        input(b.scope, "scope"),
        cwd(b),
      );
      return null;
    },
    "skills/delete-central": async (b) => {
      await service.deleteCentral(
        input(b.skill_name, "skill_name"),
        input(b.scope, "scope"),
        cwd(b),
      );
      return null;
    },
    "skillssh/leaderboard": (b) => service.leaderboard(input(b.board, "board")),
    "skillssh/search": (b) =>
      service.search(input(b.query, "query"), b.limit as number),
    "skillssh/install": (b) =>
      service.installRemote(
        input(b.source, "source"),
        input(b.skill_id, "skill_id"),
        input(b.scope, "scope"),
        cwd(b),
      ),
  };
  for (const [path, handler] of Object.entries(routes))
    app.post(`/api/${path}`, async (request, reply) =>
      reply
        .type("application/json")
        .send(JSON.stringify(await handler(object(request.body)))),
    );
  app.post("/api/skills/groups/read", () => service.readGroups());
  return service;
}
function cwd(body: Record<string, unknown>): string | undefined {
  return body.cwd == null ? undefined : input(body.cwd, "cwd");
}

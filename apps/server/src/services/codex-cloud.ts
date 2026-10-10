import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { CodexPriorConversation } from "./codex-cloud-history.js";
import type {
  CodexCloudCapability,
  CodexCloudEnvironment,
  CodexCloudSnapshot,
  CodexCloudTaskRequest,
} from "@agent-orchestrator/shared";
const execute = promisify(execFile);
const SNAPSHOT_UNAVAILABLE_TTL_MS = 60_000;
const fail = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
const digest = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value))
    throw fail("云任务标识无效", 400);
  return value;
};
interface Auth {
  access: string;
  accountId: string;
  identity: string;
  plan: string | null;
}
interface SnapshotRecord {
  public: CodexCloudSnapshot;
  file: string;
  remotes: Record<string, string>;
  fileId?: string;
  identity?: string;
}
/** Adapter for the enabled legacy VSIX cloud protocol, never the disabled newWork API. */
export class CodexCloudService {
  private fetcher: typeof fetch;
  private base: string;
  private authFile: string;
  private snapshots = new Map<string, SnapshotRecord>();
  private requests = new Map<string, Promise<unknown>>();
  private snapshotCapability = new Map<
    string,
    { reason: string; expiresAt: number }
  >();
  constructor(
    private options: {
      dataHome: string;
      authFile?: string;
      apiOrigin?: string;
      fetch?: typeof fetch;
      uploadHosts?: string[];
      priorConversation?: (
        request: CodexCloudTaskRequest,
      ) => Promise<CodexPriorConversation>;
    },
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.base = (
      options.apiOrigin ??
      process.env.CODEX_CLOUD_API_BASE_URL ??
      "https://chatgpt.com/backend-api"
    ).replace(/\/$/, "");
    const url = new URL(this.base);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        ))
    )
      throw fail("云任务 API 地址配置无效", 500);
    this.authFile =
      options.authFile ??
      process.env.CODEX_CLOUD_AUTH_FILE ??
      join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
    if (!isAbsolute(this.authFile) || /[\x00-\x1f]/.test(this.authFile))
      throw fail("云任务账号文件配置无效", 500);
  }
  private async auth(): Promise<Auth> {
    let record: any;
    try {
      record = JSON.parse(await readFile(this.authFile, "utf8"));
    } catch {
      throw fail(
        "尚未登录 ChatGPT 云任务账号；请在服务器的原生 Codex CLI 登录后刷新",
        503,
      );
    }
    const access = record.tokens?.access_token,
      accountId =
        record.tokens?.account_id ?? record.tokens?.chatgpt_account_id;
    if (
      typeof access !== "string" ||
      !access ||
      typeof accountId !== "string" ||
      !accountId
    )
      throw fail(
        "旧 Codex 云任务需要 ChatGPT 登录；当前 API Key 或自定义模型账号不能提供云任务",
        503,
      );
    let claims: any = {};
    try {
      claims = JSON.parse(
        Buffer.from(access.split(".")[1] ?? "", "base64url").toString(),
      );
    } catch {
      /* Opaque access tokens are also valid. */
    }
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now())
      throw fail("ChatGPT 登录已过期；请重新登录原生 Codex CLI 后刷新", 401);
    return {
      access,
      accountId,
      identity: digest(accountId + "\0" + access),
      plan: claims["https://api.openai.com/auth"]?.chatgpt_plan_type ?? null,
    };
  }
  async capability(): Promise<CodexCloudCapability> {
    try {
      const auth = await this.auth();
      const cached = this.snapshotCapability.get(auth.identity);
      if (cached && cached.expiresAt <= Date.now())
        this.snapshotCapability.delete(auth.identity);
      const snapshotReason = this.snapshotCapability.get(auth.identity)?.reason;
      return {
        configured: true,
        available: true,
        identity: auth.identity,
        plan: auth.plan,
        reason: null,
        snapshotAvailable: snapshotReason ? false : null,
        snapshotReason: snapshotReason ?? null,
        recovery: snapshotReason
          ? "快照接口暂不可用；1分钟后刷新账号可恢复手动上传入口。刷新不会自动上传或创建任务"
          : "刷新环境以验证当前账号及网络；账号凭证始终保留在服务器",
      };
    } catch (error) {
      return {
        configured: false,
        available: false,
        identity: null,
        plan: null,
        reason: (error as Error).message,
        recovery:
          "在服务器运行原生 codex login 后刷新；也可通过 CODEX_CLOUD_AUTH_FILE 配置账号文件",
      };
    }
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    expectedIdentity?: string,
  ) {
    const auth = await this.auth();
    if (expectedIdentity && auth.identity !== expectedIdentity)
      throw fail("云任务账号已改变，请重新核对账号和待发送内容");
    let response: Response;
    try {
      response = await this.fetcher(this.base + path, {
        method,
        headers: {
          authorization: "Bearer " + auth.access,
          "chatgpt-account-id": auth.accountId,
          "content-type": "application/json",
          originator: "codex_vscode",
          "user-agent": "CodingKanban CodexHostBridge/1",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw fail(
        method === "POST"
          ? "云端操作结果未确认，请先查看任务结果，勿重复提交"
          : "云任务网络连接失败，请重试",
        504,
      );
    }
    if (!response.ok) {
      const snapshotUnavailable =
        path.startsWith("/wham/worktree_snapshots/") &&
        [403, 404].includes(response.status);
      const reason = snapshotUnavailable
        ? `当前账号的云工作区快照接口不可用（HTTP ${response.status}），请检查账号能力或云 API 配置后刷新`
        : response.status === 401
          ? "云任务账号登录已过期，请重新登录"
          : response.status === 403
            ? "当前账号没有该云任务能力或访问权限"
            : response.status === 429
              ? "云任务额度不足或请求过于频繁，请稍后刷新额度"
              : response.status >= 500
                ? "云任务服务暂时不可用，请稍后恢复"
                : "云任务请求未被服务器接受";
      if (snapshotUnavailable)
        this.snapshotCapability.set(auth.identity, {
          reason,
          expiresAt: Date.now() + SNAPSHOT_UNAVAILABLE_TTL_MS,
        });
      throw fail(reason, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw fail(
        "云任务服务器返回了无法解析的结果，请刷新查看真实任务状态",
        502,
      );
    }
  }
  async environments(identity?: string): Promise<CodexCloudEnvironment[]> {
    const value = await this.request(
      "/wham/environments",
      "GET",
      undefined,
      identity,
    );
    const items = Array.isArray(value)
      ? value
      : (value.environments ?? value.items);
    if (!Array.isArray(items)) throw fail("云任务环境响应格式不兼容", 502);
    return items.map((item: any) => ({
      id: id(item.id),
      name: String(item.name ?? item.display_name ?? item.id),
      repositories: Object.keys(item.repo_map ?? {}),
    }));
  }
  tasks(identity?: string) {
    return this.request(
      "/wham/tasks/list?limit=20",
      "GET",
      undefined,
      identity,
    );
  }
  task(taskId: string, identity?: string) {
    return this.request(
      "/wham/tasks/" + id(taskId),
      "GET",
      undefined,
      identity,
    );
  }
  logs(taskId: string, turnId: string, identity?: string) {
    return this.request(
      "/wham/tasks/" + id(taskId) + "/turns/" + id(turnId) + "/logs",
      "GET",
      undefined,
      identity,
    );
  }
  turns(taskId: string, identity?: string) {
    return this.request(
      "/wham/tasks/" + id(taskId) + "/turns",
      "GET",
      undefined,
      identity,
    );
  }
  private git(cwd: string, args: string[]) {
    return execute("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).then((result) => result.stdout);
  }
  async prepare(cwd: string): Promise<CodexCloudSnapshot> {
    cwd = await realpath(cwd);
    const gitRoot = (
      await this.git(cwd, ["rev-parse", "--show-toplevel"])
    ).trim();
    if ((await realpath(gitRoot)) !== cwd)
      throw fail("请选择 Git 工作区根目录后准备云快照", 400);
    const commitSha = (await this.git(cwd, ["rev-parse", "HEAD"])).trim();
    if (!/^[a-f0-9]{40,64}$/.test(commitSha))
      throw fail("云快照需要至少一个 HEAD 提交");
    const branch =
      (await this.git(cwd, ["branch", "--show-current"])).trim() || commitSha;
    const listed = (
      await this.git(cwd, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ])
    )
      .split("\0")
      .filter(Boolean);
    const files: string[] = [],
      remotes: Record<string, string> = {};
    let total = 0;
    for (const file of new Set(listed)) {
      if (
        file.startsWith("-") ||
        isAbsolute(file) ||
        file.split("/").includes("..") ||
        file.includes("\0")
      )
        throw fail("工作区包含无法安全归档的文件名", 400);
      const absolute = join(cwd, file),
        info = await lstat(absolute).catch(() => null);
      if (!info) continue;
      const real = await realpath(absolute),
        rel = relative(cwd, real);
      if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
        throw fail("工作区包含指向项目外的文件链接，未创建快照", 400);
      if (info.isDirectory()) continue;
      total += info.size;
      files.push(file);
      if (total > 200 * 1024 * 1024 || files.length > 20_000)
        throw fail("工作区超出 200 MiB 或 20,000 文件快照限制", 413);
    }
    for (const line of (await this.git(cwd, ["remote", "-v"])).split(/\r?\n/)) {
      const parts = line.split(/\s+/);
      if (parts[2] !== "(push)") continue;
      let remote = parts[1]!;
      try {
        const parsed = new URL(remote);
        parsed.username = "";
        parsed.password = "";
        parsed.search = "";
        parsed.hash = "";
        remote = parsed.toString();
      } catch {
        /* SSH remotes carry repository identity, not an HTTP bearer. */
      }
      if (/^[a-zA-Z0-9_.-]+$/.test(parts[0] ?? "")) remotes[parts[0]!] = remote;
    }
    const snapshotId = randomUUID(),
      filename =
        basename(cwd).replace(/[^a-zA-Z0-9_.-]/g, "-") +
        "-snapshot-" +
        snapshotId +
        ".tar.gz";
    const directory = join(this.options.dataHome, "codex-cloud", "snapshots");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, filename);
    await new Promise<void>((accept, reject) => {
      const child = spawn(
        "tar",
        [
          "--null",
          "--verbatim-files-from",
          "-czf",
          file,
          "-C",
          cwd,
          "--files-from",
          "-",
        ],
        { stdio: ["pipe", "ignore", "ignore"] },
      );
      child.on("error", () => reject(fail("无法运行快照归档工具", 503)));
      child.on("close", (code) =>
        code === 0
          ? accept()
          : reject(fail("工作区在准备期间发生变化或文件无法归档，请重试")),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(files.join("\0") + (files.length ? "\0" : ""));
    }).catch(async (error) => {
      await rm(file, { force: true });
      throw error;
    });
    const bytes = (await stat(file)).size,
      sha256 = digest(await readFile(file));
    const snapshot: CodexCloudSnapshot = {
      id: snapshotId,
      cwd,
      filename,
      bytes,
      files,
      commitSha,
      branch,
      sha256,
      state: "prepared",
    };
    this.snapshots.set(snapshotId, { public: snapshot, file, remotes });
    return snapshot;
  }
  private snapshot(snapshotId: string, cwd: string) {
    const record = this.snapshots.get(id(snapshotId));
    if (!record || record.public.cwd !== cwd)
      throw fail("快照已过期或不属于原会话项目，请重新准备");
    return record;
  }
  async upload(
    snapshotId: string,
    cwd: string,
    identity: string,
  ): Promise<CodexCloudSnapshot> {
    const record = this.snapshot(snapshotId, cwd);
    if (record.public.state === "verified" && record.identity === identity)
      return record.public;
    if (record.public.state === "uploading")
      throw fail("快照正在上传，请等待当前请求完成");
    record.public.state = "uploading";
    try {
      if (digest(await readFile(record.file)) !== record.public.sha256)
        throw fail("快照文件已改变，请重新准备");
      const signed = await this.request(
        "/wham/worktree_snapshots/upload_url",
        "POST",
        {
          repo_name: basename(cwd),
          filename: record.public.filename,
          content_type: "application/gzip",
          anticipated_file_size: record.public.bytes,
        },
        identity,
      );
      const url = new URL(signed.upload_url),
        hosts = this.options.uploadHosts ?? [
          ".blob.core.windows.net",
          ".amazonaws.com",
          ".openai.com",
          "chatgpt.com",
        ];
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !hosts.some((host) =>
          host.startsWith(".")
            ? url.hostname.endsWith(host)
            : url.hostname === host,
        )
      )
        throw fail("云端快照上传地址不在受信列表，未上传", 502);
      const stream = createReadStream(record.file);
      let uploaded: Response;
      try {
        uploaded = await this.fetcher(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/gzip",
            "Content-Length": String(record.public.bytes),
            "x-ms-blob-type": "BlockBlob",
          },
          body: stream as unknown as BodyInit,
          duplex: "half",
          redirect: "error",
          signal: AbortSignal.timeout(120_000),
        } as RequestInit);
      } finally {
        stream.destroy();
      }
      if (!uploaded.ok) throw fail("云端快照上传失败，尚未创建任务", 502);
      const finished = await this.request(
        "/wham/worktree_snapshots/finish_upload",
        "POST",
        { file_id: signed.file_id, etag: signed.etag },
        identity,
      );
      if (
        finished.file_id !== signed.file_id ||
        typeof finished.file_id !== "string"
      )
        throw fail("云端快照校验未确认，尚未创建任务", 502);
      record.fileId = finished.file_id;
      record.identity = identity;
      record.public.state = "verified";
      return record.public;
    } catch (error) {
      record.public.state = "failed";
      throw error;
    }
  }
  async create(request: CodexCloudTaskRequest): Promise<unknown> {
    const auth = await this.auth();
    if (auth.identity !== request.identity)
      throw fail("云任务账号已改变，请重新核对账号和待发送内容");
    id(request.requestId);
    if (!request.prompt.trim() || request.prompt.length > 800_000)
      throw fail("云任务内容为空或过长", 400);
    const input_items: unknown[] = [
      {
        type: "message",
        role: "user",
        content: [{ content_type: "text", text: request.prompt }],
      },
    ];
    if (request.localDelegation) {
      if (!request.owner.threadId || !this.options.priorConversation)
        throw fail("原会话历史委派能力尚未连接，未创建云任务", 503);
      const prior = await this.options.priorConversation(request);
      if (prior.conversation.length)
        input_items.push({
          type: "prior_conversation",
          conversation: prior.conversation,
          diff: prior.diff,
        });
    }
    let task: unknown;
    if (request.taskId) {
      if (!request.turnId) throw fail("续聊需要真实云端轮次", 400);
      task = {
        follow_up: {
          task_id: id(request.taskId),
          turn_id: id(request.turnId),
          environment_mode: "code",
        },
      };
    } else {
      let environment: unknown,
        branch = "HEAD";
      if (request.snapshotId) {
        const record = this.snapshot(request.snapshotId, request.owner.cwd);
        if (
          record.public.state !== "verified" ||
          record.identity !== request.identity ||
          !record.fileId
        )
          throw fail("工作区快照尚未上传并校验，未创建任务");
        branch = record.public.branch;
        environment = {
          repos: [
            {
              kind: "local_worktree",
              name: basename(request.owner.cwd),
              remotes: record.remotes,
              commit_sha: record.public.commitSha,
              branch,
              file_id: record.fileId,
            },
          ],
        };
      } else if (!request.environmentId)
        throw fail("请选择环境或上传工作区快照", 400);
      task = {
        new_task: {
          branch,
          ...(request.environmentId
            ? { environment_id: id(request.environmentId) }
            : {}),
          ...(environment ? { environment } : {}),
          run_environment_in_qa_mode: false,
        },
      };
    }
    const payload = {
      ...(task as object),
      ...(request.modelSlug
        ? { metadata: { model_slug: request.modelSlug } }
        : {}),
      input_items,
    };
    const fingerprint = digest(
        JSON.stringify([request.owner, request.identity, payload]),
      ),
      receiptKey = digest(JSON.stringify([request.owner, request.requestId]));
    const directory = join(this.options.dataHome, "codex-cloud", "requests"),
      receipt = join(directory, receiptKey + ".json");
    if (this.requests.has(receiptKey)) return this.requests.get(receiptKey)!;
    const operation = (async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        const old = JSON.parse(await readFile(receipt, "utf8"));
        if (old.fingerprint !== fingerprint)
          throw fail("同一请求标识的内容已改变，未再次提交");
        if (old.state === "complete") return old.result;
        throw fail("云端操作结果待核查，请查看任务列表后再决定下一步");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await writeFile(
        receipt,
        JSON.stringify({ fingerprint, state: "pending" }),
        { flag: "wx", mode: 0o600 },
      );
      try {
        const result = await this.request(
          "/wham/tasks",
          "POST",
          payload,
          request.identity,
        );
        await writeFile(
          receipt,
          JSON.stringify({ fingerprint, state: "complete", result }),
          { mode: 0o600 },
        );
        return result;
      } catch (error) {
        await writeFile(
          receipt,
          JSON.stringify({ fingerprint, state: "unknown" }),
          { mode: 0o600 },
        );
        throw error;
      }
    })();
    this.requests.set(receiptKey, operation);
    try {
      return await operation;
    } finally {
      this.requests.delete(receiptKey);
    }
  }
}

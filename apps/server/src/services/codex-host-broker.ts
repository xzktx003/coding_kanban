import { randomUUID } from "node:crypto";
import type {
  CodexEditorContext,
  CodexHostCapabilities,
  CodexHostCommand,
  CodexHostOwner,
  CodexHostStatus,
} from "@agent-orchestrator/shared";
type Binding = {
  owner: CodexHostOwner;
  editorKey: string;
  touched: number;
  active: boolean;
  events: CodexEditorContext[];
};
type Connection = {
  id: string;
  cwd: string;
  editorKey: string;
  capabilities: CodexHostCapabilities;
  touched: number;
  commands: Array<{ id: string; command: CodexHostCommand }>;
};
type Pending = {
  nonce: string;
  instanceId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
const disabled: CodexHostCapabilities = {
  context: false,
  openLocation: false,
  showDiff: false,
  todoCodeLens: false,
  lsp: false,
};
const fail = (message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
const ownerKey = (owner: CodexHostOwner) =>
  JSON.stringify([
    owner.cwd,
    owner.threadId,
    owner.draftOwner,
    owner.agentId ?? "",
  ]);
/** Only a private authenticated companion supplies capabilities and results. */
export class CodexHostBroker {
  private bindings = new Map<string, Binding>();
  private connections = new Map<string, Connection>();
  private pending = new Map<string, Pending>();
  constructor(
    private now = Date.now,
    private timeout = 15_000,
  ) {}
  bind(nonce: string, owner: CodexHostOwner, editorKey = owner.cwd) {
    const old = this.bindings.get(nonce);
    if (
      old &&
      (ownerKey(old.owner) !== ownerKey(owner) || old.editorKey !== editorKey)
    )
      throw fail("编辑器会话绑定已存在");
    this.bindings.set(nonce, {
      owner: { ...owner },
      editorKey,
      touched: this.now(),
      active: false,
      events: old?.events ?? [],
    });
  }
  private binding(nonce: string, owner: CodexHostOwner) {
    const binding = this.bindings.get(nonce);
    if (!binding || ownerKey(binding.owner) !== ownerKey(owner))
      throw fail("编辑器会话绑定无效或已过期");
    if (this.now() - binding.touched > 5 * 60_000) {
      this.dispose(nonce, owner);
      throw fail("编辑器会话绑定已过期，请重连");
    }
    binding.touched = this.now();
    return binding;
  }
  private connection(cwd: string, instanceId?: string, editorKey = cwd) {
    const connection = this.connections.get(editorKey);
    if (!connection || this.now() - connection.touched > 10_000)
      throw fail("VS Code 宿主扩展未连接，请安装配套扩展后重新连接", 503);
    if (instanceId && connection.id !== instanceId)
      throw fail("VS Code 宿主实例已改变");
    if (connection.cwd !== cwd) throw fail("VS Code 编辑目录已改变");
    return connection;
  }
  status(nonce: string, owner: CodexHostOwner): CodexHostStatus {
    const binding = this.binding(nonce, owner);
    try {
      const c = this.connection(owner.cwd, undefined, binding.editorKey);
      return {
        available: true,
        reason: null,
        capabilities: c.capabilities,
        instanceId: c.id,
      };
    } catch (error) {
      return {
        available: false,
        reason: (error as Error).message,
        capabilities: disabled,
        instanceId: null,
      };
    }
  }
  connect(
    instanceId: string,
    cwd: string,
    capabilities: CodexHostCapabilities,
    editorKey = cwd,
  ) {
    const old = this.connections.get(editorKey);
    if (old && old.id !== instanceId)
      for (const [id, p] of this.pending)
        if (p.instanceId === old.id) {
          clearTimeout(p.timer);
          this.pending.delete(id);
          p.reject(fail("VS Code 宿主实例已改变，请重新执行操作"));
        }
    this.connections.set(editorKey, {
      id: instanceId,
      cwd,
      editorKey,
      capabilities,
      touched: this.now(),
      commands: old?.id === instanceId ? old.commands : [],
    });
  }
  poll(instanceId: string, cwd: string, editorKey = cwd) {
    const c = this.connection(cwd, instanceId, editorKey);
    c.touched = this.now();
    return {
      commands: c.commands.splice(0),
      active: [...this.bindings.entries()]
        .filter(
          ([, b]) =>
            b.editorKey === editorKey &&
            b.owner.cwd === cwd &&
            b.active &&
            this.now() - b.touched < 10_000,
        )
        .map(([nonce]) => nonce),
    };
  }
  command(
    nonce: string,
    owner: CodexHostOwner,
    command: CodexHostCommand,
  ): Promise<unknown> {
    const binding = this.binding(nonce, owner);
    const c = this.connection(owner.cwd, undefined, binding.editorKey);
    const capability =
      command.type === "definitions"
        ? "lsp"
        : command.type === "workspaceState"
          ? "context"
          : command.type;
    if (!c.capabilities[capability])
      throw fail("当前 VS Code 宿主不支持该能力", 503);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        c.commands = c.commands.filter((item) => item.id !== id);
        reject(fail("VS Code 操作超时，请重连后重试", 504));
      }, this.timeout);
      this.pending.set(id, { nonce, instanceId: c.id, resolve, reject, timer });
      c.commands.push({ id, command });
    });
  }
  complete(
    instanceId: string,
    cwd: string,
    id: string,
    result: unknown,
    error?: string,
    editorKey = cwd,
  ) {
    this.connection(cwd, instanceId, editorKey);
    const p = this.pending.get(id);
    if (
      !p ||
      p.instanceId !== instanceId ||
      this.bindings.get(p.nonce)?.owner.cwd !== cwd ||
      this.bindings.get(p.nonce)?.editorKey !== editorKey
    )
      throw fail("VS Code 操作实例或会话已过期");
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (error) p.reject(fail(error));
    else p.resolve(result);
  }
  activate(nonce: string, owner: CodexHostOwner, active: boolean) {
    const binding = this.binding(nonce, owner);
    if (active)
      for (const b of this.bindings.values())
        if (b.editorKey === binding.editorKey) b.active = false;
    binding.active = active;
  }
  publish(
    instanceId: string,
    cwd: string,
    context: CodexEditorContext,
    editorKey = cwd,
  ) {
    this.connection(cwd, instanceId, editorKey);
    const active = [...this.bindings.values()].filter(
      (b) =>
        b.editorKey === editorKey &&
        b.owner.cwd === cwd &&
        b.active &&
        this.now() - b.touched < 10_000,
    );
    if (active.length !== 1)
      throw fail("请先在看板中激活目标会话，再添加 TODO 上下文");
    if (active[0]!.events.length >= 30)
      throw fail("上下文待处理过多，请先回到目标会话");
    active[0]!.events.push(context);
  }
  events(nonce: string, owner: CodexHostOwner) {
    return this.binding(nonce, owner).events.splice(0);
  }
  editorWorkspace(nonce: string, owner: CodexHostOwner) {
    return this.binding(nonce, owner).editorKey;
  }
  languageStatus(cwd: string, editorKey: string) {
    const connection = this.connection(cwd, undefined, editorKey);
    return {
      instanceId: connection.id,
      available: connection.capabilities.lsp,
      reason: connection.capabilities.lsp
        ? null
        : "VS Code 可选语言服务未启用，请启用 codingKanban.host.lsp",
    };
  }
  async languageCommand(
    owner: CodexHostOwner,
    editorKey: string,
    instanceId: string,
    command: Extract<CodexHostCommand, { type: "definitions" }>,
  ) {
    this.connection(owner.cwd, instanceId, editorKey);
    const nonce = "mcp-" + randomUUID();
    this.bind(nonce, owner, editorKey);
    try {
      return await this.command(nonce, owner, command);
    } finally {
      this.dispose(nonce, owner);
    }
  }
  dispose(nonce: string, owner: CodexHostOwner) {
    const b = this.bindings.get(nonce);
    if (!b || ownerKey(b.owner) !== ownerKey(owner)) return;
    this.bindings.delete(nonce);
    for (const [id, p] of this.pending)
      if (p.nonce === nonce) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(fail("原编辑器会话已离开，操作未应用到其他会话"));
      }
  }
}

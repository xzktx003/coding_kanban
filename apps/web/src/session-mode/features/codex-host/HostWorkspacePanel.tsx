import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CodexHostOwner,
  CodexHostWorkspace,
} from "@agent-orchestrator/shared";
import { Button } from "@session/components/ui/button";
import { editorHostWorkspace } from "./bridge";
import { useSessionLeaveGuard } from "@session/hooks/useSessionLeaveGuard";
type Draft = {
  instructions: string;
  revision: string;
  baseText: string;
  branch: string;
};
type Runtime = {
  workspace: CodexHostWorkspace | null;
  busy: boolean;
  error: string | null;
  worktree: string | null;
  mcpConfig: unknown;
};
const empty: Runtime = {
  workspace: null,
  busy: false,
  error: null,
  worktree: null,
  mcpConfig: null,
};
const drafts = create<{ sessions: Partial<Record<string, Draft>> }>()(
  persist(() => ({ sessions: {} }), {
    name: "kanban.session.codex-host-workspace-drafts",
  }),
);
const runtime = create<{ sessions: Record<string, Runtime> }>(() => ({
  sessions: {},
}));
const changeDraft = (key: string, update: Partial<Draft>) =>
  drafts.setState((s) => ({
    sessions: {
      ...s.sessions,
      [key]: {
        instructions: "",
        revision: "",
        baseText: "",
        branch: "",
        ...s.sessions[key],
        ...update,
      },
    },
  }));
const changeRuntime = (key: string, update: Partial<Runtime>) =>
  runtime.setState((s) => ({
    sessions: {
      ...s.sessions,
      [key]: { ...(s.sessions[key] ?? empty), ...update },
    },
  }));
export function HostWorkspacePanel({ owner }: { owner: CodexHostOwner }) {
  const key = JSON.stringify([owner.draftOwner, owner.agentId ?? ""]);
  const { workspace, busy, error, worktree, mcpConfig } = runtime(
    (s) => s.sessions[key] ?? empty,
  );
  const draft = drafts((s) => s.sessions[key]),
    instructions = draft?.instructions ?? "",
    branch = draft?.branch ?? "";
  const dirty = !!draft && draft.instructions !== draft.baseText;
  useSessionLeaveGuard(dirty, busy && dirty);
  async function run<T>(
    action: Record<string, unknown>,
    accept: (value: T, capturedKey: string) => void,
  ) {
    const captured = { ...owner },
      capturedKey = key;
    if (runtime.getState().sessions[capturedKey]?.busy) return;
    changeRuntime(capturedKey, { busy: true, error: null });
    try {
      accept(await editorHostWorkspace<T>(captured, action), capturedKey);
    } catch (error) {
      changeRuntime(capturedKey, { error: String(error) });
    } finally {
      changeRuntime(capturedKey, { busy: false });
    }
  }
  const confirmed = (
    message: string,
    action: Record<string, unknown>,
    accept: (value: any, capturedKey: string) => void,
  ) => {
    if (window.confirm(`${message}\n项目：${owner.cwd}`))
      void run({ ...action, confirmed: true }, accept);
  };
  const acceptGit = (
    value: Partial<CodexHostWorkspace>,
    capturedKey: string,
  ) => {
    const current = runtime.getState().sessions[capturedKey]?.workspace;
    if (current)
      changeRuntime(capturedKey, { workspace: { ...current, ...value } });
  };
  return (
    <details className="rounded border p-2">
      <summary>分支、工作区与项目配置</summary>
      <div className="mt-2 space-y-2 text-xs">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run<CodexHostWorkspace>(
              { action: "read" },
              (value, capturedKey) => {
                changeRuntime(capturedKey, { workspace: value });
                const saved = drafts.getState().sessions[capturedKey];
                if (!saved || saved.instructions === saved.baseText)
                  changeDraft(capturedKey, {
                    instructions: value.agents.text,
                    baseText: value.agents.text,
                    revision: value.agents.revision,
                    branch: saved?.branch || value.branch || "",
                  });
              },
            )
          }
        >
          读取当前项目配置
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run({ action: "mcpConfig" }, (value, capturedKey) =>
              changeRuntime(capturedKey, { mcpConfig: value }),
            )
          }
        >
          获取可选 LSP MCP 配置
        </Button>
        {mcpConfig !== null && (
          <div className="space-y-1">
            <p>
              在 VS Code 设置中启用 <code>codingKanban.host.lsp</code>
              ，再将以下配置添加到 Codex MCP
              设置。定义查询会绑定这个编辑工作区；配套扩展凭证由服务器私有文件提供。
            </p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border p-2">
              {JSON.stringify(mcpConfig, null, 2)}
            </pre>
          </div>
        )}
        {workspace && (
          <>
            {workspace.git?.repoRoot && (
              <p>
                Git 仓库：
                <code className="break-all">{workspace.git.repoRoot}</code>
              </p>
            )}
            {workspace.git?.reason && <p>{workspace.git.reason}</p>}
            {!workspace.git && (
              <p>Git 仓库信息尚未读取，请重新读取项目配置。</p>
            )}
            {workspace.git?.available && (
              <>
                <p>
                  {workspace.branch || "游离 HEAD"} ·{" "}
                  {workspace.dirty ? "存在未提交文件" : "Git 工作区干净"}
                </p>
                <label className="block">
                  分支名称
                  <input
                    aria-label="分支名称"
                    className="mt-1 w-full rounded border bg-background p-1"
                    value={branch}
                    onChange={(e) =>
                      changeDraft(key, { branch: e.target.value })
                    }
                    list="codex-host-branches"
                  />
                </label>
                <datalist id="codex-host-branches">
                  {workspace.branches.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy || !workspace.git.mutationAllowed || !branch.trim()
                    }
                    onClick={() =>
                      confirmed(
                        `创建分支 ${branch}，保留当前分支？`,
                        { action: "createBranch", name: branch },
                        acceptGit,
                      )
                    }
                  >
                    创建分支
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      !workspace.git.mutationAllowed ||
                      workspace.dirty ||
                      !workspace.branches.includes(branch) ||
                      branch === workspace.branch
                    }
                    onClick={() =>
                      confirmed(
                        `切换到 ${branch}？此操作改变项目文件；请确认使用该目录的 Agent 当前没有执行任务。服务端会核验 Git 与 VS Code 未保存缓冲。`,
                        { action: "checkout", name: branch },
                        acceptGit,
                      )
                    }
                  >
                    切换分支
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      !workspace.git.mutationAllowed ||
                      !workspace.branches.includes(branch)
                    }
                    onClick={() =>
                      confirmed(
                        `为 ${branch} 创建独立 Git 工作区？`,
                        { action: "createWorktree", name: branch },
                        (value, capturedKey) =>
                          changeRuntime(capturedKey, { worktree: value.path }),
                      )
                    }
                  >
                    创建独立工作区
                  </Button>
                </div>
              </>
            )}
            {worktree && (
              <p>
                独立工作区：<code className="break-all">{worktree}</code>
              </p>
            )}
            <label className="block">
              项目 AGENTS.md
              <textarea
                aria-label="项目 AGENTS.md"
                className="mt-1 min-h-28 w-full rounded border bg-background p-2"
                value={instructions}
                onChange={(e) =>
                  changeDraft(key, { instructions: e.target.value })
                }
              />
            </label>
            {dirty && draft.revision !== workspace.agents.revision && (
              <p className="text-destructive">
                项目 AGENTS.md 已有外部修改，请合并本设备草稿后再保存。
              </p>
            )}
            <Button
              size="sm"
              disabled={busy || !dirty}
              onClick={() =>
                confirmed(
                  "保存项目 AGENTS.md？外部修改会阻止覆盖。",
                  {
                    action: "instructions",
                    text: instructions,
                    revision: draft?.revision,
                  },
                  (agents, capturedKey) => {
                    acceptGit({ agents }, capturedKey);
                    const current = drafts.getState().sessions[capturedKey];
                    changeDraft(capturedKey, {
                      baseText: agents.text,
                      revision: agents.revision,
                      ...(current?.instructions === instructions
                        ? { instructions: agents.text }
                        : {}),
                    });
                  },
                )
              }
            >
              保存 AGENTS.md
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run<CodexHostWorkspace["recommendedSkills"]>(
                  { action: "recommended", refresh: true },
                  (recommendedSkills, capturedKey) =>
                    acceptGit({ recommendedSkills }, capturedKey),
                )
              }
            >
              刷新 OpenAI 推荐技能
            </Button>
            {workspace.recommendedSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-start gap-2 rounded border p-2"
              >
                <div className="min-w-0 flex-1">
                  <strong>{skill.name}</strong>
                  <p>{skill.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || skill.installed}
                  onClick={() =>
                    confirmed(
                      `将 ${skill.name} 安装到本项目 .agents/skills/${skill.id}？同名文件不会覆盖。`,
                      { action: "installSkill", skillId: skill.id },
                      (_value, capturedKey) => {
                        const current =
                          runtime.getState().sessions[capturedKey]?.workspace;
                        if (current)
                          acceptGit(
                            {
                              recommendedSkills: current.recommendedSkills.map(
                                (s) =>
                                  s.id === skill.id
                                    ? { ...s, installed: true }
                                    : s,
                              ),
                            },
                            capturedKey,
                          );
                      },
                    )
                  }
                >
                  {skill.installed ? "已安装" : "安装"}
                </Button>
              </div>
            ))}
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}

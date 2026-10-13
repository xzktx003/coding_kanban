import {
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  RefreshCw,
  Search,
  SquarePen,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import openai from "@session/assets/openai.svg";
import type { CodexProjectConversation } from "./project-conversations";

export type ProjectConversationState = {
  loading: boolean;
  error: string | null;
  conversations: CodexProjectConversation[];
};

function projectName(path: string) {
  return path.split("/").filter(Boolean).at(-1) || path;
}

function conversationName(conversation: CodexProjectConversation) {
  return (
    conversation.name?.trim() || conversation.preview.trim() || "未命名会话"
  );
}

function conversationAge(updatedAt: number) {
  const seconds = Math.max(0, Date.now() / 1000 - updatedAt);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function CodexProjectNavigation({
  projects,
  projectsLoading,
  projectsError,
  selectedProject,
  conversationStates,
  canResume,
  openingThreadIds,
  openThreadIds,
  mobilePane,
  onDismiss,
  onSelectProject,
  onRetryProjects,
  onRetryConversations,
  onOpenConversation,
  onNewChat,
  onEnsureProject,
}: {
  projects: string[];
  projectsLoading: boolean;
  projectsError: string | null;
  selectedProject: string | null;
  conversationStates: Record<string, ProjectConversationState>;
  canResume: boolean;
  openingThreadIds: readonly string[];
  openThreadIds: readonly string[];
  mobilePane: "sessions" | "native";
  onDismiss: () => void;
  onSelectProject: (project: string) => void;
  onRetryProjects: () => void;
  onRetryConversations: (project: string) => void;
  onOpenConversation: (conversation: CodexProjectConversation) => void;
  onNewChat: (project: string) => void;
  onEnsureProject?: (project: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const loadedProjects = useRef(new Set<string>());
  useEffect(() => {
    for (const project of projects) {
      const open = expanded[project] ?? project === selectedProject;
      if (!open || loadedProjects.current.has(project)) continue;
      loadedProjects.current.add(project);
      onEnsureProject?.(project);
    }
  }, [expanded, onEnsureProject, projects, selectedProject]);
  const needle = query.trim().toLowerCase();
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (!needle) return true;
        if (projectName(project).toLowerCase().includes(needle)) return true;
        return (conversationStates[project]?.conversations ?? []).some((item) =>
          `${conversationName(item)} ${item.preview}`.toLowerCase().includes(needle),
        );
      }),
    [conversationStates, needle, projects],
  );

  return (
    <aside
      className="codex-project-navigation"
      aria-label="项目与 Codex 会话"
      data-mobile-pane={mobilePane}
    >
      <button
        type="button"
        className="codex-project-dismiss"
        onClick={onDismiss}
        aria-label="关闭项目会话面板"
      >
        ×
      </button>
      <div className="codex-sidebar-search-row">
        <label className="codex-search-trigger">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            aria-label="搜索会话"
            placeholder="搜索会话"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {projectsError && (
          <button
            type="button"
            className="codex-inline-action"
            onClick={onRetryProjects}
            aria-label="重试读取项目"
            title={projectsError}
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
      <div className="codex-sidebar-projects">
        <div className="codex-sidebar-projects-heading">
          <span>项目</span>
          {projectsLoading && <span role="status">读取中…</span>}
        </div>
        {projectsError && (
          <p className="codex-navigation-message" role="alert">
            {projectsError}
          </p>
        )}
        <div className="codex-project-list" aria-label="项目列表">
          {visibleProjects.map((project) => {
            const open = needle ? true : (expanded[project] ?? project === selectedProject);
            const state = conversationStates[project];
            const conversations = (state?.conversations ?? []).filter((item) =>
              !needle ||
              projectName(project).toLowerCase().includes(needle) ||
              `${conversationName(item)} ${item.preview}`.toLowerCase().includes(needle),
            );
            return (
              <section
                key={project}
                className="session-project-group"
                data-project-path={project}
              >
                <div className="session-project-heading" title={project}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => {
                      onSelectProject(project);
                      setExpanded((current) => ({ ...current, [project]: !open }));
                    }}
                  >
                    {open ? <FolderOpen size={14} /> : <FolderClosed size={14} />}
                    <span>{projectName(project)}</span>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button
                    type="button"
                    className="session-project-action"
                    aria-label={`在 ${projectName(project)} 打开新聊天`}
                    title={`在 ${projectName(project)} 打开新聊天`}
                    onClick={() => onNewChat(project)}
                  >
                    <SquarePen size={14} />
                  </button>
                </div>
                {open && (
                  <div className="session-project-sessions">
                    {state?.loading && (
                      <p className="codex-navigation-message" role="status">
                        正在读取这个项目的全部会话…
                      </p>
                    )}
                    {state?.error && (
                      <p className="codex-navigation-message" role="alert">
                        {state.error}
                        <button
                          type="button"
                          onClick={() => onRetryConversations(project)}
                          aria-label={`重试读取 ${projectName(project)} 的会话`}
                        >
                          重试
                        </button>
                      </p>
                    )}
                    {!state?.loading && !state?.error && conversations.length === 0 && (
                      <p className="codex-navigation-message">
                        这个项目还没有可恢复的 Codex 会话。
                      </p>
                    )}
                    {conversations.map((conversation) => {
                      const current = openThreadIds.includes(conversation.id);
                      const name = openingThreadIds.includes(conversation.id)
                        ? "正在打开…"
                        : conversationName(conversation);
                      return (
                        <button
                          type="button"
                          key={conversation.id}
                          className="session-nav-row"
                          aria-current={current || undefined}
                          disabled={!canResume && !current}
                          aria-label={`Resume ${conversationName(conversation)}`}
                          title={conversation.preview || name}
                          onClick={() => onOpenConversation(conversation)}
                        >
                          <span className="session-nav-title">
                            <span className="session-agent-symbol" aria-hidden="true">
                              <img src={openai} alt="" />
                            </span>
                            <span className="session-row-title">{name}</span>
                          </span>
                          <span className="session-nav-meta">
                            <span className="session-nav-age">
                              {conversationAge(conversation.updatedAt)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {!projectsLoading && !projectsError && projects.length === 0 && (
            <p className="codex-navigation-message">还没有已登记的项目。</p>
          )}
          {!projectsLoading && !projectsError && projects.length > 0 && visibleProjects.length === 0 && (
            <p className="codex-navigation-message">没有匹配的项目或会话。</p>
          )}
        </div>
      </div>
    </aside>
  );
}

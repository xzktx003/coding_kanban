import { Folder, MessageSquare, RefreshCw } from "lucide-react";
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

export function CodexProjectNavigation({
  projects,
  projectsLoading,
  projectsError,
  selectedProject,
  selectedState,
  canResume,
  openingThreadId,
  mobilePane,
  onSelectProject,
  onRetryProjects,
  onRetryConversations,
  onOpenConversation,
}: {
  projects: string[];
  projectsLoading: boolean;
  projectsError: string | null;
  selectedProject: string | null;
  selectedState: ProjectConversationState | undefined;
  canResume: boolean;
  openingThreadId: string | null;
  mobilePane: "sessions" | "native";
  onSelectProject: (project: string) => void;
  onRetryProjects: () => void;
  onRetryConversations: () => void;
  onOpenConversation: (conversation: CodexProjectConversation) => void;
}) {
  return (
    <aside
      className="codex-project-navigation"
      aria-label="项目与 Codex 会话"
      data-mobile-pane={mobilePane}
    >
      <div className="codex-project-list">
        <div className="codex-navigation-heading">
          <Folder size={15} aria-hidden="true" />
          <strong>项目</strong>
          {projectsLoading && <span role="status">读取中…</span>}
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
        {projectsError && (
          <p className="codex-navigation-message" role="alert">
            {projectsError}
          </p>
        )}
        {projects.map((project) => (
          <button
            type="button"
            key={project}
            className="codex-project-row"
            data-selected={selectedProject === project}
            aria-pressed={selectedProject === project}
            title={project}
            onClick={() => onSelectProject(project)}
          >
            <Folder size={14} aria-hidden="true" />
            <span>{projectName(project)}</span>
            {selectedProject === project &&
              selectedState &&
              !selectedState.loading &&
              !selectedState.error && (
                <span
                  className="codex-count-badge"
                  aria-label={`${selectedState.conversations.length} 个会话`}
                >
                  {selectedState.conversations.length}
                </span>
              )}
          </button>
        ))}
        {!projectsLoading && !projectsError && projects.length === 0 && (
          <p className="codex-navigation-message">还没有已登记的项目。</p>
        )}
      </div>

      <section className="codex-conversation-list" aria-label="项目会话">
        <div className="codex-navigation-heading">
          <MessageSquare size={15} aria-hidden="true" />
          <strong>
            {selectedProject
              ? `${projectName(selectedProject)} 的会话`
              : "会话"}
          </strong>
          {selectedState && !selectedState.loading && !selectedState.error && (
            <span className="codex-conversation-count">
              {selectedState.conversations.length} 个
            </span>
          )}
          {selectedProject && selectedState?.error && (
            <button
              type="button"
              className="codex-inline-action"
              onClick={onRetryConversations}
              aria-label="重试读取会话"
              title={selectedState.error}
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
        {selectedProject && selectedState?.loading && (
          <p className="codex-navigation-message" role="status">
            正在读取这个项目的全部会话…
          </p>
        )}
        {selectedProject && selectedState?.error && (
          <p className="codex-navigation-message" role="alert">
            {selectedState.error}
          </p>
        )}
        {selectedProject &&
          selectedState &&
          !selectedState.loading &&
          !selectedState.error &&
          selectedState.conversations.length === 0 && (
            <p className="codex-navigation-message">
              这个项目还没有可恢复的 Codex 会话。
            </p>
          )}
        {selectedState?.conversations.map((conversation) => (
          <button
            type="button"
            key={conversation.id}
            className="codex-conversation-row"
            disabled={!canResume || openingThreadId !== null}
            aria-label={`Resume ${conversationName(conversation)}`}
            title={conversation.preview || conversationName(conversation)}
            onClick={() => onOpenConversation(conversation)}
          >
            <span className="codex-conversation-row-title">
              {openingThreadId === conversation.id
                ? "正在打开…"
                : conversationName(conversation)}
            </span>
            {conversation.preview &&
              conversation.preview !== conversationName(conversation) && (
                <span className="codex-conversation-row-preview">
                  {conversation.preview}
                </span>
              )}
          </button>
        ))}
      </section>
    </aside>
  );
}

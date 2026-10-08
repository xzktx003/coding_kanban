import { ArrowLeft } from "lucide-react";
import { useLayoutStore } from "../../stores/useLayoutStore";
import { secondaryPages } from "../../services/sessionPageHistory";
import { useActiveSessionProject } from "../../hooks/useActiveSessionProject";

export function SessionSecondaryHeader() {
  const { view, setView } = useLayoutStore();
  const project = useActiveSessionProject();
  const page = secondaryPages.find((item) => item.view === view);
  if (!page) return null;
  return <header className="session-secondary-header">
    <button type="button" className="session-return-button" onClick={() => setView("agent")}><ArrowLeft size={16} aria-hidden="true" />返回会话</button>
    <h1 tabIndex={-1} data-session-page-heading>{page.label}</h1>
    <select aria-label="切换功能页" value={page.view} onChange={(event) => {
      const next = secondaryPages.find((item) => item.view === event.target.value);
      if (next) setView(next.view);
    }}>{secondaryPages.map((item) => <option key={item.view} value={item.view}>{item.label}</option>)}</select>
    <span className="session-return-context" title={project.path ?? undefined}>{project.path ? `返回项目：${project.label}` : "返回会话工作区"}</span>
  </header>;
}

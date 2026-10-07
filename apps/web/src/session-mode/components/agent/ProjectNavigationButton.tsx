import { FolderOpen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebar } from "../ui/sidebar";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { getFilename } from "@session/utils/getFilename";

export function ProjectNavigationButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const sidebar = useSidebar();
  const cwd = useWorkspaceStore((state) => state.cwd);
  const expanded = sidebar.isMobile ? sidebar.openMobile : sidebar.open;
  const PanelIcon = expanded ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      type="button"
      className={`session-project-trigger ${compact ? "session-mobile-projects" : "session-desktop-projects"}`}
      aria-label="项目与会话"
      aria-expanded={expanded}
      title={`${expanded ? "收起" : "展开"}项目与会话列表${cwd ? ` · ${cwd}` : ""}`}
      onClick={() =>
        sidebar.isMobile
          ? sidebar.setOpenMobile(!sidebar.openMobile)
          : sidebar.setOpen(!sidebar.open)
      }
    >
      <FolderOpen size={16} aria-hidden="true" />
      <span>{compact ? "项目" : getFilename(cwd) || "选择项目"}</span>
      {!compact && <PanelIcon size={14} aria-hidden="true" />}
    </button>
  );
}

import { SlidersHorizontal } from "lucide-react";
import { useSidebar } from "../ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  useAgentCenterStore,
  type AgentCardsViewMode,
} from "@session/stores/useAgentCenterStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAcpStore } from "@session/stores/useAcpStore";

import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { OpenAppMenu } from "./openApp/OpenAppMenu";
import { ProjectNavigationButton } from "./ProjectNavigationButton";

export function MobileProjectButton() {
  return <ProjectNavigationButton compact />;
}

/** Mobile keeps the transcript tall; secondary tools remain one tap away. */
export function MobileSessionTools() {
  const sidebar = useSidebar();
  const cwd = useWorkspaceStore((s) => s.cwd);
  const layout = useLayoutStore();
  const tabs = useAgentCenterStore();
  const acp = useAcpStore((s) => s.active);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="session-mobile-tools"
          aria-label="会话工具"
        >
          <SlidersHorizontal size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => sidebar.setOpenMobile(true)}>
          项目与会话
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={acp ? "solo" : tabs.cardsViewMode}
          onValueChange={(v) => tabs.setCardsViewMode(v as AgentCardsViewMode)}
        >
          <DropdownMenuRadioItem value="solo">自由分屏</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="grid" disabled={acp}>
            多会话网格
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="list" disabled={acp}>
            会话列表
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {(
          [
            ["files", "文件浏览器"],
            ["terminal", "终端"],
            ["diff", "代码变更"],
          ] as const
        ).map(([tab, label]) => (
          <DropdownMenuItem
            key={tab}
            onSelect={() => {
              layout.setActiveRightPanelTab(tab);
              layout.setRightPanelOpen(true);
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
        {cwd && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1">
              <OpenAppMenu path={cwd} />
            </div>
          </>
        )}
        {layout.isRightPanelOpen && (
          <DropdownMenuItem onSelect={() => layout.setRightPanelOpen(false)}>
            收起工具面板
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

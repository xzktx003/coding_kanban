import { useState } from "react";
import {
  MoreHorizontal,
  Plug,
  ChartNoAxesCombined,
  Settings2,
  CalendarClock,
  Download,
  FolderOpen,
  SquareTerminal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useLayoutStore, type viewType } from "../../stores/useLayoutStore";
import {
  useAgentCenterStore,
  type AgentCardsViewMode,
} from "../../stores/useAgentCenterStore";
import { useAcpStore } from "../../stores/useAcpStore";
import {
  FollowedSessionsMenu,
  RunningSessionsSummary,
} from "../agent/FollowedSessionsMenu";
import type { SessionConnectionState } from "../../hooks/useFollowedSessionStates";
import { DataImportDialog } from "../../DataImportDialog";
import type { WorkbenchMode } from "../../../lib/workbench-mode";
import { WorkbenchModeSwitch } from "../../../components/WorkbenchModeSwitch";

const secondary = [
  { view: "plugins", label: "工具与技能", Icon: Plug },
  { view: "insights", label: "用量", Icon: ChartNoAxesCombined },
  { view: "settings", label: "设置", Icon: Settings2 },
] as const;
export function SessionTopNavigation({
  status,
  onModeChange,
}: {
  status: SessionConnectionState;
  onModeChange?: (mode: WorkbenchMode) => void;
}) {
  const layout = useLayoutStore();
  const { cardsViewMode, setCardsViewMode } = useAgentCenterStore();
  const acp = useAcpStore((s) => s.active);
  const [importOpen, setImportOpen] = useState(false);
  const secondaryActive = secondary.find((s) => s.view === layout.view);
  const setView = (view: viewType) => layout.setView(view);
  return (
    <>
      <nav
        className="session-top-nav"
        aria-label="会话工作台导航"
        data-connection-state={status}
      >
        <span className="session-brand-mark" title="后摩智能">
          <img src="/houmo-logo.png" alt="Houmo" />
        </span>
        <WorkbenchModeSwitch
          mode="session"
          disabled={!onModeChange}
          onChange={(mode) => {
            if (mode === "session") setView("agent");
            onModeChange?.(mode);
          }}
        />
        <span className="session-navigation-divider" aria-hidden="true" />
        <button
          type="button"
          className="session-top-schedule"
          aria-pressed={layout.view === "automations"}
          onClick={() => setView("automations")}
        >
          <CalendarClock size={15} />
          <span>定时任务</span>
        </button>
        {secondary.map(({ view, label, Icon }) => (
          <button
            type="button"
            key={view}
            className="session-top-secondary"
            aria-pressed={layout.view === view}
            onClick={() => setView(view)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
        <span className="session-top-spacer" />
        <RunningSessionsSummary status={status} />
        <FollowedSessionsMenu summary status={status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="session-top-icon"
              aria-label="更多功能"
              title={secondaryActive?.label ?? "更多功能"}
              data-active={Boolean(secondaryActive)}
            >
              <MoreHorizontal size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="session-main-menu">
            <DropdownMenuItem
              className="session-menu-schedule"
              onSelect={() => setView("automations")}
            >
              <CalendarClock size={15} />
              定时任务
            </DropdownMenuItem>
            {secondary.map(({ view, label, Icon }) => (
              <DropdownMenuItem key={view} onSelect={() => setView(view)}>
                <Icon size={15} />
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>
              <Download size={15} />
              导入会话
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>会话布局</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={acp ? "solo" : cardsViewMode}
              onValueChange={(v) => setCardsViewMode(v as AgentCardsViewMode)}
            >
              <DropdownMenuRadioItem value="solo">
                自由分屏
              </DropdownMenuRadioItem>
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
                ["files", "文件浏览器", FolderOpen],
                ["terminal", "终端", SquareTerminal],
              ] as const
            ).map(([tab, label, Icon]) => (
              <DropdownMenuItem
                key={tab}
                onSelect={() => {
                  layout.setActiveRightPanelTab(tab);
                  layout.setRightPanelOpen(true);
                }}
              >
                <Icon size={15} />
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onSelect={() => {
                layout.setActiveRightPanelTab("diff");
                layout.setRightPanelOpen(true);
              }}
            >
              代码变更
            </DropdownMenuItem>
            {layout.isRightPanelOpen && (
              <DropdownMenuItem
                onSelect={() => layout.setRightPanelOpen(false)}
              >
                收起工具面板
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <p className="session-menu-note" role="status">
              {status === "ready"
                ? "● 已连接"
                : status === "checking"
                  ? "正在连接"
                  : "连接中断，自动重连中"}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <DataImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        hideTrigger
      />
    </>
  );
}

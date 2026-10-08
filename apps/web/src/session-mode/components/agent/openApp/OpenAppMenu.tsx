import { Button } from "@session/components/ui/button";
import { VsCodeIcon } from "@session/features/vscode/VsCodeIcon";
import {
  openVsCodePanel,
  useVsCodePanelStore,
} from "@session/stores/useVsCodePanelStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";

export function OpenAppMenu({ path }: { path: string }) {
  const active = useLayoutStore(
    (state) => state.isRightPanelOpen && state.activeRightPanelTab === "vscode",
  );
  const pinned = useVsCodePanelStore((state) => state.pinnedPath);
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="session-vscode-trigger"
      title={pinned ? `打开 VS Code（已固定 ${pinned}）` : `在右侧打开 ${path}`}
      aria-label="打开 VS Code"
      aria-pressed={active}
      onClick={openVsCodePanel}
    >
      <VsCodeIcon />
    </Button>
  );
}

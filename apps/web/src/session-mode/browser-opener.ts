import { useLayoutStore } from "./stores/useLayoutStore";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";

export async function open(url: string): Promise<void> {
  const parsed = new URL(url);
  if (
    !["http:", "https:", "vscode:", "vscode-insiders:"].includes(
      parsed.protocol,
    )
  )
    throw new Error("Unsupported external URL");
  window.open(parsed.toString(), "_blank", "noopener,noreferrer");
}
export const openUrl = open;
export async function revealItemInDir(path: string): Promise<void> {
  useWorkspaceStore
    .getState()
    .setCwd(path.slice(0, path.lastIndexOf("/")) || "/");
  const layout = useLayoutStore.getState();
  layout.setActiveRightPanelTab("files");
  layout.setRightPanelOpen(true);
}

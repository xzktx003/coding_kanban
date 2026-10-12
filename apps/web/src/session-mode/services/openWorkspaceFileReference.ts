import { toast } from "sonner";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { resolveWorkspaceFileReference } from "./workspaceFiles";

let navigationRevision = 0;

/** Resolve aliases before opening so reads, edits and line ranges use one real file. */
export async function openWorkspaceFileReference(
  reference: { path: string; line?: number; column?: number; endLine?: number },
  root?: string | null,
): Promise<boolean> {
  const own = ++navigationRevision;
  const before = useEditorStore.getState();
  const stillCurrent = () => {
    const current = useEditorStore.getState();
    return (
      own === navigationRevision &&
      current.activeFile === before.activeFile &&
      current.revealLocation === before.revealLocation
    );
  };
  try {
    if (!root) throw new Error("无法确定文件所属项目，请先选择项目");
    const target = await resolveWorkspaceFileReference(root, reference.path);
    if (!stillCurrent()) return false;
    if (
      !target ||
      typeof target.root !== "string" ||
      typeof target.path !== "string" ||
      !target.root.startsWith("/") ||
      /[\\\x00-\x1f]/.test(target.root + target.path) ||
      (target.root + "/" + target.path)
        .split("/")
        .some((part) => part === "." || part === "..") ||
      !(
        target.path === target.root ||
        target.path.startsWith(target.root.replace(/\/+$/, "") + "/")
      )
    )
      throw new Error("服务未返回有效的文件路径");
    useEditorStore
      .getState()
      .revealFile(
        target.path,
        target.root,
        reference.line,
        reference.column,
        reference.endLine,
      );
    const layout = useLayoutStore.getState();
    layout.setActiveRightPanelTab("files");
    layout.setRightPanelOpen(true);
    return true;
  } catch (error) {
    if (stillCurrent())
      toast.error(
        `无法打开文件：${error instanceof Error ? error.message : String(error)}`,
      );
    return false;
  }
}

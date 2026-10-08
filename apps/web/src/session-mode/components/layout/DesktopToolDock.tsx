import { useEffect, type RefObject } from "react";
import {
  FolderOpen,
  Maximize2,
  Minimize2,
  PanelRight,
  SquareTerminal,
} from "lucide-react";
import { useIsMobile } from "@session/hooks/use-mobile";
import { useActiveSessionProject } from "@session/hooks/useActiveSessionProject";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  openVsCodePanel,
  useVsCodePanelStore,
} from "@session/stores/useVsCodePanelStore";
import { VsCodeIcon } from "@session/features/vscode/VsCodeIcon";

/** A stable, independent dock: reserve only the space it overlaps, never rebuild tabs. */
export function DesktopToolDock({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const mobile = useIsMobile();
  const layout = useLayoutStore();
  const project = useActiveSessionProject();
  const pinned = useVsCodePanelStore((s) => s.pinnedPath);
  const enabled = !mobile && layout.view === "agent";
  // The parent container ref is attached after child layout effects on first mount.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) return;
    root.dataset.toolDock = "true";
    let frame = 0;
    const marked = new Set<HTMLElement>();
    const observed = new Set<Element>();
    const clear = () => {
      for (const el of marked) {
        delete el.dataset.toolDockReserve;
        el.style.removeProperty("--session-dock-reserve");
      }
      marked.clear();
    };
    const update = () => {
      frame = 0;
      const bounds = root.getBoundingClientRect();
      const dock = root.querySelector<HTMLElement>(
        ".session-desktop-tool-dock",
      );
      const width = dock?.getBoundingClientRect().width ?? 190;
      const headers = Array.from(
        root.querySelectorAll<HTMLElement>(".session-tabs"),
      )
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      for (const el of root.querySelectorAll<HTMLElement>(
        ".session-tabs, .session-dock-main, .session-dock-panel",
      )) {
        if (!observed.has(el)) {
          resize.observe(el);
          observed.add(el);
        }
      }
      for (const el of observed)
        if (!el.isConnected) {
          resize.unobserve(el);
          observed.delete(el);
        }
      const top = headers.length
        ? Math.min(...headers.map((h) => h.rect.top))
        : bounds.top;
      const topHeaders = headers.filter((h) => Math.abs(h.rect.top - top) < 3);
      // Keep the remembered height while focus mode hides the chat tree.
      const height = topHeaders[0]?.rect.height;
      if (height)
        root.style.setProperty("--session-dock-height", `${height}px`);
      root.dataset.toolDockFallback = String(
        !headers.length && !layout.isRightPanelFocused,
      );
      clear();
      for (const { el, rect } of topHeaders) {
        const overlap = Math.min(
          rect.width,
          Math.max(0, rect.right - (bounds.right - width)),
        );
        if (overlap > 0) {
          el.dataset.toolDockReserve = "true";
          el.style.setProperty("--session-dock-reserve", `${overlap + 4}px`);
          marked.add(el);
        }
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    const mutation = new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches(
                ".session-tabs, .session-dock-main, .session-dock-panel",
              ) ||
                node.querySelector(
                  ".session-tabs, .session-dock-main, .session-dock-panel",
                )),
          ),
        )
      )
        schedule();
    });
    mutation.observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
      clear();
      delete root.dataset.toolDock;
      delete root.dataset.toolDockFallback;
    };
  }, [
    containerRef,
    enabled,
    layout.isRightPanelOpen,
    layout.isRightPanelFocused,
  ]);
  if (!enabled) return null;
  const prepare = () => {
    if (project.path) useWorkspaceStore.getState().setCwd(project.path);
  };
  const open = (tab: "files" | "vscode" | "terminal") => {
    prepare();
    if (tab === "vscode") openVsCodePanel();
    else {
      layout.setActiveRightPanelTab(tab);
      layout.setRightPanelOpen(true);
    }
  };
  const toggle = () => {
    if (layout.isRightPanelOpen) {
      layout.setRightPanelOpen(false);
      return;
    }
    if (layout.activeRightPanelTab) {
      prepare();
      layout.setRightPanelOpen(true);
    } else open("files");
  };
  return (
    <div
      className="session-desktop-tool-dock"
      role="group"
      aria-label="常驻工作工具"
    >
      {(
        [
          ["files", "文件浏览器", FolderOpen],
          ["vscode", "VS Code", VsCodeIcon],
          ["terminal", "终端", SquareTerminal],
        ] as const
      ).map(([tab, label, Icon]) => (
        <button
          key={tab}
          type="button"
          aria-label={label}
          title={`${label}${tab === "vscode" && pinned ? ` · 已固定 ${pinned}` : project.path ? ` · ${project.path}` : " · 请先选择项目"}`}
          disabled={!project.path && !(tab === "vscode" && pinned)}
          aria-pressed={
            layout.isRightPanelOpen && layout.activeRightPanelTab === tab
          }
          onClick={() => open(tab)}
        >
          <Icon size={17} />
        </button>
      ))}
      <span className="session-tool-dock-divider" aria-hidden="true" />
      <button
        type="button"
        disabled={!layout.isRightPanelOpen}
        aria-label={
          layout.isRightPanelFocused && layout.isRightPanelOpen
            ? "还原工具区"
            : "放大工具区"
        }
        title={
          !layout.isRightPanelOpen
            ? "请先打开工具面板"
            : layout.isRightPanelFocused
              ? "还原工具区"
              : "放大工具区"
        }
        aria-pressed={layout.isRightPanelOpen && layout.isRightPanelFocused}
        onClick={layout.toggleRightPanelFocused}
      >
        {layout.isRightPanelFocused && layout.isRightPanelOpen ? (
          <Minimize2 size={17} />
        ) : (
          <Maximize2 size={17} />
        )}
      </button>
      <button
        type="button"
        aria-label={layout.isRightPanelOpen ? "收起右侧面板" : "展开右侧面板"}
        title={layout.isRightPanelOpen ? "收起右侧面板" : "展开右侧面板"}
        aria-expanded={layout.isRightPanelOpen}
        disabled={
          !layout.isRightPanelOpen &&
          !layout.activeRightPanelTab &&
          !project.path
        }
        onClick={toggle}
      >
        <PanelRight size={17} />
      </button>
    </div>
  );
}

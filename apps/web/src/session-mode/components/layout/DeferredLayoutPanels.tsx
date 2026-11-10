import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSidebar, Sidebar } from "@session/components/ui/sidebar";
import { OptionalSessionPanel } from "./OptionalSessionPanel";

const AppSidebar = lazy(() =>
  import("./AppSidebar").then((module) => ({ default: module.AppSideBar })),
);
const RightPanel = lazy(() =>
  import("./RightPanel").then((module) => ({ default: module.RightPanel })),
);

function SlowPanelLoading({ onClose }: { onClose: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="space-y-2 p-4 text-sm text-muted-foreground">
      <p role="status">
        {slow
          ? "工具面板加载时间较长，仍在尝试。你可以关闭面板并继续会话。"
          : "正在加载工具面板…"}
      </p>
      {slow && (
        <button
          type="button"
          className="min-h-11 rounded-md border px-3 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
        >
          关闭工具面板
        </button>
      )}
    </div>
  );
}

/** A closed panel does not acquire its optional module graph. Once displayed,
 * keep the exact tree mounted, including editors and terminal connections. */
export function DeferredAppSidebar() {
  const sidebar = useSidebar();
  const visible = sidebar.isMobile ? sidebar.openMobile : sidebar.open;
  const visited = useRef(false);
  if (visible) visited.current = true;
  if (!visited.current) return null;
  const close = () =>
    sidebar.isMobile ? sidebar.setOpenMobile(false) : sidebar.setOpen(false);
  return (
    <OptionalSessionPanel label="项目列表" visible={visible} onClose={close}>
      <Suspense
        fallback={
          <Sidebar>
            <div className="flex h-full flex-col gap-3 p-4 text-sm">
              <p role="status">正在加载项目列表…</p>
              <button type="button" onClick={close}>
                收起项目列表
              </button>
            </div>
          </Sidebar>
        }
      >
        <AppSidebar />
      </Suspense>
    </OptionalSessionPanel>
  );
}

export function DeferredRightPanel({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const visited = useRef(false);
  if (visible) visited.current = true;
  if (!visited.current) return null;
  return (
    <OptionalSessionPanel label="工具面板" visible={visible} onClose={onClose}>
      <Suspense
        fallback={visible ? <SlowPanelLoading onClose={onClose} /> : null}
      >
        <RightPanel visible={visible} />
      </Suspense>
    </OptionalSessionPanel>
  );
}

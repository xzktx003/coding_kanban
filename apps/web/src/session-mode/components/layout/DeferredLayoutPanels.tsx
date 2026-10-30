import { lazy, Suspense, useRef } from "react";
import { useSidebar, Sidebar } from "@session/components/ui/sidebar";
import { OptionalSessionPanel } from "./OptionalSessionPanel";

const AppSidebar = lazy(() =>
  import("./AppSidebar").then((module) => ({ default: module.AppSideBar })),
);
const RightPanel = lazy(() =>
  import("./RightPanel").then((module) => ({ default: module.RightPanel })),
);

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
        fallback={
          visible ? (
            <div role="status" className="p-4 text-sm text-muted-foreground">
              正在加载工具面板…
            </div>
          ) : null
        }
      >
        <RightPanel visible={visible} />
      </Suspense>
    </OptionalSessionPanel>
  );
}

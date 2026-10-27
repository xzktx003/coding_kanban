import { useEffect, useState } from "react";

/** Incompatible dev updates require a user gesture, just like normal updates. */
export function WorkbenchUpdateNotice() {
  const [pending, setPending] = useState(
    () => document.documentElement.dataset.workbenchUpdatePending === "true",
  );
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const update = () => setPending(true);
    window.addEventListener("workbench-update-available", update);
    if (document.documentElement.dataset.workbenchUpdatePending === "true")
      update();
    return () =>
      window.removeEventListener("workbench-update-available", update);
  }, []);
  if (!import.meta.env.DEV || !pending) return null;
  return (
    <div className="workbench-update-notice" role="status">
      <span>界面有更新，可在方便时刷新。</span>
      <button type="button" onClick={() => window.location.reload()}>
        刷新界面
      </button>
    </div>
  );
}

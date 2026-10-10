import React from "react";
import ReactDOM from "react-dom/client";

import { WorkbenchShell } from "./components/WorkbenchShell";
import { isPlanWindowRoute } from "./session-mode/features/thread-workflows/planSnapshot";
const PlanWindowEntry = React.lazy(
  () => import("./session-mode/features/thread-workflows/PlanWindowEntry"),
);
import {
  measureAppViewportHeight,
  measureAppViewportOffsetTop,
} from "./lib/viewport-height";

function syncAppViewportMetrics() {
  const viewportHeight = measureAppViewportHeight();
  if (viewportHeight <= 0) {
    return;
  }

  document.documentElement.style.setProperty(
    "--app-height",
    `${Math.round(viewportHeight)}px`,
  );
  document.documentElement.style.setProperty(
    "--app-viewport-offset-top",
    `${measureAppViewportOffsetTop()}px`,
  );
}

function syncAppViewportMetricsDeferred() {
  syncAppViewportMetrics();
  window.requestAnimationFrame(syncAppViewportMetrics);
  window.setTimeout(syncAppViewportMetrics, 120);
}

syncAppViewportMetrics();
window.addEventListener("resize", syncAppViewportMetrics);
window.addEventListener("orientationchange", syncAppViewportMetrics);
window.addEventListener("fullscreenchange", syncAppViewportMetricsDeferred);
window.visualViewport?.addEventListener("resize", syncAppViewportMetrics);
window.visualViewport?.addEventListener("scroll", syncAppViewportMetrics);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPlanWindowRoute() ? (
      <React.Suspense fallback={<div role="status">正在打开计划…</div>}>
        <PlanWindowEntry />
      </React.Suspense>
    ) : (
      <WorkbenchShell />
    )}
  </React.StrictMode>,
);

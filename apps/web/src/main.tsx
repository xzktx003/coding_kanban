import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
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
    <App />
  </React.StrictMode>,
);

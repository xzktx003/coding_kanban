import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";

// Preserve the observer's behavior; keep bounded witnesses to diagnose actual
// browser errors rather than filtering them out of end-to-end acceptance.
export async function installResizeDiagnostics(page: Page) {
  await page.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    const deliveries: unknown[] = [];
    const errors: unknown[] = [];
    Object.defineProperty(window, "__resizeObserverReceipts", {
      value: { deliveries, errors },
    });
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        const origin = new Error().stack;
        super((entries, observer) => {
          deliveries.push({
            at: performance.now(),
            origin,
            targets: entries.map(({ target, contentRect }) => ({
              tag: target.tagName,
              class: target.getAttribute("class"),
              width: contentRect.width,
              height: contentRect.height,
            })),
          });
          if (deliveries.length > 32) deliveries.shift();
          callback(entries, observer);
        });
      }
    };
    window.addEventListener("error", (event) => {
      if (event.message.includes("ResizeObserver")) {
        errors.push({ message: event.message, deliveries: [...deliveries] });
        if (errors.length > 8) errors.shift();
      }
    });
  });
}

export async function saveResizeDiagnostics(page: Page, info: TestInfo) {
  const receipt = await page.evaluate(
    () =>
      (window as unknown as { __resizeObserverReceipts: unknown })
        .__resizeObserverReceipts,
  );
  await writeFile(
    info.outputPath("resize-observer-diagnostics.json"),
    JSON.stringify(receipt, null, 2),
  );
}

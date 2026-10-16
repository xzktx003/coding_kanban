import { randomUUID } from "node:crypto";
import type { CDPSession, Page } from "@playwright/test";

type PayloadSnapshot = {
  nodes: number;
  payloads: Record<string, number>;
};

async function snapshotPayloads(
  cdp: CDPSession,
  markers: Record<string, string>,
): Promise<PayloadSnapshot> {
  const chunks: string[] = [];
  const receive = ({ chunk }: { chunk: string }) => chunks.push(chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", receive);
  try {
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    cdp.off("HeapProfiler.addHeapSnapshotChunk", receive);
  }
  const heap = JSON.parse(chunks.join("")) as {
    snapshot: { meta: { node_fields: string[] } };
    nodes: number[];
    strings: string[];
  };
  chunks.length = 0;
  const fields = heap.snapshot.meta.node_fields;
  const stride = fields.length;
  const nameIndex = fields.indexOf("name");
  const payloads = Object.fromEntries(
    Object.keys(markers).map((key) => [key, 0]),
  );
  for (let node = 0; node < heap.nodes.length; node += stride) {
    const value = heap.strings[heap.nodes[node + nameIndex]];
    // V8 truncates long string values in snapshots. Their unique prefix is
    // sufficient; short marker strings and function source are not payloads.
    if (value.length < 512) continue;
    for (const [key, marker] of Object.entries(markers)) {
      const prefix = `diff --git a/${marker}.txt`;
      if (value.startsWith(prefix) || value.startsWith(`\u001b[32m${prefix}`))
        payloads[key]++;
    }
  }
  return { nodes: heap.nodes.length / stride, payloads };
}

/** Measure actual V8 payload strings, independently of component object shape. */
export async function probePendingClipboardRetention(page: Page) {
  const run = randomUUID();
  const markers = Object.fromEntries(
    ["COMMAND", "CARD", "VIEWER"].flatMap((kind) =>
      ["PENDING", "CONTROL"].map((state) => [
        `${kind}_${state}`,
        `clipboard_retention_${run}_${kind}_${state}`,
      ]),
    ),
  );
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.evaluate(async (markers) => {
      const load = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const react = await import(
        (window as any).__sessionFixtureDependency("react.js")
      );
      const dom = await import(
        (window as any).__sessionFixtureDependency("react-dom_client.js")
      );
      const React = react.default ?? react;
      const { ShellCommand } = await load(
        "/src/session-mode/components/codex/items/ShellCommand.tsx",
      );
      const { IndividualFileChanges } = await load(
        "/src/session-mode/components/codex/items/IndividualFileChanges.tsx",
      );
      const { DiffViewer } = await load(
        "/src/session-mode/features/DiffViewer.tsx",
      );
      const { getChangeCounts, getDiffViewerProps } = await load(
        "/src/session-mode/components/codex/items/fileChangeLogic.ts",
      );

      // Keep the native Promise alive throughout measurement, without retaining
      // its argument. Any payload remaining after unmount is application-owned.
      (window as any).__copyRetentionPending = new Promise<void>((resolve) => {
        (window as any).__copyRetentionResolve = resolve;
      });
      (window as any).__copyRetentionWrites = 0;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => {
            (window as any).__copyRetentionWrites++;
            return (window as any).__copyRetentionPending;
          },
        },
      });
      const payload = (kind: string) =>
        [
          kind.startsWith("COMMAND") ? "\u001b[32m" : "",
          `diff --git a/${markers[kind]}.txt b/body.txt\n`,
          "--- a/body.txt\n+++ b/body.txt\n@@ -1 +1 @@\n-a\n+",
          "x".repeat(262144),
          "\n",
          kind.startsWith("COMMAND") ? "\u001b[0m" : "",
        ].join("");
      const elements = [];
      for (const state of ["PENDING", "CONTROL"]) {
        elements.push(
          React.createElement(
            "section",
            { key: `shell-${state}`, id: `retention-shell-${state}` },
            React.createElement(ShellCommand, {
              command: `retention-${state}`,
              commandItemId: `retention-command-${state}`,
              threadId: "clipboard-retention-owner",
              turnId: "clipboard-retention-turn",
              status: "completed",
              aggregatedOutput: payload(`COMMAND_${state}`),
            }),
          ),
          React.createElement(
            "section",
            { key: `card-${state}`, id: `retention-card-${state}` },
            React.createElement(IndividualFileChanges, {
              changes: [
                {
                  path: `retention-${state}.txt`,
                  kind: { type: "update", move_path: null },
                  diff: payload(`CARD_${state}`),
                },
              ],
              fileChangeMap: { add: "创建", update: "编辑", delete: "删除" },
              getChangeCounts,
              getDiffViewerProps,
            }),
          ),
          React.createElement(
            "section",
            { key: `viewer-${state}`, id: `retention-viewer-${state}` },
            React.createElement(DiffViewer, {
              native: true,
              presentation: "inline",
              displayPath: `retention-${state}.txt`,
              unifiedDiff: payload(`VIEWER_${state}`),
              isCollapsed: false,
            }),
          ),
        );
      }
      const host = document.createElement("div");
      host.id = "copy-retention-fixture";
      host.className = "session-mode codex-presentation";
      host.style.cssText =
        "position:fixed;z-index:200;inset:70px 12px 150px;overflow:auto;background:var(--background)";
      document.querySelector(".session-mode")!.append(host);
      (window as any).__copyRetentionRoot = (dom.default ?? dom).createRoot(
        host,
      );
      (window as any).__copyRetentionRoot.render(
        React.createElement(React.Fragment, null, ...elements),
      );
    }, markers);
    for (const state of ["PENDING", "CONTROL"]) {
      await page
        .locator(`#retention-shell-${state} .codex-command-summary`)
        .click();
      await page
        .locator(`#retention-card-${state} .codex-individual-file-disclosure`)
        .click();
    }
    await page
      .locator("#retention-shell-PENDING .codex-command-output-wrap button")
      .click();
    await page
      .locator("#retention-card-PENDING .codex-chat-file-diff-copy")
      .click();
    await page
      .locator("#retention-viewer-PENDING .codex-inline-diff-copy")
      .click();

    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const mounted = await snapshotPayloads(cdp, markers);
    await page.evaluate(() => {
      (window as any).__copyRetentionRoot.unmount();
      delete (window as any).__copyRetentionRoot;
      document.getElementById("copy-retention-fixture")!.remove();
    });
    await page.waitForTimeout(150);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const afterUnmount = await snapshotPayloads(cdp, markers);
    const writes = await page.evaluate(
      () => (window as any).__copyRetentionWrites as number,
    );
    return { markers, mounted, afterUnmount, writes };
  } finally {
    await page.evaluate(() => {
      (window as any).__copyRetentionRoot?.unmount();
      delete (window as any).__copyRetentionRoot;
      document.getElementById("copy-retention-fixture")?.remove();
      (window as any).__copyRetentionResolve?.();
      delete (window as any).__copyRetentionResolve;
      delete (window as any).__copyRetentionPending;
      delete (window as any).__copyRetentionWrites;
      delete (navigator as any).clipboard;
    });
    await cdp.detach();
  }
}

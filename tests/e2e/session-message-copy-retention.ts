import { randomUUID } from "node:crypto";
import type { CDPSession, Page } from "@playwright/test";

type PayloadSnapshot = {
  nodes: number;
  payloads: Record<string, number>;
  nodeSelfBytes: Record<string, number[]>;
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
  const selfIndex = fields.indexOf("self_size");
  const payloads = Object.fromEntries(
    Object.keys(markers).map((key) => [key, 0]),
  );
  const nodeSelfBytes = Object.fromEntries(
    Object.keys(markers).map((key) => [key, [] as number[]]),
  );
  for (let node = 0; node < heap.nodes.length; node += stride) {
    const value = heap.strings[heap.nodes[node + nameIndex]];
    // Snapshot names can truncate to 1024 characters. Real DOM length and the
    // mounted snapshot establish each complete payload before it is unmounted.
    if (value.length < 512) continue;
    for (const [key, marker] of Object.entries(markers)) {
      if (!value.includes(marker)) continue;
      payloads[key]++;
      // External strings have small headers. Never use self_size to exclude a
      // live body; record it separately from the marker-count assertion.
      nodeSelfBytes[key].push(heap.nodes[node + selfIndex]);
    }
  }
  return { nodes: heap.nodes.length / stride, payloads, nodeSelfBytes };
}

/** Actual V8 strings from six mounted instances, independent of props shape. */
export async function probeMessageClipboardRetention(page: Page) {
  const run = randomUUID();
  const payloadSize = 262144;
  const markers = Object.fromEntries(
    ["PLAN", "USER", "ASSISTANT"].flatMap((kind) =>
      ["PENDING", "CONTROL"].map((state) => [
        `${kind}_${state}`,
        `message_copy_retention_${run}_${kind}_${state}`,
      ]),
    ),
  );
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.evaluate(
      async ({ markers, payloadSize }) => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const react = await import(
          (window as any).__sessionFixtureDependency("react.js")
        );
        const dom = await import(
          (window as any).__sessionFixtureDependency("react-dom_client.js")
        );
        const React = react.default ?? react;
        const { PlanContentItem } = await load(
          "/src/session-mode/components/codex/items/PlanContentItem.tsx",
        );
        const { NativeMessageCopy } = await load(
          "/src/session-mode/features/thread-workflows/NativeMessageCopy.tsx",
        );
        const { ThemeProvider } = await load(
          "/src/session-mode/contexts/ThemeContext.tsx",
        );

        (window as any).__messageRetentionClipboard =
          Object.getOwnPropertyDescriptor(navigator, "clipboard");
        (window as any).__messageRetentionClipboardItem =
          Object.getOwnPropertyDescriptor(window, "ClipboardItem");
        // Only the Promise is strongly retained, never the text/html/Blob input.
        (window as any).__messageRetentionPending = new Promise<void>(
          (resolve) => {
            (window as any).__messageRetentionResolve = resolve;
          },
        );
        (window as any).__messageRetentionWrites = {
          write: 0,
          writeText: 0,
          item: 0,
        };
        Object.defineProperty(window, "ClipboardItem", {
          configurable: true,
          value: class {
            constructor(_data: Record<string, Blob>) {
              (window as any).__messageRetentionWrites.item++;
            }
          },
        });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (_text: string) => {
              (window as any).__messageRetentionWrites.writeText++;
              return (window as any).__messageRetentionPending;
            },
            write: (_items: unknown[]) => {
              (window as any).__messageRetentionWrites.write++;
              return (window as any).__messageRetentionPending;
            },
          },
        });
        function Message({
          text,
          kind,
        }: {
          text: string;
          kind: "user" | "assistant";
        }) {
          const ref = React.useRef(null);
          return React.createElement(
            React.Fragment,
            null,
            React.createElement(
              "p",
              { ref, "data-retention-text": true },
              text,
            ),
            React.createElement(NativeMessageCopy, {
              text,
              kind,
              contentRef: ref,
            }),
          );
        }
        const elements = [];
        for (const [label, marker] of Object.entries(markers)) {
          // Array.join constructs an independent flat body, rather than a small
          // slice or repeated-string wrapper that could obscure source lifetime.
          const text = [marker, "x".repeat(payloadSize - marker.length)].join(
            "",
          );
          const element = label.startsWith("PLAN_")
            ? React.createElement(PlanContentItem, {
                text,
                running: false,
                threadId: "message-copy-retention-owner",
                turnId: label,
              })
            : React.createElement(Message, {
                text,
                kind: label.startsWith("USER_") ? "user" : "assistant",
              });
          elements.push(
            React.createElement(
              "section",
              { key: label, id: `message-retention-${label}` },
              element,
            ),
          );
        }
        const host = document.createElement("div");
        host.id = "message-retention-fixture";
        host.className = "session-mode codex-presentation";
        host.style.cssText =
          "position:fixed;z-index:200;inset:70px 12px 150px;overflow:auto;overflow-wrap:anywhere;background:var(--background)";
        document.querySelector(".session-mode")!.append(host);
        (window as any).__messageRetentionRoot = (
          dom.default ?? dom
        ).createRoot(host);
        (window as any).__messageRetentionRoot.render(
          React.createElement(ThemeProvider, null, ...elements),
        );
      },
      { markers, payloadSize },
    );
    await page
      .locator('#message-retention-PLAN_PENDING button[aria-label="复制计划"]')
      .click();
    await page
      .locator('#message-retention-USER_PENDING button[aria-label="复制消息"]')
      .click();
    await page
      .locator(
        '#message-retention-ASSISTANT_PENDING button[aria-label="复制回复"]',
      )
      .click();
    const mountedBodies = await page.evaluate(
      (markers) =>
        Object.fromEntries(
          Object.entries(markers).map(([key, marker]) => {
            const section = document.getElementById(
              `message-retention-${key}`,
            )!;
            const body =
              section.querySelector(
                key.startsWith("PLAN_")
                  ? ".codex-plan-markdown"
                  : "[data-retention-text]",
              )?.textContent ?? "";
            return [
              key,
              { length: body.length, marker: body.startsWith(marker) },
            ];
          }),
        ),
      markers,
    );
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const mounted = await snapshotPayloads(cdp, markers);
    await page.evaluate(() => {
      (window as any).__messageRetentionRoot.unmount();
      delete (window as any).__messageRetentionRoot;
      document.getElementById("message-retention-fixture")!.remove();
    });
    await page.waitForTimeout(150);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const afterUnmount = await snapshotPayloads(cdp, markers);
    const writes = await page.evaluate(
      () =>
        (window as any).__messageRetentionWrites as {
          write: number;
          writeText: number;
          item: number;
        },
    );
    return {
      payloadSize,
      markers,
      mountedBodies,
      mounted,
      afterUnmount,
      writes,
    };
  } finally {
    await page.evaluate(() => {
      (window as any).__messageRetentionRoot?.unmount();
      delete (window as any).__messageRetentionRoot;
      document.getElementById("message-retention-fixture")?.remove();
      (window as any).__messageRetentionResolve?.();
      delete (window as any).__messageRetentionResolve;
      delete (window as any).__messageRetentionPending;
      delete (window as any).__messageRetentionWrites;
      const clipboard = (window as any).__messageRetentionClipboard;
      const item = (window as any).__messageRetentionClipboardItem;
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else delete (navigator as any).clipboard;
      if (item) Object.defineProperty(window, "ClipboardItem", item);
      else delete (window as any).ClipboardItem;
      delete (window as any).__messageRetentionClipboard;
      delete (window as any).__messageRetentionClipboardItem;
    });
    await cdp.detach();
  }
}

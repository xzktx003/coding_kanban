import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [1440, 393]) {
  test(`live Markdown stays formatted during real event delivery and preview (${width})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    await page.addInitScript(() => {
      const w = window as any;
      w.__streamSources = [];
      w.EventSource = class {
        onopen: any;
        onmessage: any;
        onerror: any;
        readyState = 1;
        static OPEN = 1;
        static CONNECTING = 0;
        static CLOSED = 2;
        constructor() {
          w.__streamSources.push(this);
          setTimeout(() => this.onopen?.({}), 0);
        }
        close() {
          this.readyState = 2;
        }
        addEventListener() {}
        removeEventListener() {}
      };
    });
    await page.goto("/?mode=session", { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const moduleUrl = (path: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const { useCodexStore } = await import(
        moduleUrl("/src/session-mode/components/codex/stores/index.ts")
      );
      const { useAgentCenterStore } = await import(
        moduleUrl("/src/session-mode/stores/useAgentCenterStore.ts")
      );
      const { useLayoutStore } = await import(
        moduleUrl("/src/session-mode/stores/useLayoutStore.ts")
      );
      const { useAgentSettingsStore } = await import(
        moduleUrl("/src/session-mode/stores/useAgentSettingsStore.ts")
      );
      const { useAcpStore } = await import(
        moduleUrl("/src/session-mode/stores/useAcpStore.ts")
      );
      useLayoutStore.setState({ view: "agent", isRightPanelOpen: false });
      useAgentSettingsStore.setState({ selectedAgent: "codex" });
      useAcpStore.setState({ active: false });
      useCodexStore.setState({
        currentThreadId: "stream-regression",
        currentTurnId: "turn",
        events: { "stream-regression": [] },
        historyLoadedMap: { "stream-regression": true },
        historyLoadingMap: {},
        historyErrorMap: {},
        turnTimingMap: {
          "stream-regression": {
            turnId: "turn",
            status: "inProgress",
            startedAtMs: Date.now(),
            durationMs: null,
          },
        },
        threads: [
          {
            id: "stream-regression",
            name: "stream regression",
            preview: "stream regression",
            cwd: "/fixture",
            createdAt: 1,
            updatedAt: 1,
            modelProvider: "openai",
            status: { type: "active", activeFlags: [] },
            turns: [],
          } as any,
        ],
      });
      useAgentCenterStore.getState().addAgentCard({
        kind: "codex",
        id: "stream-regression",
        cwd: "/fixture",
        preview: "stream regression",
      } as any);
      const w = window as any;
      w.__streamSeq = 0;
      w.__emitStream = (payload: any) => {
        const source = w.__streamSources.find(
          (candidate: any) =>
            candidate.readyState === 1 &&
            candidate.onmessage?.toString().includes("Number.isSafeInteger"),
        );
        if (!source) throw new Error("The real Codex event bridge is missing");
        source.onmessage({
          data: JSON.stringify({
            seq: ++w.__streamSeq,
            event: "codex:notification",
            payload,
          }),
        });
      };
      w.__emitDelta = (delta: string) =>
        w.__emitStream({
          method: "item/agentMessage/delta",
          params: {
            threadId: "stream-regression",
            turnId: "turn",
            itemId: "item",
            delta,
          },
        });
    });
    await expect(page.locator(".thread-surface")).toBeVisible({
      timeout: 60_000,
    });
    const live = page.locator(
      "[data-codex-live-message] [data-codex-streaming-text]",
    );
    const prefix = "**StableMarker**\n\n";
    await page.evaluate(
      (text) => (window as any).__emitDelta(text),
      prefix + "x".repeat(8191 - prefix.length),
    );
    await expect(live.locator("strong")).toHaveText("StableMarker");
    const pageCdp = await page.context().newCDPSession(page);
    const browserCdp = await page.context().browser()!.newBrowserCDPSession();
    const sampleMemory = async (phase: string) => {
      const heap = await pageCdp.send("Runtime.getHeapUsage");
      const processes = await browserCdp.send("SystemInfo.getProcessInfo");
      return {
        phase,
        heapBytes: heap.usedSize,
        backingStorageBytes: heap.backingStorageSize,
        rendererRss:
          process.platform === "linux"
            ? sampleRendererRss(processes.processInfo)
            : null,
      };
    };
    const memoryBefore = await sampleMemory("before-large-stream");

    await page.evaluate(() => {
      const w = window as any;
      w.__frameEvidence = [];
      w.__sampling = true;
      const sample = () => {
        if (!w.__sampling) return;
        const node = document.querySelector(
          "[data-codex-live-message] [data-codex-streaming-text]",
        );
        const text = node?.textContent ?? "";
        w.__frameEvidence.push({
          rich: [...(node?.querySelectorAll("strong") ?? [])].filter(
            (el) => el.textContent === "StableMarker",
          ).length,
          raw: text.includes("**StableMarker**"),
          occurrences: text.split("StableMarker").length - 1,
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    for (const delta of [
      "x",
      "\n\n查看 [资料",
      "][来源]",
      "\n\n[来源]: https://example.test",
      "\n\n后续内容",
    ]) {
      await page.evaluate(async (text) => {
        (window as any).__emitDelta(text);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, delta);
      await expect(live.locator("strong").first()).toHaveText("StableMarker");
      await expect(live).not.toContainText("**StableMarker**");
      if (delta === "\n\n查看 [资料")
        await expect(live).not.toContainText("[资料");
      if (delta === "][来源]") await expect(live).toContainText("[资料][来源]");
    }
    for (let batch = 0; batch < 4; batch++) {
      await page.evaluate(async (index) => {
        for (let i = 0; i < 9; i++)
          (window as any).__emitDelta(
            `batch ${index}-${i}\n${"z".repeat(8192)}`,
          );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, batch);
    }
    await expect(
      live.locator("[data-codex-streaming-truncated]"),
    ).toBeVisible();
    await expect(live.locator("strong").first()).toHaveText("StableMarker");
    expect((await live.textContent())?.match(/StableMarker/g)).toHaveLength(1);
    expect((await live.textContent())!.length).toBeLessThanOrEqual(256 * 1024);
    await expect(live).toContainText("batch 3-8");
    const memoryAfter = await sampleMemory("bounded-preview");
    expect(memoryAfter.heapBytes - memoryBefore.heapBytes).toBeLessThan(
      32 * 1024 * 1024,
    );
    await page.waitForTimeout(150);
    const frames = await page.evaluate(() => {
      (window as any).__sampling = false;
      return (window as any).__frameEvidence as Array<{
        rich: number;
        raw: boolean;
        occurrences: number;
      }>;
    });
    expect(frames.length).toBeGreaterThan(3);
    expect(
      frames.filter(
        (frame) => frame.rich !== 1 || frame.raw || frame.occurrences !== 1,
      ),
    ).toEqual([]);

    await page.evaluate(() =>
      (window as any).__emitStream({
        method: "item/completed",
        params: {
          threadId: "stream-regression",
          turnId: "turn",
          item: {
            id: "item",
            type: "agentMessage",
            text: "**StableMarker**\n\n查看 [资料][来源]\n\n[来源]: https://example.test",
            phase: null,
            memoryCitation: null,
          },
        },
      }),
    );
    await expect(page.locator("[data-codex-live-message]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "资料" })).toHaveAttribute(
      "href",
      "https://example.test/",
    );

    // A native citation may start at the very end of one immutable segment.
    // Keep its actual button when the bounded preview replaces the live tail.
    await page.evaluate(async () => {
      const w = window as any;
      const emit = (delta: string) =>
        w.__emitStream({
          method: "item/agentMessage/delta",
          params: {
            threadId: "stream-regression",
            turnId: "turn",
            itemId: "item-2",
            delta,
          },
        });
      emit("q".repeat(8192 - ":codex-".length) + ":codex-");
      emit('file-citation{path="/owner/source.ts"}');
      w.__emitCitationDelta = emit;
    });
    await expect(live.locator(".native-file-citation")).toBeVisible();
    for (let batch = 0; batch < 4; batch++) {
      await page.evaluate(async () => {
        for (let i = 0; i < 9; i++)
          (window as any).__emitCitationDelta("z".repeat(8192));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
    }
    await expect(
      live.locator("[data-codex-streaming-truncated]"),
    ).toBeVisible();
    await expect(live.locator(".native-file-citation")).toBeVisible();
    await expect(live).not.toContainText(
      ':codex-file-citation{path="/owner/source.ts"}',
    );
    expect(
      fixture.calls.filter((call) =>
        /turn\/(start|interrupt|steer)$/.test(call.path),
      ),
    ).toEqual([]);
    const evidence = info.outputPath("frame-and-memory-samples.json");
    await writeFile(
      evidence,
      JSON.stringify(
        { width, frames, memory: [memoryBefore, memoryAfter] },
        null,
        2,
      ),
    );
    await info.attach("frame-and-memory-samples.json", {
      path: evidence,
      contentType: "application/json",
    });
    await pageCdp.detach();
    await browserCdp.detach();
  });
}

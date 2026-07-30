import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  classifyResourcePressure,
  getResourceDiagnosticsSnapshot,
  recordAgentSnapshotFrame,
  recordMainThreadLongTask,
  recordTerminalFrame,
  registerTerminalWebSocket,
  resetResourceDiagnosticsForTest,
  type ResourceDiagnosticsSnapshot,
} from "./resource-diagnostics.js";

function makeDocument(counts: Record<string, number>) {
  return {
    querySelectorAll(selector: string) {
      return { length: counts[selector] ?? 0 };
    },
  };
}

function makeSnapshot(
  overrides: Partial<ResourceDiagnosticsSnapshot> = {},
): ResourceDiagnosticsSnapshot {
  return {
    timestamp: 1_000,
    dom: {
      xtermCount: 1,
      terminalViewCount: 1,
      liveTerminalViewCount: 1,
      previewTerminalViewCount: 0,
      lightweightPreviewCount: 4,
      monitorTerminalPaneCount: 0,
      activeInputTerminalPaneCount: 0,
      vscodeIframeCount: 0,
      vscodeActiveIframeCount: 0,
      vscodeHiddenIframeCount: 0,
    },
    agentSessionSocket: {
      messagesPerSecond: 0,
      kilobytesPerSecond: 0,
      totalMessages: 0,
      totalKilobytes: 0,
      lastPayloadKilobytes: 0,
    },
    terminalSockets: {
      connecting: 0,
      open: 1,
      total: 1,
    },
    terminalFrames: {
      messagesPerSecond: 0,
      kilobytesPerSecond: 0,
    },
    mainThread: {
      blockedMillisecondsPerSecond: 0,
      lastLongTaskMilliseconds: 0,
      longTaskObserverSupported: false,
      longTasksPerSecond: 0,
      totalBlockedMilliseconds: 0,
      totalLongTasks: 0,
    },
    memory: {},
    ...overrides,
  };
}

describe("resource diagnostics", () => {
  beforeEach(() => {
    resetResourceDiagnosticsForTest();
  });

  it("records agent-session snapshot throughput and payload sizes", () => {
    recordAgentSnapshotFrame("a".repeat(1024), 1_000);
    recordAgentSnapshotFrame("b".repeat(2048), 2_000);

    const snapshot = getResourceDiagnosticsSnapshot({
      documentRef: makeDocument({}),
      now: 2_000,
    });

    assert.equal(snapshot.agentSessionSocket.totalMessages, 2);
    assert.equal(snapshot.agentSessionSocket.totalKilobytes, 3);
    assert.equal(snapshot.agentSessionSocket.lastPayloadKilobytes, 2);
    assert.equal(snapshot.agentSessionSocket.messagesPerSecond, 0.4);
    assert.equal(snapshot.agentSessionSocket.kilobytesPerSecond, 0.6);
  });

  it("tracks terminal websocket lifecycle without leaking closed sockets", () => {
    const tracker = registerTerminalWebSocket("agent-1");

    assert.deepEqual(
      getResourceDiagnosticsSnapshot({
        documentRef: makeDocument({}),
        now: 1_000,
      }).terminalSockets,
      {
        connecting: 1,
        open: 0,
        total: 1,
      },
    );

    tracker.markOpen();
    assert.deepEqual(
      getResourceDiagnosticsSnapshot({
        documentRef: makeDocument({}),
        now: 1_000,
      }).terminalSockets,
      {
        connecting: 0,
        open: 1,
        total: 1,
      },
    );

    tracker.markClosed();
    tracker.markClosed();
    assert.deepEqual(
      getResourceDiagnosticsSnapshot({
        documentRef: makeDocument({}),
        now: 1_000,
      }).terminalSockets,
      {
        connecting: 0,
        open: 0,
        total: 0,
      },
    );
  });

  it("counts mounted resource DOM nodes and converts chromium heap metrics", () => {
    const snapshot = getResourceDiagnosticsSnapshot({
      documentRef: makeDocument({
        ".terminal-preview": 5,
        ".terminal-view": 2,
        ".terminal-view-live": 1,
        ".terminal-view-preview": 1,
        ".focus-terminal-pane[data-terminal-pane-session]": 2,
        '[data-active-terminal-pane="true"][data-terminal-pane-session]': 1,
        ".vscode-drawer-frame": 1,
        ".side-panel-view--active .vscode-drawer-frame": 1,
        ".xterm": 2,
      }),
      now: 1_000,
      performanceRef: {
        memory: {
          jsHeapSizeLimit: 1024 * 1024 * 1024,
          totalJSHeapSize: 128 * 1024 * 1024,
          usedJSHeapSize: 64 * 1024 * 1024,
        },
      },
    });

    assert.deepEqual(snapshot.dom, {
      lightweightPreviewCount: 5,
      liveTerminalViewCount: 1,
      monitorTerminalPaneCount: 2,
      activeInputTerminalPaneCount: 1,
      previewTerminalViewCount: 1,
      vscodeActiveIframeCount: 1,
      vscodeHiddenIframeCount: 0,
      terminalViewCount: 2,
      vscodeIframeCount: 1,
      xtermCount: 2,
    });
    assert.equal(snapshot.memory.usedJSHeapMegabytes, 64);
    assert.equal(snapshot.memory.totalJSHeapMegabytes, 128);
    assert.equal(snapshot.memory.jsHeapLimitMegabytes, 1024);
  });

  it("classifies full terminal preview as the primary no-vscode pressure source", () => {
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot({
        dom: {
          xtermCount: 8,
          terminalViewCount: 8,
          liveTerminalViewCount: 1,
          previewTerminalViewCount: 7,
          lightweightPreviewCount: 0,
          monitorTerminalPaneCount: 0,
          activeInputTerminalPaneCount: 0,
          vscodeIframeCount: 0,
          vscodeActiveIframeCount: 0,
          vscodeHiddenIframeCount: 0,
        },
        terminalSockets: {
          connecting: 0,
          open: 8,
          total: 8,
        },
      }),
      useLightweightTerminalPreview: false,
    });

    assert.equal(
      findings.some((finding) =>
        finding.includes("完整预览正在挂载多个 xterm"),
      ),
      true,
    );
    assert.equal(
      findings.some((finding) => finding.includes("多个终端 WebSocket")),
      true,
    );
  });

  it("classifies high snapshot and terminal stream throughput separately", () => {
    recordTerminalFrame("x".repeat(2 * 1024 * 1024), 1_000);

    const measured = getResourceDiagnosticsSnapshot({
      documentRef: makeDocument({}),
      now: 1_000,
    });
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot({
        agentSessionSocket: {
          messagesPerSecond: 6,
          kilobytesPerSecond: 40,
          totalMessages: 30,
          totalKilobytes: 200,
          lastPayloadKilobytes: 10,
        },
        terminalFrames: measured.terminalFrames,
      }),
      useLightweightTerminalPreview: true,
    });

    assert.equal(
      findings.some((finding) => finding.includes("会话快照推送频率偏高")),
      true,
    );
    assert.equal(
      findings.some((finding) => finding.includes("终端实时输出吞吐偏高")),
      true,
    );
  });

  it("does not classify explicit multi-terminal monitoring as hidden full terminals", () => {
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot({
        dom: {
          xtermCount: 4,
          terminalViewCount: 4,
          liveTerminalViewCount: 4,
          previewTerminalViewCount: 0,
          lightweightPreviewCount: 5,
          monitorTerminalPaneCount: 4,
          activeInputTerminalPaneCount: 1,
          vscodeIframeCount: 0,
          vscodeActiveIframeCount: 0,
          vscodeHiddenIframeCount: 0,
        },
        terminalSockets: {
          connecting: 0,
          open: 4,
          total: 4,
        },
      }),
      useLightweightTerminalPreview: true,
    });

    assert.equal(
      findings.some((finding) =>
        finding.includes("轻量预览下仍出现多个 xterm"),
      ),
      false,
    );
    assert.equal(
      findings.some((finding) => finding.includes("多个终端 WebSocket")),
      false,
    );
  });

  it("flags hidden full terminals even when lightweight preview is selected", () => {
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot({
        dom: {
          xtermCount: 3,
          terminalViewCount: 3,
          liveTerminalViewCount: 1,
          previewTerminalViewCount: 2,
          lightweightPreviewCount: 5,
          monitorTerminalPaneCount: 0,
          activeInputTerminalPaneCount: 0,
          vscodeIframeCount: 0,
          vscodeActiveIframeCount: 0,
          vscodeHiddenIframeCount: 0,
        },
      }),
      useLightweightTerminalPreview: true,
    });

    assert.equal(
      findings.some((finding) =>
        finding.includes("轻量预览下仍出现多个 xterm"),
      ),
      true,
    );
  });

  it("counts active and hidden vscode iframes separately", () => {
    const snapshot = getResourceDiagnosticsSnapshot({
      documentRef: makeDocument({
        ".vscode-drawer-frame": 3,
        ".side-panel-view--active .vscode-drawer-frame": 1,
      }),
      now: 1_000,
    });

    assert.equal(snapshot.dom.vscodeIframeCount, 3);
    assert.equal(snapshot.dom.vscodeActiveIframeCount, 1);
    assert.equal(snapshot.dom.vscodeHiddenIframeCount, 2);
  });

  it("records main-thread long tasks as browser jank pressure", () => {
    recordMainThreadLongTask(120, 1_000);
    recordMainThreadLongTask(80, 2_000);

    const snapshot = getResourceDiagnosticsSnapshot({
      documentRef: makeDocument({}),
      now: 2_000,
    });

    assert.equal(snapshot.mainThread.totalLongTasks, 2);
    assert.equal(snapshot.mainThread.totalBlockedMilliseconds, 200);
    assert.equal(snapshot.mainThread.lastLongTaskMilliseconds, 80);
    assert.equal(snapshot.mainThread.longTasksPerSecond, 0.4);
    assert.equal(snapshot.mainThread.blockedMillisecondsPerSecond, 40);
  });

  it("classifies hidden vscode iframes and proxy websocket pressure", () => {
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot({
        dom: {
          xtermCount: 1,
          terminalViewCount: 1,
          liveTerminalViewCount: 1,
          previewTerminalViewCount: 0,
          lightweightPreviewCount: 5,
          monitorTerminalPaneCount: 0,
          activeInputTerminalPaneCount: 0,
          vscodeIframeCount: 3,
          vscodeActiveIframeCount: 1,
          vscodeHiddenIframeCount: 2,
        },
      }),
      useLightweightTerminalPreview: true,
      vscodeProxyDiagnostics: {
        timestamp: new Date(1_000).toISOString(),
        http: {
          activeRequests: 0,
          downloadKilobytesPerSecond: 0,
          lastStatusCode: 200,
          requestsPerSecond: 0,
          totalDownloadKilobytes: 0,
          totalRequests: 0,
          totalUploadKilobytes: 0,
          uploadKilobytesPerSecond: 0,
        },
        websocket: {
          activeConnections: 1,
          downloadKilobytesPerSecond: 300,
          messagesPerSecond: 12,
          totalDownloadKilobytes: 1000,
          totalDownloadMessages: 10,
          totalUploadKilobytes: 10,
          totalUploadMessages: 5,
          uploadKilobytesPerSecond: 20,
        },
      },
    });

    assert.equal(
      findings.some((finding) => finding.includes("隐藏保活的 VS Code iframe")),
      true,
    );
    assert.equal(
      findings.some((finding) =>
        finding.includes("VS Code 代理 WebSocket 吞吐偏高"),
      ),
      true,
    );
  });

  it("flags full snapshot allocation pressure when payload throughput is high", () => {
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot({
        agentSessionSocket: {
          messagesPerSecond: 4,
          kilobytesPerSecond: 80,
          totalMessages: 100,
          totalKilobytes: 2_000,
          lastPayloadKilobytes: 20,
        },
      }),
      useLightweightTerminalPreview: true,
    });

    assert.equal(
      findings.some((finding) => finding.includes("会话快照推送频率偏高")),
      true,
    );
  });

  it("asks for backend proxy diagnostics when vscode is open but proxy metrics are missing", () => {
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot({
        dom: {
          xtermCount: 1,
          terminalViewCount: 1,
          liveTerminalViewCount: 1,
          previewTerminalViewCount: 0,
          lightweightPreviewCount: 5,
          monitorTerminalPaneCount: 0,
          activeInputTerminalPaneCount: 0,
          vscodeIframeCount: 1,
          vscodeActiveIframeCount: 1,
          vscodeHiddenIframeCount: 0,
        },
      }),
      useLightweightTerminalPreview: true,
      vscodeProxyDiagnostics: null,
    });

    assert.equal(
      findings.some((finding) => finding.includes("未拿到后端代理吞吐")),
      true,
    );
  });

  it("flags terminal history truncation from backend diagnostics", () => {
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot(),
      terminalHistoryDiagnostics: {
        timestamp: new Date(1_000).toISOString(),
        pty: {
          activeSessions: 1,
          maxScrollbackBytes: 16,
          sessions: [
            {
              agentSessionId: "agent-1",
              droppedScrollbackBytes: 32,
              droppedScrollbackChunks: 2,
              scrollbackBytes: 12,
              scrollbackChunks: 1,
            },
          ],
          totalDroppedScrollbackBytes: 32,
          totalDroppedScrollbackChunks: 2,
          totalScrollbackBytes: 12,
          truncatedSessionCount: 1,
        },
        registry: {
          maxOutputEntries: 1000,
        },
        tmux: {
          captureLines: 5000,
        },
      },
      useLightweightTerminalPreview: true,
    });

    assert.equal(
      findings.some((finding) => finding.includes("终端历史缓冲已发生裁剪")),
      true,
    );
    assert.equal(
      findings.some((finding) => finding.includes("未显示明显泄漏源")),
      false,
    );
  });

  it("falls back to heap snapshots when no live pressure source is visible", () => {
    const findings = classifyResourcePressure({
      snapshot: makeSnapshot(),
      useLightweightTerminalPreview: true,
    });

    assert.deepEqual(findings, [
      "当前指标未显示明显泄漏源；若 heap 继续增长，应优先抓取 Chrome Heap Snapshot 对比 retained objects。",
    ]);
  });
});

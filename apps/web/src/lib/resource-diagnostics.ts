import type {
  TerminalHistoryDiagnosticsResponse,
  VsCodeWebProxyDiagnosticsResponse,
} from "@agent-orchestrator/shared";

const RATE_WINDOW_MS = 5_000;

interface RateSample {
  timestamp: number;
  bytes: number;
}

interface DurationSample {
  timestamp: number;
  durationMs: number;
}

interface TerminalSocketState {
  agentSessionId: string;
  state: "connecting" | "open";
}

interface PerformanceMemory {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}

interface PerformanceLike {
  memory?: PerformanceMemory;
}

interface DocumentLike {
  querySelectorAll: (selector: string) => { length: number };
}

export interface ResourceDiagnosticsSnapshot {
  timestamp: number;
  dom: {
    xtermCount: number;
    terminalViewCount: number;
    liveTerminalViewCount: number;
    previewTerminalViewCount: number;
    lightweightPreviewCount: number;
    monitorTerminalPaneCount: number;
    activeInputTerminalPaneCount: number;
    vscodeIframeCount: number;
    vscodeActiveIframeCount: number;
    vscodeHiddenIframeCount: number;
  };
  agentSessionSocket: {
    messagesPerSecond: number;
    kilobytesPerSecond: number;
    totalMessages: number;
    totalKilobytes: number;
    lastPayloadKilobytes: number;
  };
  terminalSockets: {
    connecting: number;
    open: number;
    total: number;
  };
  terminalFrames: {
    messagesPerSecond: number;
    kilobytesPerSecond: number;
  };
  mainThread: {
    longTaskObserverSupported: boolean;
    longTasksPerSecond: number;
    blockedMillisecondsPerSecond: number;
    totalLongTasks: number;
    totalBlockedMilliseconds: number;
    lastLongTaskMilliseconds: number;
  };
  memory: {
    usedJSHeapMegabytes?: number;
    totalJSHeapMegabytes?: number;
    jsHeapLimitMegabytes?: number;
  };
}

export interface ResourceDiagnosticsOptions {
  documentRef?: DocumentLike;
  now?: number;
  performanceRef?: PerformanceLike;
}

const agentSnapshotSamples: RateSample[] = [];
const terminalFrameSamples: RateSample[] = [];
const mainThreadLongTaskSamples: DurationSample[] = [];
const terminalSockets = new Map<number, TerminalSocketState>();

let nextTerminalSocketId = 1;
let totalAgentSnapshotMessages = 0;
let totalAgentSnapshotBytes = 0;
let lastAgentSnapshotBytes = 0;
let totalMainThreadLongTasks = 0;
let totalMainThreadBlockedMilliseconds = 0;
let lastMainThreadLongTaskMilliseconds = 0;
let longTaskObserverStarted = false;
let longTaskObserverSupported = false;

function measureTextBytes(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

function trimSamples(samples: RateSample[], now: number): void {
  while (samples.length > 0 && now - samples[0]!.timestamp > RATE_WINDOW_MS) {
    samples.shift();
  }
}

function recordSample(samples: RateSample[], bytes: number, now: number): void {
  samples.push({ timestamp: now, bytes });
  trimSamples(samples, now);
}

function trimDurationSamples(samples: DurationSample[], now: number): void {
  while (samples.length > 0 && now - samples[0]!.timestamp > RATE_WINDOW_MS) {
    samples.shift();
  }
}

function calculateDurationRate(samples: DurationSample[], now: number) {
  trimDurationSamples(samples, now);
  const totalDurationMs = samples.reduce(
    (sum, sample) => sum + sample.durationMs,
    0,
  );

  return {
    blockedMillisecondsPerSecond: totalDurationMs / (RATE_WINDOW_MS / 1000),
    longTasksPerSecond: samples.length / (RATE_WINDOW_MS / 1000),
  };
}

function calculateRate(samples: RateSample[], now: number) {
  trimSamples(samples, now);
  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);

  return {
    kilobytesPerSecond: totalBytes / 1024 / (RATE_WINDOW_MS / 1000),
    messagesPerSecond: samples.length / (RATE_WINDOW_MS / 1000),
  };
}

function countSelector(
  documentRef: DocumentLike | undefined,
  selector: string,
) {
  if (!documentRef) {
    return 0;
  }

  try {
    return documentRef.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function toMegabytes(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value / 1024 / 1024
    : undefined;
}

export function recordAgentSnapshotFrame(
  payload: string,
  now = Date.now(),
): void {
  const bytes = measureTextBytes(payload);
  totalAgentSnapshotMessages += 1;
  totalAgentSnapshotBytes += bytes;
  lastAgentSnapshotBytes = bytes;
  recordSample(agentSnapshotSamples, bytes, now);
}

export function recordTerminalFrame(payload: string, now = Date.now()): void {
  recordSample(terminalFrameSamples, measureTextBytes(payload), now);
}

export function recordMainThreadLongTask(
  durationMs: number,
  now = Date.now(),
): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return;
  }

  totalMainThreadLongTasks += 1;
  totalMainThreadBlockedMilliseconds += durationMs;
  lastMainThreadLongTaskMilliseconds = durationMs;
  mainThreadLongTaskSamples.push({ timestamp: now, durationMs });
  trimDurationSamples(mainThreadLongTaskSamples, now);
}

function ensureLongTaskObserverStarted(): boolean {
  if (longTaskObserverStarted) {
    return longTaskObserverSupported;
  }

  longTaskObserverStarted = true;

  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    longTaskObserverSupported = false;
    return false;
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordMainThreadLongTask(entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    longTaskObserverSupported = true;
  } catch {
    longTaskObserverSupported = false;
  }

  return longTaskObserverSupported;
}

export function registerTerminalWebSocket(agentSessionId: string): {
  markOpen: () => void;
  markClosed: () => void;
} {
  const socketId = nextTerminalSocketId;
  nextTerminalSocketId += 1;
  let closed = false;

  terminalSockets.set(socketId, {
    agentSessionId,
    state: "connecting",
  });

  return {
    markOpen() {
      if (closed) {
        return;
      }

      terminalSockets.set(socketId, {
        agentSessionId,
        state: "open",
      });
    },
    markClosed() {
      if (closed) {
        return;
      }

      closed = true;
      terminalSockets.delete(socketId);
    },
  };
}

export function getResourceDiagnosticsSnapshot(
  options: ResourceDiagnosticsOptions = {},
): ResourceDiagnosticsSnapshot {
  const now = options.now ?? Date.now();
  const documentRef =
    options.documentRef ??
    (typeof document === "undefined" ? undefined : document);
  const performanceRef: PerformanceLike | undefined =
    options.performanceRef ??
    (typeof performance === "undefined"
      ? undefined
      : (performance as PerformanceLike));
  const agentSnapshotRate = calculateRate(agentSnapshotSamples, now);
  const terminalFrameRate = calculateRate(terminalFrameSamples, now);
  const mainThreadRate = calculateDurationRate(mainThreadLongTaskSamples, now);
  const vscodeIframeCount = countSelector(documentRef, ".vscode-drawer-frame");
  const vscodeActiveIframeCount = countSelector(
    documentRef,
    ".side-panel-view--active .vscode-drawer-frame",
  );
  let connecting = 0;
  let open = 0;

  for (const socket of terminalSockets.values()) {
    if (socket.state === "open") {
      open += 1;
    } else {
      connecting += 1;
    }
  }

  return {
    timestamp: now,
    dom: {
      xtermCount: countSelector(documentRef, ".xterm"),
      terminalViewCount: countSelector(documentRef, ".terminal-view"),
      liveTerminalViewCount: countSelector(documentRef, ".terminal-view-live"),
      previewTerminalViewCount: countSelector(
        documentRef,
        ".terminal-view-preview",
      ),
      lightweightPreviewCount: countSelector(documentRef, ".terminal-preview"),
      monitorTerminalPaneCount: countSelector(
        documentRef,
        ".focus-terminal-pane[data-terminal-pane-session]",
      ),
      activeInputTerminalPaneCount: countSelector(
        documentRef,
        '[data-active-terminal-pane="true"][data-terminal-pane-session]',
      ),
      vscodeActiveIframeCount,
      vscodeHiddenIframeCount: Math.max(
        0,
        vscodeIframeCount - vscodeActiveIframeCount,
      ),
      vscodeIframeCount,
    },
    agentSessionSocket: {
      ...agentSnapshotRate,
      lastPayloadKilobytes: lastAgentSnapshotBytes / 1024,
      totalKilobytes: totalAgentSnapshotBytes / 1024,
      totalMessages: totalAgentSnapshotMessages,
    },
    terminalFrames: terminalFrameRate,
    terminalSockets: {
      connecting,
      open,
      total: connecting + open,
    },
    mainThread: {
      ...mainThreadRate,
      lastLongTaskMilliseconds: lastMainThreadLongTaskMilliseconds,
      longTaskObserverSupported: ensureLongTaskObserverStarted(),
      totalBlockedMilliseconds: totalMainThreadBlockedMilliseconds,
      totalLongTasks: totalMainThreadLongTasks,
    },
    memory: {
      jsHeapLimitMegabytes: toMegabytes(
        performanceRef?.memory?.jsHeapSizeLimit,
      ),
      totalJSHeapMegabytes: toMegabytes(
        performanceRef?.memory?.totalJSHeapSize,
      ),
      usedJSHeapMegabytes: toMegabytes(performanceRef?.memory?.usedJSHeapSize),
    },
  };
}

export function classifyResourcePressure({
  snapshot,
  terminalHistoryDiagnostics,
  useLightweightTerminalPreview,
  vscodeProxyDiagnostics,
}: {
  snapshot: ResourceDiagnosticsSnapshot;
  terminalHistoryDiagnostics?: TerminalHistoryDiagnosticsResponse | null;
  useLightweightTerminalPreview: boolean;
  vscodeProxyDiagnostics?: VsCodeWebProxyDiagnosticsResponse | null;
}): string[] {
  const findings: string[] = [];
  const intentionalLiveTerminalBudget = Math.max(
    1,
    snapshot.dom.monitorTerminalPaneCount,
  );
  const vscodeProxyWebSocketKilobytesPerSecond = vscodeProxyDiagnostics
    ? vscodeProxyDiagnostics.websocket.uploadKilobytesPerSecond +
      vscodeProxyDiagnostics.websocket.downloadKilobytesPerSecond
    : 0;
  const vscodeProxyHttpKilobytesPerSecond = vscodeProxyDiagnostics
    ? vscodeProxyDiagnostics.http.uploadKilobytesPerSecond +
      vscodeProxyDiagnostics.http.downloadKilobytesPerSecond
    : 0;
  const hasVsCodeProxyPressure =
    Boolean(vscodeProxyDiagnostics) &&
    (vscodeProxyWebSocketKilobytesPerSecond >= 256 ||
      vscodeProxyDiagnostics!.websocket.messagesPerSecond >= 50 ||
      vscodeProxyHttpKilobytesPerSecond >= 512 ||
      vscodeProxyDiagnostics!.http.requestsPerSecond >= 5);
  const hasTerminalHistoryTruncation =
    Boolean(terminalHistoryDiagnostics) &&
    terminalHistoryDiagnostics!.pty.truncatedSessionCount > 0;

  if (hasTerminalHistoryTruncation) {
    findings.push(
      "终端历史缓冲已发生裁剪；重开、切换或刷新终端后，早期长输出可能无法完整恢复。",
    );
  }

  if (
    !useLightweightTerminalPreview &&
    snapshot.dom.xtermCount > intentionalLiveTerminalBudget
  ) {
    findings.push(
      "完整预览正在挂载多个 xterm，这是无 VS Code 场景下内存增长的首要嫌疑。",
    );
  }

  if (
    snapshot.agentSessionSocket.messagesPerSecond >= 2 ||
    snapshot.agentSessionSocket.kilobytesPerSecond >= 64
  ) {
    findings.push(
      "会话快照推送频率偏高，浏览器会持续 JSON 解析并触发 React 更新。",
    );
  }

  if (snapshot.terminalSockets.total > intentionalLiveTerminalBudget) {
    findings.push(
      "同时存在多个终端 WebSocket，说明页面仍挂着多个完整终端实例。",
    );
  }

  if (
    snapshot.terminalFrames.messagesPerSecond >= 20 ||
    snapshot.terminalFrames.kilobytesPerSecond >= 256
  ) {
    findings.push(
      "终端实时输出吞吐偏高，活跃终端本身会持续推高网络、xterm scrollback 和渲染压力。",
    );
  }

  if (
    useLightweightTerminalPreview &&
    snapshot.dom.xtermCount > intentionalLiveTerminalBudget
  ) {
    findings.push(
      "轻量预览下仍出现多个 xterm，需要检查是否有隐藏完整终端未释放。",
    );
  }

  if (snapshot.dom.vscodeHiddenIframeCount > 0) {
    findings.push(
      "存在隐藏保活的 VS Code iframe；保持状态模式下隐藏编辑器仍可能占用 CPU、WebSocket 和内存。",
    );
  }

  if (
    snapshot.mainThread.blockedMillisecondsPerSecond >= 80 ||
    snapshot.mainThread.longTasksPerSecond >= 1
  ) {
    findings.push(
      "浏览器主线程长任务偏多，VS Code iframe、React 更新和终端渲染会互相抢占同一个渲染线程。",
    );
  }

  if (
    vscodeProxyDiagnostics &&
    (vscodeProxyWebSocketKilobytesPerSecond >= 256 ||
      vscodeProxyDiagnostics.websocket.messagesPerSecond >= 50)
  ) {
    findings.push(
      "VS Code 代理 WebSocket 吞吐偏高，通常来自 code-server 编辑器状态同步、扩展或文件索引活动。",
    );
  }

  if (
    vscodeProxyDiagnostics &&
    (vscodeProxyHttpKilobytesPerSecond >= 512 ||
      vscodeProxyDiagnostics.http.requestsPerSecond >= 5)
  ) {
    findings.push(
      "VS Code 代理 HTTP 资源加载偏高，可能正在加载扩展、文件预览、webview 或大量编辑器资源。",
    );
  }

  if (snapshot.dom.vscodeIframeCount > 0 && !vscodeProxyDiagnostics) {
    findings.push(
      "已打开 VS Code，但未拿到后端代理吞吐；需要重启后端或确认诊断接口可用后再判断 VS Code 网络压力。",
    );
  }

  if (
    snapshot.dom.xtermCount <= intentionalLiveTerminalBudget &&
    snapshot.agentSessionSocket.messagesPerSecond < 2 &&
    snapshot.agentSessionSocket.kilobytesPerSecond < 64 &&
    snapshot.terminalFrames.messagesPerSecond < 20 &&
    snapshot.terminalFrames.kilobytesPerSecond < 256 &&
    snapshot.terminalSockets.total <= intentionalLiveTerminalBudget &&
    snapshot.dom.vscodeHiddenIframeCount === 0 &&
    snapshot.mainThread.blockedMillisecondsPerSecond < 80 &&
    snapshot.mainThread.longTasksPerSecond < 1 &&
    !hasTerminalHistoryTruncation &&
    !hasVsCodeProxyPressure &&
    (snapshot.dom.vscodeIframeCount === 0 || Boolean(vscodeProxyDiagnostics))
  ) {
    findings.push(
      "当前指标未显示明显泄漏源；若 heap 继续增长，应优先抓取 Chrome Heap Snapshot 对比 retained objects。",
    );
  }

  return findings;
}

export function resetResourceDiagnosticsForTest(): void {
  agentSnapshotSamples.length = 0;
  terminalFrameSamples.length = 0;
  mainThreadLongTaskSamples.length = 0;
  terminalSockets.clear();
  nextTerminalSocketId = 1;
  totalAgentSnapshotBytes = 0;
  totalAgentSnapshotMessages = 0;
  lastAgentSnapshotBytes = 0;
  totalMainThreadLongTasks = 0;
  totalMainThreadBlockedMilliseconds = 0;
  lastMainThreadLongTaskMilliseconds = 0;
  longTaskObserverStarted = false;
  longTaskObserverSupported = false;
}

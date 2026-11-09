import { installDesktopBridge } from "./browser-bridge.mjs";
import { decodeWireValue } from "./wire-value.mjs";
import { connectDesktopSurfaceHost } from "./surface-host-bridge.mjs";
import { createBrowserSurfaceController } from "./browser-surface-controller.mjs";
import { createBrowserProjectFolderPicker } from "./browser-project-folder-picker.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ENTRY = /^\.\/assets\/index-[a-f0-9]+\.js$/;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4096;
const MAX_TIMEOUT_MS = 30_000;
const startedDocuments = new WeakSet();
const encoder = new TextEncoder();
const BRIDGE_FAILURE_CODES = new Set([
  "BRIDGE_CLOSED",
  "BRIDGE_INVALID_CONFIG",
  "BRIDGE_INVALID_MESSAGE",
  "BRIDGE_MENU_UNAVAILABLE",
  "BRIDGE_NATIVE_ERROR",
  "BRIDGE_OUTCOME_UNKNOWN",
  "BRIDGE_PENDING_LIMIT",
  "BRIDGE_PORT_LIMIT",
  "BRIDGE_QUEUE_FULL",
  "BRIDGE_SCOPE_CHANGED",
  "BRIDGE_UNSUPPORTED_OPERATION",
  "BRIDGE_UNSUPPORTED_VALUE",
]);
const BRIDGE_LIMIT_KINDS = new Set([
  "waiting_count",
  "queued_bytes",
  "snapshot_bytes",
  "native_output_count",
  "native_output_bytes",
]);
const BRIDGE_OUTCOME_CAUSES = new Set([
  "send_failure",
  "request_timeout",
  "port_closed_queued",
]);
function bridgeFailureCode(reason) {
  try {
    const code = Object.getOwnPropertyDescriptor(reason, "code")?.value;
    return BRIDGE_FAILURE_CODES.has(code) ? code : null;
  } catch {
    return null;
  }
}
function bridgeLimitCode(reason, code) {
  if (code !== "BRIDGE_QUEUE_FULL") return null;
  try {
    const limit = Object.getOwnPropertyDescriptor(reason, "limitKind")?.value;
    return BRIDGE_LIMIT_KINDS.has(limit) ? limit : null;
  } catch {
    return null;
  }
}
function bridgeCauseCode(reason, code) {
  if (code !== "BRIDGE_OUTCOME_UNKNOWN") return null;
  try {
    const cause = Object.getOwnPropertyDescriptor(reason, "causeKind")?.value;
    return BRIDGE_OUTCOME_CAUSES.has(cause) ? cause : null;
  } catch {
    return null;
  }
}

function bridgeTimeoutMetadata(diagnostic) {
  try {
    const source=Object.getOwnPropertyDescriptors(diagnostic), raw=source.timedOutRequest?.value;
    const fields=Object.getOwnPropertyDescriptors(raw), request={};
    const keys=['id','seq','type','method','dispatched','admitted','queued','queueAhead'];
    if(Object.keys(fields).sort().join(',')!==[...keys].sort().join(','))return null;
    for(const key of keys){if(!Object.hasOwn(fields[key],'value'))return null;request[key]=fields[key].value;}
    if(!Number.isSafeInteger(request.id)||request.id<1||!Number.isSafeInteger(request.seq)||request.seq<1||
      !['call','openPort','portPost','closePort'].includes(request.type)||
      ![null,'sendMessageFromView','startLinkDrag','acknowledgeChunkedMessage','connectGitWorker','sendWorkerMessageFromView','showContextMenu','getFastModeRolloutMetrics','workerSubscribe','workerUnsubscribe'].includes(request.method)||
      ['dispatched','admitted','queued'].some(key=>typeof request[key]!=='boolean')||
      (request.queueAhead!==null&&(!Number.isSafeInteger(request.queueAhead)||request.queueAhead<0||request.queueAhead>320)))return null;
    const result={timedOutRequest:request};
    for(const key of ['pendingTotal','waitingRequests','portPostsInFlight','waitingPortPosts','portCount','readyPorts','queuedTransportFrames','queuedTransportBytes','retainedPortBytes','overlappedPortBytes','portProduced','portReceived','nativeDeferred','nativeDeferredBytes']){
      const value=source[key]?.value;
      if(!Number.isSafeInteger(value)||value<0)return null;
      result[key]=value;
    }
    return JSON.stringify(result);
  }catch{return null;}
}

const failure = (code) =>
  Object.assign(new Error("Desktop connection unavailable"), { code });
const record = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const exact = (value, keys) =>
  record(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
function budget(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw failure("ENTRY_INVALID_CONFIG");
  return value;
}
function bytes(value, maximum) {
  if (typeof value !== "string") throw failure("ENTRY_INVALID_FRAME");
  if (value.length > maximum) throw failure("ENTRY_FRAME_LIMIT");
  const length = encoder.encode(value).byteLength;
  if (length > maximum) throw failure("ENTRY_FRAME_LIMIT");
  return length;
}

// The original desktop binds Open Folder through Electron's menu accelerator.
// In a browser document, deliver that same action through the existing view
// bridge; the native picker still owns path and view authorization.
export function installProjectOpenShortcut({ window: win, activation, sendMessage }) {
  if (
    !win?.document ||
    typeof win.addEventListener !== "function" ||
    typeof win.removeEventListener !== "function" ||
    typeof activation?.getSnapshot !== "function" ||
    typeof activation?.isCurrent !== "function" ||
    typeof sendMessage !== "function"
  ) throw failure("ENTRY_INVALID_CONFIG");
  let disposed = false, inFlight = false;
  const onKeyDown = (event) => {
    if (
      disposed || event.isTrusted !== true || event.defaultPrevented ||
      event.isComposing || event.keyCode === 229 || event.repeat ||
      event.altKey || event.shiftKey ||
      (event.ctrlKey === true) === (event.metaKey === true) ||
      typeof event.key !== "string" || event.key.toLowerCase() !== "o" ||
      win.document.visibilityState !== "visible"
    ) return;
    let token;
    try {
      token = activation.getSnapshot();
      if (!token || activation.isCurrent(token) !== true) return;
    } catch { return; }
    event.preventDefault();
    // Install before the original UI so one gesture cannot also dispatch the
    // Electron menu action through a later listener.
    event.stopImmediatePropagation();
    if (inFlight) return;
    inFlight = true;
    try {
      Promise.resolve(sendMessage({ type: "electron-add-new-workspace-root-option" }))
        .catch(() => {})
        .finally(() => { inFlight = false; });
    } catch { inFlight = false; }
  };
  win.addEventListener("keydown", onKeyDown, true);
  return Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    win.removeEventListener("keydown", onKeyDown, true);
  } });
}

function manifestFor(win) {
  const doc = win.document;
  const manifests = doc.querySelectorAll("#chatgpt-host-manifest");
  if (manifests.length !== 1) throw failure("ENTRY_INVALID_MANIFEST");
  const node = manifests[0],
    body = node.textContent;
  if (
    node.tagName !== "SCRIPT" ||
    node.type !== "application/json" ||
    node.getAttribute("src") !== null ||
    typeof body !== "string" ||
    body.length > MAX_MANIFEST_BYTES ||
    encoder.encode(body).byteLength > MAX_MANIFEST_BYTES
  ) {
    throw failure("ENTRY_INVALID_MANIFEST");
  }
  let manifest;
  try {
    manifest = JSON.parse(body);
  } catch {
    throw failure("ENTRY_INVALID_MANIFEST");
  }
  if (
    !exact(manifest, ["version", "profileId", "generation", "entry"]) ||
    ![1, 2, 3, 4, 5].includes(manifest.version) ||
    typeof manifest.profileId !== "string" ||
    !UUID.test(manifest.profileId) ||
    typeof manifest.generation !== "string" ||
    !UUID.test(manifest.generation) ||
    typeof manifest.entry !== "string" ||
    !ENTRY.test(manifest.entry) ||
    body !==
      JSON.stringify({
        version: manifest.version,
        profileId: manifest.profileId,
        generation: manifest.generation,
        entry: manifest.entry,
      })
  ) {
    throw failure("ENTRY_INVALID_MANIFEST");
  }
  let location, asset, baseAsset;
  try {
    location = new URL(win.location.href);
    asset = new URL(manifest.entry, location);
    baseAsset = new URL(manifest.entry, doc.baseURI);
  } catch {
    throw failure("ENTRY_INVALID_LOCATION");
  }
  const path = `/chatgpt-desktop/${manifest.profileId}/${manifest.generation}`;
  if (
    !["http:", "https:"].includes(location.protocol) ||
    location.username ||
    location.password ||
    location.origin !== win.location.origin ||
    location.pathname !== `${path}/webview/index.html` ||
    asset.origin !== location.origin ||
    asset.href !== baseAsset.href
  ) {
    throw failure("ENTRY_INVALID_LOCATION");
  }
  const ws = new URL(`${path}/bridge`, location.origin);
  ws.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return { manifest, socketUrl: ws.href };
}

function validBootstrap(frame, manifest) {
  if (
    !exact(frame, ["v", "type", "scope", "bootstrap"]) ||
    frame.v !== 1 ||
    frame.type !== "bootstrap" ||
    !exact(frame.scope, ["profileId", "generation", "viewId"]) ||
    frame.scope.profileId !== manifest.profileId ||
    frame.scope.generation !== manifest.generation ||
    typeof frame.scope.viewId !== "string" ||
    !UUID.test(frame.scope.viewId) ||
    !exact(frame.bootstrap, ["windowType", "getters", "sharedObjects"]) ||
    frame.bootstrap.windowType !== "electron" ||
    !record(frame.bootstrap.getters) ||
    !record(frame.bootstrap.sharedObjects)
  )
    return false;
  return true;
}

function showFailure(win, code, bridgeCode, limitCode, causeCode, timeoutMetadata) {
  const doc = win.document;
  if (!doc?.body) return;
  const box = doc.createElement("div");
  box.id = "chatgpt-host-connection-status";
  box.setAttribute("role", "alert");
  box.setAttribute("data-error-code", code);
  if (code === "ENTRY_BRIDGE_FAILED" && BRIDGE_FAILURE_CODES.has(bridgeCode))
    box.setAttribute("data-bridge-error-code", bridgeCode);
  if (code === "ENTRY_BRIDGE_FAILED" && bridgeCode === "BRIDGE_QUEUE_FULL" && BRIDGE_LIMIT_KINDS.has(limitCode))
    box.setAttribute("data-bridge-limit-code", limitCode);
  if (code === "ENTRY_BRIDGE_FAILED" && bridgeCode === "BRIDGE_OUTCOME_UNKNOWN" && BRIDGE_OUTCOME_CAUSES.has(causeCode))
    box.setAttribute("data-bridge-cause-code", causeCode);
  if(code==='ENTRY_BRIDGE_FAILED'&&bridgeCode==='BRIDGE_OUTCOME_UNKNOWN'&&causeCode==='request_timeout'&&timeoutMetadata)
    box.setAttribute('data-bridge-timeout-metadata',timeoutMetadata);
  Object.assign(box.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    maxWidth: "min(360px, calc(100vw - 32px))",
    padding: "12px 14px",
    background: "#fff",
    color: "#202123",
    border: "1px solid #ccc",
    borderRadius: "10px",
    boxShadow: "0 4px 20px #0002",
    font: "13px/1.5 system-ui, sans-serif",
  });
  const message = doc.createElement("span");
  if (code === "ENTRY_SECURE_CONTEXT_REQUIRED") {
    message.textContent =
      "请使用 HTTPS 打开桌面工作区。当前连接无法提供编辑器所需的浏览器能力。";
    box.appendChild(message);
    doc.body.appendChild(box);
    return;
  }
  if (code === "ENTRY_BRIDGE_FAILED" && bridgeCode === "BRIDGE_QUEUE_FULL") {
    message.textContent =
      "桌面连接请求队列已满。请手动重新连接后检查会话状态。";
  } else if (code === "ENTRY_BRIDGE_FAILED" && bridgeCode === "BRIDGE_OUTCOME_UNKNOWN") {
    message.textContent =
      "上一次操作是否完成尚未确认。请重新连接后先检查会话状态，再决定是否重试；不会自动重发操作。";
  } else {
    message.textContent = "桌面工作区连接中断，请重新连接。";
  }
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.textContent = "重新连接";
  Object.assign(retry.style, {
    marginLeft: "10px",
    minHeight: "36px",
    cursor: "pointer",
  });
  // Scripted click() is not a user decision to reload this document.
  retry.addEventListener("click", (event) => {
    if (event.isTrusted === true) win.location.reload();
  });
  box.appendChild(message);
  box.appendChild(retry);
  doc.body.appendChild(box);
}

/**
 * Start exactly one browser document. Successful resolution means the native
 * bootstrap was validated, the facade installed and the original module tag
 * appended; it does not mean that the original UI or any operation succeeded.
 * The returned close() only tears down this view/connection. Socket writes are
 * browser-enqueue acknowledgements, not native execution acknowledgements.
 * No retry, reconnect, reload or operation replay occurs without a user click.
 */
export function createDesktopDocumentStarter({
  createSurfaceController = createBrowserSurfaceController,
  createProjectFolderPicker = createBrowserProjectFolderPicker,
  loadCapability = () => import("./browser-composer-capability-entry.mjs"),
  loadSharedNavigation = () => import("./browser-shared-thread-navigation.mjs"),
  loadSharedCatalog = () => import("./browser-shared-catalog.mjs"),
  loadSharedDirectory = () => import("./browser-shared-thread-directory.mjs"),
  loadIsolatedPaneNavigation = () =>
    import("./browser-isolated-pane-navigation.mjs"),
} = {}) {
  if (
    typeof createSurfaceController !== "function" ||
    typeof createProjectFolderPicker !== "function" ||
    typeof loadCapability !== "function" ||
    typeof loadSharedNavigation !== "function" ||
    typeof loadSharedCatalog !== "function" ||
    typeof loadSharedDirectory !== "function" ||
    typeof loadIsolatedPaneNavigation !== "function"
  )
    throw failure("ENTRY_INVALID_CONFIG");
  return function startDesktopDocument(options = {}) {
    return new Promise((resolve, reject) => {
      const win =
        options && typeof options === "object" ? options.window : undefined;
      const doc = win?.document;
      if (!doc || typeof doc !== "object") {
        reject(failure("ENTRY_INVALID_CONFIG"));
        return;
      }
      if (startedDocuments.has(doc)) {
        reject(failure("ENTRY_ALREADY_STARTED"));
        return;
      }
      startedDocuments.add(doc);
      let socket,
        bridge,
        activation,
        surfaceController,
        folderPicker,
        projectShortcut,
        sharedComposerCapability, sharedProjectSelection, sharedNavigation,
        sharedCatalog,
        sharedDirectory,
        sharedSourceReady = false,
        listener,
        timer,
        script,
        settled = false,
        closed = false,
        closing = false,
        failed = false,
        intentional = false,
        bootstrapped = false;
      const handlers = [];
      const sourceListeners = new Set();
      const observe = (target, type, handler) => {
        target.addEventListener(type, handler);
        handlers.push(() => target.removeEventListener(type, handler));
      };
      const close = () => {
        if (closed || closing) return;
        closing = true;
        sharedSourceReady = false;
        for (const fn of sourceListeners) try { fn(); } catch {}
        sourceListeners.clear();
        try { sharedDirectory?.dispose(); } catch {}
        sharedDirectory = undefined;
        try { sharedCatalog?.dispose(); } catch {}
        sharedCatalog = undefined;
        const ownedShortcut = projectShortcut;
        projectShortcut = undefined;
        try { ownedShortcut?.dispose(); } catch { /* revoke other resources */ }
        try { sharedProjectSelection?.dispose(); } catch {}
        sharedProjectSelection = undefined;
        const ownedShared = sharedNavigation;
        sharedNavigation = undefined;
        try {
          ownedShared?.dispose();
        } catch {
          /* revoke remaining resources */
        }
        const ownedPicker = folderPicker;
        folderPicker = undefined;
        try {
          // Give an owned pending dialog a chance to cancel while this view's
          // bridge is still open. Delivery may remain unknown on disconnect.
          ownedPicker?.dispose();
        } catch {
          /* still revoke all remaining resources */
        }
        closed = true;
        if (timer !== undefined) win.clearTimeout(timer);
        for (const off of handlers.splice(0)) off();
        listener = undefined;
        const ownedSurface = surfaceController;
        surfaceController = undefined;
        try {
          ownedSurface?.dispose();
        } catch {
          /* cancel owned local menu and clipboard work */
        }
        const ownedActivation = activation;
        activation = undefined;
        try {
          ownedActivation?.dispose();
        } catch {
          /* revoke local input before releasing the bridge */
        }
        const ownedBridge = bridge;
        bridge = undefined;
        try {
          ownedBridge?.dispose();
        } catch {
          /* release only our own resources */
        }
        try {
          if (socket && socket.readyState !== 3) socket.close();
        } catch {
          /* already closed */
        }
      };
      const fail = (code, bridgeCode, limitCode, causeCode, timeoutMetadata) => {
        if (failed || intentional) return;
        failed = true;
        close();
        try {
          showFailure(win, code, bridgeCode, limitCode, causeCode, timeoutMetadata);
        } catch {
          /* no untrusted error detail is exposed */
        }
        if (!settled) {
          settled = true;
          reject(failure(code));
        }
      };
      const stop = () => {
        if (intentional) return;
        intentional = true;
        close();
        if (!settled) {
          settled = true;
          reject(failure("ENTRY_CLOSED"));
        }
      };
      try {
        const allowed = new Set([
          "window",
          "handshakeTimeoutMs",
          "maxFrameBytes",
          "maxBufferedBytes",
        ]);
        if (
          !record(options) ||
          Object.keys(options).some((key) => !allowed.has(key)) ||
          typeof win.WebSocket !== "function" ||
          typeof win.setTimeout !== "function" ||
          typeof win.clearTimeout !== "function"
        ) {
          throw failure("ENTRY_INVALID_CONFIG");
        }
        const timeout = budget(
          options.handshakeTimeoutMs ?? 10_000,
          MAX_TIMEOUT_MS,
        );
        const maxFrame = budget(options.maxFrameBytes ?? MAX_BYTES, MAX_BYTES);
        const maxBuffered = budget(
          options.maxBufferedBytes ?? MAX_BYTES,
          MAX_BYTES,
        );
        const { manifest, socketUrl } = manifestFor(win);
        if (
          win.isSecureContext !== true ||
          typeof win.crypto?.randomUUID !== "function" ||
          !win.crypto?.subtle
        ) {
          throw failure("ENTRY_SECURE_CONTEXT_REQUIRED");
        }
        const sendBounded = (encoded) => {
            try {
              const length = bytes(encoded, maxFrame);
              const buffered = socket?.bufferedAmount;
              if (
                closed ||
                socket?.readyState !== 1 ||
                !Number.isSafeInteger(buffered) ||
                buffered < 0
              )
                throw failure("ENTRY_CONNECTION_LOST");
              if (buffered + length > maxBuffered)
                throw failure("ENTRY_BACKPRESSURE");
              socket.send(encoded);
              if (
                !Number.isSafeInteger(socket.bufferedAmount) ||
                socket.bufferedAmount < 0 ||
                socket.bufferedAmount > maxBuffered
              )
                throw failure("ENTRY_BACKPRESSURE");
            } catch (error) {
              const code =
                error?.code === "ENTRY_FRAME_LIMIT" ||
                error?.code === "ENTRY_INVALID_FRAME" ||
                error?.code === "ENTRY_BACKPRESSURE"
                  ? error.code
                  : "ENTRY_CONNECTION_LOST";
              fail(code);
              throw failure(code);
            }
        };
        let deliveryView, deliverySequence = -1;
        const deliveryActive = new Set();
        const acknowledge = (number) => { sendBounded('KBA1:' + deliveryView + ':' + number); deliveryActive.delete(number); };
        const transport = {
          async send(encoded) { sendBounded(encoded); },
          subscribe(handler) {
            if (closed || listener || typeof handler !== "function")
              throw failure("ENTRY_INVALID_CONFIG");
            listener = handler;
            return () => {
              if (listener === handler) listener = undefined;
            };
          },
          close,
        };
        observe(win, "pagehide", (event) => {
          const mayRestore = event?.persisted === true;
          stop();
          if (mayRestore) {
            const restored = (shown) => {
              win.removeEventListener("pageshow", restored);
              if (shown?.persisted === true) {
                try {
                  showFailure(win, "ENTRY_RESTORE_REQUIRED");
                } catch {
                  /* keep the restored document intact */
                }
              }
            };
            win.addEventListener("pageshow", restored);
          }
        });
        socket = new win.WebSocket(socketUrl);
        observe(socket, "error", () => fail("ENTRY_CONNECTION_LOST"));
        observe(socket, "close", () => fail("ENTRY_CONNECTION_LOST"));
        observe(socket, "message", (event) => {
          if (closed) return;
          try {
            bytes(event.data, maxFrame);
            if (socket.readyState !== 1) throw failure("ENTRY_CONNECTION_LOST");
            // This fixed transport version is deliberately not compatible with
            // the old kernel-write-only gateway. Metadata never enters native.
            const boundary = event.data.indexOf('\n');
            const header = boundary >= 0 && boundary <= 80
              ? /^KBC1:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):((?:0|[1-9][0-9]{0,15}))$/.exec(event.data.slice(0, boundary)) : null;
            if (!header || (deliveryView !== undefined && header[1] !== deliveryView))
              throw failure("ENTRY_INVALID_FRAME");
            const delivery = Number(header[2]);
            if (!Number.isSafeInteger(delivery) || delivery !== deliverySequence + 1)
              throw failure("ENTRY_INVALID_FRAME");
            deliverySequence = delivery;
            if (delivery > 0) {
              if (deliveryActive.size >= 8) throw failure("ENTRY_BACKPRESSURE");
              deliveryActive.add(delivery);
            }
            const encoded = event.data.slice(boundary + 1);
            if (!bootstrapped) {
              let frame;
              try {
                frame = decodeWireValue(encoded);
              } catch {
                throw failure("ENTRY_INVALID_BOOTSTRAP");
              }
              if (delivery !== 0 || !validBootstrap(frame, manifest) || header[1] !== frame.scope.viewId)
                throw failure("ENTRY_INVALID_BOOTSTRAP");
              // Confirm version zero before any initializer may issue a call.
              deliveryView = header[1];
              acknowledge(0);
              const scope = Object.freeze({ ...frame.scope });
              // This owned document serves the Codex surface only. The exact
              // upstream renderer adaptation reads this immutable flag before
              // attempting Work executor authorization.
              if (
                "__kanbanCodexOnlySurface" in win ||
                "__kanbanDesktopSurfaceActivation" in win ||
                (manifest.version >= 2 &&
                  "__chatgptDesktopLayoutEnabled" in win) ||
                (manifest.version >= 2 &&
                  "__chatgptDesktopSplitPaneEnabled" in win) ||
                (manifest.version >= 2 &&
                  "__kanbanSharedThreadNavigation" in win)
              )
                throw failure("ENTRY_BRIDGE_FAILED");
              Object.defineProperty(win, "__kanbanCodexOnlySurface", {
                value: true,
                writable: false,
                configurable: false,
              });
              if (manifest.version >= 2)
                Object.defineProperty(win, "__chatgptDesktopLayoutEnabled", {
                  value: true,
                  writable: false,
                  configurable: false,
                });
              if (manifest.version === 4 || manifest.version === 5)
                Object.defineProperty(win, "__chatgptDesktopSplitPaneEnabled", {
                  value: true,
                  writable: false,
                  configurable: false,
                });
              activation = connectDesktopSurfaceHost({
                window: win,
                document: doc,
                scope,
              });
              // This lease gates local editing only. Native RPC retains its own
              // exact authorization and intent checks.
              Object.defineProperty(win, "__kanbanDesktopSurfaceActivation", {
                value: Object.freeze({
                  getSnapshot: activation.getSnapshot,
                  isCurrent: activation.isCurrent,
                  subscribe: activation.subscribe,
                }),
                writable: false,
                configurable: false,
              });
              if (manifest.version >= 2) {
                surfaceController = createSurfaceController({
                  window: win,
                  scope,
                  modeActivation: activation,
                  imagePickerEnabled: manifest.version === 4,
                  initializeCapability: async (options) => {
                    const module = await loadCapability();
                    if (
                      typeof module?.initializeComposerCapability !== "function"
                    )
                      throw failure("ENTRY_SURFACE_FAILED");
                    const capability = await module.initializeComposerCapability(options);
                    sharedComposerCapability = capability;
                    return capability;
                  },
                });
                if (
                  !surfaceController?.contextMenuAdapter ||
                  typeof surfaceController.initialize !== "function" ||
                  typeof surfaceController.dispose !== "function"
                )
                  throw failure("ENTRY_BRIDGE_FAILED");
              }
              bridge = installDesktopBridge({
                window: win,
                scope,
                bootstrap: frame.bootstrap,
                transport,
                ...((manifest.version === 3 || manifest.version === 5) ? {onInternalViewMessage: data => {
                  if (sharedCatalog?.receive(data) === true) return true;
                  if (data?.type !== 'kanban-shared-host-state') return false;
                  if (!exact(data,['type','state']) || !['ready','unavailable'].includes(data.state)) throw failure('ENTRY_BRIDGE_FAILED');
                  sharedSourceReady = data.state === 'ready';
                  for (const fn of sourceListeners) fn();
                  return true;
                }} : {}),
                ...(surfaceController
                  ? { contextMenuAdapter: surfaceController.contextMenuAdapter }
                  : {}),
                onFailure: (reason, diagnostic) => {
                  // One numeric and fixed transport-type snapshot, before bridge
                  // cleanup clears its queues. Never retain payload or scope.
                  if (diagnostic) try {
                    win.console?.warn?.('CHATGPT_DESKTOP_BRIDGE_WAITING_COUNT ' + JSON.stringify({...diagnostic,deliveryOutstanding:deliveryActive.size}));
                  } catch { /* Diagnostics cannot alter failure cleanup. */ }
                  const code = bridgeFailureCode(reason);
                  fail(
                    "ENTRY_BRIDGE_FAILED",
                    code,
                    bridgeLimitCode(reason, code),
                    bridgeCauseCode(reason, code),
                    bridgeTimeoutMetadata(diagnostic),
                  );
                },
              });
              if (closed || !listener) throw failure("ENTRY_BRIDGE_FAILED");
              if (manifest.version >= 2) {
                const picker = createProjectFolderPicker({
                  window: win,
                  scopeLease: win.__kanbanDesktopSurfaceActivation,
                  sendMessage: (message) =>
                    win.electronBridge.sendMessageFromView(message),
                  onFailure: () => fail("ENTRY_SURFACE_FAILED"),
                });
                if (closed) {
                  try {
                    picker?.dispose();
                  } catch {
                    /* construction lost its view before returning */
                  }
                  return;
                }
                folderPicker = picker;
                if (
                  !folderPicker ||
                  typeof folderPicker.ready !== "function" ||
                  typeof folderPicker.dispose !== "function"
                )
                  throw failure("ENTRY_BRIDGE_FAILED");
              }
              // The bridge must already receive subsequent native frames while
              // the local capability imports and initializes asynchronously.
              bootstrapped = true;
              win.clearTimeout(timer);
              timer = undefined;
              const appendOriginal = () => {
                if (closed) return;
                if (timer !== undefined) {
                  win.clearTimeout(timer);
                  timer = undefined;
                }
                if (manifest.version >= 2) {
                  try {
                    projectShortcut = installProjectOpenShortcut({
                      window: win,
                      activation,
                      sendMessage: (message) => win.electronBridge.sendMessageFromView(message),
                    });
                  } catch {
                    fail("ENTRY_SURFACE_FAILED");
                    return;
                  }
                }
                script = doc.createElement("script");
                script.type = "module";
                script.crossOrigin = "anonymous";
                script.setAttribute("src", manifest.entry);
                observe(script, "error", () => fail("ENTRY_SCRIPT_FAILED"));
                doc.head.appendChild(script);
                if (!settled) {
                  settled = true;
                  resolve({ scope, close: stop });
                }
              };
              if (manifest.version === 1) appendOriginal();
              else {
                timer = win.setTimeout(
                  () => fail("ENTRY_SURFACE_TIMEOUT"),
                  timeout,
                );
                // The picker proves that the native side installed this
                // view's current activation epoch. A generic bridge call
                // acknowledgement alone cannot establish that policy.
                const initializing = Promise.all([
                  surfaceController.initialize(),
                  Promise.resolve().then(() => folderPicker.ready()),
                  (async () => {
                    const shared = manifest.version === 3 || manifest.version === 5;
                    const module = await (shared
                      ? loadSharedNavigation()
                      : loadIsolatedPaneNavigation());
                    const create = shared
                      ? module?.createBrowserSharedThreadNavigation
                      : module?.createBrowserIsolatedPaneNavigation;
                    if (closed || typeof create !== "function")
                      throw failure("ENTRY_SURFACE_FAILED");
                    const navigation = create({
                      window: win,
                      documentScope: scope,
                      scopeLease: win.__kanbanDesktopSurfaceActivation,
                      getComposer: () => sharedComposerCapability,
                      ...(shared
                        ? {
                            isSourceReady: () => sharedSourceReady,
                            subscribeSource: fn => { sourceListeners.add(fn); return () => sourceListeners.delete(fn); },
                            sendMessage: (message) =>
                              win.electronBridge.sendMessageFromView(message),
                            onFailure: () => fail("ENTRY_SURFACE_FAILED"),
                          }
                        : {}),
                    });
                    if (closed) {
                      try {
                        navigation?.dispose();
                      } catch {}
                      throw failure("ENTRY_SURFACE_FAILED");
                    }
                    const required = shared
                      ? [
                          "ready",
                          "dispose",
                          "createRoot",
                          "wrapNavigation",
                          "bindAppServerHosts",
                          "consumeRoute",
                          "activateExplicit",
                          ...(manifest.version === 5 ? ["beginApproval"] : []),
                        ]
                      : ["dispose", "activateExplicit"];
                    if (
                      !navigation ||
                      required.some(
                        (name) => typeof navigation[name] !== "function",
                      )
                    ) {
                      try {
                        navigation?.dispose();
                      } catch {}
                      throw failure("ENTRY_SURFACE_FAILED");
                    }
                    sharedNavigation = navigation;
                    Object.defineProperty(
                      win,
                      "__kanbanSharedThreadNavigation",
                      {
                        value: navigation,
                        writable: false,
                        configurable: false,
                      },
                    );
                    if (shared) {
                      await navigation.ready();
                      const selectionModule=await import("./browser-shared-project-selection.mjs");
                      if(closed||typeof selectionModule.createBrowserSharedProjectSelection!=="function")throw failure("ENTRY_SURFACE_FAILED");
                      sharedProjectSelection=selectionModule.createBrowserSharedProjectSelection({window:win,scopeLease:win.__kanbanDesktopSurfaceActivation,isSourceReady:()=>sharedSourceReady,subscribeSource:fn=>{sourceListeners.add(fn);return()=>sourceListeners.delete(fn)}});
                      const [catalogModule,directoryModule]=await Promise.all([loadSharedCatalog(),loadSharedDirectory()]);
                      if(closed||typeof catalogModule?.createBrowserSharedCatalog!=='function'||typeof directoryModule?.createBrowserSharedThreadDirectory!=='function')throw failure('ENTRY_SURFACE_FAILED');
                      sharedCatalog=catalogModule.createBrowserSharedCatalog({window:win,scopeLease:win.__kanbanDesktopSurfaceActivation,send:message=>win.electronBridge.sendMessageFromView(message)});
                      sharedDirectory=directoryModule.createBrowserSharedThreadDirectory({window:win,scopeLease:win.__kanbanDesktopSurfaceActivation,navigation,
                        loadPage:args=>sharedCatalog.loadPage(args),navigateSource:navigation.navigateSharedThread,
                        isSourceReady:()=>sharedSourceReady,subscribeSource:fn=>{sourceListeners.add(fn);return()=>sourceListeners.delete(fn)}});
                    }
                  })(),
                ]);
                Promise.resolve(initializing).then(appendOriginal, () => {
                  if (!closed) fail("ENTRY_SURFACE_FAILED");
                });
              }
            } else {
              if (!listener) throw failure("ENTRY_BRIDGE_FAILED");
              const completed = listener(encoded);
              if (completed === false) throw failure("ENTRY_BRIDGE_FAILED");
              // Receipts for original portPost writes remain runnable while a
              // prior SDK data frame waits for producer pressure to subside.
              if (completed && typeof completed.then === 'function') {
                Promise.resolve(completed).then(() => {
                  if (!closed) acknowledge(delivery);
                }, () => fail("ENTRY_BRIDGE_FAILED")).catch(() => fail("ENTRY_CONNECTION_LOST"));
              } else acknowledge(delivery);
            }
          } catch (error) {
            const code = [
              "ENTRY_FRAME_LIMIT",
              "ENTRY_BACKPRESSURE",
              "ENTRY_INVALID_FRAME",
              "ENTRY_INVALID_BOOTSTRAP",
              "ENTRY_CONNECTION_LOST",
              "ENTRY_BRIDGE_FAILED",
            ].includes(error?.code)
              ? error.code
              : "ENTRY_BRIDGE_FAILED";
            fail(code);
          }
        });
        timer = win.setTimeout(() => fail("ENTRY_BOOTSTRAP_TIMEOUT"), timeout);
      } catch (error) {
        const code = [
          "ENTRY_INVALID_CONFIG",
          "ENTRY_INVALID_MANIFEST",
          "ENTRY_INVALID_LOCATION",
          "ENTRY_SECURE_CONTEXT_REQUIRED",
        ].includes(error?.code)
          ? error.code
          : "ENTRY_CONNECTION_LOST";
        fail(code);
      }
    });
  };
}

export const startDesktopDocument = createDesktopDocumentStarter();

// File-based Node imports (including Node tests with DOM globals) never access a document.
if (/^https?:/.test(import.meta.url) && typeof window !== "undefined") {
  void startDesktopDocument({ window }).catch(() => {});
}

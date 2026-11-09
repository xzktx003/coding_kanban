// Independent, per-view UI for the native project-folder request. This module
// never decides which host or roots to use; native validates every result.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TTL = 120000,
  MAX_PATHS = 8;
const fail = () =>
  Object.assign(new Error("Folder picker unavailable"), {
    code: "PROJECT_FOLDER_UI_UNAVAILABLE",
  });
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === keys.slice().sort().join(",");
const validPath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  value.startsWith("/") &&
  !/[\u0000-\u001f\u007f]/u.test(value) &&
  (value === "/" ||
    (!value.endsWith("/") &&
      !value.includes("//") &&
      value
        .slice(1)
        .split("/")
        .every((x) => x !== "." && x !== ".." && x !== "")));

export function createBrowserProjectFolderPicker({
  window: win,
  scopeLease,
  sendMessage,
  readyTimeoutMs = 15000,
  onFailure = () => {},
} = {}) {
  const doc = win?.document;
  if (
    !doc?.body ||
    typeof doc.createElement !== "function" ||
    typeof win.addEventListener !== "function" ||
    typeof win.removeEventListener !== "function" ||
    !scopeLease ||
    typeof scopeLease.getSnapshot !== "function" ||
    typeof scopeLease.isCurrent !== "function" ||
    typeof scopeLease.subscribe !== "function" ||
    typeof sendMessage !== "function" ||
    typeof win.crypto?.randomUUID !== "function" ||
    !Number.isSafeInteger(readyTimeoutMs) ||
    readyTimeoutMs < 1 ||
    readyTimeoutMs > 15000 ||
    typeof onFailure !== "function"
  )
    throw fail();
  let disposed = false,
    active = null,
    token = null,
    unsubscribe,
    lifecycleSequence = 0,
    lifecycleEpoch = null,
    lifecycleSent = 0,
    lifecycleAck = 0,
    lifecycleTimer,
    lifecycleFailed = false,
    readySettled = false,
    resolveReady,
    rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void readyPromise.catch(() => {});
  const lifecycleError = () =>
    Object.assign(new Error("Folder picker lifecycle unavailable"), {
      code: "PROJECT_FOLDER_UI_LIFECYCLE_UNAVAILABLE",
    });
  const retiredTokens = new WeakSet();
  const cancelledIds = new Set();
  const seenRequestIds = new Set();
  const validToken = (value) =>
    value !== null &&
    (typeof value === "object" || typeof value === "function");
  function cancelRequest(requestId, epoch) {
    if (cancelledIds.has(requestId)) return;
    cancelledIds.add(requestId);
    if (cancelledIds.size > 64)
      cancelledIds.delete(cancelledIds.values().next().value);
    try {
      const result = sendMessage({
        type: "kanban-project-folder-reply",
        requestId,
        epoch,
        action: "cancel",
      });
      if (result && typeof result.then === "function")
        Promise.resolve(result).catch(() => {});
    } catch {}
  }
  function cancelActive() {
    const state = active;
    if (!state) return;
    close(state, false);
    cancelRequest(state.requestId, state.epoch);
  }
  function retireToken() {
    if (validToken(token)) retiredTokens.add(token);
    token = null;
    cancelActive();
  }
  function onScopeChange() {
    const before = lifecycleSequence;
    retireToken();
    current();
    if (before === lifecycleSequence) publishLifecycle();
  }
  function current() {
    if (disposed || lifecycleFailed) return false;
    try {
      const previous = token;
      const next = scopeLease.getSnapshot();
      if (token && (token !== next || scopeLease.isCurrent(token) !== true))
        retireToken();
      if (
        !token &&
        validToken(next) &&
        !retiredTokens.has(next) &&
        scopeLease.isCurrent(next) === true
      )
        token = next;
      if (token !== previous) publishLifecycle();
      return token !== null && token === next && !retiredTokens.has(token);
    } catch {
      const hadToken = token !== null;
      retireToken();
      if (hadToken) publishLifecycle();
      return false;
    }
  }
  function failLifecycle() {
    if (disposed || lifecycleFailed) return;
    lifecycleFailed = true;
    win.clearTimeout(lifecycleTimer);
    retireToken();
    if (!readySettled) {
      readySettled = true;
      rejectReady(lifecycleError());
    }
    try {
      onFailure({ code: "PROJECT_FOLDER_UI_LIFECYCLE_UNAVAILABLE" });
    } catch {}
  }
  function settleLifecycle() {
    if (
      disposed ||
      lifecycleFailed ||
      lifecycleSent !== lifecycleSequence ||
      lifecycleAck !== lifecycleSequence
    )
      return;
    win.clearTimeout(lifecycleTimer);
    if (!readySettled) {
      readySettled = true;
      resolveReady();
    }
  }
  function publishLifecycle() {
    if (disposed || lifecycleFailed) return;
    if (lifecycleSequence >= Number.MAX_SAFE_INTEGER) {
      failLifecycle();
      return;
    }
    const sequence = ++lifecycleSequence;
    try {
      lifecycleEpoch = token === null ? null : win.crypto.randomUUID();
    } catch {
      failLifecycle();
      return;
    }
    if (lifecycleEpoch !== null && !UUID.test(lifecycleEpoch)) {
      failLifecycle();
      return;
    }
    seenRequestIds.clear();
    const epoch = lifecycleEpoch;
    lifecycleSent = 0;
    lifecycleAck = 0;
    win.clearTimeout(lifecycleTimer);
    lifecycleTimer = win.setTimeout(() => {
      if (sequence === lifecycleSequence) failLifecycle();
    }, readyTimeoutMs);
    try {
      const result = sendMessage({
        type: "kanban-project-folder-lifecycle",
        sequence,
        epoch,
      });
      Promise.resolve(result).then(
        () => {
          if (sequence === lifecycleSequence && !disposed && !lifecycleFailed) {
            lifecycleSent = sequence;
            settleLifecycle();
          }
        },
        () => {
          if (sequence === lifecycleSequence) failLifecycle();
        },
      );
    } catch {
      if (sequence === lifecycleSequence) failLifecycle();
    }
  }
  function close(state, restore = true) {
    if (!state || active !== state) return;
    active = null;
    win.clearTimeout(state.timer);
    state.ownerObserver?.disconnect();
    state.overlay.remove();
    if (
      restore &&
      current() &&
      state.previous?.isConnected &&
      typeof state.previous.focus === "function"
    ) {
      try {
        state.previous.focus({ preventScroll: true });
      } catch {}
    }
  }
  function send(state, message) {
    if (!current() || active !== state) return;
    try {
      const result = sendMessage(message);
      if (result && typeof result.then === "function")
        Promise.resolve(result).catch(() => close(state));
    } catch {
      close(state);
    }
  }
  function activate(event, fn) {
    if (event.isTrusted !== true) return;
    event.preventDefault();
    event.stopPropagation();
    fn();
  }
  function display(message) {
    const previous = doc.activeElement,
      overlay = doc.createElement("div"),
      panel = doc.createElement("div");
    overlay.dataset.projectFolderPicker = "";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "选择项目文件夹");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      display: "flex",
      // The original project modal may disable pointer events on body while
      // awaiting this picker; only restore interaction on our own overlay.
      pointerEvents: "auto",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,.35)",
      padding: "20px",
      boxSizing: "border-box",
    });
    Object.assign(panel.style, {
      width: "min(560px, 100%)",
      boxSizing: "border-box",
      background: "#fff",
      color: "#202123",
      border: "1px solid #dedede",
      borderRadius: "16px",
      padding: "22px",
      boxShadow: "0 18px 55px rgba(0,0,0,.2)",
      font: "14px/1.5 system-ui, sans-serif",
    });
    const title = doc.createElement("h2");
    title.textContent = "选择项目文件夹";
    Object.assign(title.style, {
      fontSize: "18px",
      lineHeight: "1.3",
      margin: "0 0 8px",
    });
    const desc = doc.createElement("p");
    desc.textContent = message.allowMultiple
      ? "输入已有文件夹的绝对路径，每行一个。"
      : "输入已有文件夹的绝对路径。";
    Object.assign(desc.style, { margin: "0 0 14px", color: "#626262" });
    const input = doc.createElement(
      message.allowMultiple ? "textarea" : "input",
    );
    if (!message.allowMultiple) input.type = "text";
    input.setAttribute(
      "aria-label",
      message.allowMultiple ? "文件夹路径，每行一个" : "文件夹路径",
    );
    input.placeholder = "/path/to/project";
    input.spellcheck = false;
    input.autocomplete = "off";
    Object.assign(input.style, {
      display: "block",
      boxSizing: "border-box",
      width: "100%",
      minHeight: message.allowMultiple ? "96px" : "42px",
      resize: "vertical",
      border: "1px solid #bcbcbc",
      borderRadius: "9px",
      padding: "9px 11px",
      background: "#fff",
      color: "#202123",
      font: "14px/1.4 system-ui, sans-serif",
    });
    const hint = doc.createElement("div");
    hint.textContent = "可选择的目录范围：";
    Object.assign(hint.style, {
      margin: "13px 0 5px",
      fontSize: "12px",
      color: "#626262",
    });
    const roots = doc.createElement("div");
    Object.assign(roots.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      maxHeight: "100px",
      overflow: "auto",
    });
    for (const root of message.roots) {
      const chip = doc.createElement("button");
      chip.type = "button";
      chip.textContent = root;
      chip.setAttribute("data-action", "root");
      Object.assign(chip.style, {
        border: "1px solid #dedede",
        borderRadius: "6px",
        background: "#f7f7f7",
        padding: "3px 7px",
        color: "#383838",
        font: "12px/1.4 system-ui, sans-serif",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      chip.addEventListener("click", (event) =>
        activate(event, () => {
          input.value = root;
          input.focus();
        }),
      );
      roots.append(chip);
    }
    const notice = doc.createElement("div");
    notice.setAttribute("role", "alert");
    notice.setAttribute("aria-live", "polite");
    Object.assign(notice.style, {
      minHeight: "20px",
      marginTop: "9px",
      color: "#b42318",
      fontSize: "12px",
    });
    const actions = doc.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
      marginTop: "12px",
    });
    const cancel = doc.createElement("button"),
      select = doc.createElement("button");
    cancel.type = select.type = "button";
    cancel.textContent = "取消";
    select.textContent = "选择";
    cancel.dataset.action = "cancel";
    select.dataset.action = "select";
    Object.assign(cancel.style, {
      border: "1px solid #d4d4d4",
      borderRadius: "8px",
      background: "#fff",
      padding: "7px 14px",
      color: "#202123",
      cursor: "pointer",
    });
    Object.assign(select.style, {
      border: "1px solid #202123",
      borderRadius: "8px",
      background: "#202123",
      padding: "7px 14px",
      color: "#fff",
      cursor: "pointer",
    });
    actions.append(cancel, select);
    panel.append(title, desc, input, hint, roots, notice, actions);
    overlay.append(panel);
    // A native project modal keeps focus inside its own subtree. Place this
    // picker in that subtree when it opened the request so keyboard input is
    // not redirected to the underlying project-name field. A manual popover
    // keeps the fixed overlay above transformed/modal ancestors when available.
    const hostModal = previous?.closest?.('[role="dialog"], dialog[open]');
    const useModal = !!hostModal && hostModal.isConnected && doc.body.contains(hostModal);
    if (useModal && typeof overlay.showPopover === "function") {
      overlay.setAttribute("popover", "manual");
      Object.assign(overlay.style, { margin: "0", width: "100vw", height: "100vh", maxWidth: "none", maxHeight: "none", border: "0" });
    }
    (useModal ? hostModal : doc.body).append(overlay);
    if (overlay.hasAttribute("popover")) {
      try { overlay.showPopover(); }
      catch { overlay.removeAttribute("popover"); }
    }
    const state = {
      requestId: message.requestId,
      epoch: message.epoch,
      allowMultiple: message.allowMultiple,
      previous,
      overlay,
      input,
      notice,
      select,
      busy: false,
      timer: null,
      ownerObserver: null,
    };
    active = state;
    if (useModal && typeof win.MutationObserver === "function") {
      const observer = new win.MutationObserver(() => {
        if (active === state && (!hostModal.isConnected || !overlay.isConnected))
          cancelActive();
      });
      observer.observe(hostModal, { childList: true });
      for (let node = hostModal; node && node !== doc.body; node = node.parentNode)
        if (node.parentNode) observer.observe(node.parentNode, { childList: true });
      state.ownerObserver = observer;
    }
    state.timer = win.setTimeout(() => {
      if (active === state) cancelActive();
    }, TTL);
    cancel.addEventListener("click", (event) =>
      activate(event, () => {
        send(state, {
          type: "kanban-project-folder-reply",
          requestId: state.requestId,
          epoch: state.epoch,
          action: "cancel",
        });
        close(state);
      }),
    );
    function submit() {
      if (state.busy || !current()) return;
      const paths = state.allowMultiple
        ? input.value.split("\n")
        : [input.value];
      if (
        paths.length < 1 ||
        paths.length > (state.allowMultiple ? MAX_PATHS : 1) ||
        paths.some((value) => !validPath(value)) ||
        new Set(paths).size !== paths.length
      ) {
        notice.textContent = "请输入有效的绝对目录路径。";
        input.focus();
        return;
      }
      state.busy = true;
      select.disabled = true;
      notice.textContent = "正在检查目录…";
      input.focus();
      send(state, {
        type: "kanban-project-folder-reply",
        requestId: state.requestId,
        epoch: state.epoch,
        action: "select",
        paths,
      });
    }
    select.addEventListener("click", (event) => activate(event, submit));
    overlay.addEventListener("keydown", (event) => {
      if (event.isTrusted !== true) return;
      if (event.key === "Escape") {
        activate(event, () => {
          send(state, {
            type: "kanban-project-folder-reply",
            requestId: state.requestId,
            epoch: state.epoch,
            action: "cancel",
          });
          close(state);
        });
        return;
      }
      if (
        event.key === "Enter" &&
        !state.allowMultiple &&
        event.target === input
      ) {
        activate(event, submit);
        return;
      }
      if (event.key === "Tab") {
        const list = [
          input,
          ...roots.querySelectorAll("button"),
          cancel,
          select,
        ].filter((node) => !node.disabled);
        if (
          list.length &&
          ((event.shiftKey && doc.activeElement === list[0]) ||
            (!event.shiftKey && doc.activeElement === list.at(-1)))
        ) {
          event.preventDefault();
          (event.shiftKey ? list.at(-1) : list[0]).focus();
        }
      }
    });
    try {
      input.focus();
    } catch {}
  }
  function onMessage(event) {
    if (event.source !== null) return;
    const value = event.data;
    if (
      exact(value, ["type", "sequence", "epoch"]) &&
      value.type === "kanban-project-folder-lifecycle-ack" &&
      Number.isSafeInteger(value.sequence) &&
      value.sequence > 0 &&
      (value.epoch === null ||
        (typeof value.epoch === "string" && UUID.test(value.epoch)))
    ) {
      current();
      if (
        !disposed &&
        !lifecycleFailed &&
        value.sequence === lifecycleSequence &&
        value.epoch === lifecycleEpoch
      ) {
        lifecycleAck = value.sequence;
        settleLifecycle();
      }
      return;
    }
    const opening =
      exact(value, ["type", "requestId", "epoch", "allowMultiple", "roots"]) &&
      value.type === "kanban-project-folder-open" &&
      UUID.test(value.requestId ?? "") &&
      typeof value.epoch === "string" &&
      UUID.test(value.epoch) &&
      typeof value.allowMultiple === "boolean" &&
      Array.isArray(value.roots) &&
      value.roots.length >= 1 &&
      value.roots.length <= 9 &&
      value.roots.every(validPath) &&
      new Set(value.roots).size === value.roots.length;
    const isCurrent = current();
    if (opening && value.epoch === lifecycleEpoch) {
      if (seenRequestIds.has(value.requestId)) return;
      if (seenRequestIds.size >= 4096) {
        cancelRequest(value.requestId, value.epoch);
        return;
      }
      seenRequestIds.add(value.requestId);
    }
    if (
      !isCurrent ||
      lifecycleAck !== lifecycleSequence ||
      lifecycleSent !== lifecycleSequence
    ) {
      if (opening) cancelRequest(value.requestId, value.epoch);
      return;
    }
    if (opening && value.epoch !== lifecycleEpoch) {
      cancelRequest(value.requestId, value.epoch);
      return;
    }
    if (opening && cancelledIds.has(value.requestId)) return;
    if (opening && !active) {
      display(value);
      return;
    }
    if (
      !active ||
      !exact(value, ["type", "requestId", "epoch"]) ||
      value.requestId !== active.requestId ||
      value.epoch !== active.epoch
    )
      return;
    if (value.type === "kanban-project-folder-invalid") {
      active.busy = false;
      active.select.disabled = false;
      active.notice.textContent =
        "目录不可用或不在允许的范围内，请检查后重试。";
      active.input.focus();
    } else if (value.type === "kanban-project-folder-done") close(active);
  }
  try {
    win.addEventListener("message", onMessage);
    unsubscribe = scopeLease.subscribe(onScopeChange);
    if (typeof unsubscribe !== "function") throw fail();
    current();
    if (!lifecycleSequence) publishLifecycle();
  } catch {
    disposed = true;
    retireToken();
    win.removeEventListener("message", onMessage);
    win.clearTimeout(lifecycleTimer);
    if (!readySettled) {
      readySettled = true;
      rejectReady(lifecycleError());
    }
    try {
      if (typeof unsubscribe === "function") unsubscribe();
    } catch {}
    throw fail();
  }
  return Object.freeze({
    ready() {
      return readyPromise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retireToken();
      win.clearTimeout(lifecycleTimer);
      if (!readySettled) {
        readySettled = true;
        rejectReady(lifecycleError());
      }
      win.removeEventListener("message", onMessage);
      try {
        unsubscribe();
      } catch {}
    },
  });
}

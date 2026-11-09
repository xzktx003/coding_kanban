// Browser-owned replacement for the desktop context-menu surface. The caller
// still owns the originating view/thread and the returned {id} decision.
// No native request, remote image load, HTML parsing or clipboard emulation.
const LIMITS = Object.freeze({
  items: 128,
  depth: 4,
  text: 512,
  id: 256,
  icon: 65536,
  total: 131072,
  selection: 1048576,
  selectionNodes: 4096,
});
const fail = (code, message) => Object.assign(new Error(message), { code });
const error = (code) => fail(code, "Context menu unavailable");
const allowed = new Set([
  "id",
  "type",
  "checked",
  "label",
  "icon",
  "accelerator",
  "role",
  "enabled",
  "toolTip",
  "submenu",
]);
const unsupported = "浏览器暂不支持此操作";
const unavailable = "当前选区不可用";

function parseItems(root) {
  if (!Array.isArray(root)) throw error("CONTEXT_MENU_INVALID_ITEMS");
  const ids = new Set();
  let count = 0,
    size = 0;
  const text = (value, limit, optional = true) => {
    if (optional && value == null) return "";
    if (typeof value !== "string" || value.length > limit)
      throw error("CONTEXT_MENU_INVALID_ITEMS");
    size += value.length;
    if (size > LIMITS.total) throw error("CONTEXT_MENU_INVALID_ITEMS");
    return value;
  };
  const walk = (items, depth) => {
    if (!Array.isArray(items) || depth > LIMITS.depth)
      throw error("CONTEXT_MENU_INVALID_ITEMS");
    return items.map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).some((key) => !allowed.has(key)) ||
        ++count > LIMITS.items
      )
        throw error("CONTEXT_MENU_INVALID_ITEMS");
      const type = text(item.type, 32);
      if (type && !["separator", "radio", "checkbox"].includes(type))
        throw error("CONTEXT_MENU_INVALID_ITEMS");
      for (const name of ["enabled", "checked"])
        if (item[name] != null && typeof item[name] !== "boolean")
          throw error("CONTEXT_MENU_INVALID_ITEMS");
      const id = text(item.id, LIMITS.id),
        label = text(item.label, LIMITS.text);
      const role = text(item.role, 64),
        tip = text(item.toolTip, LIMITS.text);
      const accelerator = text(item.accelerator, 128);
      text(item.icon, LIMITS.icon); // Validated but never fetched or interpreted as markup.
      if (type !== "separator" && id) {
        if (ids.has(id)) throw error("CONTEXT_MENU_INVALID_ITEMS");
        ids.add(id);
      }
      const submenu =
        item.submenu == null ? null : walk(item.submenu, depth + 1);
      return {
        id,
        label,
        type,
        role,
        tip,
        accelerator,
        checked: item.checked === true,
        enabled: item.enabled !== false,
        submenu,
      };
    });
  };
  return walk(root, 1);
}

// A child document can remain visible and focusable while its containing
// workbench mode is hidden/inert. Every embedding document must be same-origin
// and independently visible; an unverifiable ancestor is never authorized.
function embeddingContext(win) {
  const parents = [];
  let current = win;
  try {
    for (let depth = 0; depth < 8; depth++) {
      const doc = current.document;
      if (!doc || doc.visibilityState === "hidden")
        throw error("CONTEXT_MENU_CONTEXT_HIDDEN");
      const parent = current.parent;
      if (parent === current) return parents;
      if (!parent) throw error("CONTEXT_MENU_CONTEXT_UNVERIFIED");
      const frame = current.frameElement,
        parentDoc = parent.document;
      if (
        !frame ||
        frame.ownerDocument !== parentDoc ||
        !frame.isConnected ||
        typeof parent.MutationObserver !== "function"
      )
        throw error("CONTEXT_MENU_CONTEXT_UNVERIFIED");
      const rect = frame.getBoundingClientRect();
      if (!frame.getClientRects().length || rect.width <= 0 || rect.height <= 0)
        throw error("CONTEXT_MENU_CONTEXT_HIDDEN");
      const nodes = [];
      for (let node = frame; node; node = node.parentElement) {
        if (nodes.length >= 256) throw error("CONTEXT_MENU_CONTEXT_UNVERIFIED");
        nodes.push(node);
        const style = parent.getComputedStyle(node);
        if (
          node.hidden ||
          node.inert ||
          node.getAttribute("aria-hidden") === "true" ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.opacity === "0"
        )
          throw error("CONTEXT_MENU_CONTEXT_HIDDEN");
      }
      parents.push({ window: parent, document: parentDoc, frame, nodes });
      current = parent;
    }
    throw error("CONTEXT_MENU_CONTEXT_UNVERIFIED");
  } catch (cause) {
    if (
      cause?.code === "CONTEXT_MENU_CONTEXT_HIDDEN" ||
      cause?.code === "CONTEXT_MENU_CONTEXT_UNVERIFIED"
    )
      throw cause;
    throw error("CONTEXT_MENU_CONTEXT_UNVERIFIED");
  }
}

// A target within the document may also be visually hidden while retaining a
// client rect. Return its current ancestor chain so the menu can invalidate a
// capture if an owner hides and immediately restores it during a clipboard read.
function visibleTargetAncestors(win, target) {
  try {
    if (
      !target ||
      target.ownerDocument !== win.document ||
      !target.isConnected ||
      !target.getClientRects().length
    )
      return null;
    const nodes = [];
    for (let node = target; node; node = node.parentElement) {
      if (nodes.length >= 256) return null;
      nodes.push(node);
      const style = win.getComputedStyle(node);
      if (
        node.hidden ||
        node.inert ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0"
      )
        return null;
    }
    return nodes;
  } catch {
    return null;
  }
}

// Count text without constructing a giant selected string. The node cap also
// bounds work for a deliberately fragmented DOM selection.
function boundedSelectionText(win, range) {
  try {
    const root = range.commonAncestorContainer;
    const walker = win.document.createTreeWalker(root, win.NodeFilter.SHOW_ALL);
    let node = root,
      nodes = 0,
      chars = 0;
    while (node) {
      if (++nodes > LIMITS.selectionNodes) return null;
      if (node.nodeType === 3 && range.intersectsNode(node)) {
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.length;
        chars += Math.max(0, end - start);
        if (chars > LIMITS.selection) return null;
      }
      node = walker.nextNode();
    }
    const text = range.toString();
    return text.length <= LIMITS.selection ? text : null;
  } catch {
    return null;
  }
}

function captureSelection(win) {
  const doc = win.document,
    element = doc.activeElement;
  const visible = (node) => {
    try {
      embeddingContext(win);
      return visibleTargetAncestors(win, node) !== null;
    } catch {
      return false;
    }
  };
  const tag = element?.tagName?.toLowerCase();
  if ((tag === "textarea" || tag === "input") && visible(element)) {
    let start, end;
    try {
      start = element.selectionStart;
      end = element.selectionEnd;
    } catch {
      /* unsupported input type */
    }
    if (Number.isInteger(start) && Number.isInteger(end)) {
      const password = tag === "input" && element.type === "password";
      const value = element.value;
      if (value.length > LIMITS.selection)
        return {
          kind: "none",
          element,
          text: "",
          url: win.location.href,
          visible,
        };
      let undo = false,
        redo = false;
      try {
        undo = doc.queryCommandEnabled("undo");
        redo = doc.queryCommandEnabled("redo");
      } catch {
        /* unsupported */
      }
      return {
        kind: "input",
        element,
        value,
        start,
        end,
        direction: element.selectionDirection,
        password,
        undo,
        redo,
        text: password ? "" : value.slice(start, end),
        url: win.location.href,
        visible,
      };
    }
  }
  const selection = doc.getSelection?.();
  if (selection?.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0).cloneRange(),
      common = range.commonAncestorContainer;
    const anchor = common.nodeType === 1 ? common : common.parentElement;
    const value = boundedSelectionText(win, range);
    if (visible(anchor) && value !== null)
      return {
        kind: "range",
        element,
        anchor,
        range,
        text: value,
        url: win.location.href,
        visible,
      };
  }
  return { kind: "none", element, text: "", url: win.location.href, visible };
}

function current(win, snapshot) {
  if (win.location.href !== snapshot.url) return false;
  if (snapshot.kind === "input") {
    const target = snapshot.element;
    try {
      return (
        snapshot.visible(target) &&
        target.value === snapshot.value &&
        target.selectionStart === snapshot.start &&
        target.selectionEnd === snapshot.end &&
        target.selectionDirection === snapshot.direction
      );
    } catch {
      return false;
    }
  }
  if (snapshot.kind === "range") {
    try {
      const selection = win.document.getSelection();
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed)
        return false;
      const selected = selection.getRangeAt(0);
      return (
        snapshot.visible(snapshot.anchor) &&
        snapshot.range.startContainer.isConnected &&
        snapshot.range.endContainer.isConnected &&
        selected.startContainer === snapshot.range.startContainer &&
        selected.startOffset === snapshot.range.startOffset &&
        selected.endContainer === snapshot.range.endContainer &&
        selected.endOffset === snapshot.range.endOffset &&
        boundedSelectionText(win, snapshot.range) === snapshot.text
      );
    } catch {
      return false;
    }
  }
  return false;
}

function positionMenu(win, menu, x, y) {
  const inset = 4,
    width = Math.max(inset * 2, win.innerWidth),
    height = Math.max(inset * 2, win.innerHeight);
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(inset, Math.min(x, width - rect.width - inset))}px`;
  menu.style.top = `${Math.max(inset, Math.min(y, height - rect.height - inset))}px`;
}

/**
 * show(items, position) resolves to {id} after an actual action, or {id:null}
 * on cancellation. Browser permissions and native roles are never simulated.
 * dispose() closes only this owner's outstanding menu and listeners.
 * Native roles require a synchronous captureScope/isScopeCurrent pair bound
 * to the committed original pane/thread revision; absent identity disables
 * them. copy supports text selections; cut/paste/undo/redo/selectAll support
 * native text inputs only. Unsupported rich-editor and OS roles stay disabled.
 * onFailure({code}) receives no clipboard contents or account information.
 */
export function createBrowserContextMenus(options = {}) {
  const win = options?.window,
    doc = win?.document;
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some(
      (key) =>
        ![
          "window",
          "onFailure",
          "captureScope",
          "isScopeCurrent",
          "richEditor",
        ].includes(key),
    ) ||
    !doc ||
    typeof doc.createElement !== "function" ||
    typeof win.addEventListener !== "function" ||
    (options.onFailure !== undefined &&
      typeof options.onFailure !== "function") ||
    (options.richEditor !== undefined &&
      (!options.richEditor ||
        typeof options.richEditor.capture !== "function")) ||
    ((options.captureScope !== undefined ||
      options.isScopeCurrent !== undefined) &&
      (typeof options.captureScope !== "function" ||
        typeof options.isScopeCurrent !== "function"))
  )
    throw error("CONTEXT_MENU_INVALID_CONFIG");
  const report = (code) => {
    try {
      options.onFailure?.({ code });
    } catch {
      /* never leak an error or strand a menu */
    }
  };
  const hasScope = typeof options.captureScope === "function";
  const scopeCurrent = (snap) => {
    if (!hasScope) return true;
    try {
      return snap.scopeValid && options.isScopeCurrent(snap.scope) === true;
    } catch {
      return false;
    }
  };
  let active = null,
    disposed = false;

  function close(state, result, restore = true) {
    if (!state || active !== state) return;
    active = null;
    try {
      state.snapshot.richAction?.cancel();
    } catch {
      /* release only this menu capture */
    }
    for (const dispose of state.listeners.splice(0)) dispose();
    const focused = doc.activeElement,
      inMenu = state.container.contains(focused);
    state.container.remove();
    if (
      restore &&
      scopeCurrent(state.snapshot) &&
      win.location.href === state.snapshot.url &&
      (state.richApplied ||
        state.snapshot.kind === "none" ||
        current(win, state.snapshot)) &&
      (inMenu || !focused || focused === doc.body)
    ) {
      const target = state.snapshot.element;
      if (
        target?.isConnected &&
        state.snapshot.visible(target) &&
        target.ownerDocument === doc &&
        typeof target.focus === "function"
      ) {
        try {
          target.focus({ preventScroll: true });
          if (
            state.snapshot.kind === "input" &&
            !state.preserveSelection &&
            doc.activeElement === target &&
            scopeCurrent(state.snapshot) &&
            current(win, state.snapshot)
          )
            target.setSelectionRange(
              state.snapshot.start,
              state.snapshot.end,
              state.snapshot.direction ?? "none",
            );
        } catch {
          /* the originating target may no longer be focusable */
        }
      }
    }
    // Plain entries are executed later by the original renderer. Focusing the
    // originating element can synchronously switch its owning thread, so do
    // one last check before returning the renderer an actionable id.
    if (
      result.id !== null &&
      state.returnRequiresTarget &&
      (!scopeCurrent(state.snapshot) ||
        (state.snapshot.kind !== "none" && !current(win, state.snapshot)))
    ) {
      report("CONTEXT_MENU_TARGET_CHANGED");
      result = { id: null };
    }
    state.resolve(result);
  }
  function roleReason(item, snap) {
    if (!item.role) return "";
    if (
      ["copy", "selectAll", "cut", "paste", "undo", "redo"].includes(
        item.role,
      ) &&
      (!hasScope || !snap.scopeValid)
    )
      return "无法确认发起会话";
    if (
      snap.richAction &&
      ["copy", "cut", "paste", "undo", "redo", "selectAll"].includes(item.role)
    ) {
      if (item.role === "selectAll" && !snap.richAction.supportsSelectAll)
        return unsupported;
      if (["copy", "cut"].includes(item.role) && snap.richAction.selectionEmpty)
        return unavailable;
      if (
        ["copy", "cut"].includes(item.role) &&
        (win.isSecureContext !== true ||
          typeof win.ClipboardItem !== "function" ||
          typeof win.navigator?.clipboard?.write !== "function")
      )
        return unsupported;
      if (
        item.role === "paste" &&
        (win.isSecureContext !== true ||
          typeof win.navigator?.clipboard?.read !== "function")
      )
        return unsupported;
      return "";
    }
    if (item.role === "copy") {
      if (
        !snap.text ||
        snap.text.length > LIMITS.selection ||
        (snap.kind === "input" && snap.password)
      )
        return unavailable;
      return win.isSecureContext !== true ||
        typeof win.navigator?.clipboard?.writeText !== "function"
        ? unsupported
        : "";
    }
    if (item.role === "selectAll")
      return snap.kind === "input" ? "" : unsupported;
    if (["cut", "paste", "undo", "redo"].includes(item.role)) {
      if (snap.kind !== "input") return unsupported;
      if (snap.element.disabled || snap.element.readOnly || snap.password)
        return unavailable;
      if (item.role === "cut" && !snap.text) return unavailable;
      if (
        (item.role === "undo" && !snap.undo) ||
        (item.role === "redo" && !snap.redo)
      )
        return unavailable;
      if (
        ["cut", "paste"].includes(item.role) &&
        (win.isSecureContext !== true ||
          typeof win.navigator?.clipboard?.[
            item.role === "cut" ? "writeText" : "read"
          ] !== "function")
      )
        return unsupported;
      return typeof doc.execCommand === "function" ? "" : unsupported;
    }
    return unsupported;
  }

  function show(rawItems, position) {
    if (disposed) return Promise.reject(error("CONTEXT_MENU_DISPOSED"));
    if (active) close(active, { id: null });
    let items, x, y, snap, parents, targetAncestors;
    try {
      items = parseItems(rawItems);
      if (
        position != null &&
        (typeof position !== "object" ||
          Array.isArray(position) ||
          Object.keys(position).some((key) => key !== "x" && key !== "y") ||
          !Number.isFinite(position.x) ||
          !Number.isFinite(position.y))
      )
        throw error("CONTEXT_MENU_INVALID_POSITION");
      parents = embeddingContext(win);
      snap = captureSelection(win);
      if (snap.kind !== "none") {
        targetAncestors = visibleTargetAncestors(
          win,
          snap.kind === "range" ? snap.anchor : snap.element,
        );
        if (!targetAncestors) throw error("CONTEXT_MENU_TARGET_CHANGED");
      }
      if (hasScope) {
        try {
          snap.scope = options.captureScope();
          snap.scopeValid = snap.scope !== undefined && snap.scope !== null;
        } catch {
          snap.scopeValid = false;
        }
      }
      if (
        hasScope &&
        snap.scopeValid &&
        options.richEditor &&
        snap.element &&
        (snap.kind !== "range" || snap.element.contains?.(snap.anchor))
      ) {
        try {
          snap.richAction = options.richEditor.capture(snap.element);
        } catch {
          snap.richAction = null;
        }
        if (snap.richAction) {
          // Observe the editor and its owners, not transient content nodes:
          // an original ProseMirror transaction legitimately replaces those.
          targetAncestors = visibleTargetAncestors(win, snap.element);
          if (!targetAncestors) throw error("CONTEXT_MENU_TARGET_CHANGED");
        }
      }
      const rect = snap.element?.getBoundingClientRect?.();
      x = position?.x ?? rect?.left ?? 0;
      y = position?.y ?? rect?.bottom ?? 0;
      if (
        !doc.body ||
        !Number.isFinite(win.innerWidth) ||
        !Number.isFinite(win.innerHeight)
      )
        throw error("CONTEXT_MENU_INVALID_CONFIG");
    } catch (cause) {
      const code = cause?.code ?? "CONTEXT_MENU_INVALID_ITEMS";
      report(code);
      return Promise.reject(error(code));
    }
    return new Promise((resolve) => {
      const container = doc.createElement("div");
      container.setAttribute("data-chatgpt-browser-context-menus", "");
      const state = {
        container,
        snapshot: snap,
        resolve,
        listeners: [],
        preserveSelection: false,
        returnRequiresTarget: false,
        busy: false,
      };
      active = state;
      const on = (target, type, handler, capture) => {
        target.addEventListener(type, handler, capture);
        state.listeners.push(() =>
          target.removeEventListener(type, handler, capture),
        );
      };
      const touchTarget =
        win.matchMedia?.("(pointer: coarse)").matches === true;
      const menuStyle = {
        position: "fixed",
        zIndex: "2147483647",
        boxSizing: "border-box",
        minWidth: `min(200px, calc(100vw - 8px))`,
        maxWidth: "calc(100vw - 8px)",
        maxHeight: "calc(100vh - 8px)",
        overflowY: "auto",
        padding: "4px",
        borderRadius: "10px",
        border: "1px solid var(--border-light, #ddd)",
        background: "var(--main-surface-primary, #fff)",
        color: "var(--text-primary, #202123)",
        boxShadow: "0 8px 24px #0003",
        font: "13px/1.35 system-ui, sans-serif",
      };
      function closeChildren(level) {
        for (const row of level.rows)
          if (row.child) {
            row.button.setAttribute("aria-expanded", "false");
            row.child.menu.hidden = true;
            closeChildren(row.child);
          }
      }
      function openChild(row) {
        if (!row.child || row.disabled) return;
        closeChildren(row.level);
        row.child.menu.hidden = false;
        row.button.setAttribute("aria-expanded", "true");
        const rect = row.button.getBoundingClientRect(),
          child = row.child.menu;
        positionMenu(win, child, rect.right - 2, rect.top - 4);
        const box = child.getBoundingClientRect();
        if (rect.right + box.width > win.innerWidth - 4)
          positionMenu(win, child, rect.left - box.width + 2, rect.top - 4);
        row.child.rows
          .find((value) => !value.disabled)
          ?.button.focus({ preventScroll: true });
      }
      async function activate(row, event) {
        if (active !== state || row.disabled || state.busy) return;
        if (!scopeCurrent(snap)) {
          report("CONTEXT_MENU_TARGET_CHANGED");
          close(state, { id: null }, false);
          return;
        }
        if (row.child) {
          openChild(row);
          return;
        }
        if (!row.item.id) {
          close(state, { id: null });
          return;
        }
        const item = row.item;
        if (
          snap.richAction &&
          ["copy", "cut", "paste", "undo", "redo", "selectAll"].includes(
            item.role,
          )
        ) {
          state.busy = true;
          try {
            const result = await snap.richAction.execute(item.role, event);
            if (active !== state) return;
            if (result?.status === "applied" && scopeCurrent(snap)) {
              state.richApplied = true;
              state.preserveSelection = true;
              close(state, { id: item.id });
            } else {
              report(
                result?.status === "uncertain"
                  ? "CONTEXT_MENU_OUTCOME_UNCERTAIN"
                  : "CONTEXT_MENU_ROLE_FAILED",
              );
              close(state, { id: null }, false);
            }
          } catch {
            if (active === state) {
              report("CONTEXT_MENU_ROLE_FAILED");
              close(state, { id: null }, false);
            }
          }
          return;
        }
        if (!item.role && snap.kind !== "none" && !current(win, snap)) {
          report("CONTEXT_MENU_TARGET_CHANGED");
          close(state, { id: null }, false);
          return;
        }
        if (item.role === "copy") {
          if (!current(win, snap) || !scopeCurrent(snap)) {
            report("CONTEXT_MENU_TARGET_CHANGED");
            close(state, { id: null });
            return;
          }
          state.busy = true;
          try {
            await win.navigator.clipboard.writeText(snap.text);
            if (active !== state) return;
            if (!current(win, snap) || !scopeCurrent(snap)) {
              report("CONTEXT_MENU_TARGET_CHANGED");
              close(state, { id: null });
              return;
            }
            close(state, { id: item.id });
          } catch {
            if (active === state) {
              report("CONTEXT_MENU_CLIPBOARD_DENIED");
              close(state, { id: null });
            }
          }
          return;
        }
        if (item.role === "selectAll") {
          if (!current(win, snap) || !scopeCurrent(snap)) {
            report("CONTEXT_MENU_TARGET_CHANGED");
            close(state, { id: null });
            return;
          }
          try {
            snap.element.focus({ preventScroll: true });
            if (
              doc.activeElement !== snap.element ||
              !current(win, snap) ||
              !scopeCurrent(snap)
            ) {
              report("CONTEXT_MENU_TARGET_CHANGED");
              close(state, { id: null }, false);
              return;
            }
            snap.element.select();
            if (
              snap.element.selectionStart !== 0 ||
              snap.element.selectionEnd !== snap.value.length
            )
              throw Error();
            state.preserveSelection = true;
            close(state, { id: item.id });
          } catch {
            report("CONTEXT_MENU_ROLE_FAILED");
            close(state, { id: null });
          }
          return;
        }
        if (["cut", "paste", "undo", "redo"].includes(item.role)) {
          const valid = () =>
            active === state &&
            current(win, snap) &&
            scopeCurrent(snap) &&
            (container.contains(doc.activeElement) ||
              doc.activeElement === snap.element);
          if (!valid()) {
            report("CONTEXT_MENU_TARGET_CHANGED");
            close(state, { id: null });
            return;
          }
          state.busy = true;
          let value = "";
          try {
            if (item.role === "cut")
              await win.navigator.clipboard.writeText(snap.text);
            if (item.role === "paste") {
              // ClipboardItem exposes Blob.size before a JS string is created.
              // The browser/OS may still allocate its own clipboard buffer.
              const items = await win.navigator.clipboard.read();
              if (!valid()) throw error("CONTEXT_MENU_TARGET_CHANGED");
              if (!Array.isArray(items) || items.length > 16)
                throw error("CONTEXT_MENU_CLIPBOARD_LIMIT");
              const item = items.find(
                (entry) =>
                  Array.isArray(entry.types) &&
                  entry.types.includes("text/plain"),
              );
              if (!item) throw error("CONTEXT_MENU_CLIPBOARD_UNSUPPORTED");
              const blob = await item.getType("text/plain");
              if (!valid()) throw error("CONTEXT_MENU_TARGET_CHANGED");
              if (
                !Number.isSafeInteger(blob.size) ||
                blob.size > LIMITS.selection
              )
                throw error("CONTEXT_MENU_CLIPBOARD_LIMIT");
              value = await blob.text();
              if (value.length > LIMITS.selection)
                throw error("CONTEXT_MENU_CLIPBOARD_LIMIT");
            }
          } catch (cause) {
            if (active === state) {
              report(
                [
                  "CONTEXT_MENU_TARGET_CHANGED",
                  "CONTEXT_MENU_CLIPBOARD_LIMIT",
                  "CONTEXT_MENU_CLIPBOARD_UNSUPPORTED",
                ].includes(cause?.code)
                  ? cause.code
                  : "CONTEXT_MENU_CLIPBOARD_DENIED",
              );
              close(state, { id: null });
            }
            return;
          }
          if (active !== state) return;
          if (!valid()) {
            report("CONTEXT_MENU_TARGET_CHANGED");
            close(state, { id: null });
            return;
          }
          if (
            item.role === "paste" &&
            (typeof value !== "string" ||
              !value ||
              value.length > LIMITS.selection ||
              (snap.element.tagName.toLowerCase() === "input" &&
                /[\r\n]/.test(value)))
          ) {
            report("CONTEXT_MENU_ROLE_FAILED");
            close(state, { id: null });
            return;
          }
          value = value.replace(/\r\n?/g, "\n");
          let trustedInput = false;
          const observe = (event) => {
            if (event.isTrusted && event.target === snap.element)
              trustedInput = true;
          };
          snap.element.addEventListener("input", observe);
          try {
            snap.element.focus({ preventScroll: true });
            // Focusing may synchronously invoke application handlers that
            // change the thread or reuse this same input for another draft.
            if (doc.activeElement !== snap.element || !valid()) {
              report("CONTEXT_MENU_TARGET_CHANGED");
              close(state, { id: null }, false);
              return;
            }
            const command =
              item.role === "cut"
                ? "delete"
                : item.role === "paste"
                  ? "insertText"
                  : item.role;
            const ok = doc.execCommand(
              command,
              false,
              item.role === "paste" ? value : undefined,
            );
            const actual = snap.element.value;
            const expected =
              item.role === "cut"
                ? snap.value.slice(0, snap.start) + snap.value.slice(snap.end)
                : item.role === "paste"
                  ? snap.value.slice(0, snap.start) +
                    value +
                    snap.value.slice(snap.end)
                  : null;
            if (
              !ok ||
              !trustedInput ||
              (expected === null
                ? actual === snap.value
                : actual !== expected) ||
              !scopeCurrent(snap)
            )
              throw Error();
            state.preserveSelection = true;
            close(state, { id: item.id });
          } catch {
            // A handler may have changed the field even though the resulting
            // value cannot be verified. Never invite an automatic replay.
            let changed = true;
            try {
              changed = snap.element.value !== snap.value;
            } catch {
              /* treat unreadable as uncertain */
            }
            report(
              changed
                ? "CONTEXT_MENU_OUTCOME_UNCERTAIN"
                : item.role === "cut"
                  ? "CONTEXT_MENU_CUT_NOT_COMPLETED"
                  : "CONTEXT_MENU_ROLE_FAILED",
            );
            close(state, { id: null });
          } finally {
            snap.element.removeEventListener("input", observe);
          }
          return;
        }
        state.returnRequiresTarget = true;
        close(state, { id: item.id });
      }
      function build(list, parentRow = null) {
        const menu = doc.createElement("div");
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "上下文菜单");
        Object.assign(menu.style, menuStyle);
        menu.hidden = Boolean(parentRow);
        container.appendChild(menu);
        const level = { menu, rows: [], parentRow };
        for (const item of list) {
          if (item.type === "separator") {
            const divider = doc.createElement("div");
            divider.setAttribute("role", "separator");
            Object.assign(divider.style, {
              height: "1px",
              background: "var(--border-light, #e5e5e5)",
              margin: "4px 5px",
            });
            menu.appendChild(divider);
            continue;
          }
          const button = doc.createElement("button");
          button.type = "button";
          button.setAttribute(
            "role",
            item.type === "radio"
              ? "menuitemradio"
              : item.type === "checkbox"
                ? "menuitemcheckbox"
                : "menuitem",
          );
          if (item.type === "radio" || item.type === "checkbox")
            button.setAttribute("aria-checked", String(item.checked));
          const reason = roleReason(item, snap),
            disabled =
              !item.enabled || Boolean(reason) || (!item.id && !item.submenu);
          button.setAttribute("aria-disabled", String(disabled));
          if (disabled) button.disabled = true;
          button.title = reason || item.tip;
          Object.assign(button.style, {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%",
            minHeight: touchTarget ? "44px" : "32px",
            border: "0",
            borderRadius: "6px",
            padding: "5px 8px",
            background: "transparent",
            color: "inherit",
            textAlign: "left",
            font: "inherit",
            cursor: disabled ? "not-allowed" : "default",
            opacity: disabled ? "0.55" : "1",
          });
          const mark = doc.createElement("span");
          mark.textContent = item.checked ? "✓" : "";
          mark.setAttribute("aria-hidden", "true");
          Object.assign(mark.style, { width: "12px", flex: "0 0 12px" });
          button.appendChild(mark);
          const label = doc.createElement("span");
          label.textContent = item.label;
          Object.assign(label.style, {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: "1",
          });
          button.appendChild(label);
          if (reason) {
            const note = doc.createElement("span");
            note.textContent = "不可用";
            note.style.fontSize = "11px";
            button.appendChild(note);
          }
          if (item.accelerator) {
            const shortcut = doc.createElement("span");
            shortcut.textContent = item.accelerator;
            shortcut.setAttribute("aria-hidden", "true");
            shortcut.style.opacity = "0.6";
            button.appendChild(shortcut);
          }
          if (item.submenu) {
            const arrow = doc.createElement("span");
            arrow.textContent = "›";
            arrow.setAttribute("aria-hidden", "true");
            button.appendChild(arrow);
            button.setAttribute("aria-haspopup", "menu");
            button.setAttribute("aria-expanded", "false");
          }
          menu.appendChild(button);
          const row = { item, button, disabled, level, child: null };
          level.rows.push(row);
          if (item.submenu) row.child = build(item.submenu, row);
          on(button, "click", (event) => {
            if (event.isTrusted) void activate(row, event);
          });
          on(button, "pointermove", () => {
            if (!disabled) {
              button.focus({ preventScroll: true });
              if (row.child) openChild(row);
              else closeChildren(level);
            }
          });
          on(button, "focus", () => {
            button.style.background = "var(--message-surface, #eee)";
          });
          on(button, "blur", () => {
            button.style.background = "transparent";
          });
        }
        return level;
      }
      try {
        const root = build(items);
        doc.body.appendChild(container);
        positionMenu(win, root.menu, x, y);
        // Any target or mode ancestor change invalidates the capture,
        // including a hidden->visible transition before a clipboard reply.
        // The original ProseMirror editor toggles exactly one focus class
        // when focus moves to our menu. Permit only that known transition.
        const isEditorFocusTransition = (record, after) => {
          const editor = snap.element;
          if (
            record.type !== "attributes" ||
            record.attributeName !== "class" ||
            record.target !== editor ||
            (snap.kind !== "range" && !snap.richAction) ||
            editor?.isContentEditable !== true ||
            !container.contains(doc.activeElement) ||
            !scopeCurrent(snap) ||
            typeof record.oldValue !== "string" ||
            typeof after !== "string"
          )
            return false;
          const parse = (value) => value.trim().split(/\s+/).filter(Boolean);
          const before = parse(record.oldValue),
            next = parse(after),
            focusClass = "ProseMirror-focused";
          if (
            before.length > 256 ||
            next.length > 256 ||
            new Set(before).size !== before.length ||
            new Set(next).size !== next.length ||
            !before.includes("ProseMirror") ||
            !next.includes("ProseMirror") ||
            before.includes(focusClass) === next.includes(focusClass)
          )
            return false;
          const withoutFocus = (classes) =>
            classes.filter((name) => name !== focusClass);
          const left = withoutFocus(before),
            right = withoutFocus(next);
          if (
            left.length !== right.length ||
            left.some((name, index) => name !== right[index])
          )
            return false;
          try {
            embeddingContext(win);
            return visibleTargetAncestors(win, editor) !== null;
          } catch {
            return false;
          }
        };
        const observed = [
          ...(targetAncestors ? [{ window: win, nodes: targetAncestors }] : []),
          ...parents,
        ];
        for (const ancestor of observed) {
          const watched = new Set(ancestor.nodes);
          const observer = new ancestor.window.MutationObserver((records) => {
            if (records.length > 1024) {
              close(state, { id: null }, false);
              return;
            }
            // Reconstruct each individual transition, not just old vs final:
            // a hidden class added and removed in one task must still cancel.
            const later = new Map();
            for (let i = records.length - 1; i >= 0; i--) {
              const record = records[i];
              if (record.type !== "attributes") {
                if (
                  [...record.removedNodes].some((node) => watched.has(node))
                ) {
                  close(state, { id: null }, false);
                  return;
                }
                continue;
              }
              let attrs = later.get(record.target);
              if (!attrs) later.set(record.target, (attrs = new Map()));
              const name = record.attributeName,
                after = attrs.has(name)
                  ? attrs.get(name)
                  : record.target.getAttribute(name);
              attrs.set(name, record.oldValue);
              if (!isEditorFocusTransition(record, after)) {
                close(state, { id: null }, false);
                return;
              }
            }
          });
          for (const node of ancestor.nodes)
            observer.observe(node, {
              attributes: true,
              attributeOldValue: true,
              childList: true,
              attributeFilter: [
                "hidden",
                "inert",
                "aria-hidden",
                "style",
                "class",
              ],
            });
          state.listeners.push(() => observer.disconnect());
        }
        for (const parent of parents) {
          on(parent.document, "visibilitychange", () => {
            if (parent.document.visibilityState === "hidden")
              close(state, { id: null }, false);
          });
          on(parent.window, "pagehide", () =>
            close(state, { id: null }, false),
          );
        }
        on(doc, "visibilitychange", () => {
          if (doc.visibilityState === "hidden")
            close(state, { id: null }, false);
        });
        embeddingContext(win);
        const rowFor = (target) => {
          const find = (level) => {
            for (const row of level.rows) {
              if (row.button === target) return row;
              const found = row.child && find(row.child);
              if (found) return found;
            }
            return null;
          };
          return find(root);
        };
        on(container, "keydown", (event) => {
          if (!event.isTrusted || active !== state) return;
          const row = rowFor(doc.activeElement),
            level = row?.level ?? root,
            selectable = level.rows.filter((value) => !value.disabled);
          if (event.key === "Escape") {
            event.preventDefault();
            if (level.parentRow) {
              closeChildren(level.parentRow.level);
              level.parentRow.button.focus({ preventScroll: true });
            } else close(state, { id: null });
            return;
          }
          if (event.key === "ArrowLeft" && level.parentRow) {
            event.preventDefault();
            closeChildren(level.parentRow.level);
            level.parentRow.button.focus({ preventScroll: true });
            return;
          }
          if (event.key === "ArrowRight" && row?.child) {
            event.preventDefault();
            openChild(row);
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (row) void activate(row, event);
            return;
          }
          if (event.key === "Tab") {
            close(state, { id: null }, false);
            return;
          }
          if (
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
            selectable.length
          ) {
            event.preventDefault();
            const index = selectable.indexOf(row);
            let next;
            if (event.key === "Home") next = 0;
            else if (event.key === "End") next = selectable.length - 1;
            else
              next =
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  selectable.length) %
                selectable.length;
            closeChildren(level);
            selectable[next].button.focus({ preventScroll: true });
          }
        });
        on(
          doc,
          "pointerdown",
          (event) => {
            if (!container.contains(event.target))
              close(state, { id: null }, false);
          },
          true,
        );
        on(
          doc,
          "focusin",
          (event) => {
            if (
              !container.contains(event.target) &&
              event.target !== snap.element
            )
              close(state, { id: null }, false);
          },
          true,
        );
        on(win, "blur", () => close(state, { id: null }, false));
        on(win, "resize", () => close(state, { id: null }));
        on(
          win,
          "scroll",
          (event) => {
            if (!container.contains(event.target)) close(state, { id: null });
          },
          true,
        );
        const first = root.rows.find((row) => !row.disabled);
        if (first) first.button.focus({ preventScroll: true });
        else
          ((root.menu.tabIndex = -1), root.menu.focus({ preventScroll: true }));
      } catch {
        report("CONTEXT_MENU_RENDER_FAILED");
        close(state, { id: null });
      }
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (active) close(active, { id: null });
  }
  return Object.freeze({ show, dispose });
}

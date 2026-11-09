// Explicit, local adapter for an already-committed original composer. The
// caller must supply the real controller/view and a revision token bound to its
// committed pane, thread and active workbench mode. No identity is inferred
// from DOM or React internals, and no native request or model turn is sent.
const LIMITS = Object.freeze({
  selectionUnits: 1024 * 1024,
  clipboardBytes: 1024 * 1024,
  modelNodes: 4096,
  attributeNodes: 4096,
  attributeDepth: 12,
  waitMs: 30000,
});
const ORIGINAL_COMPOSER_SHA256 =
  "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032";
const ORIGINAL_SHARED_SHA256 =
  "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116";
const PASTE_EVENTS = [
  "pasted-link",
  "pasted-text",
  "pasted-images",
  "pasted-files",
];
const failure = (code) =>
  Object.assign(new Error("Rich editor action unavailable"), { code });

function visibleInOwnAndParentDocuments(win, editor) {
  try {
    let current = win,
      target = editor;
    for (let depth = 0; depth < 8; depth++) {
      const doc = current.document;
      if (
        !doc ||
        doc.visibilityState === "hidden" ||
        target.ownerDocument !== doc ||
        !target.isConnected ||
        !target.getClientRects().length
      )
        return false;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let count = 0;
      for (let node = target; node; node = node.parentElement) {
        if (++count > 256) return false;
        const style = current.getComputedStyle(node);
        if (
          node.hidden ||
          node.inert ||
          node.getAttribute("aria-hidden") === "true" ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.opacity === "0"
        )
          return false;
      }
      const parent = current.parent;
      if (parent === current) return true;
      if (!parent) return false;
      const frame = current.frameElement;
      if (!frame || frame.ownerDocument !== parent.document) return false;
      target = frame;
      current = parent;
    }
    return false;
  } catch {
    // A cross-origin or detached parent cannot establish the active pane.
    return false;
  }
}

function boundedModelSelection(selection) {
  if (
    !selection ||
    !Number.isSafeInteger(selection.from) ||
    !Number.isSafeInteger(selection.to) ||
    selection.from < 0 ||
    selection.to < selection.from ||
    selection.to - selection.from > LIMITS.selectionUnits ||
    typeof selection.content !== "function"
  )
    throw failure("RICH_SELECTION_LIMIT");
  const slice = selection.content();
  if (!slice?.content || typeof slice.content.descendants !== "function")
    throw failure("RICH_SELECTION_UNSUPPORTED");
  let nodes = 0,
    attributeNodes = 0,
    units = 0;
  const seen = new Set();
  const add = (value, depth) => {
    if (
      ++attributeNodes > LIMITS.attributeNodes ||
      depth > LIMITS.attributeDepth
    )
      throw failure("RICH_SELECTION_LIMIT");
    if (typeof value === "string") {
      units += value.length;
      if (units > LIMITS.selectionUnits) throw failure("RICH_SELECTION_LIMIT");
      return;
    }
    if (
      value == null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return;
    if (typeof value !== "object" || seen.has(value))
      throw failure("RICH_SELECTION_UNSUPPORTED");
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== null && proto !== Object.prototype)
      throw failure("RICH_SELECTION_UNSUPPORTED");
    seen.add(value);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (Array.isArray(value) && key === "length") continue;
      if (!("value" in descriptor) || key.length > 256)
        throw failure("RICH_SELECTION_UNSUPPORTED");
      add(descriptor.value, depth + 1);
    }
    seen.delete(value);
  };
  try {
    slice.content.descendants((node) => {
      if (++nodes > LIMITS.modelNodes) throw failure("RICH_SELECTION_LIMIT");
      add(node.text ?? "", 0);
      add(node.attrs ?? null, 0);
      if (!Array.isArray(node.marks) || node.marks.length > 128)
        throw failure("RICH_SELECTION_UNSUPPORTED");
      for (const mark of node.marks) add(mark.attrs ?? null, 0);
    });
  } catch (cause) {
    if (cause?.code) throw cause;
    throw failure("RICH_SELECTION_UNSUPPORTED");
  }
  return slice;
}

function withinBytes(win, value) {
  return (
    typeof value === "string" &&
    value.length <= LIMITS.clipboardBytes &&
    new win.TextEncoder().encode(value).byteLength <= LIMITS.clipboardBytes
  );
}

function trustedAction(win, event) {
  if (
    !event ||
    !(event instanceof win.Event) ||
    event.isTrusted !== true ||
    (win.navigator.userActivation && !win.navigator.userActivation.isActive)
  )
    return false;
  if (event.type === "click")
    return event instanceof win.MouseEvent && event.button === 0;
  return (
    event.type === "keydown" &&
    event instanceof win.KeyboardEvent &&
    (event.key === "Enter" || event.key === " ")
  );
}

/**
 * capture() must be called while the original composer context is committed,
 * before the menu moves focus. It returns an opaque single-use action or null.
 * execute(role, trustedEvent) resolves to {status,code?}; contents and scope
 * identifiers are never returned. Paste uses the original view's parser and
 * plugin with an untrusted, local ClipboardEvent carrying the real clipboard
 * data. It reports applied only after an observed guarded document transaction;
 * binary clipboard images/files remain explicitly unsupported.
 */
export function createBrowserRichEditor(options = {}) {
  const win = options?.window,
    doc = win?.document;
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some(
      (key) =>
        ![
          "window",
          "getCommittedEditor",
          "captureScope",
          "isScopeCurrent",
          "onFailure",
        ].includes(key),
    ) ||
    !doc ||
    typeof win.Event !== "function" ||
    typeof options.getCommittedEditor !== "function" ||
    typeof options.captureScope !== "function" ||
    typeof options.isScopeCurrent !== "function" ||
    (options.onFailure !== undefined && typeof options.onFailure !== "function")
  )
    throw failure("RICH_EDITOR_INVALID_CONFIG");

  let epoch = 0,
    disposed = false,
    busy = false;
  const pending = new Set();
  const report = (status, code) => {
    if (code) {
      try {
        options.onFailure?.({ code });
      } catch {
        // The diagnostic callback must not change editor semantics.
      }
    }
    return code ? { status, code } : { status };
  };
  function revoke() {
    epoch++;
    for (const cancel of pending) cancel();
    pending.clear();
  }
  function current(
    snapshot,
    unchanged = false,
    expectedDispatch = snapshot.dispatch,
  ) {
    if (disposed || snapshot.epoch !== epoch) return false;
    try {
      const committed = options.getCommittedEditor();
      const { controller, view } = snapshot;
      return (
        options.isScopeCurrent(snapshot.scope) === true &&
        committed?.controller === controller &&
        committed?.view === view &&
        committed?.composerSha256 === ORIGINAL_COMPOSER_SHA256 &&
        committed?.sharedSha256 === ORIGINAL_SHARED_SHA256 &&
        committed?.allSelectionConstructor ===
          snapshot.allSelectionConstructor &&
        controller.view === view &&
        controller.eventEmitter === snapshot.emitter &&
        controller.undo === snapshot.undo &&
        controller.redo === snapshot.redo &&
        controller.isInputActive === true &&
        view.isDestroyed === false &&
        view.editable === true &&
        view.dispatch === expectedDispatch &&
        view.serializeForClipboard === snapshot.serialize &&
        view.pasteText === snapshot.pasteText &&
        view.pasteHTML === snapshot.pasteHTML &&
        !view.composing &&
        (!unchanged || view.state === snapshot.state) &&
        visibleInOwnAndParentDocuments(win, view.dom)
      );
    } catch {
      return false;
    }
  }
  function pasteListenersSafe(snapshot, name, expectedEmit = snapshot.emit) {
    try {
      const emitter = snapshot.emitter,
        listeners = emitter?.listeners;
      if (
        !(listeners instanceof win.Map) ||
        listeners !== snapshot.listeners ||
        emitter.emit !== expectedEmit
      )
        return false;
      for (const key of name ? [name] : PASTE_EVENTS) {
        const handlers = listeners.get(key);
        if (
          handlers !== undefined &&
          (!(handlers instanceof win.Set) || handlers.size)
        )
          return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  // Existing listeners for unrelated clipboard events are common in the
  // original composer. Snapshot each exact listener set so a listener added,
  // removed, or replaced during an operation still stops the next transaction.
  // A listener for an event actually emitted by Tac is rejected separately,
  // before it receives any clipboard data or starts asynchronous work.
  function capturePasteListeners(snapshot) {
    try {
      const emitter = snapshot.emitter,
        listeners = emitter?.listeners;
      if (
        !(listeners instanceof win.Map) ||
        listeners !== snapshot.listeners ||
        emitter.emit !== snapshot.emit
      )
        return null;
      return PASTE_EVENTS.map((name) => {
        const handlers = listeners.get(name);
        if (handlers === undefined) return { name, handlers, values: null };
        if (!(handlers instanceof win.Set) || handlers.size > 128)
          throw failure("RICH_PASTE_LISTENER_UNSUPPORTED");
        return { name, handlers, values: [...handlers] };
      });
    } catch {
      return null;
    }
  }
  function pasteListenersUnchanged(snapshot, baseline, expectedEmit) {
    try {
      if (
        !baseline ||
        !(snapshot.emitter?.listeners instanceof win.Map) ||
        snapshot.emitter.listeners !== snapshot.listeners ||
        snapshot.emitter.emit !== expectedEmit
      )
        return false;
      return baseline.every(({ name, handlers, values }) => {
        const current = snapshot.listeners.get(name);
        return (
          current === handlers &&
          (values === null ||
            (current instanceof win.Set &&
              current.size === values.length &&
              values.every((value) => current.has(value))))
        );
      });
    } catch {
      return false;
    }
  }
  function waitFor(value, snapshot) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback, result) => {
        if (done) return;
        done = true;
        pending.delete(cancel);
        win.clearTimeout(timer);
        callback(result);
      };
      const cancel = () => finish(reject, failure("RICH_SCOPE_STALE"));
      const timer = win.setTimeout(
        () => finish(reject, failure("RICH_CLIPBOARD_TIMEOUT")),
        LIMITS.waitMs,
      );
      pending.add(cancel);
      Promise.resolve(value).then(
        (result) => finish(resolve, result),
        (cause) => finish(reject, cause),
      );
      if (!current(snapshot, true)) cancel();
    });
  }
  // The fixed original Tac paste handler can dispatch more than once. Guard
  // each original dispatch, including synchronous application callbacks that
  // switch the committed owner during an earlier transaction.
  function guardedDispatch(
    snapshot,
    action,
    guardPasteEvents = false,
    clipboardBaseline = null,
  ) {
    const { view } = snapshot,
      previous = Object.getOwnPropertyDescriptor(view, "dispatch");
    if (
      !previous ||
      previous.value !== snapshot.dispatch ||
      typeof previous.value !== "function" ||
      !previous.writable
    )
      return { status: "unavailable", code: "RICH_DISPATCH_UNAVAILABLE" };
    const emitter = snapshot.emitter,
      previousEmit = guardPasteEvents
        ? Object.getOwnPropertyDescriptor(emitter, "emit")
        : null;
    const pasteBaseline = guardPasteEvents ? clipboardBaseline : null;
    if (
      guardPasteEvents &&
      (!pasteListenersUnchanged(snapshot, pasteBaseline, snapshot.emit) ||
        typeof snapshot.emit !== "function" ||
        (previousEmit &&
          (!("value" in previousEmit) || !previousEmit.writable)) ||
        (!previousEmit && !Object.isExtensible(emitter)))
    )
      return { status: "unavailable", code: "RICH_PASTE_LISTENER_UNSUPPORTED" };
    let attempted = 0,
      value,
      cause,
      restored = true,
      dispatchInstalled = false,
      emitInstalled = false;
    const original = previous.value;
    const guarded = function (...args) {
      if (!current(snapshot, false, guarded)) throw failure("RICH_SCOPE_STALE");
      if (
        guardPasteEvents &&
        !pasteListenersUnchanged(snapshot, pasteBaseline, guardedEmit)
      )
        throw failure("RICH_PASTE_LISTENER_UNSUPPORTED");
      attempted++;
      const result = Reflect.apply(original, view, args);
      if (!current(snapshot, false, guarded)) throw failure("RICH_SCOPE_STALE");
      if (
        guardPasteEvents &&
        !pasteListenersUnchanged(snapshot, pasteBaseline, guardedEmit)
      )
        throw failure("RICH_PASTE_LISTENER_UNSUPPORTED");
      return result;
    };
    const guardedEmit = function (name, ...args) {
      if (!current(snapshot, false, guarded)) throw failure("RICH_SCOPE_STALE");
      if (
        !pasteListenersUnchanged(snapshot, pasteBaseline, guardedEmit) ||
        !pasteListenersSafe(snapshot, name, guardedEmit)
      )
        throw failure("RICH_PASTE_LISTENER_UNSUPPORTED");
      const result = Reflect.apply(snapshot.emit, emitter, [name, ...args]);
      if (!current(snapshot, false, guarded)) throw failure("RICH_SCOPE_STALE");
      if (!pasteListenersUnchanged(snapshot, pasteBaseline, guardedEmit))
        throw failure("RICH_PASTE_LISTENER_UNSUPPORTED");
      return result;
    };
    try {
      if (guardPasteEvents) {
        Object.defineProperty(emitter, "emit", {
          ...(previousEmit || {
            configurable: true,
            enumerable: false,
            writable: true,
          }),
          value: guardedEmit,
        });
        emitInstalled = true;
      }
      Object.defineProperty(view, "dispatch", { ...previous, value: guarded });
      dispatchInstalled = true;
      value = action();
    } catch (error) {
      cause = error;
    } finally {
      try {
        if (dispatchInstalled) {
          const descriptor = Object.getOwnPropertyDescriptor(view, "dispatch");
          if (descriptor?.value === guarded)
            Object.defineProperty(view, "dispatch", previous);
          else restored = false;
        }
      } catch {
        restored = false;
      }
      try {
        if (emitInstalled) {
          const descriptor = Object.getOwnPropertyDescriptor(emitter, "emit");
          if (descriptor?.value !== guardedEmit) restored = false;
          else if (previousEmit)
            Object.defineProperty(emitter, "emit", previousEmit);
          else if (!delete emitter.emit) restored = false;
        }
      } catch {
        restored = false;
      }
    }
    if (!restored)
      return { status: "uncertain", code: "RICH_DISPATCH_RESTORE_FAILED" };
    if (cause || !current(snapshot))
      return attempted
        ? { status: "uncertain", code: "RICH_OUTCOME_UNCERTAIN" }
        : cause?.code === "RICH_PASTE_LISTENER_UNSUPPORTED"
          ? { status: "unavailable", code: "RICH_PASTE_LISTENER_UNSUPPORTED" }
          : { status: "stale", code: "RICH_SCOPE_STALE" };
    return { status: "completed", attempted, value };
  }
  function checkedOutcome(snapshot, outcome, verify) {
    if (outcome.status !== "completed")
      return report(outcome.status, outcome.code);
    if (!outcome.attempted)
      return report("unavailable", "RICH_ACTION_UNAVAILABLE");
    try {
      if (!current(snapshot) || !verify(outcome))
        return report("uncertain", "RICH_OUTCOME_UNCERTAIN");
    } catch {
      return report("uncertain", "RICH_OUTCOME_UNCERTAIN");
    }
    return report("applied");
  }
  function capture(target) {
    revoke();
    if (disposed) return null;
    try {
      const owner = options.getCommittedEditor(),
        scope = options.captureScope(),
        controller = owner?.controller,
        view = owner?.view,
        state = view?.state;
      if (
        scope == null ||
        !controller ||
        !view ||
        !state?.selection ||
        !state.doc ||
        typeof view.dispatch !== "function" ||
        (target !== undefined &&
          (!target ||
            (target !== view.dom && !view.dom.contains(target)) ||
            (doc.activeElement !== view.dom &&
              !view.dom.contains(doc.activeElement))))
      )
        return null;
      const emitter = controller.eventEmitter;
      const snapshot = {
        controller,
        view,
        state,
        scope,
        epoch,
        emitter,
        listeners: emitter?.listeners,
        emit: emitter?.emit,
        dispatch: view.dispatch,
        serialize: view.serializeForClipboard,
        pasteText: view.pasteText,
        pasteHTML: view.pasteHTML,
        undo: controller.undo,
        redo: controller.redo,
        allSelectionConstructor: owner?.allSelectionConstructor,
      };
      if (!current(snapshot, true)) return null;
      let used = false;
      return Object.freeze({
        selectionEmpty: state.selection.empty === true,
        supportsSelectAll:
          typeof snapshot.allSelectionConstructor === "function",
        cancel() {
          if (snapshot.epoch === epoch) revoke();
        },
        async execute(role, event) {
          if (used) return report("unavailable", "RICH_ACTION_ALREADY_USED");
          used = true;
          if (
            !["copy", "cut", "paste", "undo", "redo", "selectAll"].includes(
              role,
            )
          )
            return report("unavailable", "RICH_ACTION_UNSUPPORTED");
          if (!trustedAction(win, event))
            return report("unavailable", "RICH_USER_GESTURE_REQUIRED");
          if (busy) return report("unavailable", "RICH_ACTION_BUSY");
          if (!current(snapshot, true))
            return report("stale", "RICH_SCOPE_STALE");
          busy = true;
          let clipboardWriteStarted = false;
          try {
            if (role === "selectAll") {
              if (typeof snapshot.allSelectionConstructor !== "function")
                return report("unavailable", "RICH_ACTION_UNSUPPORTED");
              const selection = new snapshot.allSelectionConstructor(state.doc);
              if (
                selection?.from !== 0 ||
                selection?.to !== state.doc.content.size ||
                selection?.$from?.doc !== state.doc ||
                selection?.toJSON?.()?.type !== "all"
              )
                return report("unavailable", "RICH_ACTION_UNSUPPORTED");
              const transaction = state.tr
                .setSelection(selection)
                .scrollIntoView();
              const result = guardedDispatch(snapshot, () =>
                view.dispatch(transaction),
              );
              return checkedOutcome(
                snapshot,
                result,
                () =>
                  view.state.doc.eq(state.doc) &&
                  view.state.selection.eq(selection),
              );
            }
            if (role === "copy" || role === "cut") {
              if (state.selection.empty)
                return report("unavailable", "RICH_EMPTY_SELECTION");
              if (
                typeof view.serializeForClipboard !== "function" ||
                typeof win.ClipboardItem !== "function" ||
                typeof win.navigator.clipboard?.write !== "function"
              )
                return report("unavailable", "RICH_CLIPBOARD_UNSUPPORTED");
              const slice = boundedModelSelection(state.selection),
                serialized = view.serializeForClipboard(slice),
                text = serialized?.text,
                html = serialized?.dom?.innerHTML;
              if (!withinBytes(win, text) || !withinBytes(win, html))
                return report("unavailable", "RICH_CLIPBOARD_LIMIT");
              if (!current(snapshot, true))
                return report("stale", "RICH_SCOPE_STALE");
              const item = new win.ClipboardItem({
                "text/plain": new win.Blob([text], { type: "text/plain" }),
                "text/html": new win.Blob([html], { type: "text/html" }),
              });
              clipboardWriteStarted = true;
              await waitFor(win.navigator.clipboard.write([item]), snapshot);
              if (!current(snapshot, true))
                return report("uncertain", "RICH_CLIPBOARD_SCOPE_CHANGED");
              if (role === "copy") return report("applied");
              const transaction = state.tr
                  .deleteSelection()
                  .scrollIntoView()
                  .setMeta("uiEvent", "cut"),
                expected = transaction.doc;
              if (!current(snapshot, true))
                return report("uncertain", "RICH_CLIPBOARD_SCOPE_CHANGED");
              const result = guardedDispatch(snapshot, () =>
                view.dispatch(transaction),
              );
              return checkedOutcome(snapshot, result, () =>
                view.state.doc.eq(expected),
              );
            }
            if (role === "paste") {
              const clipboardBaseline = capturePasteListeners(snapshot);
              if (!clipboardBaseline)
                return report("unavailable", "RICH_PASTE_LISTENER_UNSUPPORTED");
              if (
                typeof win.navigator.clipboard?.read !== "function" ||
                typeof win.DataTransfer !== "function" ||
                typeof win.ClipboardEvent !== "function" ||
                typeof view.pasteText !== "function" ||
                typeof view.pasteHTML !== "function"
              )
                return report("unavailable", "RICH_CLIPBOARD_UNSUPPORTED");
              const items = await waitFor(
                win.navigator.clipboard.read(),
                snapshot,
              );
              if (!current(snapshot, true))
                return report("stale", "RICH_SCOPE_STALE");
              if (!Array.isArray(items) || items.length !== 1)
                return report(
                  "unavailable",
                  "RICH_CLIPBOARD_FORMAT_UNSUPPORTED",
                );
              const item = items[0],
                types = item?.types;
              if (
                !Array.isArray(types) ||
                !types.includes("text/plain") ||
                types.some(
                  (type) => !["text/plain", "text/html"].includes(type),
                )
              )
                return report(
                  "unavailable",
                  "RICH_CLIPBOARD_FORMAT_UNSUPPORTED",
                );
              const read = async (type) => {
                const blob = await waitFor(item.getType(type), snapshot);
                if (
                  !Number.isSafeInteger(blob?.size) ||
                  blob.size < 0 ||
                  blob.size > LIMITS.clipboardBytes
                )
                  throw failure("RICH_CLIPBOARD_LIMIT");
                const text = await waitFor(blob.text(), snapshot);
                if (!withinBytes(win, text))
                  throw failure("RICH_CLIPBOARD_LIMIT");
                return text;
              };
              const text = await read("text/plain"),
                html = types.includes("text/html")
                  ? await read("text/html")
                  : "";
              if (!current(snapshot, true))
                return report("stale", "RICH_SCOPE_STALE");
              const transfer = new win.DataTransfer();
              transfer.setData("text/plain", text);
              if (html) transfer.setData("text/html", html);
              const event = new win.ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              });
              // This event is intentionally not dispatched and is not trusted.
              // The original parser/plugin must produce a real transaction.
              const result = guardedDispatch(
                snapshot,
                () =>
                  html
                    ? view.pasteHTML(html, event)
                    : view.pasteText(text, event),
                true,
                clipboardBaseline,
              );
              if (result.status === "completed" && result.value !== true)
                return result.attempted
                  ? report("uncertain", "RICH_OUTCOME_UNCERTAIN")
                  : report("unavailable", "RICH_ACTION_UNAVAILABLE");
              if (result.status === "completed" && !result.attempted)
                return report("uncertain", "RICH_OUTCOME_UNCERTAIN");
              return checkedOutcome(
                snapshot,
                result,
                () => !view.state.doc.eq(state.doc),
              );
            }
            if (typeof controller[role] !== "function")
              return report("unavailable", "RICH_ACTION_UNSUPPORTED");
            const result = guardedDispatch(snapshot, () => controller[role]());
            if (result.status === "completed" && result.value !== true)
              return result.attempted
                ? report("uncertain", "RICH_OUTCOME_UNCERTAIN")
                : report("unavailable", "RICH_ACTION_UNAVAILABLE");
            return checkedOutcome(snapshot, result, () => view.state !== state);
          } catch (cause) {
            if (cause?.code === "RICH_SCOPE_STALE")
              return clipboardWriteStarted
                ? report("uncertain", "RICH_CLIPBOARD_SCOPE_CHANGED")
                : report("stale", "RICH_SCOPE_STALE");
            if (
              [
                "RICH_SELECTION_LIMIT",
                "RICH_SELECTION_UNSUPPORTED",
                "RICH_CLIPBOARD_LIMIT",
              ].includes(cause?.code)
            )
              return report("unavailable", cause.code);
            return clipboardWriteStarted
              ? report("uncertain", "RICH_CLIPBOARD_OUTCOME_UNCERTAIN")
              : report("unavailable", "RICH_CLIPBOARD_DENIED");
          } finally {
            busy = false;
          }
        },
      });
    } catch {
      return null;
    }
  }
  return Object.freeze({
    capture,
    dispose() {
      if (!disposed) {
        disposed = true;
        revoke();
      }
    },
  });
}

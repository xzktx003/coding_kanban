// Local capability for the committed original composer only. The renderer is a
// trusted, version-pinned realm; this is not an authorization boundary against
// arbitrary script in that realm and never grants native RPC or turn access.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DOCUMENT_KEYS = ["profileId", "generation", "viewId"];
const TARGET_KEYS = ["hostId", "conversationId", "clientThreadId"];
const COMPOSER_SHA256 =
  "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032";
const SHARED_SHA256 =
  "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116";
const failure = (code) =>
  Object.assign(new Error("Composer capability unavailable"), { code });

function readDataObject(value, keys, validate) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !validate(key, descriptor.value)
    )
      return null;
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}
function leaseLike(lease) {
  return (
    !!lease &&
    typeof lease.getSnapshot === "function" &&
    typeof lease.isCurrent === "function" &&
    typeof lease.subscribe === "function"
  );
}
function snapshot(lease) {
  if (!leaseLike(lease)) return null;
  try {
    const value = lease.getSnapshot();
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
function validLease(lease, captured, target) {
  if (!captured || snapshot(lease) !== captured) return false;
  try {
    return lease.isCurrent(captured, target) === true;
  } catch {
    return false;
  }
}

/**
 * `Registrar` must be rendered within the original ComposerControllerScope by
 * the exact-version adapter. `scope` comes from the original committed Ej and
 * `paneLease` from the actual unique committed footer slot. The mode lease is
 * established by the host for the same validated document. Lease revisions
 * must be opaque, stable until invalidated, and replaced on every confirmation,
 * including equal-valued confirmations. `isCurrent` must revoke synchronously.
 *
 * No target or controller is discovered via DOM, labels, or React internals.
 * The layout owner must supply the pane lease; missing/ambiguous evidence closes
 * the capability. Captured tokens are opaque and have no RPC authority.
 */
export function createBrowserComposerCapability(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw failure("COMPOSER_CAPABILITY_INVALID_CONFIG");
  const { window: win, React, useComposerController, modeActivation } = options;
  const documentScope = readDataObject(
    options.documentScope,
    DOCUMENT_KEYS,
    (_key, value) => typeof value === "string" && UUID.test(value),
  );
  if (
    Object.keys(options).some(
      (key) =>
        ![
          "window",
          "React",
          "useComposerController",
          "modeActivation",
          "documentScope",
        ].includes(key),
    ) ||
    !win?.document ||
    !documentScope ||
    typeof useComposerController !== "function" ||
    !leaseLike(modeActivation) ||
    !React ||
    ["useCallback", "useLayoutEffect", "useRef", "useSyncExternalStore"].some(
      (key) => typeof React[key] !== "function",
    )
  )
    throw failure("COMPOSER_CAPABILITY_INVALID_CONFIG");

  const owners = new Map(),
    brokenLeases = new WeakSet();
  let issued = null,
    attachmentIssued = null,
    disposed = false;
  function invalidate() {
    issued = null;
  }
  function invalidateForLease() {
    invalidate();
    attachmentIssued = null;
    for (const owner of owners.values()) owner.poisoned = true;
  }
  function useLease(lease) {
    const subscribe = React.useCallback(
      (listener) => {
        if (!leaseLike(lease) || brokenLeases.has(lease)) return () => {};
        try {
          const unsubscribe = lease.subscribe(() => {
            invalidateForLease();
            listener();
          });
          if (typeof unsubscribe !== "function")
            throw new Error("Invalid unsubscribe");
          return () => {
            try {
              unsubscribe();
            } catch {
              brokenLeases.add(lease);
              invalidateForLease();
            }
          };
        } catch {
          brokenLeases.add(lease);
          invalidateForLease();
          listener();
          return () => {};
        }
      },
      [lease],
    );
    const get = React.useCallback(
      () => (brokenLeases.has(lease) ? null : snapshot(lease)),
      [lease],
    );
    return React.useSyncExternalStore(subscribe, get, () => null);
  }
  function Registrar({ scope, paneLease } = {}) {
    const owner = React.useRef(null);
    if (!owner.current) owner.current = {};
    const modeToken = useLease(modeActivation),
      paneToken = useLease(paneLease);
    let controller = null;
    try {
      controller = useComposerController();
    } catch {
      /* Missing original provider closes the gate. */
    }
    const checked = readDataObject(
      scope,
      [...TARGET_KEYS, "isMain"],
      (key, value) =>
        key === "isMain"
          ? typeof value === "boolean"
          : key === "conversationId" && value === null
            ? true
            : typeof value === "string" &&
              value.length > 0 &&
              value.length <= 4096 &&
              !/[\x00-\x1f\x7f]/.test(value),
    );
    const inactive = checked?.isMain === false;
    const target =
      checked &&
      Object.freeze(
        Object.fromEntries(TARGET_KEYS.map((key) => [key, checked[key]])),
      );
    const view = controller?.view;
    // Attachment selection spans ordinary menu-close commits. Its separate
    // token still belongs to this mounted owner and to the exact committed
    // document/pane/mode lease revisions; it grants no native RPC authority.
    React.useLayoutEffect(() => () => {
      if (attachmentIssued?.owner === owner.current) attachmentIssued = null;
    }, []);
    // No dependency array: every actual React commit revokes the preceding local
    // capability, even if all visible identity fields are equal.
    React.useLayoutEffect(() => {
      if (disposed || inactive) {
        if (attachmentIssued?.owner === owner.current) attachmentIssued = null;
        return undefined;
      }
      const record = {
        owner: owner.current,
        controller,
        view,
        editorDom: view?.dom,
        target,
        paneLease,
        paneToken,
        modeToken,
        poisoned: false,
      };
      owners.set(owner.current, record);
      if (attachmentIssued) {
        const previous = attachmentIssued.record;
        const continuous = owners.size === 1 && !previous.poisoned &&
          previous.owner === record.owner && previous.controller === controller &&
          previous.view === view && previous.editorDom === record.editorDom && previous.paneLease === paneLease &&
          previous.paneToken === paneToken && previous.modeToken === modeToken &&
          previous.target && target && TARGET_KEYS.every(key => previous.target[key] === target[key]) &&
          usable(record);
        if (continuous) attachmentIssued.record = record;
        else attachmentIssued = null;
      }
      invalidate();
      return () => {
        if (owners.get(owner.current) === record) {
          owners.delete(owner.current);
          invalidate();
        }
      };
    });
    return null;
  }
  function usable(record) {
    try {
      return (
        !!record &&
        !record.poisoned &&
        !!record.target &&
        !brokenLeases.has(modeActivation) &&
        !brokenLeases.has(record.paneLease) &&
        validLease(modeActivation, record.modeToken) &&
        validLease(record.paneLease, record.paneToken, record.target) &&
        !!record.controller &&
        record.controller.view === record.view &&
        record.controller.isInputActive === true &&
        !!record.view &&
        record.view.isDestroyed === false &&
        record.view.editable === true &&
        !!record.view.dom &&
        record.view.dom.ownerDocument === win.document &&
        record.view.dom.isConnected === true
      );
    } catch {
      return false;
    }
  }
  function liveOwner() {
    if (disposed || owners.size !== 1) {
      invalidate();
      attachmentIssued = null;
      return null;
    }
    const record = owners.values().next().value;
    if (!usable(record)) {
      // Once handed out, a token cannot become current again when a view or
      // lease disappears and later returns without a new React commit.
      if (issued || attachmentIssued) {
        record.poisoned = true;
        invalidate();
        attachmentIssued = null;
      }
      return null;
    }
    return record;
  }
  function captureScope() {
    const record = liveOwner();
    if (!record) return null;
    if (!issued) issued = { token: Object.freeze({}), record };
    return issued.token;
  }
  function isScopeCurrent(token) {
    const record = liveOwner();
    return (
      !!record && !!issued && issued.record === record && issued.token === token
    );
  }
  function liveAttachmentOwner() {
    const record = liveOwner();
    if (!record) return null;
    if (record.view.dom !== record.editorDom) {
      record.poisoned = true;
      attachmentIssued = null;
      invalidate();
      return null;
    }
    return record;
  }
  function captureAttachmentScope() {
    const record = liveAttachmentOwner();
    if (!record) return null;
    if (!attachmentIssued) attachmentIssued = { token: Object.freeze({}), record, owner: record.owner };
    return attachmentIssued.token;
  }
  function isAttachmentScopeCurrent(token) {
    const record = liveAttachmentOwner();
    return !!record && !!attachmentIssued && attachmentIssued.record === record && attachmentIssued.token === token;
  }
  return Object.freeze({
    Registrar,
    captureScope,
    isScopeCurrent,
    captureAttachmentScope,
    isAttachmentScopeCurrent,
    // Identity metadata from the unique committed Registrar; this read grants no native authority.
    getCommittedTarget() {
      const record=owners.size===1?owners.values().next().value:null;
      try { if(disposed||!record?.target||record.poisoned||!validLease(modeActivation,record.modeToken)||!validLease(record.paneLease,record.paneToken,record.target)||record.controller?.view!==record.view||record.view?.isDestroyed!==false||record.view.dom!==record.editorDom||record.editorDom?.ownerDocument!==win.document||!record.editorDom.isConnected)return null;
        return Object.freeze({target:record.target,editorDom:record.editorDom,canSubmit:record.controller.isInputActive===true&&record.view.editable===true});
      }catch{return null;}
    },
    getCommittedEditor() {
      const record = liveOwner();
      return record
        ? Object.freeze({
            controller: record.controller,
            view: record.view,
            composerSha256: COMPOSER_SHA256,
            sharedSha256: SHARED_SHA256,
          })
        : null;
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        owners.clear();
        invalidate();
        attachmentIssued = null;
      }
    },
  });
}

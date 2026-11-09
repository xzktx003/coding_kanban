import { createBrowserContextMenus } from "./browser-context-menu.mjs";
import { createBrowserRichEditor } from "./browser-rich-editor.mjs";

const failure = (code) =>
  Object.assign(new Error("Desktop local editing unavailable"), { code });

/**
 * Install the closed proxy in the bridge first, then call initialize() before
 * loading the original entry. The caller supplies the pinned capability
 * initializer; importing this module never imports an original bundle.
 * This controller owns local UI resources only, not the native bridge/view.
 */
export function createBrowserSurfaceController({
  window,
  scope,
  modeActivation,
  initializeCapability,
  createRichEditor = createBrowserRichEditor,
  createMenus = createBrowserContextMenus,
  imagePickerEnabled = false,
  loadImagePicker = () => import("./browser-image-file-picker.mjs"),
} = {}) {
  if (
    !window?.document ||
    !scope ||
    !modeActivation ||
    !["getSnapshot", "isCurrent", "subscribe"].every(
      (key) => typeof modeActivation[key] === "function",
    ) ||
    typeof imagePickerEnabled !== "boolean" ||
    [initializeCapability, createRichEditor, createMenus, loadImagePicker].some(
      (value) => typeof value !== "function",
    )
  ) {
    throw failure("SURFACE_INVALID_CONFIG");
  }
  let phase = "new",
    capability,
    rich,
    menus,
    imagePicker,
    installImagePicker,
    unsubscribe = () => {};
  const releaseLocal = () => {
    const oldImagePicker = imagePicker,
      oldMenus = menus,
      oldRich = rich;
    imagePicker = menus = rich = undefined;
    try {
      oldImagePicker?.dispose();
    } catch {
      /* release the remaining local resources */
    }
    try {
      oldMenus?.dispose();
    } catch {
      /* release the remaining local resources */
    }
    try {
      oldRich?.dispose();
    } catch {
      /* no native fallback */
    }
  };
  const activeToken = () => {
    try {
      const token = modeActivation.getSnapshot();
      return token && modeActivation.isCurrent(token) === true ? token : null;
    } catch {
      return null;
    }
  };
  const releaseCapability = () => {
    const current = capability;
    capability = undefined;
    try {
      current?.dispose();
    } catch {
      /* never acquire another capability */
    }
  };
  const refreshLocal = () => {
    releaseLocal();
    if (phase !== "active") return;
    const token = activeToken();
    if (!token) return;
    try {
      rich = createRichEditor({
        window,
        getCommittedEditor: capability.getCommittedEditor,
        captureScope: capability.captureScope,
        isScopeCurrent: capability.isScopeCurrent,
      });
      if (
        !rich ||
        typeof rich.capture !== "function" ||
        typeof rich.dispose !== "function"
      )
        throw failure("SURFACE_INITIALIZATION_FAILED");
      menus = createMenus({
        window,
        captureScope: capability.captureScope,
        isScopeCurrent: capability.isScopeCurrent,
        richEditor: rich,
      });
      if (
        !menus ||
        typeof menus.show !== "function" ||
        typeof menus.dispose !== "function"
      )
        throw failure("SURFACE_INITIALIZATION_FAILED");
      if (imagePickerEnabled) {
        imagePicker = installImagePicker({
          window,
          captureScope: capability.captureAttachmentScope,
          isScopeCurrent: capability.isAttachmentScopeCurrent,
        });
        if (!imagePicker || typeof imagePicker.dispose !== "function")
          throw failure("SURFACE_INITIALIZATION_FAILED");
      }
      if (!modeActivation.isCurrent(token)) releaseLocal();
    } catch {
      releaseLocal();
      throw failure("SURFACE_INITIALIZATION_FAILED");
    }
  };
  const contextMenuAdapter = Object.freeze({
    async show(items, position) {
      if (phase === "closed") throw failure("SURFACE_CLOSED");
      if (phase !== "active") throw failure("SURFACE_NOT_READY");
      const token = activeToken(),
        current = menus;
      if (!token || !current) throw failure("SURFACE_INACTIVE");
      const result = await current.show(items, position);
      if (phase === "closed") throw failure("SURFACE_CLOSED");
      if (
        phase !== "active" ||
        current !== menus ||
        !modeActivation.isCurrent(token)
      )
        throw failure("SURFACE_INACTIVE");
      return result;
    },
    dispose,
  });
  function dispose() {
    if (phase === "closed") return;
    phase = "closed";
    const off = unsubscribe;
    unsubscribe = () => {};
    try {
      off();
    } catch {
      /* local capability checks still reject */
    }
    releaseLocal();
    releaseCapability();
  }
  return Object.freeze({
    contextMenuAdapter,
    async initialize() {
      if (phase !== "new") throw failure("SURFACE_ALREADY_INITIALIZED");
      phase = "starting";
      try {
        const loaded = await initializeCapability({
          window,
          scope,
          modeActivation,
        });
        if (phase === "closed") {
          try {
            loaded?.dispose();
          } catch {
            /* late capability remains unusable */
          }
          throw failure("SURFACE_CLOSED");
        }
        capability = loaded;
        if (
          !capability ||
          ![
            "captureScope",
            "isScopeCurrent",
            "getCommittedEditor",
            "dispose",
          ].every((key) => typeof capability[key] === "function")
        )
          throw failure("SURFACE_INITIALIZATION_FAILED");
        if (imagePickerEnabled) {
          if (typeof capability.captureAttachmentScope !== "function" ||
              typeof capability.isAttachmentScopeCurrent !== "function")
            throw failure("SURFACE_INITIALIZATION_FAILED");
          const module = await loadImagePicker();
          if (phase === "closed") throw failure("SURFACE_CLOSED");
          if (typeof module?.installBrowserImageFilePicker !== "function")
            throw failure("SURFACE_INITIALIZATION_FAILED");
          installImagePicker = module.installBrowserImageFilePicker;
        }
        phase = "active";
        unsubscribe = modeActivation.subscribe(() => {
          try {
            refreshLocal();
          } catch {
            phase = "failed";
            releaseLocal();
            releaseCapability();
          }
        });
        if (typeof unsubscribe !== "function")
          throw failure("SURFACE_INITIALIZATION_FAILED");
        refreshLocal();
      } catch {
        if (phase === "closed") throw failure("SURFACE_CLOSED");
        phase = "failed";
        try {
          unsubscribe();
        } catch {
          /* no retry or new native work */
        }
        unsubscribe = () => {};
        releaseLocal();
        releaseCapability();
        throw failure("SURFACE_INITIALIZATION_FAILED");
      }
    },
    dispose,
  });
}

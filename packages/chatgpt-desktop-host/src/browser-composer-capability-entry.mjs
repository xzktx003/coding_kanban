import { createBrowserComposerCapability } from "./browser-composer-capability.mjs";

// This module is loaded only in the same trusted pinned renderer as the
// original React tree. The host explicitly initializes it after validating
// bootstrap and installing the native facade; merely importing it is inert.
let phase = "new",
  current = null;
const failure = (code) =>
  Object.assign(new Error("Desktop composer unavailable"), { code });

export async function initializeComposerCapability(options) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !["window", "scope", "modeActivation"].includes(key),
    ) ||
    !options.window?.document ||
    !options.scope ||
    !options.modeActivation
  )
    throw failure("COMPOSER_ENTRY_INVALID_CONFIG");
  if (phase !== "new") throw failure("COMPOSER_ENTRY_ALREADY_INITIALIZED");
  phase = "starting";
  try {
    const marker = Object.getOwnPropertyDescriptor(
      options.window,
      "__chatgptDesktopSplitPaneEnabled",
    );
    if (marker && (!Object.hasOwn(marker, "value") || marker.value !== true || marker.writable || marker.configurable))
      throw failure("COMPOSER_ENTRY_INVALID_CONFIG");
    const split = marker !== undefined;
    const [shared, original, layout, pane, home] = await Promise.all([
      import("../assets/app-shared-601019a330d7.js"),
      import("../assets/app-initial-18b189e867e7.js"),
      import("./desktop-layout-browser.mjs"),
      split
        ? import("./desktop-split-pane-browser.mjs")
        : import("./desktop-selected-pane-browser.mjs"),
      import("./desktop-home-registrar.mjs"),
    ]);
    const React = shared.pWt();
    original.dO();
    shared.zEt();
    if (
      typeof layout.useDesktopFooterOwnership !== "function" ||
      typeof layout.getDesktopLayoutSnapshot !== "function" ||
      typeof home.createDesktopHomeRegistrar !== "function" ||
      typeof original.fO !== "function" ||
      typeof shared.AEt !== "function"
    )
      throw failure("COMPOSER_ENTRY_INITIALIZATION_FAILED");
    const capability = createBrowserComposerCapability({
      window: options.window,
      React,
      useComposerController: original.fO,
      documentScope: options.scope,
      modeActivation: options.modeActivation,
    });
    const HomeRegistrar = home.createDesktopHomeRegistrar({
      React,
      registry: split ? pane.desktopSplitPaneRegistry : pane.desktopSelectedPaneRegistry,
      footerOwnership: layout.desktopFooterOwnership,
      Registrar: capability.Registrar,
      enabled: layout.getDesktopLayoutSnapshot().enabled === true,
    });
    function PaneScopedRegistrar({ scope, homeScope }) {
      const paneLease = layout.useDesktopFooterOwnership();
      if (scope == null && paneLease == null && homeScope != null)
        return React.createElement(HomeRegistrar, { scope: homeScope });
      return React.createElement(capability.Registrar, { scope, paneLease });
    }
    current = { React, capability, PaneScopedRegistrar };
    phase = "active";
    return Object.freeze({
      captureScope: capability.captureScope,
      isScopeCurrent: capability.isScopeCurrent,
      captureAttachmentScope: capability.captureAttachmentScope,
      isAttachmentScopeCurrent: capability.isAttachmentScopeCurrent,
      getCommittedTarget: capability.getCommittedTarget,
      getCommittedEditor() {
        const editor = capability.getCommittedEditor();
        return editor
          ? Object.freeze({ ...editor, allSelectionConstructor: shared.AEt })
          : null;
      },
      dispose() {
        if (phase !== "active") return;
        phase = "closed";
        capability.dispose();
        current = null;
      },
    });
  } catch {
    phase = "failed";
    throw failure("COMPOSER_ENTRY_INITIALIZATION_FAILED");
  }
}

// Invoked by the fixed composer member inside the original provider. Before
// initialization it renders nothing; it never creates a second React root.
export function OriginalComposerRegistrar({ scope, homeScope } = {}) {
  const state = current;
  return state === null
    ? null
    : state.React.createElement(state.PaneScopedRegistrar, {
        scope,
        homeScope,
      });
}

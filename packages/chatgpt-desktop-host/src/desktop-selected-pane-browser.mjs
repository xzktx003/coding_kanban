import { pWt as getReact } from "../assets/app-shared-601019a330d7.js";
import { createDesktopSelectedPaneRuntime } from "./desktop-selected-pane-core.mjs";
import { readDesktopLayoutConfig } from "./desktop-layout-core.mjs";
import * as layout from "./desktop-layout-browser.mjs";

const selected = createDesktopSelectedPaneRuntime({
  React: getReact(),
  enabled: readDesktopLayoutConfig().enabled,
  layoutRuntime: {
    DesktopLayoutBoundary: layout.DesktopLayoutBoundary,
    DesktopPaneOwnershipProvider: layout.DesktopPaneOwnershipProvider,
    footerOwnership: layout.desktopFooterOwnership,
  },
});
export const DesktopSelectedPaneBoundary = selected.DesktopSelectedPaneBoundary;
// The original home composer and GI footer compete for this same owner set.
export const desktopSelectedPaneRegistry = selected.registry;

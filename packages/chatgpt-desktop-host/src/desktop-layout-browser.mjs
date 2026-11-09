// The synthetic host route serves this file alongside desktop-layout-core.mjs.
// Both imports resolve from the same document/origin as the original page;
// the pinned shared module supplies the renderer's *existing* React instance.
import { pWt as getReact, JFt as getJsx } from '../assets/app-shared-601019a330d7.js';
import { createDesktopLayoutRuntime, readDesktopLayoutConfig } from './desktop-layout-core.mjs';

const { enabled } = readDesktopLayoutConfig();
const runtime = createDesktopLayoutRuntime({ React: getReact(), jsx: getJsx(), enabled });
export const DesktopLayoutBoundary = runtime.DesktopLayoutBoundary;
export const DesktopPaneOwnershipProvider = runtime.DesktopPaneOwnershipProvider;
export const useDesktopFooterOwnership = runtime.useDesktopFooterOwnership;
export const desktopFooterOwnership = runtime.footerOwnership;
export const renderDesktopLayout = runtime.renderLayout;
export const getDesktopLayoutSnapshot = runtime.getSnapshot;
export const requestDesktopReadonlyPane = runtime.requestReadonlyPane;

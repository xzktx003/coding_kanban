import type { WorkbenchMode } from "./workbench-mode";
import {
  isMobileWorkbenchLocation,
  type MobileWorkbenchLocation,
} from "./mobile-workbench-route";

export interface MobileTerminalTouchSignals {
  maxTouchPoints?: number;
  pointerCoarse: boolean;
}

export const PHONE_TERMINAL_MAX_WIDTH = 480;
export const PHONE_TERMINAL_SHORT_HEIGHT = 500;
export const PHONE_TERMINAL_SHORT_WIDTH = 1024;

export function isPhoneTerminalViewport(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) {
    return false;
  }
  return (
    width <= PHONE_TERMINAL_MAX_WIDTH ||
    (height <= PHONE_TERMINAL_SHORT_HEIGHT && width <= PHONE_TERMINAL_SHORT_WIDTH)
  );
}

export function phoneTerminalMinimumHeight(viewportHeight: number): number {
  return viewportHeight > 0 && viewportHeight <= PHONE_TERMINAL_SHORT_HEIGHT
    ? 140
    : 180;
}

export function shouldUsePhoneTerminal({
  location,
  viewportWidth,
  viewportHeight,
  workbenchMode,
  coarsePointer = false,
}: {
  location: MobileWorkbenchLocation;
  viewportWidth: number;
  viewportHeight: number;
  workbenchMode: WorkbenchMode;
  coarsePointer?: boolean;
}): boolean {
  if (isMobileWorkbenchLocation(location)) {
    return true;
  }
  return (
    workbenchMode === "terminal" &&
    (coarsePointer || isPhoneTerminalViewport(viewportWidth, viewportHeight))
  );
}

export function shouldEnableMobileTerminalTouchMode({
  maxTouchPoints = 0,
  pointerCoarse,
}: MobileTerminalTouchSignals): boolean {
  return pointerCoarse || maxTouchPoints > 0;
}

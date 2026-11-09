import type { DesktopScope } from "./control-client.mjs";
import type { DesktopSurfaceActivationLease } from "./surface-activation.mjs";
export const DESKTOP_SURFACE_HOST_KEY: "__kanbanDesktopSurfaceHostV1";
export interface DesktopSurfaceHostOwner {
  confirmActive(active: boolean): void;
  checkDocument(): void;
  close(): void;
}
export function installDesktopSurfaceHost(options: {
  window: Window;
  frame: HTMLIFrameElement;
  profileId: string;
  generation: string;
}): DesktopSurfaceHostOwner;
export function connectDesktopSurfaceHost(options: {
  window: Window;
  document: Document;
  scope: Readonly<DesktopScope>;
}): DesktopSurfaceActivationLease;

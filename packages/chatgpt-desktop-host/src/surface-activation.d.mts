import type { DesktopScope } from "./control-client.mjs";

/** Opaque process-local editing lease, never native permission. */
export interface DesktopSurfaceActivationLease {
  getSnapshot(): Readonly<object> | null;
  isCurrent(token: unknown): boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
export interface DesktopSurfaceActivationOwner {
  /** Even a same-value confirmation revokes the previous token. */
  confirmActive(active: boolean): void;
  bind(options: {
    scope: Readonly<DesktopScope>;
    document: object;
    isCurrentDocument(document: object): boolean;
  }): DesktopSurfaceActivationLease;
  checkDocument(): void;
  close(): void;
}
export function createDesktopSurfaceActivation(options: {
  profileId: string;
  generation: string;
  onSubscriberError?: () => void;
}): DesktopSurfaceActivationOwner;

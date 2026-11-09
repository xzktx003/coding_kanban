export interface DesktopScope { profileId: string; generation: string; viewId: string }
export interface DesktopBootstrap { windowType: 'electron'; getters: Record<string, unknown>; sharedObjects: Record<string, unknown> }
export interface DesktopControlConnection {
  scope: Readonly<DesktopScope>;
  bootstrap: DesktopBootstrap;
  frames: AsyncIterable<string>;
  sendFrame(encoded: string): Promise<void>;
  close(): void;
}
export type ProjectPersistenceState = 'disabled' | 'waiting' | 'active' | 'unsupported' | 'error' | 'unknown';
/** Read a fixed profile's current metadata after hello; never creates a view. */
export function readDesktopProjectPersistence(options: {
  profile: { id: string; generation: string; pid: number; startTicks: string; controlSocketPath: string };
  verifyProfile: () => Promise<boolean>;
  timeoutMs?: number;
}): Promise<ProjectPersistenceState>;
export function connectDesktopControl(options: {
  profile: { id: string; generation: string; pid: number; startTicks: string; controlSocketPath: string };
  viewId: string;
  verifyProfile: () => Promise<boolean>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<DesktopControlConnection>;

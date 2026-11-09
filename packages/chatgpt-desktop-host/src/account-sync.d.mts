export interface DesktopAccountSynchronizerOptions {
  /** Existing canonical 0600 authorized source; source and auth.lock are never modified. */
  sourceFile: string;
  /** Existing owned private tmpfs HOME containing the previously seeded snapshot. */
  homeRoot: string;
  /** Existing owned 0600 grant in an owned 0700 directory, selected server-side only. */
  grantFile: string;
}
export interface DesktopAccountSynchronizer {
  /** Only updates the snapshot, or returns busy/unchanged. Does not refresh the CLI cache. */
  syncNow(): Promise<Readonly<{ state: "updated" | "unchanged" | "busy" }>>;
  /** Revokes this in-memory authority and waits for its in-flight write to finish. */
  close(): Promise<void>;
}
export type DesktopAccountSyncLoopStatus =
  | Readonly<{ state: "running"; lastCheck: "pending" | "updated" | "unchanged" | "busy" }>
  | Readonly<{ state: "stopped"; code: string }>
  | Readonly<{ state: "closed" }>;
export interface DesktopAccountSyncLoop {
  status(): DesktopAccountSyncLoopStatus;
  /** Clear the timer, revoke, and wait for any in-flight check. */
  close(): Promise<void>;
}
/** Stable local identity comparison only: the JWT signatures are not verified. */
export function desktopAccountIdentityDigest(bytes: Buffer): string;
/** Explicit opt-in enrollment; no polling or network requests are started. */
export function createDesktopAccountSynchronizer(options: DesktopAccountSynchronizerOptions): Promise<Readonly<DesktopAccountSynchronizer>>;
/** Start one immediate check followed by fixed, serial 30-second checks. */
export function startDesktopAccountSyncLoop(synchronizer: DesktopAccountSynchronizer): Readonly<DesktopAccountSyncLoop>;

export interface DesktopAccountSnapshotOptions {
  /** Explicitly authorized, owned 0600 ChatGPT auth.json in an owned 0700 directory. */
  sourceFile: string;
  /** Existing, canonical, empty owned 0700 directory on tmpfs. Never a disk HOME. */
  homeRoot: string;
}
/** Read the source once without refreshing it; write only a private access snapshot. */
export function seedDesktopAccountSnapshot(
  options: DesktopAccountSnapshotOptions,
): Promise<Readonly<{ kind: 'chatgpt-access-snapshot'; refreshEnabled: false }>>;

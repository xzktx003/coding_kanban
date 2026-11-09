export interface DesktopSurfaceAssetAdapter {
  readonly members: readonly string[];
  adapt(options: { member: string; body: Buffer }): {
    body: Buffer;
    originalSha256: string;
    adaptedSha256: string;
  } | null;
}
/** The caller must also initialize the matching browser capability before the original entry. */
export function createDesktopSurfaceAssetAdapter(options: {
  archiveSha256: string;
  sharedThread?: boolean;
  splitPane?: boolean;
  sshDiscovery?: boolean;
}): DesktopSurfaceAssetAdapter;

export interface AssetLease {
  body: Buffer;
  contentType: string;
  etag: string;
  release(): void;
}
export interface WebviewArchive {
  acquireAsset(member: string, options?: { signal?: AbortSignal }): Promise<AssetLease>;
  close(): Promise<void>;
}
export function openWebviewArchive(options: {
  asarPath: string;
  sha256: string;
  maxHeaderBytes?: number;
  maxAssetBytes?: number;
  maxInFlightBytes?: number;
  maxQueue?: number;
}): Promise<WebviewArchive>;

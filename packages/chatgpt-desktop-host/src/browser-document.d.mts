export function createBrowserDocument(options: {
  body: Uint8Array;
  profileId: string;
  generation: string;
  version?: 1 | 2 | 3 | 4 | 5;
}): { body: Buffer; originalSha256: string; adaptedSha256: string };

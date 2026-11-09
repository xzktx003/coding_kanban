import type { Buffer } from 'node:buffer';

export function adaptCodexRendererAsset(options: {
  member: string;
  body: Buffer;
}): {
  body: Buffer;
  originalSha256: string;
  adaptedSha256: string;
} | null;

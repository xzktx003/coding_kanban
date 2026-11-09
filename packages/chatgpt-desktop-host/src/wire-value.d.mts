export interface WireLimits { maxEncodedBytes?: number; maxDecodedBytes?: number; maxNodes?: number; maxDepth?: number }
export const WIRE_DEFAULT_LIMITS: Readonly<Required<WireLimits>>;
export class WireValueError extends Error { code: string }
export function encodeWireValue(value: unknown, limits?: WireLimits): string;
export function encodeWireValueDetailed(value: unknown, limits?: WireLimits): Readonly<{ encoded: string; encodedBytes: number; nodeCount: number }>;
export function decodeWireValue(encoded: string, limits?: WireLimits): unknown;

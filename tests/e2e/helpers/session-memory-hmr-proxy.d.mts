import type { Server } from "node:http";
export function attachSessionMemoryHmrProxy(options: {
  server: Server;
  sourceOrigin: string;
  proxyOrigin: string;
  verifySource: (signal: AbortSignal) => Promise<unknown>;
  rejectUnauthorized?: boolean;
  maxConnections?: number;
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  handshakeTimeoutMs?: number;
  closeTimeoutMs?: number;
}): {
  snapshot(): {
    attempts: number;
    connected: number;
    closed: number;
    rejected: number;
    active: number;
    upstreamActive: number;
    rawActive: number;
    frames: Record<string, number>;
    fromSource: Record<string, number>;
    fromClient: Record<string, number>;
    closeCodes: {
      client: Record<string, number>;
      upstream: Record<string, number>;
    };
  };
  close(): Promise<void>;
};

import type { Plugin } from "vite";

export function viteDocumentContinuity(): Plugin;
export function preserveViteDocument(
  source: string,
  state?: { instanceId: string; revision: number },
): string;

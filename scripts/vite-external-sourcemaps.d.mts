import type { Plugin } from "vite";
export function viteExternalSourceMaps(): Plugin;
export function assertExternalSourceMapContract(version: string): void;
export function externalSourceMapUrl(requestUrl: string | undefined): string | null;

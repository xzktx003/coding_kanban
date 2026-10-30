import { getJsonWithOptions, postNoContent } from "./shared";

export interface SettingsFile {
  version?: number;
  workspace?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  locale?: Record<string, unknown>;
  app?: Record<string, unknown>;
  codexConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function fetchRemoteSettings(options?: {
  signal?: AbortSignal;
}): Promise<SettingsFile> {
  return getJsonWithOptions<SettingsFile>("/api/settings", {
    ...options,
    suppressToast: true,
  });
}

export async function saveRemoteSettings(
  settings: SettingsFile,
): Promise<void> {
  return postNoContent("/api/settings", settings);
}

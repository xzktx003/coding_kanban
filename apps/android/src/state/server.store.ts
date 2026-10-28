import { create } from "zustand";
import {
  clearServerConfig as clearStoredConfig,
  loadServerConfig,
  saveServerConfig,
} from "../core/config";
import { initBaseUrl, setBaseUrl } from "../core/transport";

type ServerState = {
  url: string;
  ready: boolean;
  error: string | null;
  init(): Promise<void>;
  connect(url: string): Promise<boolean>;
  disconnect(): Promise<void>;
};

export const useServerStore = create<ServerState>((set, get) => ({
  url: "",
  ready: false,
  error: null,

  async init() {
    const stored = await loadServerConfig();
    setBaseUrl(stored);
    set({ url: stored, ready: true, error: null });
  },

  async connect(url) {
    try {
      const normalized = await saveServerConfig(url);
      setBaseUrl(normalized);
      set({ url: normalized, ready: true, error: null });
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "INVALID";
      set({ error: message });
      return false;
    }
  },

  async disconnect() {
    await clearStoredConfig();
    setBaseUrl("");
    set({ url: "", ready: true, error: null });
  },
}));

// Make sure a caller can still read the resolved URL after init.
export async function ensureBaseUrl(): Promise<string> {
  return initBaseUrl();
}

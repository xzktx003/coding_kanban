import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "codingkanban.serverUrl";
const TEST_KEY = "codingkanban.serverUrl.test";

let memoryUrl = "";

export type ServerConfig = {
  url: string;
  setUrl(url: string): Promise<void>;
  clear(): Promise<void>;
};

/**
 * Normalise a server base URL: trim whitespace, strip trailing slashes,
 * and reject obvious non-http(s) values.
 */
export function normaliseServerUrl(input: string): string {
  let value = input.trim();
  if (!value) return "";
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) {
    throw new Error(`Unsupported protocol: ${value}`);
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  value = value.replace(/\/+$/, "");
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  return value;
}

export function validateServerUrl(input: string): string | null {
  try {
    const normalized = normaliseServerUrl(input);
    if (!normalized) return "EMPTY";
    const parsed = new URL(normalized);
    if (!parsed.hostname) return "INVALID";
    return null;
  } catch {
    return "INVALID";
  }
}

export async function loadServerConfig(): Promise<string> {
  if (memoryUrl) return memoryUrl;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    return stored ?? "";
  } catch {
    return "";
  }
}

export async function saveServerConfig(input: string): Promise<string> {
  const normalized = normaliseServerUrl(input);
  memoryUrl = normalized;
  try {
    await AsyncStorage.setItem(KEY, normalized);
  } catch {
    // Persistence is best-effort in v1; keep memory value.
  }
  return normalized;
}

export async function clearServerConfig(): Promise<void> {
  memoryUrl = "";
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Test helper to inject a known URL without hitting AsyncStorage.
export function setMemoryServerUrlForTest(url: string): void {
  memoryUrl = url;
}

import { nativeIframeUrl } from "./native-surface";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const endpoints = [
  "status",
  "instance-status",
  "focus",
  "resume-beside",
  "new-beside",
  "restore",
  "release-instance",
  "theme",
  "send",
  "tabs",
] as const;
type Endpoint = (typeof endpoints)[number];

/** Select only a server-registered client; this URL never chooses an upstream. */
export function nativeClientScope(search: string) {
  const selectors = new URLSearchParams(search).getAll("nativeClient");
  const valid =
    selectors.length === 0 ||
    (selectors.length === 1 && UUID.test(selectors[0]!));
  const profileId = valid && selectors.length ? selectors[0]! : null;
  const prefix = profileId
    ? `/native-codex/clients/${profileId}/`
    : "/native-codex/";
  return {
    valid,
    profileId,
    storageKey(key: string) {
      return valid
        ? profileId
          ? `${key}:${profileId}`
          : key
        : `${key}:invalid-client`;
    },
    api(endpoint: Endpoint) {
      if (!valid)
        throw new Error("原生 Codex 客户端标识无效，请重新打开对应入口");
      if (!endpoints.includes(endpoint)) throw new Error("原生 Codex 接口无效");
      return endpoint === "tabs"
        ? "/api/native-codex/tabs"
        : `/api${prefix}${endpoint}`;
    },
    iframe(value: unknown, origin: string) {
      if (!valid) return null;
      const url = nativeIframeUrl(value, origin);
      return url && new URL(url, origin).pathname === prefix ? url : null;
    },
  };
}

export type NativeClientScope = ReturnType<typeof nativeClientScope>;

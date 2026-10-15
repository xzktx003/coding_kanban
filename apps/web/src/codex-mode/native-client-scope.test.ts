import { expect, it } from "vitest";
import { nativeClientScope } from "./native-client-scope";
const first = "019aabcd-1234-7890-abcd-000000000041",
  second = "019aabcd-1234-7890-abcd-000000000042",
  origin = "https://lan.example";
it("keeps default startup paths and accepts only the exact selected same-origin host root", () => {
  const legacy = nativeClientScope("?mode=codex"),
    profile = nativeClientScope(`?nativeClient=${first}`);
  expect(legacy.api("status")).toBe("/api/native-codex/status");
  expect(legacy.storageKey("view")).toBe("view");
  expect(legacy.iframe(`/native-codex/clients/${first}/`, origin)).toBeNull();
  expect(profile.api("send")).toBe(`/api/native-codex/clients/${first}/send`);
  expect(profile.api("tabs")).toBe("/api/native-codex/tabs");
  expect(
    profile.iframe(
      `/native-codex/clients/${first}/?folder=%2Ftmp%2Fproject`,
      origin,
    ),
  ).toBe(`/native-codex/clients/${first}/?folder=%2Ftmp%2Fproject`);
  for (const value of [
    "/native-codex/",
    `/native-codex/clients/${second}/`,
    `/native-codex/clients/${first}/../${second}/`,
    `/native-codex/clients/${first}/static/file.js`,
    `https://evil.example/native-codex/clients/${first}/`,
    `/native-codex/clients/${first}/#other`,
  ])
    expect(profile.iframe(value, origin)).toBeNull();
});
it.each([
  "",
  first.toUpperCase(),
  "../status",
  "https://evil.example/",
  `${first}&nativeClient=${second}`,
])(
  "refuses invalid or ambiguous selectors without choosing the default service: %s",
  (value) => {
    const profile = nativeClientScope(`?nativeClient=${value}`);
    expect(profile.valid).toBe(false);
    expect(() => profile.api("status")).toThrow(/客户端标识/);
    expect(profile.iframe("/native-codex/", origin)).toBeNull();
  },
);

import { afterEach, expect, it, vi } from "vitest";
import { mcpServerOauthLogin } from "./mcp";

vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => `http://fixture.invalid${path}`,
  authHeaders: () => ({}),
  isTauri: () => false,
  isDesktopTauri: () => false,
}));
afterEach(() => vi.unstubAllGlobals());
it("serializes the native bigint timeout as an exact JSON integer", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          authorizationUrl: "https://fixture.invalid/authorize",
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    mcpServerOauthLogin({
      name: "fixture",
      threadId: null,
      scopes: null,
      timeoutSecs: 120n,
    }),
  ).resolves.toEqual({ authorizationUrl: "https://fixture.invalid/authorize" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    name: "fixture",
    threadId: null,
    scopes: null,
    timeoutSecs: 120,
  });
});
it("rejects an unsafe native timeout before starting HTTP", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    mcpServerOauthLogin({ name: "fixture", timeoutSecs: 9007199254740992n }),
  ).rejects.toThrow("timeout");
  expect(fetchMock).not.toHaveBeenCalled();
});

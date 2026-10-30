import type { Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

/** A verified running owner A. Creating independent connection B fails before
 * admission; viewing or creating another chat must never cancel owner A. */
export async function setupAcpNewConnectionFailure(page: Page) {
  const calls: Array<{ path: string; body: any }> = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSessionUxFixture(page, 1);
  await page.route("**/api/session/api/acp/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (request.method() === "POST") calls.push({ path, body });
    if (path.endsWith("/start")) {
      await route.fulfill({ status: 503, json: { error: "隔离新连接暂不可用" } });
      return;
    }
    const json = path.endsWith("/agents")
      ? [{ id: "fixture-agent", name: "隔离 Agent", command: "fixture", args: [], env: {}, available: true }]
      : path.endsWith("/sessions") ? []
      : path.endsWith("/connection-snapshot") ? {
          runtimeInstance: "fixture-runtime", connectionId: "fixture-connection",
          agentId: "fixture-agent", sessionId: "fixture-running", historySessionId: "acph_fixture_owner_a",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          initialize: { agentInfo: { name: "fixture-agent" }, agentCapabilities: { loadSession: true } },
          session: { sessionId: "fixture-running", historySessionId: "acph_fixture_owner_a" },
          settingsKnown: true, running: true, deliveryUnknown: false, lifecycleUnknown: false, permissions: [],
        }
      : path.includes("/history") ? { entries: [], nextCursor: null }
      : {};
    await route.fulfill({ json });
  });
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const module = async (suffix: string) => import(performance.getEntriesByType("resource")
      .findLast((entry) => new URL(entry.name).pathname.endsWith(`/src/session-mode/${suffix}`))?.name
      ?? `/src/session-mode/${suffix}`);
    const { useAcpStore } = await module("stores/useAcpStore.ts");
    const { buildUrl } = await module("hooks/runtime.ts");
    useAcpStore.setState({
      active: true, agentId: "fixture-agent", agentTitle: "隔离 Agent",
      connectionId: "fixture-connection", sessionId: "fixture-running", historySessionId: "acph_fixture_owner_a",
      runtimeInstance: "fixture-runtime", connectionEndpoint: buildUrl("/api/acp/connection-snapshot"),
      sessionCwd: "/fixture/项目/very-long-project-path-for-ui-regression", connecting: false, running: true,
      connectionRecovery: false, sessionTransition: null, sessionTransitionError: null,
      permission: null, pendingPermissions: {}, entries: [{ id: "context", role: "agent", text: "正在执行隔离任务" }],
    });
    (window as any).acpFixtureStore = useAcpStore;
  });
  return { calls, errors };
}

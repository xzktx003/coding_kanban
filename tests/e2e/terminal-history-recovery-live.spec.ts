import { expect, test } from "@playwright/test";

test("restored terminal records keep original IDs and browser grouping through reload", async ({ page, request }) => {
  test.skip(process.env.TERMINAL_RECOVERY_LIVE !== "1", "Requires an explicitly recovered live terminal registry");
  const response = await request.get("/api/agent-sessions");
  expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  expect(snapshot.items.length).toBeGreaterThan(0);
  const session = snapshot.items.find((s: any) => s.connectionState === "online");
  expect(session).toBeTruthy();
  const group = { groups: [{ id: "recovery-check", name: "历史恢复验证" }], assignments: { [`session:${session.id}`]: "recovery-check" }, collapsedGroupIds: [] };
  await page.addInitScript(group => {
    if (!localStorage.getItem("coding-kanban-session-groups-v1")) {
      localStorage.setItem("coding-kanban-session-groups-v1", JSON.stringify(group));
      localStorage.setItem("coding-kanban-agent-grid-layout-v1", "group");
    }
  }, group);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/?mode=terminal", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("历史恢复验证", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(session.displayName, { exact: true }).first()).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("历史恢复验证", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("coding-kanban-session-groups-v1")!).assignments)).toEqual(group.assignments);
  const after = await (await request.get("/api/agent-sessions")).json();
  expect(after.items.map((s: any) => s.id).sort()).toEqual(snapshot.items.map((s: any) => s.id).sort());
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("terminal-restored.png") });
});

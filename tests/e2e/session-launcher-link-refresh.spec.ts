import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const viewport of [
  { width: 1600, height: 1000 },
  { width: 393, height: 852 },
]) {
  test(`launcher link retains Session history after refresh at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const fixture = await installSessionUxFixture(page, 1);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    Object.assign(fixture.threads[0], {
      turns: [
        {
          id: "launcher-turn",
          status: "completed",
          startedAt: 1,
          durationMs: 1000,
          error: null,
          items: [
            {
              type: "userMessage",
              id: "launcher-user",
              content: [
                {
                  type: "text",
                  text: "launcher history question",
                  text_elements: [],
                },
              ],
            },
            {
              type: "agentMessage",
              id: "launcher-answer",
              text: "launcher history answer",
              phase: "final_answer",
            },
          ],
        },
      ],
    });
    // All API/WebSocket traffic stays in the isolated fixture, including a
    // regression that would accidentally mount the Terminal workbench.
    const cwd = fixture.threads[0]!.cwd;
    await page.goto(
      `/?mode=session&agent=codex&thread=ux-0&cwd=${encodeURIComponent(cwd)}&keep=launcher#anchor`,
    );
    await expect(
      page.getByText("launcher history answer", { exact: true }),
    ).toBeVisible();
    const cleaned = new URL(page.url());
    expect(cleaned.searchParams.get("mode")).toBe("session");
    expect(cleaned.searchParams.get("keep")).toBe("launcher");
    expect(cleaned.hash).toBe("#anchor");
    for (const key of ["agent", "thread", "cwd"])
      expect(cleaned.searchParams.has(key)).toBe(false);
    await page.reload();
    await expect(page.locator(".workbench-shell")).toHaveAttribute(
      "data-mode",
      "session",
    );
    await expect(
      page.getByText("launcher history answer", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".codex-native-history-notice")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    expect(errors).toEqual([]);
    expect(
      fixture.calls.filter(({ path }) =>
        /\/(turn\/(start|steer|interrupt)|thread\/(resume|acquire|start)|followups\/(submit|change|stop))$/.test(
          path,
        ),
      ),
    ).toEqual([]);
  });
}

import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
for (const [width, ambiguous] of [
  [1440, false],
  [393, false],
  [1440, true],
  [393, true],
] as const)
  test(`accepted steer display provenance survives refresh and matches exact native identity at ${width}px${ambiguous ? " with ambiguous IDs" : ""}`, async ({
    page,
    baseURL,
  }, info) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1),
      reads: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(
      "**/api/session/followups/steer-receipts?**",
      async (route) => {
        reads.push(route.request().url());
        expect(route.request().method()).toBe("GET");
        expect(
          new URL(route.request().url()).searchParams.get("expectedScope"),
        ).toBe("ux-fixture-native-scope");
        await route.fulfill({
          json: {
            data: ["one", "two"].map((id) => ({
              sourceId: `operation-${id}`,
              operationId: `operation-${id}`,
              clientId: ambiguous ? "client-one" : `client-${id}`,
              threadId: "ux-0",
              turnId: "original-turn",
              scope: "previous-runtime-scope",
              namespace: "ux-fixture-native-domain",
              createdAt: 1,
              status: "accepted",
              nativeIdentityUnique: !ambiguous,
              text: "Original accepted in-turn supplement",
              images: [],
            })),
            nextCursor: null,
          },
        });
      },
    );
    const stream = await liveStream(page, baseURL!);
    try {
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await seedSessionUx(page, 1);
      if (width < 768)
        await page
          .getByRole("button", { name: "展开项目列表", exact: true })
          .click();
      await page
        .getByRole("button", { name: /Agent: Codex 中文会话 0/ })
        .first()
        .click();
      await expect(
        page.locator('[data-steer-receipt="operation-one"]'),
      ).toBeVisible();
      await expect(
        page.getByText("已发送的补充说明", { exact: true }),
      ).toHaveCount(2);
      const beforeRefresh = reads.length;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.locator('[data-steer-receipt="operation-one"]'),
      ).toBeVisible();
      expect(reads.length).toBeGreaterThan(beforeRefresh);
      await page.evaluate(async () => {
        const path =
          "/src/session-mode/components/codex/stores/useCodexStore.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        useCodexStore.setState((state: any) => ({
          events: {
            ...state.events,
            "ux-0": [
              ...(state.events["ux-0"] ?? []),
              {
                method: "item/completed",
                params: {
                  threadId: "ux-0",
                  turnId: "unrelated-turn",
                  item: {
                    type: "userMessage",
                    id: "other-turn-item",
                    clientId: "client-one",
                    content: [
                      {
                        type: "text",
                        text: "Original accepted in-turn supplement",
                        text_elements: [],
                      },
                    ],
                  },
                },
              },
            ],
          },
        }));
      });
      await expect(
        page.locator('[data-steer-receipt="operation-one"]'),
      ).toBeVisible();
      await page.evaluate(async () => {
        const path =
          "/src/session-mode/components/codex/stores/useCodexStore.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        useCodexStore.setState((state: any) => ({
          events: {
            ...state.events,
            "ux-0": [
              ...(state.events["ux-0"] ?? []),
              {
                method: "item/completed",
                params: {
                  threadId: "ux-0",
                  turnId: "original-turn",
                  item: {
                    type: "userMessage",
                    id: "exact-item",
                    clientId: "client-one",
                    content: [
                      {
                        type: "text",
                        text: "Original accepted in-turn supplement",
                        text_elements: [],
                      },
                    ],
                  },
                },
              },
            ],
          },
        }));
      });
      if (ambiguous)
        await expect(
          page.locator('[data-steer-receipt="operation-one"]'),
        ).toBeVisible();
      else
        await expect(
          page.locator('[data-steer-receipt="operation-one"]'),
        ).toHaveCount(0);
      await expect(
        page.locator('[data-steer-receipt="operation-two"]'),
      ).toBeVisible();
      expect(
        fixture.calls.filter((call) =>
          /followups|turn\/(?:start|steer)|thread\/resume/.test(call.path),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: info.outputPath("steer-exact-native-reconciliation.png"),
      });
      await writeFile(
        info.outputPath("steer-display-proof.json"),
        JSON.stringify(
          {
            width,
            reads,
            oldScopeReceiptRestored: true,
            equalTextKept: true,
            otherTurnKept: true,
            exactNativeIdentityHidden: !ambiguous,
            ambiguousSourceRetained: ambiguous,
            writes: 0,
            boundary:
              "Actual Workbench/browser with isolated readonly receipt HTTP. Official native steer and server persistence have separate owner evidence; these rows are explicitly display provenance.",
          },
          null,
          2,
        ),
      );
    } finally {
      await stream.close();
    }
  });

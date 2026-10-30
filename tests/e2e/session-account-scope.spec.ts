import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
async function pair(page: any, baseURL: string) {
  const url = new URL(baseURL);
  await page.addInitScript(
    ({ host, port }: any) =>
      localStorage.setItem(
        "kanban.session.codexia.pairing",
        JSON.stringify({
          version: 2,
          state: {
            selectedHost: host,
            desktops: [
              { host, port, token: "fixture-old-token", name: "isolated" },
            ],
          },
        }),
      ),
    { host: url.hostname, port: Number(url.port) },
  );
}
async function changeToken(page: any) {
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/usePairingStore.ts";
    const { usePairingStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    const device = usePairingStore.getState().desktops[0];
    usePairingStore
      .getState()
      .addDesktop({ ...device, token: "fixture-new-token" });
  });
}
for (const width of [1440, 393])
  for (const delayedAck of [false, true])
    test(`same-endpoint credentials revoke device login ${delayedAck ? "before" : "after"} ACK at ${width}px`, async ({
      page,
      baseURL,
    }, info) => {
      await page.setViewportSize({ width, height: 852 });
      await pair(page, baseURL!);
      await installSessionUxFixture(page, 0);
      const stream = await liveStream(page, baseURL!);
      let release: (() => void) | undefined;
      const writes: Array<{ type: string }> = [];
      await page.route("**/api/session/api/codex/account/get", (route) =>
        route.fulfill({ json: { account: null, requiresOpenaiAuth: true } }),
      );
      await page.route(
        "**/api/session/api/codex/account/login",
        async (route) => {
          const input = route.request().postDataJSON();
          writes.push({ type: input.type });
          if (input.type === "apiKey") {
            await route.fulfill({ json: { type: "apiKey" } });
            return;
          }
          if (delayedAck)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          await route.fulfill({
            json: {
              type: "chatgptDeviceCode",
              loginId: "owned-device-login",
              verificationUrl: "https://fixture.invalid/device",
              userCode: "OWNED-FIXTURE",
            },
          });
        },
      );
      try {
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await expect(
          page.locator(".session-mode [contenteditable=true]").first(),
        ).toBeVisible();
        if (width < 768)
          await page
            .getByRole("button", { name: "展开项目列表", exact: true })
            .click();
        // An authoritative signed-out account opens the normal login prompt itself.
        // Do not try to click the inert sidebar beneath that existing modal.
        await expect(
          page.getByRole("dialog", { name: "ChatGPT Login", exact: true }),
        ).toBeVisible();
        const auth = page.getByRole("dialog", {
            name: "ChatGPT Login",
            exact: true,
          }),
          key = auth.getByLabel("OpenAI API Key", { exact: true });
        await key.fill("fixture-input-key");
        await auth
          .getByRole("button", { name: "登录 ChatGPT", exact: true })
          .click();
        await expect.poll(() => writes.length).toBe(1);
        if (!delayedAck) await expect(auth).toContainText("OWNED-FIXTURE");
        await changeToken(page);
        release?.();
        await expect(auth).toContainText("连接设备或凭据已改变");
        await expect(key).toHaveValue("");
        await expect(auth).not.toContainText("OWNED-FIXTURE");
        stream.emit(1, {
          method: "account/login/completed",
          params: { loginId: "owned-device-login", success: true, error: null },
        });
        await expect(auth).toBeVisible();
        await expect(auth).not.toContainText("登录成功");
        await key.fill("fixture-current-key");
        await auth
          .getByRole("button", { name: "验证 API Key", exact: true })
          .click();
        await expect.poll(() => writes.length).toBe(2);
        expect(writes).toEqual([
          { type: "chatgptDeviceCode" },
          { type: "apiKey" },
        ]);
        await page.screenshot({
          path: info.outputPath("paired-login-owner.png"),
        });
        await writeFile(
          info.outputPath("paired-login-owner.json"),
          JSON.stringify(
            {
              width,
              delayedAck,
              writes,
              oldCodeCleared: true,
              oldInputCleared: true,
              lateCompletionRejected: true,
              boundary:
                "Actual account menu/dialog and HTTP against isolated fixtures; no real account login/credential is used.",
            },
            null,
            2,
          ),
        );
      } finally {
        release?.();
        await stream.close();
      }
    });
for (const width of [1440, 393])
  test(`quota changes with paired credentials and rejects late old HTTP at ${width}px`, async ({
    page,
    baseURL,
  }, info) => {
    await page.setViewportSize({ width, height: 852 });
    await pair(page, baseURL!);
    await installSessionUxFixture(page, 0);
    const stream = await liveStream(page, baseURL!);
    let oldPending = false,
      oldRelease: (() => void) | undefined,
      newRelease: (() => void) | undefined;
    const reads: string[] = [];
    const response = (usedPercent: number) => ({
      rateLimits: {
        limitId: "codex",
        limitName: "Codex",
        primary: { usedPercent, windowDurationMins: 120, resetsAt: null },
        secondary: null,
        credits: null,
        individualLimit: null,
        spendControlReached: null,
        planType: null,
        rateLimitReachedType: null,
      },
      rateLimitsByLimitId: null,
      rateLimitResetCredits: null,
    });
    await page.route("**/api/session/api/codex/account/get", (route) =>
      route.fulfill({
        json: { account: { type: "apiKey" }, requiresOpenaiAuth: true },
      }),
    );
    await page.route(
      "**/api/session/api/codex/account/rate-limits",
      async (route) => {
        const fresh =
          route.request().headers().authorization ===
          "Bearer fixture-new-token";
        reads.push(fresh ? "new" : "old");
        if (fresh)
          await new Promise<void>((resolve) => {
            newRelease = resolve;
          });
        else if (oldPending)
          await new Promise<void>((resolve) => {
            oldRelease = resolve;
          });
        await route
          .fulfill({ json: response(fresh ? 88 : oldPending ? 1 : 23) })
          .catch(() => {});
      },
    );
    try {
      await page.goto("/usage?mode=session", { waitUntil: "domcontentloaded" });
      const quota = page.locator(".codex-native-usage");
      await expect(quota).toContainText("剩余 77%");
      oldPending = true;
      await quota
        .getByRole("button", { name: "刷新 Codex 额度", exact: true })
        .click();
      await expect.poll(() => Boolean(oldRelease)).toBe(true);
      await changeToken(page);
      await expect(quota).not.toContainText("剩余 77%");
      await expect.poll(() => Boolean(newRelease)).toBe(true);
      newRelease!();
      await expect(quota).toContainText("剩余 12%");
      oldRelease!();
      await expect(quota).not.toContainText("剩余 99%");
      await page.screenshot({
        path: info.outputPath("paired-quota-owner.png"),
      });
      await writeFile(
        info.outputPath("paired-quota-owner.json"),
        JSON.stringify(
          {
            width,
            reads,
            oldBodyClearedBeforeNewReply: true,
            lateOldReplyIgnored: true,
            boundary:
              "Actual usage page and native Fetch cancellation against isolated HTTP; percentages are fixture values, not billing proof.",
          },
          null,
          2,
        ),
      );
    } finally {
      oldRelease?.();
      newRelease?.();
      await stream.close();
    }
  });

import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  auxiliaryHistoryCompatibilityFixture,
  sourceImage,
} from "./session-auxiliary-history-compat-fixture.mts";

type Provider = "cc" | "acp";
const { installSessionUxFixture } = createRequire(import.meta.url)(
  "./session-ux-fixture.ts",
) as typeof import("./session-ux-fixture");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function bootstrapMetadata(
  page: Page,
  source: Awaited<ReturnType<typeof auxiliaryHistoryCompatibilityFixture>>,
  provider: Provider,
) {
  await installSessionUxFixture(page, 0);
  await page.route("**/api/session/projects", (route) =>
    route.fulfill({
      json: {
        projects: [source.cwd],
        initialized: true,
        revision: 1,
        sequence: 0,
      },
    }),
  );
  // URL rewrite retains the browser's actual request/cancellation. No history
  // response body is synthesized by Playwright or inserted into a browser store.
  await page.route(
    /\/api\/session\/api\/(?:(?:cc|acp)\/|events(?:\?|$))/,
    async (route) => {
      const url = new URL(route.request().url());
      await route.continue({ url: source.origin + url.pathname + url.search });
    },
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await expect(
    page.locator(".session-mode [contenteditable=true]").first(),
  ).toBeVisible();
  await page.evaluate(
    async ({ cwd, provider }) => {
      const load = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const [
        { useWorkspaceStore },
        { useLayoutStore },
        { useAcpStore },
        { useAgentSettingsStore },
      ] = await Promise.all([
        load("/src/session-mode/stores/useWorkspaceStore.ts"),
        load("/src/session-mode/stores/useLayoutStore.ts"),
        load("/src/session-mode/stores/useAcpStore.ts"),
        load("/src/session-mode/stores/useAgentSettingsStore.ts"),
      ]);
      useWorkspaceStore.getState().setCwd(cwd);
      useLayoutStore.setState({ isSidebarOpen: true, isRightPanelOpen: false });
      useAgentSettingsStore.setState({
        selectedAgent: provider === "cc" ? "cc" : "codex",
      });
      if (provider === "acp") {
        // Only an already-owned live target's small identity is bootstrapped.
        // The public source row must remain read-only and preserve this target.
        useAcpStore.setState({
          active: true,
          agentId: "aux-browser-agent",
          connectionId: "aux-browser-live-connection",
          sessionId: "aux-browser-live-target",
          entries: [],
          running: false,
          connecting: false,
          canLoadSession: false,
        });
      }
    },
    { cwd: source.cwd, provider },
  );
  const title = provider === "cc" ? source.ccTitle : source.acpTitle;
  // A uniquely titled real list row is the public history navigation gesture.
  const expand = page
    .getByRole("button", { name: "展开项目列表", exact: true })
    .first();
  if (await expand.isVisible()) await expand.click();
  const row = page
    .locator(".session-mode .session-nav-row[role=button]")
    .filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await row.click();
  const collapse = page
    .getByRole("button", { name: "收起项目列表", exact: true })
    .first();
  if (await collapse.isVisible()) await collapse.click();
}

async function assertDraft(editor: Locator, draft: string) {
  expect(
    await editor.evaluate((element) =>
      element instanceof HTMLTextAreaElement
        ? element.value
        : element.textContent,
    ),
  ).toContain(draft);
}

for (const [provider, width] of [
  ["cc", 1440],
  ["acp", 1440],
  ["acp", 393],
] as const) {
  test(`${provider} private source reaches public recent, earlier, original detail and image UI through the legacy compatibility gateway at ${width}px`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    expect(
      new URL(baseURL!).protocol,
      "The owned native HTTPS proxy requires an HTTPS frontend",
    ).toBe("https:");
    await page.setViewportSize({ width, height: 1000 });
    const source = await auxiliaryHistoryCompatibilityFixture();
    const pageErrors: string[] = [],
      responseBodies: Array<{
        path: string;
        body: any;
        data: any;
        status: number;
      }> = [],
      failed: Array<{ path: string; reason: string | null }> = [];
    const responseWork: Array<Promise<void>> = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      const path = new URL(request.url()).pathname;
      if (/\/api\/(?:cc|acp)\//.test(path))
        failed.push({ path, reason: request.failure()?.errorText ?? null });
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        !/\/api\/(?:cc\/session-messages|acp\/session)$/.test(url.pathname) ||
        url.searchParams.get("view") !== "recent"
      )
        return;
      responseWork.push(
        (async () => {
          const data = await response.json();
          responseBodies.push({
            path: url.pathname,
            body: response.request().postDataJSON(),
            data,
            status: response.status(),
          });
        })().catch(() => {}),
      );
    });
    let cleanup: unknown,
      stage = "public navigation";
    try {
      await bootstrapMetadata(page, source, provider);
      const panel =
        provider === "cc"
          ? page.locator(
              `[data-provider-transcript-owner="cc:${source.ccAlias}"]`,
            )
          : page.locator(`[data-acp-readonly-source="${source.acpId}"]`);
      await expect(panel).toBeVisible();
      const recent =
        provider === "cc"
          ? "CC_RECENT_FINAL_FROM_PRIVATE_SDK"
          : "ACP_RECENT_FINAL_FROM_PRIVATE_SQLITE";
      await expect(panel.getByText(recent, { exact: true })).toBeAttached();
      const editor = page.getByRole("textbox", {
        name: provider === "cc" ? "Message input" : "ACP 消息输入",
        exact: true,
      });
      const draft = `draft preserved for ${provider} exact input owner`;
      await editor.fill(draft);
      const events = await source.events();
      expect(
        events.events.filter(
          (event: any) =>
            event.path === "RAW_HISTORY_CALLED" ||
            event.path === "WRITE_CALLED",
        ),
      ).toEqual([]);
      await Promise.all(responseWork);
      const firstPage = responseBodies.find(
        (row) =>
          row.status === 200 &&
          row.body.session_id ===
            (provider === "cc" ? source.ccAlias : source.acpId) &&
          !row.body.cursor &&
          !row.body.metadataOnly,
      );
      expect(firstPage?.data.nextCursor).toEqual(expect.any(String));
      const cursor = firstPage!.data.nextCursor;
      const earlierName = provider === "cc" ? "加载更早消息" : "读取更早旧记录";
      stage = "public earlier page";
      await panel
        .getByRole("button", { name: earlierName, exact: true })
        .click();
      await expect
        .poll(() => source.requests.some((row) => row.body?.cursor === cursor))
        .toBe(true);
      await Promise.all(responseWork);
      await expect
        .poll(() =>
          responseBodies.some(
            (row) => row.status === 200 && row.body.cursor === cursor,
          ),
        )
        .toBe(true);
      const earlier = responseBodies.find(
        (row) => row.status === 200 && row.body.cursor === cursor,
      )!;
      expect(earlier.data.data.length).toBeGreaterThan(0);
      expect(JSON.stringify(earlier.data.data)).toContain(
        provider === "cc" ? "CC_OLDER_" : "ACP_OLDER_",
      );
      const historyViewport =
        provider === "cc"
          ? panel.locator(".thread-surface").locator("..")
          : panel.locator("[data-acp-readonly-history]");
      const olderMarker = JSON.stringify(earlier.data.data).match(
        provider === "cc"
          ? /CC_OLDER_\d+_FROM_PRIVATE_SDK/
          : /ACP_OLDER_\d+_FROM_PRIVATE_SQLITE/,
      )?.[0];
      expect(olderMarker).toBeTruthy();
      await historyViewport.hover();
      await page.mouse.wheel(0, -1_000_000);
      await expect(
        panel.getByText(olderMarker!, { exact: true }),
      ).toBeInViewport();
      if (provider === "cc") {
        for (const page of responseBodies.filter((row) => row.status === 200))
          expect(
            page.data.data.every(
              (row: any) => row.session_id === source.ccAlias,
            ),
          ).toBe(true);
      }
      await assertDraft(editor, draft);
      stage = "return to latest source rows";
      if (provider === "acp") {
        await panel
          .getByRole("button", { name: "返回最近旧记录", exact: true })
          .click();
      }
      // CC prepends earlier rows into its canonical window; the latest rows
      // remain readable by scrolling. ACP's readonly panel replaces its page.
      await historyViewport.hover();
      await page.mouse.wheel(0, 1_000_000);
      await expect(panel.getByText(recent, { exact: true })).toBeInViewport();
      const detailId =
        provider === "cc" ? source.ccItemId : source.acpToolItemId;
      const imageId =
        provider === "cc" ? source.ccItemId : source.acpImageItemId;
      const detail = panel.locator(
        `[data-provider-history-detail=${JSON.stringify(detailId)}]`,
      );
      stage = "original detail paging";
      await detail
        .getByRole("button", { name: "查看完整内容", exact: true })
        .click();
      const content = detail.getByRole("region", {
        name: "完整原始内容",
        exact: true,
      });
      await expect(content.locator("pre")).toContainText(
        provider === "cc"
          ? "CC_EXACT_LONG_ORIGINAL_FROM_PRIVATE_SDK"
          : "ACP_EXACT_LONG_ORIGINAL_FROM_PRIVATE_SQLITE",
      );
      await content
        .getByRole("button", { name: "下一部分", exact: true })
        .click();
      await expect(content).toContainText("第 2 部分");
      await expect(content.locator("pre")).toContainText(
        provider === "cc" ? "sdk-original-content" : "sqlite-original-content",
      );
      await detail
        .getByRole("button", { name: "关闭完整内容", exact: true })
        .click();
      await expect(content).toHaveCount(0);
      const imageRow = panel.locator(
        `[data-provider-history-detail=${JSON.stringify(imageId)}]`,
      );
      stage = "original source image";
      await imageRow
        .getByRole("button", { name: "查看图片", exact: true })
        .click();
      const image = imageRow.getByRole("img", {
        name: "历史图片 1",
        exact: true,
      });
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        )
        .toBe(1);
      const imageBytes = await image.evaluate(async (element) => [
        ...new Uint8Array(
          await (await fetch((element as HTMLImageElement).src)).arrayBuffer(),
        ),
      ]);
      expect(sha(Buffer.from(imageBytes))).toBe(sha(sourceImage));
      await imageRow
        .getByRole("button", { name: "关闭图片", exact: true })
        .click();
      await expect(image).toHaveCount(0);
      await assertDraft(editor, draft);

      // Delay only the owned old-runtime metadata response. Closing the real
      // detail UI must cancel through Chromium -> gateway -> loopback HTTP.
      const beforeCancel = (await source.events()).events.filter(
        (event: any) => event.path === "health-cancelled",
      ).length;
      stage = "detail cancellation reaches runtime HTTP";
      await source.holdHealth(true);
      await detail
        .getByRole("button", { name: "查看完整内容", exact: true })
        .click();
      await expect(content.getByRole("status")).toContainText(
        "正在读取完整内容",
      );
      await expect
        .poll(async () => (await source.events()).pending.length)
        .toBeGreaterThan(0);
      await detail
        .getByRole("button", { name: "关闭完整内容", exact: true })
        .click();
      await expect(content).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await source.events()).events.filter(
              (event: any) => event.path === "health-cancelled",
            ).length,
        )
        .toBeGreaterThan(beforeCancel);
      expect(
        source.requests.some(
          (row) => /session(?:-message)?-detail/.test(row.path) && row.aborted,
        ),
      ).toBe(true);
      await source.holdHealth(false);
      await detail
        .getByRole("button", { name: "查看完整内容", exact: true })
        .click();
      await expect(content.locator("pre")).toContainText(
        provider === "cc"
          ? "CC_EXACT_LONG_ORIGINAL_FROM_PRIVATE_SDK"
          : "ACP_EXACT_LONG_ORIGINAL_FROM_PRIVATE_SQLITE",
      );
      await detail
        .getByRole("button", { name: "关闭完整内容", exact: true })
        .click();
      await assertDraft(editor, draft);
      if (provider === "acp") {
        await panel
          .getByRole("button", { name: "收起旧记录", exact: true })
          .click();
        await expect(panel.locator("[data-acp-readonly-history]")).toHaveCount(
          0,
        );
        await panel
          .getByRole("button", { name: "查看旧记录", exact: true })
          .click();
        await expect(panel.getByText(recent, { exact: true })).toBeVisible();
        await assertDraft(editor, draft);
        const target = await page.evaluate(async () => {
          const path = "/src/session-mode/stores/useAcpStore.ts";
          const { useAcpStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
          const { agentId, connectionId, sessionId } = useAcpStore.getState();
          return { agentId, connectionId, sessionId };
        });
        expect(target).toEqual({
          agentId: "aux-browser-agent",
          connectionId: "aux-browser-live-connection",
          sessionId: "aux-browser-live-target",
        });
      }
      const unchanged = await source.assertSourcesUnchanged();
      await page.screenshot({
        path: info.outputPath("private-source-public-ui.png"),
      });

      // Replace only this fixture's private identity record. An established
      // reader must reject the wrong source without raw fallback or target loss.
      await source.invalidateSource();
      stage = "wrong source rejection";
      if (provider === "cc") {
        await detail
          .getByRole("button", { name: "查看完整内容", exact: true })
          .click();
        await expect(content.getByRole("alert")).toBeVisible();
      } else {
        await panel
          .getByRole("button", { name: "返回最近旧记录", exact: true })
          .click();
        await expect(panel.getByRole("alert").first()).toBeVisible();
      }
      await expect
        .poll(() => source.requests.some((row) => row.status === 501))
        .toBe(true);
      await assertDraft(editor, draft);
      const finalEvents = await source.events();
      expect(
        finalEvents.events.filter(
          (event: any) =>
            event.path === "RAW_HISTORY_CALLED" ||
            event.path === "WRITE_CALLED",
        ),
      ).toEqual([]);
      expect(
        source.requests
          .filter(
            (row) =>
              row.bytes !== undefined && row.path.includes("view=recent"),
          )
          .every((row) => row.bytes! <= 2 * 1024 * 1024),
      ).toBe(true);
      expect(pageErrors).toEqual([]);
      stage = "complete";
      await Promise.all(responseWork);
      await writeFile(
        info.outputPath("source-to-browser-evidence.json"),
        JSON.stringify(
          {
            provider,
            width,
            provenance: source.provenance,
            unchanged,
            cursor,
            historyPages: responseBodies.map(
              ({ path, body, data, status }) => ({
                path,
                body,
                status,
                nextCursor: data.nextCursor,
                rows: data.data?.length,
                projection: data.projection,
              }),
            ),
            gatewayRequests: source.requests,
            httpsProxyRequests: source.proxyRequests,
            runtimeEvents: finalEvents,
            browserFailures: failed,
            pageErrors,
            actualImageSha256: sha(Buffer.from(imageBytes)),
            automaticRawCalls: 0,
            nativeWrites: 0,
            sourceMismatchRejected: true,
            draftPreserved: true,
            metadataBootstrap:
              "Workspace/preferences and empty ACP live target identity only; all displayed history, full detail, image bytes and cursors came from actual private files through the compiled candidate gateway.",
          },
          null,
          2,
        ),
      );
    } finally {
      cleanup = await source.close();
      await writeFile(
        info.outputPath("owned-fixture-cleanup.json"),
        JSON.stringify(
          {
            cleanup,
            provenance: source.provenance,
            gatewayRequests: source.requests,
            pageErrors,
            stage,
          },
          null,
          2,
        ),
      );
    }
  });
}

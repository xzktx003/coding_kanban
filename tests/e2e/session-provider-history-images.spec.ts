import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

const original = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
for (const provider of ["cc", "acp"] as const)
  for (const [width, deferredScope] of [
    [1440, false],
    [393, false],
    [1440, true],
    [393, true],
  ] as const) {
    test(`${provider} cropped images preview, download and release the exact source at ${width}px${deferredScope ? " with account change during module loading" : ""}`, async ({
      page,
      baseURL,
    }, info) => {
      await page.setViewportSize({ width, height: 852 });
      const errors: string[] = [],
        reads: unknown[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installSessionUxFixture(page, 0);
      const sessionId = `image-${provider}`,
        itemId = "original-large-user-image";
      const historyImages = [
        { index: 0, mimeType: "image/png" },
        { index: 1, mimeType: "image/png" },
      ];
      const sdk = [
        {
          type: "user",
          uuid: itemId,
          session_id: sessionId,
          truncated: true,
          historyDetail: { itemId },
          historyImages,
          message: {
            role: "user",
            content: [
              { type: "text", text: "Original image attachment preview" },
            ],
          },
        },
      ];
      const entries = [
        {
          id: itemId,
          role: "user",
          text: "Original image attachment preview",
          truncated: true,
          historyDetail: { itemId },
          historyImages,
        },
      ];
      await page.route(
        /\/api\/session\/api\/(?:cc\/session-messages|acp\/session)(?:\?.*)?$/,
        (route) =>
          route.fulfill({
            json: {
              data: provider === "cc" ? sdk : entries,
              nextCursor: null,
              revision: "stable-revision",
              truncated: true,
              projection: provider === "cc" ? "cc-messages" : "acp-entries",
              metadata: {},
            },
          }),
      );
      await page.route(
        /\/api\/session\/api\/(?:cc\/session-message-image|acp\/session-image)$/,
        async (route) => {
          reads.push(route.request().postDataJSON());
          await route.fulfill({
            body: original,
            contentType: "image/png",
            headers: {
              "x-history-image-width": "1",
              "x-history-image-height": "1",
              "x-history-image-revision": createHash("sha256")
                .update(original)
                .digest("hex"),
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        },
      );
      const stream = await liveStream(page, baseURL!);
      try {
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await expect(
          page.locator(".session-mode [contenteditable=true]").first(),
        ).toBeVisible();
        await page.evaluate(
          async ({ provider, sessionId, sdk, entries }) => {
            const load = (path: string) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((entry) => new URL(entry.name).pathname === path)
                  ?.name ?? path
              );
            const [
              { useAgentSettingsStore },
              { useAgentCenterStore },
              { useCCStore },
              { useAcpStore },
              { fromSdkMessages },
            ] = await Promise.all([
              load("/src/session-mode/stores/useAgentSettingsStore.ts"),
              load("/src/session-mode/stores/useAgentCenterStore.ts"),
              load("/src/session-mode/stores/cc/index.ts"),
              load("/src/session-mode/stores/useAcpStore.ts"),
              load("/src/session-mode/components/cc/utils/fromSdkMessages.ts"),
            ]);
            useAgentCenterStore.setState({
              cards:
                provider === "cc"
                  ? [
                      {
                        kind: "cc",
                        id: sessionId,
                        cwd: "/fixture/images",
                        preview: "Image source",
                      },
                    ]
                  : [],
              currentAgentCardId: provider === "cc" ? sessionId : null,
              currentAgentCardKind: provider === "cc" ? "cc" : null,
              cardsViewMode: "solo",
            });
            useAgentSettingsStore.setState({
              selectedAgent: provider === "cc" ? "cc" : "codex",
            });
            if (provider === "cc") {
              useAcpStore.setState({ active: false });
              const messages = fromSdkMessages(sdk, sessionId);
              useCCStore.setState({
                activeSessionId: sessionId,
                messages,
                sessionMessagesMap: { [sessionId]: messages },
                isLoading: false,
              });
            } else
              useAcpStore.setState({
                active: true,
                agentId: "image-fixture",
                connectionId: "image-connection",
                sessionId,
                entries,
                running: false,
                connecting: false,
              });
          },
          { provider, sessionId, sdk, entries },
        );
        const editor = page.getByRole("textbox", {
          name: provider === "cc" ? "Message input" : "ACP 消息输入",
          exact: true,
        });
        await editor.fill("image owner draft is preserved");
        await expect(page.getByRole("button", { name: "查看图片", exact: true })).toBeVisible();
        const confirmSource = page.getByRole("button", { name: "重新核对来源", exact: true });
        if (await confirmSource.isVisible()) {
          await confirmSource.click();
          await expect(page.getByRole("button", { name: "查看图片", exact: true })).toBeEnabled();
        }
        let releaseModule: (() => void) | undefined;
        let moduleRequested: Promise<void> | undefined;
        let initialScopeRevision = 0;
        if (deferredScope) {
          let requested!: () => void;
          moduleRequested = new Promise<void>((resolve) => {
            requested = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            releaseModule = resolve;
          });
          await page.route(
            "**/src/session-mode/components/history/ProviderHistoryImageReader.tsx*",
            async (route) => {
              requested();
              await gate;
              await route.continue();
            },
          );
          initialScopeRevision = await page.evaluate(async () => {
            const path = "/src/session-mode/services/codexOperationScope.ts";
            const module = await import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
            return module.captureCodexOperationScope().revision;
          });
        }
        expect(reads).toEqual([]);
        await writeFile(info.outputPath("preview-source-confirmation.json"), JSON.stringify(await page.evaluate(async ({ provider, sessionId, itemId }) => {
          const load = (path: string) => import(performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
          const [{ readProviderHistoryConfirmation }, { captureCodexOperationScope }, { isHistorySourceScopeCurrent }, { useCCStore }, { useAcpStore }] = await Promise.all([
            load("/src/session-mode/services/providerHistorySourceConfirmation.ts"), load("/src/session-mode/services/codexOperationScope.ts"), load("/src/session-mode/components/history/historySourceScope.ts"), load("/src/session-mode/stores/cc/index.ts"), load("/src/session-mode/stores/useAcpStore.ts"),
          ]);
          const state = provider === "cc" ? useCCStore.getState() : useAcpStore.getState();
          const row = provider === "cc" ? state.sessionMessagesMap[sessionId]?.[0] : state.entries[0];
          const owner = provider === "cc" ? `cc:${sessionId}` : JSON.stringify(["acp", state.agentId ?? null, state.connectionId ?? null, state.sessionId]);
          const proof = row && readProviderHistoryConfirmation(row, { provider, sourceId: state.historySessionId ?? sessionId, itemId, owner });
          return { hasRow: !!row, hasProof: !!proof, sourceCurrent: proof ? isHistorySourceScopeCurrent(proof.scope) : null, proofOperation: proof?.scope.operation, currentOperation: captureCodexOperationScope(), owner };
        }, { provider, sessionId, itemId }), null, 2));
        await page
          .getByRole("button", { name: "查看图片", exact: true })
          .click();
        if (deferredScope) {
          await moduleRequested;
          stream.emit(1, {
            method: "account/updated",
            params: { authMode: null, planType: null },
          });
          await expect
            .poll(() =>
              page.evaluate(async () => {
                const path =
                  "/src/session-mode/services/codexOperationScope.ts";
                const module = await import(
                  performance
                    .getEntriesByType("resource")
                    .findLast((entry) => new URL(entry.name).pathname === path)
                    ?.name ?? path
                );
                return module.captureCodexOperationScope().revision;
              }),
            )
            .toBeGreaterThan(initialScopeRevision);
          releaseModule!();
          await expect(
            page.getByRole("button", { name: "查看图片", exact: true }),
          ).toHaveAttribute("aria-expanded", "false");
          expect(reads).toEqual([]);
          expect(
            await editor.evaluate((element) =>
              element instanceof HTMLTextAreaElement
                ? element.value
                : element.textContent,
            ),
          ).toContain("image owner draft is preserved");
          expect(errors).toEqual([]);
          await writeFile(
            info.outputPath("deferred-source-revoked.json"),
            JSON.stringify(
              {
                provider,
                width,
                reads,
                accountChangedDuringModuleLoad: true,
                oldSourceDidNotReadWithNewScope: true,
                boundary:
                  "Actual lazy module blocked in browser, same-value notification processed before module release; isolated readonly binary route must receive zero requests.",
              },
              null,
              2,
            ),
          );
          return;
        }
        const image = page.getByRole("img", {
          name: "历史图片 1",
          exact: true,
        });
        await expect(image).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate(
              (element) => (element as HTMLImageElement).naturalWidth,
            ),
          )
          .toBe(1);
        const firstUrl = await image.getAttribute("src");
        expect(reads).toEqual([
          { session_id: sessionId, item_id: itemId, image_index: 0 },
        ]);
        const downloadEvent = page.waitForEvent("download");
        await page.getByRole("link", { name: "下载原图", exact: true }).click();
        const download = await downloadEvent;
        await download.saveAs(info.outputPath("exact-original.png"));
        expect(await readFile(info.outputPath("exact-original.png"))).toEqual(
          original,
        );
        expect(reads).toHaveLength(1);
        await page.getByRole("button", { name: "下一张", exact: true }).click();
        const secondImage = page.getByRole("img", {
          name: "历史图片 2",
          exact: true,
        });
        await expect
          .poll(() =>
            secondImage.evaluate(
              (element) => (element as HTMLImageElement).naturalWidth,
            ),
          )
          .toBe(1);
        const secondUrl = await secondImage.getAttribute("src");
        expect(secondUrl).not.toBe(firstUrl);
        expect(
          await page.evaluate(async (url) => {
            try {
              await fetch(url!);
              return false;
            } catch {
              return true;
            }
          }, firstUrl),
        ).toBe(true);
        expect(reads).toEqual([
          { session_id: sessionId, item_id: itemId, image_index: 0 },
          { session_id: sessionId, item_id: itemId, image_index: 1 },
        ]);
        await page.screenshot({
          path: info.outputPath("original-image-preview.png"),
        });
        await page
          .getByRole("button", { name: "关闭图片", exact: true })
          .click();
        await expect(
          page.getByRole("region", { name: "历史原图", exact: true }),
        ).toHaveCount(0);
        expect(
          await page.evaluate(async (url) => {
            try {
              await fetch(url!);
              return false;
            } catch {
              return true;
            }
          }, secondUrl),
        ).toBe(true);
        await page
          .getByRole("button", { name: "查看图片", exact: true })
          .click();
        await expect(
          page.getByRole("img", { name: "历史图片 1", exact: true }),
        ).toBeVisible();
        const scopeUrl = await page
          .getByRole("img", { name: "历史图片 1", exact: true })
          .getAttribute("src");
        stream.emit(1, {
          method: "account/updated",
          params: { authMode: null, planType: null },
        });
        await expect(
          page.getByRole("region", { name: "历史原图", exact: true }),
        ).toHaveCount(0);
        expect(
          await page.evaluate(async (url) => {
            try {
              await fetch(url!);
              return false;
            } catch {
              return true;
            }
          }, scopeUrl),
        ).toBe(true);
        expect(
          await editor.evaluate((element) =>
            element instanceof HTMLTextAreaElement
              ? element.value
              : element.textContent,
          ),
        ).toContain("image owner draft is preserved");
        expect(errors).toEqual([]);
        await writeFile(
          info.outputPath("image-source-proof.json"),
          JSON.stringify(
            {
              provider,
              width,
              reads,
              sha256: createHash("sha256").update(original).digest("hex"),
              decodedNaturalWidth: 1,
              downloadedOriginalBytes: original.length,
              objectUrlsReleased: true,
              sameValueAccountRevokedBlob: true,
              boundary:
                "Real Workbench/UI/native Blob decoding/download against isolated binary HTTP routes; backend exact source/magic/limits validated separately.",
            },
            null,
            2,
          ),
        );
      } finally {
        await stream.close();
      }
    });
  }

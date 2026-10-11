import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { writeFile } from "node:fs/promises";
import { CodexService } from "../../packages/session-runtime/src/codex/client";
import { EventHub } from "../../packages/session-runtime/src/core/events";
import { registerCodexRoutes } from "../../packages/session-runtime/src/codex/routes";
import { registerEventRoutes } from "../../packages/session-runtime/src/transport/events";
import type { Json } from "../../packages/session-runtime/src/core/json";
import { setup } from "./session-composer-v2-fixture";

for (const width of [390, 700])
  for (const theme of ["dark", "light"])
    test(`GitHub PR production transport over native HTTP and EventSource (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      const f = await setup(page, false),
        app = Fastify(),
        hub = new EventHub();
      const service = new CodexService({
        hub,
        instance: "isolated-github-browser",
        sweepIntervalMs: 0,
      });
      const calls: { method: string; params: Json }[] = [],
        bytes: number[] = [];
      let account = "a",
        threadCount = 0,
        held: (() => void) | null = null,
        started: (() => void) | null = null,
        hold = false;
      Object.assign(service, {
        raw: async (method: string, params: Json): Promise<Json> => {
          calls.push({ method, params });
          if (method === "account/read")
            return {
              account: { type: "chatgpt", email: "fixture@example.invalid" },
              workspaceRouting: {
                chatgptAccountId: account,
                backendOrigin: "https://fixture.invalid",
                accountRoutingOverride: "NO_CONSTRAINT",
              },
            };
          if (method === "mcpServerStatus/list")
            return {
              data: [
                {
                  name: "codex_apps",
                  tools: Object.fromEntries(
                    ["get_pr_info", "fetch"].map((action) => [
                      "github." + action,
                      {
                        name: "github." + action,
                        _meta: {
                          connector_name: "GitHub",
                          connector_id: "github",
                          _codex_apps: {
                            resource_uri: `/github/primary/${action}`,
                          },
                        },
                      },
                    ]),
                  ),
                },
              ],
              nextCursor: null,
            };
          if (method === "thread/start") {
            const thread = {
              id: `private-github-${++threadCount}`,
              source: "vscode",
              name: null,
              preview: "",
              cwd: "/fixture/project",
              createdAt: 1,
              updatedAt: 1,
              modelProvider: "openai",
              status: { type: "idle" },
              turns: [],
            };
            hub.publish("codex:notification", {
              method: "thread/started",
              params: { thread },
            });
            return { thread };
          }
          if (method === "thread/unsubscribe") {
            hub.publish("codex:notification", {
              method: "thread/closed",
              params: { threadId: (params as any).threadId },
            });
            return {};
          }
          if (method === "mcpServer/tool/call") {
            const captured = account;
            if (hold) {
              hold = false;
              started?.();
              await new Promise<void>((resolve) => (held = resolve));
            }
            return {
              structuredContent: {
                content: JSON.stringify({
                  base: { ref: "main" },
                  head: { ref: "fix", sha: "abc", repo: null },
                  draft: false,
                  merged: captured === "b",
                  state: captured === "b" ? "closed" : "open",
                  number: 42,
                  title:
                    captured === "a"
                      ? "Fix routing"
                      : captured === "b"
                        ? "Merge routing"
                        : "Old account",
                  html_url: "https://github.com/OpenAI/Codex/pull/42",
                  body: "x".repeat(200000),
                  user: { login: "fixture", name: "private@example.invalid" },
                }),
              },
            };
          }
          throw new Error("Unexpected isolated preview RPC " + method);
        },
      });
      try {
        await app.register(websocket);
        app.addHook("onRequest", async (_request, reply) => {
          reply.raw.setHeader("Access-Control-Allow-Origin", "*");
        });
        app.options("/*", (_request, reply) =>
          reply
            .header(
              "Access-Control-Allow-Headers",
              "Content-Type, Authorization",
            )
            .header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            .send(),
        );
        registerCodexRoutes(app, service);
        registerEventRoutes(app, hub);
        app.addHook("onSend", async (request, _reply, payload) => {
          if (request.url.endsWith("/read") && typeof payload === "string")
            bytes.push(Buffer.byteLength(payload));
          return payload;
        });
        await app.listen({ host: "0.0.0.0", port: 0 });
        const address = app.server.address();
        if (!address || typeof address === "string")
          throw new Error("Missing fixture listener");
        const host = new URL(process.env.PLAYWRIGHT_BASE_URL!).hostname,
          origin = `http://${host}:${address.port}`;
        // Preserve browser fetch/EventSource; rewrite only the isolated endpoints
        // to a real server running the production route handlers.
        await page.route(
          "**/api/session/api/codex/mcp/github-preview/**",
          (route) =>
            route.continue({
              url:
                origin +
                new URL(route.request().url()).pathname.replace(
                  "/api/session",
                  "",
                ),
            }),
        );
        await page.route("**/api/session/api/events?*", (route) =>
          route.continue({
            url: origin + "/api/events" + new URL(route.request().url()).search,
          }),
        );
        await page.evaluate(
          (theme) =>
            localStorage.setItem(
              "kanban.session.theme-storage",
              JSON.stringify({
                version: 1,
                state: { theme, accent: "default" },
              }),
            ),
          theme,
        );
        await page.reload();
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor();
        await page.evaluate(async () => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const w = window as any,
            rm = await import(w.__sessionFixtureDependency("react.js")),
            dm = await import(
              w.__sessionFixtureDependency("react-dom_client.js")
            ),
            R = rm.default ?? rm;
          const { NativeGithubPreview, NativeGithubPreviewHost } = await module(
            "/src/session-mode/components/codex/presentation/NativeGithubPreview.tsx",
          );
          const c = document.createElement("div");
          c.style.cssText = "position:fixed;left:16px;top:16px;z-index:100";
          document.querySelector(".session-mode")!.append(c);
          w.githubHttpRoot = (dm.default ?? dm).createRoot(c);
          w.renderGithubGate = (enabled: boolean) =>
            w.githubHttpRoot.render(
              R.createElement(
                NativeGithubPreviewHost.Provider,
                { value: { enabled } },
                R.createElement(
                  NativeGithubPreview,
                  { href: "https://github.com/OpenAI/Codex/pull/42/files" },
                  R.createElement(
                    "a",
                    { href: "https://github.com/OpenAI/Codex/pull/42/files" },
                    "Review PR",
                  ),
                ),
              ),
            );
          w.renderGithubGate(false);
        });
        const profile = page.getByRole("link", {
          name: "Review PR",
          exact: true,
        });
        await profile.focus();
        await expect(page.locator(".codex-native-github-preview")).toHaveCount(
          0,
        );
        expect(calls).toEqual([]);
        await profile.evaluate((e) => (e as HTMLElement).blur());
        await page.evaluate(async () => {
          (window as any).renderGithubGate(true);
          await new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          );
        });
        await profile.focus();
        await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
          "Fix routing",
        );
        await expect(page.getByRole("tooltip").locator("p")).toHaveText(
          "OpenAI/Codex · #42 · 已打开",
        );
        await page.screenshot({
          path: info.outputPath("github-http-open.png"),
        });
        await page.keyboard.press("Escape");
        await profile.evaluate((e) => (e as HTMLElement).blur());
        await profile.focus();
        await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
          "Fix routing",
        );
        expect(
          calls.filter((c) => c.method === "mcpServer/tool/call"),
        ).toHaveLength(1);
        expect(threadCount).toBe(1);
        await expect(page.getByRole("tab", { name: /^中文会话/ })).toHaveCount(
          2,
        );
        await expect(
          page.getByRole("tab", { name: /^中文会话 0/ }),
        ).toHaveAttribute("aria-selected", "true");
        if (width === 700 && theme === "dark") {
          await page.evaluate(async () => {
            const path = "/src/session-mode/lib/i18n.ts";
            const { i18n } = await import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
            await i18n.changeLanguage("en");
          });
          await expect(
            page.locator(".codex-native-github-preview").locator("p"),
          ).toHaveText("OpenAI/Codex · #42 · Open");
          await page.screenshot({
            path: info.outputPath("github-http-locale-en.png"),
          });
          expect(
            calls.filter((c) => c.method === "mcpServer/tool/call"),
          ).toHaveLength(1);
          await page.evaluate(async () => {
            const path = "/src/session-mode/lib/i18n.ts";
            const { i18n } = await import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
            await i18n.changeLanguage("zh");
          });
          await expect(
            page.locator(".codex-native-github-preview").locator("p"),
          ).toHaveText("OpenAI/Codex · #42 · 已打开");

          await page.keyboard.press("Escape");
          // Switch account through the actual HTTP EventSource, while an old
          // request is held by the isolated native-protocol fixture.
          account = "old-inflight";
          service.githubPreviews.observe("account/updated");
          hold = true;
          const sent = new Promise<void>((resolve) => (started = resolve));
          hub.publish("codex:notification", {
            method: "account/updated",
            params: { authMode: "chatgpt" },
          });
          await profile.evaluate((element) => (element as HTMLElement).blur());
          await profile.focus();
          await sent;
          account = "b";
          service.githubPreviews.observe("account/updated");
          hub.publish("codex:notification", {
            method: "account/updated",
            params: { authMode: "chatgpt" },
          });
          await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
            "Merge routing",
          );
          expect(
            calls
              .filter((c) => c.method === "thread/unsubscribe")
              .some((c) => (c.params as any).threadId === "private-github-2"),
          ).toBe(false);
          held?.();
          held = null;
          await expect
            .poll(() =>
              calls
                .filter((c) => c.method === "thread/unsubscribe")
                .some((c) => (c.params as any).threadId === "private-github-2"),
            )
            .toBe(true);
          await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
            "Merge routing",
          );
          await page.screenshot({
            path: info.outputPath("github-http-account-change.png"),
          });
          await expect(page.getByRole("tooltip").locator("p")).toHaveText(
            "OpenAI/Codex · #42 · 已合并",
          );
        }
        expect(bytes.length).toBeGreaterThan(0);
        expect(bytes.every((value) => value < 1000)).toBe(true);
        expect(
          calls.filter((c) =>
            /^(?:turn\/|thread\/(?:resume|rollback|delete))/u.test(c.method),
          ),
        ).toEqual([]);
        expect(
          calls
            .filter((c) => c.method === "mcpServer/tool/call")
            .every((c) =>
              String((c.params as any).threadId).startsWith("private-github-"),
            ),
        ).toBe(true);
        expect(f.calls).toEqual([]);
        expect(f.errors).toEqual([]);
        await writeFile(
          info.outputPath("transport-evidence.json"),
          JSON.stringify(
            {
              origin,
              bytes,
              toolCalls: calls
                .filter((c) => c.method === "mcpServer/tool/call")
                .map((c) => c.params),
              threadCount,
              boundary:
                "Native browser HTTP/EventSource and production handlers; account/catalog/tool results are an isolated protocol fixture, not remote GitHub.",
            },
            null,
            2,
          ),
        );
      } finally {
        held?.();
        hub.close();
        await app.close();
        await service.close();
        await f.close();
      }
    });

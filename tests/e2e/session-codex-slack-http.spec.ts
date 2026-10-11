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
    test(`Slack production transport over native HTTP and EventSource (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      const f = await setup(page, false),
        app = Fastify(),
        hub = new EventHub();
      const service = new CodexService({
        hub,
        instance: "isolated-slack-browser",
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
                    ["slack_read_user_profile", "slack_read_thread"].map(
                      (action) => [
                        action,
                        {
                          name: action,
                          _meta: {
                            connector_name: "Slack",
                            connector_id: "slack",
                            _codex_apps: {
                              resource_uri: `/slack/workspace/${action}`,
                            },
                          },
                        },
                      ],
                    ),
                  ),
                },
              ],
              nextCursor: null,
            };
          if (method === "thread/start") {
            const thread = {
              id: `private-slack-${++threadCount}`,
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
            if ((params as any).tool === "slack_read_user_profile")
              return {
                isError: false,
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      result: `User ID: U123\nReal Name: ${captured === "a" ? "Alice" : captured === "b" ? "Bob" : "Old account"}\nTitle: ${"Engineer ".repeat(900)}\nEmail: private@example.invalid`,
                    }),
                  },
                ],
              };
            return {
              structuredContent: {
                slack_data: {
                  schema_version: 1,
                  ok: true,
                  channel_id: "C123",
                  message_ts: "1700000000.000000",
                  messages: [
                    { ts: "1700000000.000000", text: "Wrong root" },
                    {
                      ts: "1700000000.000001",
                      text: "Review <https://example.invalid|release> &amp; preserve the running Agent.",
                    },
                  ],
                },
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
          "**/api/session/api/codex/mcp/slack-preview/**",
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
        f.fixture.threads[0].turns = [
          {
            id: "slack-http",
            status: "completed",
            items: [
              {
                type: "agentMessage",
                id: "slack-http-message",
                text: "[Slack profile](https://team.slack.com/team/U123)\n\n[Slack reply](https://team.slack.com/archives/C123/p1700000000000001?thread_ts=1700000000.000000)",
                phase: "final_answer",
              },
            ],
          },
        ] as never;
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
        const profile = page.getByRole("link", {
            name: "Slack profile",
            exact: true,
          }),
          reply = page.getByRole("link", { name: "Slack reply", exact: true });
        await profile.focus();
        await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
          "Alice",
        );
        await expect(page.getByRole("tooltip").locator("p")).toHaveText(
          "Engineer ".repeat(900).slice(0, 300),
        );
        await page.screenshot({
          path: info.outputPath("slack-http-profile.png"),
        });
        await page.keyboard.press("Escape");
        await profile.evaluate((element) => (element as HTMLElement).blur());
        await profile.focus();
        await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
          "Alice",
        );
        expect(
          calls.filter((c) => c.method === "mcpServer/tool/call"),
        ).toHaveLength(1);
        await page.keyboard.press("Escape");
        await reply.focus();
        await expect(page.getByRole("tooltip").locator("p")).toHaveText(
          "Review release & preserve the running Agent.",
        );
        await page.screenshot({
          path: info.outputPath("slack-http-reply.png"),
        });
        expect(threadCount).toBe(1);
        await expect(page.getByRole("tab", { name: /^中文会话/ })).toHaveCount(
          2,
        );
        await expect(
          page.getByRole("tab", { name: /^中文会话 0/ }),
        ).toHaveAttribute("aria-selected", "true");
        if (width === 700 && theme === "dark") {
          await page.keyboard.press("Escape");
          // Switch account through the actual HTTP EventSource, while an old
          // request is held by the isolated native-protocol fixture.
          account = "old-inflight";
          service.slackPreviews.observe("account/updated");
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
          service.slackPreviews.observe("account/updated");
          hub.publish("codex:notification", {
            method: "account/updated",
            params: { authMode: "chatgpt" },
          });
          await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
            "Bob",
          );
          expect(
            calls
              .filter((c) => c.method === "thread/unsubscribe")
              .some((c) => (c.params as any).threadId === "private-slack-2"),
          ).toBe(false);
          held?.();
          held = null;
          await expect
            .poll(() =>
              calls
                .filter((c) => c.method === "thread/unsubscribe")
                .some((c) => (c.params as any).threadId === "private-slack-2"),
            )
            .toBe(true);
          await expect(page.getByRole("tooltip").locator("h3")).toHaveText(
            "Bob",
          );
          await page.screenshot({
            path: info.outputPath("slack-http-account-change.png"),
          });
        }
        expect(bytes.length).toBeGreaterThan(1);
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
              String((c.params as any).threadId).startsWith("private-slack-"),
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
                "Native browser HTTP/EventSource and production handlers; account/catalog/tool results are an isolated protocol fixture, not remote Slack.",
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

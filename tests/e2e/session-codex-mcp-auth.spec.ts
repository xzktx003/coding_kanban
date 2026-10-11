import { test, expect, type Page } from "@playwright/test";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setup } from "./session-composer-v2-fixture";
import { nativeNotifications } from "./session-native-notifications-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const frontNotice =
  '._toast_zsre1_1[data-sonner-toast][data-front="true"],.codex-native-sonner-toaster [data-sonner-toast][data-front="true"]';
async function compareCardPixels(
  product: Page,
  native: Page,
  info: any,
  state: string,
) {
  const images = [];
  for (const [name, page] of [
    ["native", native],
    ["product", product],
  ] as const) {
    // Match the surrounding paint behind transparent screenshot edge pixels.
    // Native reference text and this app's own navigation otherwise intersect the card crop.
    await page.evaluate(() => {
      const backdrop = document.createElement("div");
      backdrop.id = "notice-pixel-backdrop";
      backdrop.style.cssText =
        "position:fixed;inset:0;background:#20211d;z-index:59;pointer-events:none";
      document.body.append(backdrop);
    });
    images.push(
      (
        await page
          .locator(frontNotice)
          .locator(".alert-root,.codex-native-alert")
          .screenshot({ path: info.outputPath(`${name}-${state}-card.png`) })
      ).toString("base64"),
    );
    await page.evaluate(() =>
      document.getElementById("notice-pixel-backdrop")?.remove(),
    );
  }
  const result = await product.evaluate(async (images) => {
    const decoded = await Promise.all(
      images.map(async (bytes) => {
        const image = new Image();
        image.src = "data:image/png;base64," + bytes;
        await image.decode();
        return image;
      }),
    );
    const [a, b] = decoded;
    if (a.width !== b.width || a.height !== b.height)
      throw Error("Card dimensions differ");
    const read = (image: HTMLImageElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height).data;
    };
    const first = read(a),
      second = read(b);
    let changed = 0,
      maxChannel = 0;
    for (let y = 0; y < a.height; y++)
      for (let x = 0; x < a.width; x++) {
        // Transparent rounded corners expose each workbench's different surrounding UI.
        if ((x < 16 || x >= a.width - 16) && (y < 16 || y >= a.height - 16))
          continue;
        const index = (y * a.width + x) * 4;
        let difference = false;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs(first[index + c] - second[index + c]);
          if (d) difference = true;
          maxChannel = Math.max(maxChannel, d);
        }
        if (difference) changed++;
      }
    return { width: a.width, height: a.height, changed, maxChannel };
  }, images);
  await writeFile(
    info.outputPath(`${state}-pixels.json`),
    JSON.stringify(result, null, 2),
  );
  expect(result.changed).toBe(0);
}
async function wire(page: Page) {
  const clients = new Set<ServerResponse>();
  const network: any[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/events"))
      network.push({ request: request.url() });
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/events"))
      network.push({ response: response.url(), status: response.status() });
  });
  page.on("requestfailed", (request) =>
    network.push({
      path: new URL(request.url()).pathname,
      error: request.failure()?.errorText,
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      network.push({ console: message.text().slice(0, 500) });
  });
  let seq = 1;
  const upstream = createServer((_r, res) => {
    network.push({ upstream: _r.url });
    if (!_r.url?.startsWith("/api/events")) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    res.flushHeaders();
    res.write(": connected\n\n");
    clients.add(res);
    res.on("close", () => clients.delete(res));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(upstream.address() as any).port}`;
  const root = await mkdtemp(join(tmpdir(), "mcp-auth-browser-"));
  const gateway = spawn(
    "pnpm",
    [
      "--filter",
      "web",
      "exec",
      "tsx",
      resolve(__dirname, "helpers/session-mcp-auth-gateway.mts"),
      origin,
      root,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let gatewayPid = 0;
  let diagnostics = "";
  gateway.stderr.on("data", (chunk) => {
    diagnostics += chunk;
    network.push({ gateway: String(chunk).slice(0, 1000) });
  });
  const lines = createInterface({ input: gateway.stdout });
  const gatewayOrigin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture gateway timeout: " + diagnostics)),
      15000,
    );
    lines.on("line", (line) => {
      try {
        const value = JSON.parse(line);
        if (value.origin) {
          gatewayPid = value.pid;
          clearTimeout(timer);
          resolve(value.origin);
        }
      } catch {
        diagnostics += line;
      }
    });
    gateway.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Fixture gateway exited " + code + ": " + diagnostics));
    });
  });
  await page.addInitScript((gateway) => {
    (window as any).authFrames = [];
    (window as any).authSources = [];
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        const u = new URL(String(url), location.href);
        const endpoint = new URL(gateway);
        endpoint.hostname = location.hostname;
        super(
          u.pathname.endsWith("/api/events")
            ? endpoint.origin + u.pathname + u.search
            : url,
          options,
        );
        (window as any).authSources.push({ path: u.pathname, url: this.url });
        (window as any).authCurrent = this;
        this.addEventListener("message", (message: any) => {
          const data = JSON.parse(message.data),
            w = window as any;
          w.authFrames.push({
            seq: data.seq,
            method: data.payload?.method,
            chars: message.data.length,
            result: data.payload?.params?.item?.result ?? null,
            challenge:
              data.payload?.params?.item?.nativeMcpAuthChallenge ?? null,
          });
          w.authFrames.splice(0, Math.max(0, w.authFrames.length - 10));
        });
        this.addEventListener("error", () => {
          (window as any).authSources.push({
            error: this.url,
            state: this.readyState,
          });
        });
        this.addEventListener("open", () => {
          (window as any).authSources.push({ open: this.url });
        });
      }
    };
  }, gatewayOrigin);
  return {
    network,
    origin: gatewayOrigin,
    allow: () =>
      page.route(
        (url) => url.port === new URL(gatewayOrigin).port,
        (route) => route.continue(),
      ),
    connected: () => clients.size,
    send(method: string, params: any) {
      const frame = `data: ${JSON.stringify({ seq: seq++, event: "codex:notification", payload: { method, params } })}\n\n`;
      for (const c of clients) c.write(frame);
      return Buffer.byteLength(frame);
    },
    async close() {
      for (const c of clients) c.end();
      upstream.closeAllConnections();
      if (gatewayPid) process.kill(gatewayPid, "SIGTERM");
      else gateway.kill("SIGTERM");
      gateway.kill("SIGTERM");
      lines.close();
      await new Promise<void>((r) => {
        if (gateway.exitCode !== null) {
          r();
          return;
        }
        const timer = setTimeout(() => {
          gateway.kill("SIGKILL");
          r();
        }, 3000);
        gateway.once("exit", () => {
          clearTimeout(timer);
          r();
        });
      });
      await new Promise<void>((r) => upstream.close(() => r()));
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function measure(page: Page) {
  return page
    .locator(
      '._toast_zsre1_1[data-sonner-toast][data-front="true"],.codex-native-sonner-toaster [data-sonner-toast][data-front="true"]',
    )
    .evaluate((e) => {
      const card = e.querySelector(".alert-root,.codex-native-alert")!;
      return [card, ...card.querySelectorAll("button,svg")].map((n) => {
        const s = getComputedStyle(n),
          r = n.getBoundingClientRect();
        return {
          tag: n.tagName,
          text: n.tagName === "svg" ? null : n.textContent,
          rect: [r.x, r.y, r.width, r.height],
          font: s.font,
          bg: s.backgroundColor,
          color: s.color,
          border: s.border,
          radius: s.borderRadius,
          corner: s.getPropertyValue("corner-shape"),
          padding: s.padding,
          paths: [...n.querySelectorAll("path")].map((p) =>
            p.getAttribute("d"),
          ),
        };
      });
    });
}
async function settle(page: Page) {
  await expect
    .poll(() =>
      page
        .locator(
          '._toast_zsre1_1[data-sonner-toast][data-front="true"],.codex-native-sonner-toaster [data-sonner-toast][data-front="true"]',
        )
        .evaluate((e) => e.getBoundingClientRect().y),
    )
    .toBe(8);
}
async function goldenMcp(page: Page, loading = false) {
  await page.evaluate(async (loading) => {
    const Auth = await import(
        /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
      ),
      R = (window as any).nativeModules.React;
    Auth.ZBt().closeAll();
    Auth.ZBt().custom({
      level: "warning",
      duration: 0,
      content: ({ close }: any) =>
        R.createElement(Auth.$K, {
          title: "重新连接 MCP 服务器“fixture-mcp”",
          description: "身份验证已过期。请重新连接以继续使用此 MCP 服务器",
          level: "warning",
          onClose: close,
          primaryAction: { label: "重新连接", loading, onClick: () => {} },
        }),
    });
  }, loading);
  await settle(page);
}
for (const theme of ["dark", "light"])
  for (const width of [390, 700])
    test(`MCP startup prompt, pending OAuth and completion ${width} ${theme}`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Unchanged native card required");
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 844 });
      const stream = await wire(page);
      let f;
      try {
        f = await setup(page, false, async () => {
          await stream.allow();
          await page.route("**/api/session/api/codex/config/read", (r) =>
            r.fulfill({
              json: {
                config: { desktop: { mcp_startup_authentication: true } },
              },
            }),
          );
          await page.route("**/api/session/health", (r) =>
            r.fulfill({
              json: {
                status: "ok",
                instance: "ux-fixture",
                capabilities: {
                  codexMcpAuthV1: true,
                  codexMcpOAuthThreadId: true,
                },
              },
            }),
          );
        });
      } catch (error) {
        await stream.close();
        throw error;
      }
      await stream.allow();
      const native = await page.context().newPage();
      native.on("pageerror", (e) => f.errors.push("Native: " + e.message));
      let release!: () => void;
      const requests: any[] = [];
      let reloads = 0;
      try {
        if (theme === "light")
          await page.getByRole("button", { name: "切换为浅色模式" }).click();
        await page.route("**/api/session/api/codex/config/read", (r) =>
          r.fulfill({
            json: { config: { desktop: { mcp_startup_authentication: true } } },
          }),
        );
        await page.route("**/api/session/health", (r) =>
          r.fulfill({
            json: {
              status: "ok",
              instance: "ux-fixture",
              capabilities: {
                codexMcpAuthV1: true,
                codexMcpOAuthThreadId: true,
              },
            },
          }),
        );
        await page.route(
          "**/api/session/api/codex/mcp/oauth/login",
          async (r) => {
            requests.push(r.request().postDataJSON());
            await new Promise<void>((resolve) => (release = resolve));
            await r.fulfill({
              json: { authorizationUrl: "https://example.invalid/authorize" },
            });
          },
        );
        await page.route("**/api/session/api/codex/mcp/reload", (r) => {
          reloads++;
          return r.fulfill({ json: {} });
        });
        await page.evaluate(() => {
          (window as any).oauthWindows = [];
          window.open = ((url: any) => {
            (window as any).oauthWindows.push(url);
            return null;
          }) as any;
        });
        await expect.poll(stream.connected).toBeGreaterThan(0);
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).authCurrent?.readyState),
          )
          .toBe(1);
        stream.send("mcpServer/startupStatus/updated", {
          name: "fixture-mcp",
          status: "failed",
          failureReason: "reauthenticationRequired",
          threadId: "ux-0",
        });
        await expect(
          page.locator(".codex-native-sonner-toaster [data-sonner-toast]"),
        ).toContainText("重新连接 MCP 服务器");
        await settle(page);
        await native.setViewportSize({ width, height: 844 });
        await nativeNotifications(native, reference!, width, theme);
        await goldenMcp(native);
        const normal = {
          native: await measure(native),
          product: await measure(page),
        };
        await writeFile(
          info.outputPath("prompt-metrics.json"),
          JSON.stringify(normal, null, 2),
        );
        for (const [name, target] of [
          ["native", native],
          ["product", page],
        ] as const)
          await target.screenshot({
            path: info.outputPath(`${name}-mcp-prompt.png`),
          });
        expect(normal.product).toEqual(normal.native);
        await compareCardPixels(page, native, info, "normal");
        await page
          .locator("[data-sonner-toast]")
          .getByRole("button", { name: "重新连接", exact: true })
          .click();
        await expect.poll(() => requests.length).toBe(1);
        await expect(
          page
            .locator("[data-sonner-toast]")
            .getByRole("button", { name: "重新连接", exact: true }),
        ).toBeDisabled();
        await goldenMcp(native, true);
        // Sample the same animation phase in both contexts; retain exact native timing checks.
        for (const target of [native, page]) {
          const timing = await target.locator(frontNotice).evaluate((e) => {
            const spinner = [...e.querySelectorAll("svg")].find(
              (svg) => svg.getAttribute("viewBox") === "0 0 24 24",
            )!.parentElement!;
            const style = getComputedStyle(spinner);
            for (const animation of spinner.getAnimations()) {
              animation.pause();
              animation.currentTime = 0;
            }
            return {
              duration: style.animationDuration,
              easing: style.animationTimingFunction,
              iterations: style.animationIterationCount,
            };
          });
          expect(timing).toEqual({
            duration: "2s",
            easing: "steps(60)",
            iterations: "infinite",
          });
        }
        const pending = {
          native: await measure(native),
          product: await measure(page),
        };
        await writeFile(
          info.outputPath("pending-metrics.json"),
          JSON.stringify(pending, null, 2),
        );
        for (const [name, target] of [
          ["native", native],
          ["product", page],
        ] as const)
          await target.screenshot({
            path: info.outputPath(`${name}-mcp-pending.png`),
          });
        expect(pending.product).toEqual(pending.native);
        await compareCardPixels(page, native, info, "pending");
        release();
        await expect
          .poll(() => page.evaluate(() => (window as any).oauthWindows))
          .toEqual(["https://example.invalid/authorize"]);
        stream.send("mcpServer/oauthLogin/completed", {
          name: "fixture-mcp",
          threadId: "ux-0",
          success: true,
        });
        await expect(
          page.locator(".codex-native-sonner-toaster [data-sonner-toast]"),
        ).toHaveCount(0);
        // Initialization/version observation is separate from health. This fixture starts before its cap recheck.
        expect(requests[0]).toEqual({ name: "fixture-mcp", threadId: "ux-0" });
        await expect.poll(() => reloads).toBe(1);
        expect(f.errors).toEqual([]);
        expect(f.calls).toEqual([]);
        await writeFile(
          info.outputPath("oauth-requests.json"),
          JSON.stringify({ requests, reloads }, null, 2),
        );
      } finally {
        await writeFile(
          info.outputPath("transport-debug.json"),
          JSON.stringify(
            {
              frames: await page.evaluate(() => (window as any).authFrames),
              network: stream.network,
              errors: f.errors,
              sources: await page.evaluate(() => (window as any).authSources),
              modules: await page.evaluate(() =>
                performance
                  .getEntriesByType("resource")
                  .filter(
                    (e) =>
                      e.name.includes("native-mcp-auth") ||
                      e.name.includes("eventStream"),
                  )
                  .map((e) => new URL(e.name).pathname),
              ),
            },
            null,
            2,
          ),
        ).catch(() => {});
        release?.();
        await native.close();
        await page.close();
        await f.close();
        await stream.close();
      }
    });

test("runtime authentication challenge crosses real projected SSE with no tool body", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 844 });
  const stream = await wire(page);
  let f;
  try {
    f = await setup(page, false);
  } catch (error) {
    await stream.close();
    throw error;
  }
  const requests: any[] = [];
  await stream.allow();
  try {
    await page.route("**/api/session/api/codex/config/read", (r) =>
      r.fulfill({
        json: { config: { desktop: { mcp_startup_authentication: false } } },
      }),
    );
    await page.route("**/api/session/api/codex/mcp/oauth/login", (r) => {
      requests.push(r.request().postDataJSON());
      return r.fulfill({
        json: { authorizationUrl: "https://example.invalid/authorize" },
      });
    });
    await page.evaluate(() => {
      (window as any).oauthWindows = [];
      window.open = ((url: any) => {
        (window as any).oauthWindows.push(url);
        return null;
      }) as any;
    });
    await expect.poll(stream.connected).toBeGreaterThan(0);
    const upstreamBytes = stream.send("item/completed", {
      threadId: "ux-0",
      turnId: "auth-turn",
      item: {
        id: "auth-tool",
        type: "mcpToolCall",
        server: "fixture-mcp",
        tool: "read",
        status: "completed",
        result: {
          _meta: {
            "mcp/www_authenticate": [
              'Bearer scope="read profile"',
              'Bearer scope="read"',
            ],
          },
          content: [
            {
              type: "text",
              text: "PRIVATE_TOOL_BODY" + "x".repeat(4 * 1024 * 1024),
            },
          ],
        },
      },
    });
    await expect(
      page.locator(".codex-native-sonner-toaster [data-sonner-toast]"),
    ).toContainText("重新连接 MCP 服务器");
    await settle(page);
    await page.screenshot({ path: info.outputPath("runtime-challenge.png") });
    await page
      .locator("[data-sonner-toast]")
      .getByRole("button", { name: "重新连接", exact: true })
      .click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      name: "fixture-mcp",
      scopes: ["read", "profile"],
    });
    expect(await page.locator("body").textContent()).not.toContain(
      "PRIVATE_TOOL_BODY",
    );
    expect(upstreamBytes).toBeGreaterThan(4 * 1024 * 1024);
    const frames = await page.evaluate(() => (window as any).authFrames);
    expect(frames).toEqual([
      expect.objectContaining({
        seq: 1,
        method: "item/completed",
        result: null,
        challenge: { scopes: ["read", "profile"] },
      }),
    ]);
    expect(frames[0].chars).toBeLessThan(16 * 1024);
    expect(f.errors).toEqual([]);
    expect(f.calls).toEqual([]);
    await writeFile(
      info.outputPath("runtime-auth.json"),
      JSON.stringify({ upstreamBytes, requests, frames }, null, 2),
    );
  } finally {
    await writeFile(
      info.outputPath("transport-debug.json"),
      JSON.stringify(
        {
          frames: await page.evaluate(() => (window as any).authFrames),
          network: stream.network,
          errors: f.errors,
          sources: await page.evaluate(() => (window as any).authSources),
          modules: await page.evaluate(() =>
            performance
              .getEntriesByType("resource")
              .filter(
                (e) =>
                  e.name.includes("native-mcp-auth") ||
                  e.name.includes("eventStream"),
              )
              .map((e) => new URL(e.name).pathname),
          ),
        },
        null,
        2,
      ),
    ).catch(() => {});
    await page.close();
    await f.close();
    await stream.close();
  }
});

for (const width of [390, 700])
  test(`MCP dismissal, retry, captured URL and workspace isolation ${width}`, async ({
    page,
  }, info) => {
    test.skip(!reference, "Unchanged native provider required");
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 844 });
    const stream = await wire(page),
      requests: any[] = [];
    let release: () => void = () => {};
    const f = await setup(page, false, async () => {
      await stream.allow();
      await page.route("**/api/session/api/codex/config/read", (r) =>
        r.fulfill({
          json: { config: { desktop: { mcp_startup_authentication: true } } },
        }),
      );
      await page.route("**/api/session/health", (r) =>
        r.fulfill({
          json: {
            status: "ok",
            instance: "ux-fixture",
            capabilities: { codexMcpAuthV1: true, codexMcpOAuthThreadId: true },
          },
        }),
      );
      await page.route("**/api/session/api/codex/account/get", (r) =>
        r.fulfill({
          json: {
            account: {
              type: "chatgpt",
              email: "fixture@example.invalid",
              planType: "plus",
            },
            workspaceRouting: { chatgptAccountId: "workspace-A" },
            requiresOpenaiAuth: false,
          },
        }),
      );
      await page.route("**/api/session/api/codex/mcp/status/list", (r) =>
        r.fulfill({
          json: {
            data: [{ name: "fixture-mcp", authStatus: "notLoggedIn" }],
            nextCursor: null,
          },
        }),
      );
    });
    const native = await page.context().newPage();
    native.on("pageerror", (e) => f.errors.push("Native: " + e.message));
    const notices = page.locator(
        ".codex-native-sonner-toaster [data-sonner-toast]",
      ),
      front = page.locator(frontNotice);
    try {
      await expect
        .poll(() =>
          page.evaluate(
            async (url) =>
              (await import(url)).useCodexStore.getState().accountNamespace,
            f.storeUrl(),
          ),
        )
        .toBe("workspace-A");
      await expect(notices).toHaveCount(1);
      await settle(page);
      await front.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(notices).toHaveCount(0);
      await page
        .locator('[role="tab"][data-tab-key$="ux-1"]')
        .getByText(f.fixture.threads[1].name, { exact: true })
        .click();
      await expect(notices).toHaveCount(1);
      await page.route(
        "**/api/session/api/codex/mcp/oauth/login",
        async (r) => {
          requests.push(r.request().postDataJSON());
          if (requests.length === 1)
            return r.fulfill({
              status: 500,
              json: { error: "isolated OAuth refusal" },
            });
          if (requests.length === 3)
            await new Promise<void>((resolve) => (release = resolve));
          await r
            .fulfill({
              json: {
                authorizationUrl:
                  requests.length === 3
                    ? "https://example.invalid/old-workspace"
                    : "https://example.invalid/current",
              },
            })
            .catch(() => {});
        },
      );
      await page.evaluate(() => {
        (window as any).oauthWindows = [];
        window.open = ((url: any) => {
          (window as any).oauthWindows.push(url);
          return null;
        }) as any;
      });
      await front
        .getByRole("button", { name: "重新连接", exact: true })
        .click();
      await expect(front).toContainText("无法连接到 MCP 服务器");
      await settle(page);
      await native.setViewportSize({ width, height: 844 });
      await nativeNotifications(native, reference!, width, "dark");
      await native.evaluate(async () => {
        const Auth = await import(
          /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
        );
        Auth.ZBt().danger("无法连接到 MCP 服务器“fixture-mcp”。请重试。");
      });
      await settle(native);
      expect(await measure(page)).toEqual(await measure(native));
      await compareCardPixels(page, native, info, "start-error");
      await front.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(notices).toHaveCount(1);
      await front
        .getByRole("button", { name: "重新连接", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => (window as any).oauthWindows))
        .toEqual(["https://example.invalid/current"]);
      await front
        .getByRole("button", { name: "重新连接", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => (window as any).oauthWindows))
        .toEqual([
          "https://example.invalid/current",
          "https://example.invalid/current",
        ]);
      expect(requests).toEqual([
        { name: "fixture-mcp" },
        { name: "fixture-mcp" },
      ]);
      await expect.poll(stream.connected).toBeGreaterThan(0);
      stream.send("mcpServer/oauthLogin/completed", {
        name: "fixture-mcp",
        success: false,
        error: "isolated completion refusal",
      });
      await expect(front).toContainText("身份验证未完成");
      await settle(page);
      await native.evaluate(async () => {
        const Auth = await import(
          /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
        );
        Auth.ZBt().closeAll();
        Auth.ZBt().danger("MCP 服务器“fixture-mcp”的身份验证未完成");
      });
      await settle(native);
      expect(await measure(page)).toEqual(await measure(native));
      await compareCardPixels(page, native, info, "completion-error");
      await front.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(notices).toHaveCount(1);
      await front
        .getByRole("button", { name: "重新连接", exact: true })
        .click();
      await expect.poll(() => requests.length).toBe(3);
      await expect(
        front.getByRole("button", { name: "重新连接", exact: true }),
      ).toBeDisabled();
      await page.evaluate(
        async (url) =>
          (await import(url)).useCodexStore.setState({
            accountNamespace: "workspace-B",
          }),
        f.storeUrl(),
      );
      release();
      await expect(notices).toHaveCount(1);
      await expect(
        front.getByRole("button", { name: "重新连接", exact: true }),
      ).toBeEnabled();
      expect(await page.evaluate(() => (window as any).oauthWindows)).toEqual([
        "https://example.invalid/current",
        "https://example.invalid/current",
      ]);
      expect(f.calls).toEqual([]);
      expect(f.errors).toEqual([]);
      await writeFile(
        info.outputPath("flow.json"),
        JSON.stringify(
          {
            requests,
            windows: await page.evaluate(() => (window as any).oauthWindows),
            frames: await page.evaluate(() => (window as any).authFrames),
          },
          null,
          2,
        ),
      );
    } finally {
      release();
      await native.close();
      await page.close();
      await f.close();
      await stream.close();
    }
  });

test("startup authentication uses the actual public runtime config handler without private fields", async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(60000);
  const stream = await wire(page);
  const target = new URL(stream.origin);
  target.hostname = new URL(baseURL!).hostname;
  const requestBodies: unknown[] = [],
    configResponses: unknown[] = [],
    abortedResponses: string[] = [],
    responseReadErrors: string[] = [];
  const responseReads = new Set<Promise<void>>();
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname !== "/api/codex/config/read" ||
      response.request().method() !== "POST"
    )
      return;
    const read = (async () => {
      const completion = await response.finished();
      const failure = response.request().failure()?.errorText;
      if (completion || failure) {
        if (
          failure === "net::ERR_ABORTED" ||
          failure === "Load request cancelled"
        )
          abortedResponses.push(failure);
        else responseReadErrors.push(failure ?? String(completion));
        return;
      }
      if (!response.ok()) {
        responseReadErrors.push(`Config response HTTP ${response.status()}`);
        return;
      }
      configResponses.push(await response.json());
    })()
      .catch((error) => responseReadErrors.push(String(error)))
      .then(() => {});
    responseReads.add(read);
    void read.finally(() => responseReads.delete(read));
  });
  let f;
  let nativeCalls: unknown;
  try {
    f = await setup(page, false, async () => {
      await stream.allow();
      await page.route("**/api/session/api/codex/config/read", (route) => {
        requestBodies.push(route.request().postDataJSON());
        return route.continue({
          url: target.origin + "/api/codex/config/read",
        });
      });
      await page.route("**/api/session/api/codex/mcp/status/list", (route) =>
        route.fulfill({
          json: {
            data: [
              { name: "public-config-fixture", authStatus: "notLoggedIn" },
            ],
            nextCursor: null,
          },
        }),
      );
    });
    await expect(
      page.getByText("重新连接 MCP 服务器“public-config-fixture”", {
        exact: true,
      }),
    ).toBeVisible();
    expect(requestBodies.length).toBeGreaterThan(0);
    expect(requestBodies.every((body) => JSON.stringify(body) === "{}")).toBe(
      true,
    );
    await expect.poll(() => configResponses.length).toBeGreaterThan(0);
    expect(
      configResponses.some((response) =>
        JSON.stringify(response).includes("PRIVATE_CONFIG"),
      ),
    ).toBe(false);
    expect((configResponses[0] as any).config.desktop).toEqual({
      mcp_startup_authentication: true,
    });
    nativeCalls = await page.evaluate(
      async (origin) =>
        (await fetch(origin + "/__fixture/native-calls")).json(),
      target.origin,
    );
    expect(nativeCalls).toContainEqual({
      method: "config/read",
      params: { includeLayers: false },
    });
    await writeFile(
      info.outputPath("public-config-wire.json"),
      JSON.stringify({ requestBodies, configResponses, nativeCalls }, null, 2),
    );
    await Promise.all([...responseReads]);
    expect(responseReadErrors).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await Promise.all([...responseReads]);
    await writeFile(
      info.outputPath("public-config-wire.json"),
      JSON.stringify(
        {
          requestBodies,
          configResponses,
          nativeCalls,
          abortedResponses,
          responseReadErrors,
          network: stream.network,
        },
        null,
        2,
      ),
    );
    await f?.close();
    await stream.close();
  }
});

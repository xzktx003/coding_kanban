import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
async function fixture() {
  const require = createRequire(
      resolve("packages/session-runtime/package.json"),
    ),
    child = spawn(
      process.execPath,
      [
        require.resolve("tsx/cli"),
        resolve("tests/e2e/helpers/plugin-browser-server.mts"),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  let stderr = "",
    sequence = 0,
    ready!: (value: any) => void,
    rejectReady!: (e: Error) => void;
  const started = new Promise<any>((resolve, reject) => {
    ready = resolve;
    rejectReady = reject;
  });
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.stderr.on("data", (part) => {
    stderr = (stderr + part).slice(-3000);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    if (value.kind === "ready") ready(value);
    else {
      const waiter = pending.get(value.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(value.id);
        waiter.resolve(value.value);
      }
    }
  });
  child.once("exit", (code) => {
    const e = new Error(`Private plugin fixture exited ${code}: ${stderr}`);
    rejectReady(e);
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(e);
    }
    pending.clear();
    lines.close();
  });
  const timer = setTimeout(
    () =>
      rejectReady(
        new Error(stderr || "Private plugin fixture startup timed out"),
      ),
    15000,
  );
  let config: any;
  try {
    config = await started;
  } catch (e) {
    child.kill("SIGTERM");
    await exited;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const control = (method: string) =>
    new Promise<any>((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(
          () => reject(new Error(`Plugin fixture ${method} timed out`)),
          15000,
        );
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method }) + "\n");
    });
  const streams: Awaited<ReturnType<typeof liveStream>>[] = [];
  return {
    ...config,
    streams,
    control,
    async close() {
      for (const stream of streams) await stream.close();
      try {
        await control("close");
      } finally {
        child.stdin.end();
        await exited;
      }
    },
  };
}
async function connect(
  page: Page,
  native: Awaited<ReturnType<typeof fixture>>,
) {
  await installSessionUxFixture(page, 1);
  native.streams.push(await liveStream(page, process.env.PLAYWRIGHT_BASE_URL!));
  await page.route("**/api/session/lifecycle/context", (route) =>
    route.fulfill({
      json: { scopeToken: native.scope, namespace: native.namespace },
    }),
  );
  await page.route(
    /\/api\/(session\/api\/)?codex\/plugin\/(list|installed|read|install|uninstall|mutation|authentication)$/,
    async (route) => {
      const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
      const response = await route.fetch({
        url: native.origin + "/api/session/api/codex/plugin/" + action,
      });
      await route.fulfill({ response });
    },
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 1);
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor({ timeout: 60000 });
  await openPlugins(page);
}
async function openPlugins(page: Page) {
  await page.evaluate(async () => {
    const module = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((row) => new URL(row.name).pathname === path)?.name ?? path
      );
    const [{ usePluginsNavigationStore }, { useLayoutStore }] =
      await Promise.all([
        module("/src/session-mode/stores/usePluginsNavigationStore.ts"),
        module("/src/session-mode/stores/useLayoutStore.ts"),
      ]);
    usePluginsNavigationStore.setState({ mainTab: "Plugins" });
    useLayoutStore.setState({ view: "plugins", isSidebarOpen: false });
  });
  await expect(
    page.getByText("Alpha Plugin", { exact: true }).first(),
  ).toBeVisible();
}
for (const width of [1440, 393])
  test(`plugins ${width}: exact marketplace, all authentication actions and guarded uninstall`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    const native = await fixture(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.setViewportSize({ width, height: 900 });
      await connect(page, native);
      await page.getByTitle("Install Alpha Plugin", { exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Alpha Plugin 插件认证" }),
      ).toBeVisible();
      await expect(
        page.getByTitle("Install Beta Plugin", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "认证 App A", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "认证 App B", exact: true }),
      ).toBeVisible();
      const urls: string[] = [];
      await page.evaluate(() => {
        (window as any).__pluginAuthUrls = [];
        window.open = ((url?: string | URL) => {
          (window as any).__pluginAuthUrls.push(String(url));
          return null;
        }) as typeof window.open;
      });
      for (const name of ["App A", "App B"])
        await page
          .getByRole("button", { name: `认证 ${name}`, exact: true })
          .click();
      urls.push(
        ...(await page.evaluate(() => (window as any).__pluginAuthUrls)),
      );
      expect(urls).toEqual([
        "https://auth.invalid/a",
        "https://auth.invalid/b",
      ]);
      await expect(page.getByText("App A 已可用", { exact: true })).toHaveCount(
        0,
      );
      await page
        .getByRole("button", { name: "核对认证状态", exact: true })
        .click();
      await expect(
        page.getByText("仍有应用尚不可用", { exact: false }),
      ).toBeVisible();
      await native.control("accessible");
      await page
        .getByRole("button", { name: "核对认证状态", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "App A 已可用", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "App B 已可用", exact: true }),
      ).toBeDisabled();
      await page.getByText("Alpha Plugin", { exact: true }).first().click();
      await page
        .getByRole("button", { name: "Uninstall", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await native.control("metrics")).calls.filter(
              (row: any) => row.method === "plugin/uninstall",
            ).length,
        )
        .toBe(1);
      const metrics = await native.control("metrics");
      expect(
        metrics.calls.filter((row: any) => row.method === "plugin/install"),
      ).toHaveLength(1);
      expect(metrics.installed.beta).toBe(false);
      expect(errors).toEqual([]);
      await info.attach("production-plugin-chain", {
        body: JSON.stringify({
          productionUI: true,
          productionGateway: true,
          productionRuntime: true,
          nativeRpcFixture: true,
          onlineOAuth: false,
          width,
          ...metrics,
        }),
        contentType: "application/json",
      });
    } finally {
      await native.close();
    }
  });
test("unknown plugin delivery survives reload and repeated gestures only inspect the same intent", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const native = await fixture();
  try {
    await native.control("unknown");
    await connect(page, native);
    await page.getByTitle("Install Alpha Plugin", { exact: true }).click();
    await expect(
      page.getByText(/Alpha Plugin：.*connection lost/).first(),
    ).toBeVisible();
    await page.getByTitle("Install Alpha Plugin", { exact: true }).click();
    await expect
      .poll(
        async () =>
          (await native.control("metrics")).calls.filter(
            (row: any) => row.method === "plugin/read",
          ).length,
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      (await native.control("metrics")).calls.filter(
        (row: any) => row.method === "plugin/install",
      ),
    ).toHaveLength(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "会话工作台导航" }).waitFor();
    await openPlugins(page);
    const inspected = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith("/plugin/mutation"),
      ),
      page.getByTitle("Install Alpha Plugin", { exact: true }).click(),
    ]);
    expect((await inspected[0].json()).status).toBe("unknown");
    await expect(
      page.getByText(/Alpha Plugin：.*outcome remains unknown/).first(),
    ).toBeVisible();
    expect(
      (await native.control("metrics")).calls.filter(
        (row: any) => row.method === "plugin/install",
      ),
    ).toHaveLength(1);
    await native.control("complete");
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith("/plugin/mutation"),
      ),
      page.getByTitle("Install Alpha Plugin", { exact: true }).click(),
    ]);
    await expect(
      page.getByRole("region", { name: "Alpha Plugin 插件认证" }),
    ).toBeVisible();
    const metrics = await native.control("metrics");
    expect(
      metrics.calls.filter((row: any) => row.method === "plugin/install"),
    ).toHaveLength(1);
    await info.attach("unknown-receipt-proof", {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
  } finally {
    await native.close();
  }
});
test("plugin changes refresh another page without replacing its selected marketplace detail or draft", async ({
  page,
  context,
}, info) => {
  test.setTimeout(90000);
  const native = await fixture(),
    other = await context.newPage();
  try {
    await connect(page, native);
    await connect(other, native);
    await other.getByText("Beta Plugin", { exact: true }).first().click();
    await expect(
      other.getByRole("heading", { name: "Beta Plugin", exact: true }),
    ).toBeVisible();
    const reads = (await native.control("metrics")).calls.filter(
      (row: any) => row.method === "plugin/list",
    ).length;
    await page.getByTitle("Install Alpha Plugin", { exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Alpha Plugin 插件认证" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await native.control("metrics")).calls.filter(
            (row: any) => row.method === "plugin/list",
          ).length,
      )
      .toBeGreaterThan(reads + 1);
    await expect(
      other.getByRole("heading", { name: "Beta Plugin", exact: true }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", { name: "Uninstall", exact: true }),
    ).toHaveCount(0);
    await other.getByRole("button", { name: "Plugin", exact: true }).click();
    await expect(
      other.getByTitle("Use Alpha Plugin", { exact: true }),
    ).toBeVisible();
    await expect(
      other.getByTitle("Install Beta Plugin", { exact: true }),
    ).toBeVisible();
    const metrics = await native.control("metrics");
    expect(
      metrics.calls.filter((row: any) => row.method === "plugin/install"),
    ).toHaveLength(1);
    await info.attach("cross-page-plugin-state", {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
  } finally {
    await other.close();
    await native.close();
  }
});
test("same-value account revocation drops late plugin details and closes authentication actions", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const native = await fixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const reading = new Promise<void>((resolve) => (started = resolve));
  try {
    await connect(page, native);
    await page.getByTitle("Install Alpha Plugin", { exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Alpha Plugin 插件认证" }),
    ).toBeVisible();
    await page.route(/\/plugin\/read$/, async (route) => {
      started();
      await blocked;
      const response = await route.fetch({
        url: native.origin + "/api/session/api/codex/plugin/read",
      });
      await route.fulfill({ response }).catch(() => {});
    });
    await page.getByText("Beta Plugin", { exact: true }).first().click();
    await reading;
    await expect(
      page.getByRole("heading", { name: "Beta Plugin", exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const path = "/src/session-mode/services/goalCompletionAutoClear.ts";
      const { resetGoalCompletionScope } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((row) => new URL(row.name).pathname === path)?.name ?? path
      );
      resetGoalCompletionScope();
    });
    await expect(
      page.getByRole("region", { name: "Alpha Plugin 插件认证" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Beta Plugin", exact: true }),
    ).toHaveCount(0);
    release();
    await expect(
      page.getByText("插件账号或连接已变化，请重新打开详情。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Beta Plugin", exact: true }),
    ).toHaveCount(0);
    const metrics = await native.control("metrics");
    expect(
      metrics.calls.filter((row: any) => row.method === "plugin/install"),
    ).toHaveLength(1);
    await info.attach("revoked-plugin-scope", {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
  } finally {
    release();
    await native.close();
  }
});

test("plugin detail keeps its original summary when a native read returns another source or oversized body", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const native = await fixture(),
    errors: string[] = [];
  let failure = "foreign market";
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await connect(page, native);
    await page.route(/\/plugin\/read$/, async (route) => {
      const response = await route.fetch({
        url: native.origin + "/api/session/api/codex/plugin/read",
      });
      const value = await response.json();
      if (failure === "foreign market")
        value.plugin.marketplacePath = "/private/foreign";
      if (failure === "foreign plugin") value.plugin.summary.name = "foreign";
      value.plugin.description =
        failure === "oversized detail"
          ? "x".repeat(2 * 1024 * 1024)
          : "FOREIGN_DETAIL_MUST_NOT_RENDER";
      await route.fulfill({ json: value });
    });
    for (failure of ["foreign market", "foreign plugin", "oversized detail"]) {
      await page.getByText("Alpha Plugin", { exact: true }).first().click();
      await expect(
        page.getByRole("heading", { name: "Alpha Plugin", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("alert").filter({ hasText: "插件详情尚未加载" }),
      ).toContainText(failure === "oversized detail" ? "读取预算" : "来源");
      await expect(
        page.getByText("FOREIGN_DETAIL_MUST_NOT_RENDER", { exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Plugin", exact: true }).click();
      await expect(
        page.getByTitle("Install Alpha Plugin", { exact: true }),
      ).toBeVisible();
    }
    const metrics = await native.control("metrics");
    expect(
      metrics.calls.filter((row: any) =>
        ["plugin/install", "plugin/uninstall"].includes(row.method),
      ),
    ).toHaveLength(0);
    expect(errors).toEqual([]);
    await info.attach("guarded-plugin-detail", {
      body: JSON.stringify({ cases: 3, nativeWrites: 0, errors }),
      contentType: "application/json",
    });
  } finally {
    await native.close();
  }
});

test("reopening an unmounted plugin catalog after the same account event rereads the current native state", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const native = await fixture();
  try {
    await connect(page, native);
    await expect(
      page.getByTitle("Install Alpha Plugin", { exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useLayoutStore.ts";
      const { useLayoutStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      useLayoutStore.getState().setView("agent");
    });
    await expect(
      page.locator(".session-codex-composer [contenteditable=true]").first(),
    ).toBeVisible();
    await expect(
      page.getByTitle("Install Alpha Plugin", { exact: true }),
    ).toHaveCount(0);
    const before = (await native.control("metrics")).calls.filter(
      (row: any) => row.method === "plugin/list",
    ).length;
    // Simulate an external client's completed installation; the board sends no
    // mutation and must discover the state through the next authorized read.
    await native.control("complete");
    await page.evaluate(async () => {
      const path = "/src/session-mode/services/goalCompletionAutoClear.ts";
      const { resetGoalCompletionScope } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      resetGoalCompletionScope();
    });
    await openPlugins(page);
    await expect(
      page.getByTitle("Use Alpha Plugin", { exact: true }),
    ).toBeVisible();
    const metrics = await native.control("metrics");
    expect(
      metrics.calls.filter((row: any) => row.method === "plugin/list").length,
    ).toBeGreaterThan(before);
    expect(
      metrics.calls.filter((row: any) =>
        ["plugin/install", "plugin/uninstall"].includes(row.method),
      ),
    ).toHaveLength(0);
    await info.attach("closed-plugin-catalog-scope", {
      body: JSON.stringify({ previousReads: before, ...metrics }),
      contentType: "application/json",
    });
  } finally {
    await native.close();
  }
});

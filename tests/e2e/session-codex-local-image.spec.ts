import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

// Mount only the real Markdown renderer; no Agent, runtime or session API is started.
const project = process.cwd();
let directory: string, imagePath: string, oddPath: string, pixels: Buffer;
let dimensions: { width: number; height: number };
test.beforeAll(async () => {
  await mkdir(join(project, ".dev-runtime"), { recursive: true });
  directory = await mkdtemp(
    join(project, ".dev-runtime/local-chat-image-fixture-"),
  );
  try {
    pixels = await readFile(
      join(project, ".dev-runtime/designs/system-events-corner-sketch.png"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    pixels = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
  }
  dimensions = {
    width: pixels.readUInt32BE(16),
    height: pixels.readUInt32BE(20),
  };
  imagePath = join(directory, "sketch.png");
  oddPath = join(directory, "草图 一#?%.png");
  await writeFile(imagePath, pixels);
  await writeFile(oddPath, pixels);
});
test.afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
for (const width of [1440, 390]) {
  test(`local chat image renders real pixels and releases resources (${width})`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/?image-acceptance=1", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><head></head><body><div class="session-mode" id="fixture"></div></body></html>',
      }),
    );
    await page.goto("/?image-acceptance=1");
    await page.evaluate(async (project) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const Refresh = await load("/@react-refresh");
      Refresh.default.injectIntoGlobalHook(window);
      (window as any).$RefreshReg$ = () => {};
      (window as any).$RefreshSig$ = () => (type: unknown) => type;
      (window as any).__vite_plugin_react_preamble_installed__ = true;
      const transformed = await (
        await fetch(
          "/src/session-mode/components/codex/presentation/CodexMarkdown.tsx",
        )
      ).text();
      const reactUrl = transformed.match(/"([^"]*\/deps\/react\.js[^"]*)"/)![1];
      const main = await (await fetch("/src/main.tsx")).text();
      const domUrl = main.match(
        /"([^"]*\/deps\/react-dom_client\.js[^"]*)"/,
      )![1];
      const [React, DOM, Markdown, Theme] = await Promise.all([
        load(reactUrl),
        load(domUrl),
        load(
          "/src/session-mode/components/codex/presentation/CodexMarkdown.tsx",
        ),
        load("/src/session-mode/contexts/ThemeContext.tsx"),
      ]);
      const loadedModule = (path: string) =>
        load(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path,
        );
      const [Store, Workspace] = await Promise.all([
        loadedModule(
          "/src/session-mode/components/codex/stores/useCodexStore.ts",
        ),
        loadedModule("/src/session-mode/stores/useWorkspaceStore.ts"),
      ]);
      await load("/src/app.css");
      await load("/src/session-mode/App.css");
      await load("/src/session-mode/session-theme.css");
      await load("/src/session-mode/session-interactions.css");
      await load("/src/session-mode/codex-presentation.css");
      const w = window as any;
      w.created = [];
      w.released = [];
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        w.created.push(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        w.released.push(url);
        revoke(url);
      };
      Store.useCodexStore.setState({
        threads: [{ id: "image-fixture", cwd: project }],
      });
      Workspace.useWorkspaceStore.setState({ cwd: "/unrelated-project" });
      const root = (DOM.default ?? DOM).createRoot(
        document.getElementById("fixture"),
      );
      w.show = (value: string) =>
        root.render(
          (React.default ?? React).createElement(
            Theme.ThemeProvider,
            {},
            (React.default ?? React).createElement(Markdown.CodexMarkdown, {
              value,
              threadId: "image-fixture",
            }),
          ),
        );
      w.unmountImage = () => root.render(null);
      w.switchProject = () =>
        Workspace.useWorkspaceStore.setState({ cwd: "/another-project" });
    }, project);
    const pageSession = await page.context().newCDPSession(page);
    await pageSession.send("Performance.enable");
    const browserSession = await browser.newBrowserCDPSession();
    const memorySnapshot = async () => {
      const metrics = await pageSession.send("Performance.getMetrics");
      const processInfo = await browserSession.send(
        "SystemInfo.getProcessInfo",
      );
      const renderers = await Promise.all(
        processInfo.processInfo
          .filter((item) => item.type === "renderer")
          .map(async (item) => {
            const status = await readFile(`/proc/${item.id}/status`, "utf8");
            return {
              pid: item.id,
              rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)![1]),
            };
          }),
      );
      return {
        jsHeapBytes: metrics.metrics.find(
          (item) => item.name === "JSHeapUsedSize",
        )!.value,
        renderers,
      };
    };
    const beforeMemory = await memorySnapshot();
    const requests: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/fs/markdown-image"))
        requests.push(request.postDataJSON());
    });
    await page.evaluate(
      (path) =>
        (window as any).show(`图片验收\n\n![系统事件展示草图](${path})`),
      imagePath,
    );
    const img = page.getByRole("img", {
      name: "系统事件展示草图",
      exact: true,
    });
    await expect(img)
      .toBeVisible()
      .catch(async (error) => {
        throw new Error(`${error.message}
${JSON.stringify(errors)}
${await page.locator("body").innerText()}
${JSON.stringify(requests)}`);
      });
    await expect
      .poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth))
      .toBe(dimensions.width);
    expect(await img.evaluate((e: HTMLImageElement) => e.naturalHeight)).toBe(
      dimensions.height,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ rootPath: project, source: imagePath });
    await page.evaluate(() => (window as any).switchProject());
    await expect(img).toBeVisible();
    expect(requests).toHaveLength(1);
    await page.getByRole("button", { name: "放大系统事件展示草图" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "系统事件展示草图大图" }),
    ).toBeVisible();
    const download = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "下载图片" }).click(),
    ]);
    expect(await download[0].failure()).toBeNull();
    const downloaded = await readFile((await download[0].path())!);
    expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
      createHash("sha256").update(pixels).digest("hex"),
    );
    const dialogBox = (await page.getByRole("dialog").boundingBox())!;
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`local-image-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => (window as any).unmountImage());
    await expect
      .poll(() => page.evaluate(() => (window as any).released.length))
      .toBe(1);
    expect(await page.evaluate(() => (window as any).created)).toEqual(
      await page.evaluate(() => (window as any).released),
    );
    await page.evaluate(() =>
      (window as any).show("![越界](/outside-private/image.png)"),
    );
    await expect(page.getByRole("alert")).toContainText("图片加载失败");
    expect(requests).toHaveLength(1);
    await page.evaluate(() => (window as any).unmountImage());
    let failedOnce = false;
    await page.route("**/api/fs/markdown-image", (route) => {
      if (!failedOnce) {
        failedOnce = true;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"transient test failure"}',
        });
      }
      return route.continue();
    });
    const relative =
      "./" +
      oddPath
        .slice(project.length + 1)
        .split("/")
        .map(encodeURIComponent)
        .join("/");
    await page.evaluate(
      (source) => (window as any).show(`![中文文件](${source})`),
      relative,
    );
    await expect(page.getByRole("alert")).toContainText("图片加载失败");
    await page.getByRole("button", { name: "重试" }).click();
    const oddImage = page.getByRole("img", { name: "中文文件", exact: true });
    await expect(oddImage).toBeVisible();
    await expect
      .poll(() => oddImage.evaluate((e: HTMLImageElement) => e.naturalWidth))
      .toBe(dimensions.width);
    await page.unroute("**/api/fs/markdown-image");
    await page.evaluate(() => (window as any).unmountImage());
    await expect
      .poll(() => page.evaluate(() => (window as any).released.length))
      .toBe(2);
    for (let i = 0; i < 5; i++) {
      await page.evaluate(
        (source) => (window as any).show(`![复显](${source})`),
        imagePath,
      );
      const repeated = page.getByRole("img", { name: "复显", exact: true });
      await expect(repeated).toBeVisible();
      await expect
        .poll(() => repeated.evaluate((e: HTMLImageElement) => e.naturalWidth))
        .toBe(dimensions.width);
      await page.evaluate(() => (window as any).unmountImage());
      await expect
        .poll(() => page.evaluate(() => (window as any).released.length))
        .toBe(3 + i);
    }
    expect(await page.evaluate(() => (window as any).created)).toEqual(
      await page.evaluate(() => (window as any).released),
    );
    const audit = {
      dimensions,
      imageBytes: pixels.length,
      requestCount: requests.length,
      created: await page.evaluate(() => (window as any).created.length),
      released: await page.evaluate(() => (window as any).released.length),
      beforeMemory,
      afterMemory: await memorySnapshot(),
      errors,
    };
    await writeFile(
      info.outputPath("resource-audit.json"),
      JSON.stringify(audit, null, 2),
    );
    await info.attach("resource-audit", {
      body: JSON.stringify(audit),
      contentType: "application/json",
    });
    await pageSession.detach();
    await browserSession.detach();
    expect(errors).toEqual([]);
  });
}

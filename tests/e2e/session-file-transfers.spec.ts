import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerWorkspaceFileRoutes } from "../../apps/server/src/routes/workspace-files";
import { expect, test, type Route } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [1366, 390]) {
  test(`session files upload into selected directories, copy paths and download without a page blob (${width}px)`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(90_000);
    const base = await mkdtemp(join(tmpdir(), "kanban-native-file-browser-"));
    const root = join(base, "project");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "readme.md"), "downloaded file");
    await writeFile(join(root, "src", "child.txt"), "nested file");
    const app = Fastify();
    registerWorkspaceFileRoutes(app, {
      trashHome: join(base, "trash"),
      roots: async () => [root],
    });
    const nativeDownloads: string[] = [];
    app.addHook("onRequest", async (request) => {
      if (request.method === "GET")
        nativeDownloads.push(
          new URL(request.url, "http://fixture").searchParams.get("path")!,
        );
    });
    const downloadOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      await page.setViewportSize({ width, height: 900 });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await installSessionUxFixture(page, 0);
      const uploads: string[] = [];

      await page.route("**/api/session/api/filesystem/**", async (route) => {
        const action = new URL(route.request().url()).pathname
          .split("/")
          .at(-1);
        const body =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : {};
        if (action === "canonicalize-path")
          await route.fulfill({ json: body.path });
        else if (action === "read-directory")
          await route.fulfill({
            json:
              body.path === root
                ? [
                    { name: "src", path: root + "/src", is_dir: true },
                    {
                      name: "readme.md",
                      path: root + "/readme.md",
                      is_dir: false,
                    },
                  ]
                : [
                    {
                      name: "child.txt",
                      path: root + "/src/child.txt",
                      is_dir: false,
                    },
                  ],
          });
        else await route.fulfill({ json: [] });
      });
      const handleWorkspaceRoute = async (route: Route) => {
        const url = new URL(route.request().url());
        const action = url.pathname.split("/").at(-1);
        // File mutations stay inside this test's registered temporary project.
        const response = await app.inject({
          method: route.request().method() as "POST" | "GET",
          url: url.pathname + url.search,
          headers: {
            "content-type":
              route.request().headers()["content-type"] ?? "application/json",
          },
          payload: route.request().postDataBuffer() ?? undefined,
        });
        expect(response.statusCode).toBe(200);
        await route.fulfill({
          status: response.statusCode,
          contentType: String(
            response.headers["content-type"] ?? "application/json",
          ),
          body: response.rawPayload,
        });
        if (action === "upload")
          uploads.push(route.request().postDataBuffer()?.toString() ?? "");
      };
      await page.route(
        "**/api/session/workspace-files/**",
        handleWorkspaceRoute,
      );
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await page.evaluate(
        async ({ root, downloadOrigin }) => {
          const moduleUrl = (path: string) =>
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path;
          const { useWorkspaceStore } = await import(
            moduleUrl("/src/session-mode/stores/useWorkspaceStore.ts")
          );
          const { useLayoutStore } = await import(
            moduleUrl("/src/session-mode/stores/useLayoutStore.ts")
          );
          const { useEditorStore } = await import(
            moduleUrl("/src/session-mode/stores/useEditorStore.ts")
          );
          useEditorStore.getState().resetFiles();
          useWorkspaceStore.setState({ cwd: root });
          useLayoutStore.setState({
            view: "agent",
            isRightPanelOpen: true,
            isRightPanelFocused: true,
            openRightPanelTabs: ["files"],
            activeRightPanelTab: "files",
          });
          // Chrome native downloads bypass Playwright network routing. Replace
          // only their transport origin, leaving production path/query intact.
          const originalClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            const url = new URL(this.href);
            if (url.pathname === "/api/session/workspace-files/download")
              this.href = downloadOrigin + url.pathname + url.search;
            return originalClick.call(this);
          };
          const original = URL.createObjectURL;
          (window as any).__fileDownloadBlobs = 0;
          URL.createObjectURL = (value) => {
            if (value instanceof Blob) (window as any).__fileDownloadBlobs++;
            return original(value);
          };
        },
        { root, downloadOrigin },
      );
      const panel = page.getByRole("region", { name: "会话文件管理" });
      if (width < 768)
        await panel
          .getByRole("button", { name: "显示文件树", exact: true })
          .click();
      await panel
        .getByRole("button", { name: "展开文件夹 src", exact: true })
        .click();
      const choose = page.waitForEvent("filechooser");
      await panel
        .getByRole("button", { name: "上传文件", exact: true })
        .click();
      await (
        await choose
      ).setFiles({
        name: "upload.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("payload"),
      });
      await expect.poll(() => uploads.length).toBe(1);
      expect(uploads[0]).toContain(root + "/src/upload.txt");
      expect(await readFile(join(root, "src", "upload.txt"), "utf8")).toBe(
        "payload",
      );
      await panel
        .getByRole("button", { name: "复制绝对路径", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(root + "/src");
      if (width >= 768) {
        await panel
          .getByRole("button", { name: "文件夹 src", exact: true })
          .click({ button: "right" });
        await expect(
          page.getByRole("menuitem", {
            name: "下载文件夹（ZIP）",
            exact: true,
          }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
      const zipDownloading = page.waitForEvent("download");
      await panel
        .getByRole("button", { name: "下载文件夹（ZIP）", exact: true })
        .click();
      const zipDownload = await zipDownloading;
      expect(zipDownload.suggestedFilename()).toBe("src.zip");
      const zip = await readFile((await zipDownload.path())!);
      expect(zip.subarray(0, 2).toString()).toBe("PK");
      expect(zip.includes(Buffer.from("child.txt"))).toBe(true);
      expect(zip.includes(Buffer.from("upload.txt"))).toBe(true);
      await panel
        .getByRole("button", { name: "文件 readme.md", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "复制相对路径", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe("readme.md");
      const downloading = page.waitForEvent("download");
      await panel
        .getByRole("button", { name: "下载文件", exact: true })
        .click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe("readme.md");
      expect(await readFile((await download.path())!, "utf8")).toBe(
        "downloaded file",
      );
      expect(nativeDownloads).toEqual([root + "/src", root + "/readme.md"]);
      expect(
        await page.evaluate(() => (window as any).__fileDownloadBlobs),
      ).toBe(0);
      const box = await panel.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: testInfo.outputPath(`session-files-${width}.png`),
      });
    } finally {
      await app.close();
      await rm(base, { recursive: true, force: true });
    }
  });
}

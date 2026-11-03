import { expect, test } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import { registerWorkspaceFileRoutes } from "../../apps/server/src/routes/workspace-files";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const xlsx = createRequire(join(process.cwd(), "apps/web/package.json"))(
  "xlsx",
);

function samplePdf() {
  const stream = "BT /F1 12 Tf 20 100 Td (Local PDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

for (const width of [1366, 390]) {
  test(`local file links, browsing and edits preserve the session (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const base = await mkdtemp(join(tmpdir(), "kanban-local-browser-"));
    const project = join(base, "project"),
      outside = join(base, "other"),
      file = join(outside, "outside.ts");
    await mkdir(project);
    await mkdir(outside);
    await mkdir(join(outside, "dest"));
    await writeFile(file, "first line\nsecond line\nthird line\n");
    const image = join(outside, "tiny.png");
    const csv = join(outside, "table.csv"),
      spreadsheet = join(outside, "workbook.xlsx"),
      pdf = join(outside, "sample.pdf");
    await writeFile(csv, "name,value\nalpha,42\n");
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet([["Office file", "workbook value"]]),
      "Sheet1",
    );
    await writeFile(
      spreadsheet,
      xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }),
    );
    await writeFile(pdf, samplePdf());
    await writeFile(
      image,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX8AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await symlink(outside, join(project, "linked"));
    const app = Fastify();
    registerWorkspaceFileRoutes(app, {
      trashHome: join(base, "trash"),
      roots: async () => [project],
    });
    const downloadOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
    const calls: Array<{ url: string; body: any }> = [],
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: 900 });
      const fixture = await installSessionUxFixture(page, 1);
      fixture.threads[0].cwd = project;
      const text = `[外部文件](${file}:2:1)\n\n[相对路径文件](../other/outside.ts:2)\n\n[项目内符号链接](${join(project, "linked/outside.ts")}:2:1)\n\n[外部图片](${image})\n\n[外部表格](${csv})\n\n[外部工作簿](${spreadsheet})\n\n[外部PDF](${pdf})\n\n:codex-file-citation{path="${file}" line_range_start="2" line_range_end="3"}`;
      const turn = {
        id: "local-file-turn",
        status: "completed",
        startedAt: 1,
        durationMs: 1000,
        error: null,
        items: [
          {
            id: "local-answer",
            type: "agentMessage",
            text,
            phase: "final_answer",
          },
        ],
      };
      fixture.threads[0].turns = [turn] as never[];
      await page.route("**/api/session/projects", async (route) => {
        const body =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : null;
        await route.fulfill({
          json: {
            initialized: true,
            revision: 1,
            sequence: Math.max(
              0,
              ...(body?.operations ?? []).map((op: { seq: number }) => op.seq),
            ),
            projects: [project],
          },
        });
      });
      await page.route(
        /\/api\/session\/(workspace-files|local-files)\//,
        async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          const contentType = request.headers()["content-type"] ?? "";
          const payload =
            request.method() === "POST"
              ? contentType.includes("application/json")
                ? request.postDataJSON()
                : request.postDataBuffer()
              : undefined;
          calls.push({
            url: url.pathname,
            body: contentType.includes("application/json") ? payload : null,
          });
          const response = await app.inject({
            method: request.method() as "GET" | "POST",
            url: url.pathname + url.search,
            headers: contentType ? { "content-type": contentType } : {},
            ...(payload ? { payload } : {}),
          });
          await route.fulfill({
            status: response.statusCode,
            headers: {
              "content-type":
                (response.headers["content-type"] as string) ??
                "application/json",
            },
            body: response.rawPayload,
          });
        },
      );
      await page.route("**/api/session/api/filesystem/**", async (route) => {
        const action = new URL(route.request().url()).pathname
          .split("/")
          .at(-1);
        const body = route.request().postDataJSON();
        try {
          if (action === "canonicalize-path" || action === "read-directory") {
            const canonical = await realpath(body.path);
            if (canonical !== base && !canonical.startsWith(base + "/"))
              throw new Error("outside fixture");
            if (action === "canonicalize-path")
              await route.fulfill({ json: canonical });
            else {
              const entries = await readdir(canonical, { withFileTypes: true });
              await route.fulfill({
                json: await Promise.all(
                  entries.map(async (entry) => ({
                    name: entry.name,
                    path: join(canonical, entry.name),
                    is_dir: (
                      await stat(join(canonical, entry.name))
                    ).isDirectory(),
                  })),
                ),
              });
            }
          } else if (action === "read-file") {
            const canonical = await realpath(body.filePath);
            if (!canonical.startsWith(base + "/"))
              throw new Error("outside fixture");
            await route.fulfill({
              json: (await readFile(canonical)).toString("base64"),
            });
          } else await route.fulfill({ json: [] });
        } catch {
          await route.fulfill({
            status: 404,
            json: { error: "fixture path unavailable" },
          });
        }
      });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 1);
      await page.evaluate(
        async ({ project, turn, downloadOrigin }) => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const [
            { useCodexStore },
            { useAgentCenterStore },
            { useWorkspaceStore },
            { useLayoutStore },
            { useEditorStore },
          ] = await Promise.all([
            module("/src/session-mode/components/codex/stores/index.ts"),
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
            module("/src/session-mode/stores/useWorkspaceStore.ts"),
            module("/src/session-mode/stores/useLayoutStore.ts"),
            module("/src/session-mode/stores/useEditorStore.ts"),
          ]);
          useEditorStore.getState().resetFiles();
          useWorkspaceStore.setState({ cwd: project, projects: [project] });
          useCodexStore.setState({
            threads: [
              {
                id: "ux-0",
                cwd: project,
                status: { type: "idle" },
                turns: [turn],
              },
            ],
            events: {
              "ux-0": [
                ...turn.items.map((item) => ({
                  method: "item/completed",
                  params: { threadId: "ux-0", turnId: turn.id, item },
                })),
                {
                  method: "turn/completed",
                  params: { threadId: "ux-0", turn },
                },
              ],
            },
            historyLoadedMap: { "ux-0": true },
            currentThreadId: "ux-0",
            currentTurnId: null,
          });
          useAgentCenterStore.getState().addAgentCard(
            {
              kind: "codex",
              id: "ux-0",
              cwd: project,
              preview: "Local files",
            },
            { activate: true },
          );
          useAgentCenterStore.setState({ cardsViewMode: "solo" });
          useLayoutStore.setState({
            view: "agent",
            isSidebarOpen: false,
            isRightPanelOpen: false,
            openRightPanelTabs: ["files"],
          });
          // Native downloads bypass Playwright routing; change only the fixture origin.
          const click = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            const url = new URL(this.href);
            if (url.pathname === "/api/session/local-files/download")
              this.href = downloadOrigin + url.pathname + url.search;
            return click.call(this);
          };
        },
        { project, turn, downloadOrigin },
      );
      await page.getByRole("link", { name: "外部文件" }).click();
      const editor = page.locator(".session-mode .ace_editor:visible");
      const panel = page.getByRole("region", { name: "会话文件管理" });
      await expect
        .poll(() => editor.evaluate((el) => (el as any).env.editor.getValue()))
        .toContain("second line");
      await expect(
        panel.getByRole("button", { name: "下载文件", exact: true }),
      ).toBeEnabled();
      expect(calls).toContainEqual({
        url: "/api/session/local-files/resolve",
        body: { root: project, path: file },
      });
      expect(calls).toContainEqual({
        url: "/api/session/local-files/read",
        body: { root: "/", path: file },
      });
      await editor.evaluate((el) =>
        (el as any).env.editor.setValue("edited local\n", -1),
      );
      await page
        .getByRole("button", { name: "保存文件（Ctrl+S）", exact: true })
        .click();
      await expect.poll(() => readFile(file, "utf8")).toBe("edited local\n");
      const hidePanel = () =>
        page.evaluate(async () => {
          const path = "/src/session-mode/stores/useLayoutStore.ts";
          const { useLayoutStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useLayoutStore.getState().setRightPanelOpen(false);
        });
      await hidePanel();
      await page.getByRole("link", { name: "相对路径文件" }).click();
      await expect
        .poll(() => editor.evaluate((el) => (el as any).env.editor.getValue()))
        .toBe("edited local\n");
      await hidePanel();
      await page.getByRole("button", { name: /outside\.ts.*2-3/ }).click();
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const path = "/src/session-mode/stores/useEditorStore.ts";
            const { useEditorStore } = await import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
            return useEditorStore.getState().revealLocation;
          }),
        )
        .toMatchObject({ path: file, line: 2, endLine: 3 });
      await hidePanel();
      await page.getByRole("link", { name: "项目内符号链接" }).click();
      await expect
        .poll(() =>
          calls.some(
            (call) =>
              call.url === "/api/session/local-files/resolve" &&
              call.body.path === join(project, "linked/outside.ts"),
          ),
        )
        .toBe(true);
      await hidePanel();
      await page.getByRole("link", { name: "外部图片" }).click();
      await expect
        .poll(() =>
          page
            .getByRole("img", { name: "tiny.png" })
            .evaluate((element: HTMLImageElement) => element.naturalWidth),
        )
        .toBe(1);
      await hidePanel();
      await page.getByRole("link", { name: "外部表格" }).click();
      await expect(page.getByRole("cell", { name: "alpha" })).toBeVisible();
      await expect(page.getByRole("cell", { name: "42" })).toBeVisible();
      await hidePanel();
      await page.getByRole("link", { name: "外部工作簿" }).click();
      await expect(
        page.getByRole("cell", { name: "workbook value" }),
      ).toBeVisible();
      await hidePanel();
      await page.getByRole("link", { name: "外部PDF" }).click();
      await expect(page.locator(".react-pdf__Page__canvas")).toBeVisible();
      await panel.getByLabel("文件浏览路径").fill(outside);
      await panel.getByRole("button", { name: "前往" }).click();
      await expect(panel.getByLabel("文件浏览路径")).toHaveValue(outside);
      await panel
        .getByRole("button", { name: "新建文件", exact: true })
        .click();
      await page.getByLabel("文件或文件夹名称").fill("created.txt");
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await expect
        .poll(() =>
          readFile(join(outside, "created.txt"), "utf8").catch(() => null),
        )
        .toBe("");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        panel.getByRole("button", { name: "上传文件", exact: true }).click(),
      ]);
      await chooser.setFiles({
        name: "upload.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("uploaded"),
      });
      await expect
        .poll(() =>
          readFile(join(outside, "upload.txt"), "utf8").catch(() => null),
        )
        .toBe("uploaded");
      if (width < 768)
        await panel.getByRole("button", { name: "显示文件树" }).click();
      await panel.getByRole("button", { name: "文件操作：upload.txt" }).click();
      await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
      await page.getByLabel("文件或文件夹名称").fill("renamed.txt");
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await expect
        .poll(() =>
          readFile(join(outside, "renamed.txt"), "utf8").catch(() => null),
        )
        .toBe("uploaded");
      await panel
        .getByRole("button", { name: "文件操作：renamed.txt" })
        .click();
      await page.getByRole("menuitem", { name: "移动", exact: true }).click();
      await expect(
        page
          .getByLabel("目标目录")
          .locator("option", { hasText: join(outside, "dest") }),
      ).toHaveCount(1);
      await page.getByLabel("目标目录").selectOption(join(outside, "dest"));
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await expect
        .poll(() =>
          readFile(join(outside, "dest/renamed.txt"), "utf8").catch(() => null),
        )
        .toBe("uploaded");
      await panel.getByRole("button", { name: "展开文件夹 dest" }).click();
      await panel
        .getByRole("button", { name: "文件操作：renamed.txt" })
        .click();
      await page
        .getByRole("menuitem", { name: "移入回收站", exact: true })
        .click();
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await expect
        .poll(() =>
          readFile(join(outside, "dest/renamed.txt"), "utf8").catch(() => null),
        )
        .toBe(null);
      await panel.getByRole("button", { name: "回收站", exact: true }).click();
      await page.getByRole("button", { name: "恢复 renamed.txt" }).click();
      await expect
        .poll(() =>
          readFile(join(outside, "dest/renamed.txt"), "utf8").catch(() => null),
        )
        .toBe("uploaded");
      await page.keyboard.press("Escape");
      await panel
        .getByRole("button", { name: "文件 renamed.txt", exact: true })
        .click();
      const downloading = page.waitForEvent("download");
      await panel
        .getByRole("button", { name: "下载文件", exact: true })
        .click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe("renamed.txt");
      expect(await readFile((await download.path())!, "utf8")).toBe("uploaded");
      await page.screenshot({
        path: test.info().outputPath("local-files.png"),
      });
      await panel.getByRole("button", { name: "返回上级目录" }).click();
      await expect(panel.getByLabel("文件浏览路径")).toHaveValue(
        dirname(outside),
      );
      await panel.getByLabel("文件浏览路径").fill(project);
      await panel.getByRole("button", { name: "前往" }).click();
      await expect(panel.getByLabel("文件浏览路径")).toHaveValue(project);
      if (width < 768)
        await panel.getByRole("button", { name: "显示文件树" }).click();
      await panel.getByRole("button", { name: "展开文件夹 linked" }).click();
      await panel
        .getByRole("button", { name: "新建文件", exact: true })
        .click();
      await page.getByLabel("文件或文件夹名称").fill("via-dir-link.txt");
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await expect
        .poll(() =>
          readFile(join(outside, "via-dir-link.txt"), "utf8").catch(() => null),
        )
        .toBe("");
      await panel
        .getByRole("button", { name: "文件 outside.ts", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "新建文件", exact: true })
        .click();
      await page.getByLabel("文件或文件夹名称").fill("via-link.txt");
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await expect
        .poll(() =>
          readFile(join(outside, "via-link.txt"), "utf8").catch(() => null),
        )
        .toBe("");
      await expect
        .poll(() =>
          readFile(join(project, "via-link.txt"), "utf8").catch(() => null),
        )
        .toBe(null);
      const state = await page.evaluate(async () => {
        const path = "/src/session-mode/stores/useWorkspaceStore.ts";
        const { useWorkspaceStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        return {
          cwd: useWorkspaceStore.getState().cwd,
          projects: useWorkspaceStore.getState().projects,
        };
      });
      expect(state).toEqual({ cwd: project, projects: [project] });
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await app.close();
      await rm(base, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });
}

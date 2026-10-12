import { expect, test } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerWorkspaceFileRoutes } from "../../apps/server/src/routes/workspace-files";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [1366, 390]) {
  test(`chat links resolve sibling project symlinks and preserve editable real files (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const base = await mkdtemp(join(tmpdir(), "kanban-file-links-"));
    const root = join(base, "xh2modelzoo"),
      actualRoot = join(base, "xhquanttool");
    const dir = join(
      actualRoot,
      "xhquant",
      "backend",
      "xh2a",
      "ir",
      "operators",
    );
    await mkdir(root);
    await mkdir(dir, { recursive: true });
    const actual = join(dir, "sparse_attention_select_kv.py");
    const alias = join(
      root,
      "xhquant",
      "backend",
      "xh2a",
      "ir",
      "operators",
      "sparse_attention_select_kv.py",
    );
    await writeFile(
      actual,
      "# isolated operator\ndef select_kv():\n    return 'selected'\n",
    );
    await symlink("../xhquanttool/xhquant", join(root, "xhquant"));
    const app = Fastify();
    registerWorkspaceFileRoutes(app, {
      trashHome: join(base, "trash"),
      roots: async () => [root, actualRoot],
    });
    const requests: Array<{ action: string; root: string; path: string }> = [];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.setViewportSize({ width, height: 900 });
      const fixture = await installSessionUxFixture(page, 1);
      fixture.threads[0].cwd = root;
      const text = `[operator](${alias}:2:1)\n\n:codex-file-citation{path="${alias}" line_range_start="2" line_range_end="3"}`;
      const turn = {
        id: "file-link-turn",
        status: "completed",
        startedAt: 1,
        durationMs: 1000,
        error: null,
        items: [
          {
            id: "file-link-answer",
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
              ...(body?.operations ?? []).map(
                (operation: { seq: number }) => operation.seq,
              ),
            ),
            projects: [root, actualRoot],
          },
        });
      });
      await page.route("**/api/session/workspace-files/**", async (route) => {
        const url = new URL(route.request().url());
        const body = route.request().postDataJSON();
        requests.push({
          action: url.pathname.split("/").at(-1)!,
          root: body.root,
          path: body.path,
        });
        const response = await app.inject({
          method: "POST",
          url: url.pathname,
          payload: body,
        });
        await route.fulfill({
          status: response.statusCode,
          contentType: "application/json",
          body: response.rawPayload,
        });
      });
      await page.route("**/api/session/api/filesystem/**", async (route) => {
        const action = new URL(route.request().url()).pathname
          .split("/")
          .at(-1);
        const body = route.request().postDataJSON();
        if (action === "canonicalize-path")
          await route.fulfill({
            json:
              body.path === join(root, "xhquant")
                ? join(actualRoot, "xhquant")
                : body.path,
          });
        else if (action === "read-directory")
          await route.fulfill({
            json:
              body.path === root
                ? [
                    {
                      name: "xhquant",
                      path: join(root, "xhquant"),
                      is_dir: true,
                    },
                  ]
                : [
                    {
                      name: "sparse_attention_select_kv.py",
                      path: actual,
                      is_dir: false,
                    },
                  ],
          });
        else await route.fulfill({ json: [] });
      });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 1);
      await page.evaluate(
        async ({ root, actualRoot, turn }) => {
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
          useWorkspaceStore.setState({
            cwd: root,
            projects: [root, actualRoot],
          });
          useCodexStore.setState({
            threads: [
              {
                id: "ux-0",
                cwd: root,
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
          useAgentCenterStore
            .getState()
            .addAgentCard(
              { kind: "codex", id: "ux-0", cwd: root, preview: "File links" },
              { activate: true },
            );
          useAgentCenterStore.setState({ cardsViewMode: "solo" });
          useLayoutStore.setState({
            view: "agent",
            isSidebarOpen: false,
            isRightPanelOpen: false,
            openRightPanelTabs: ["files"],
          });
        },
        { root, actualRoot, turn },
      );
      const link = page.getByRole("link", { name: "operator", exact: true });
      await link.click();
      const editor = page.locator(".session-mode .ace_editor:visible");
      await expect
        .poll(() => editor.evaluate((el) => (el as any).env.editor.getValue()))
        .toContain("return 'selected'");
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const { useEditorStore } = await import(
              performance
                .getEntriesByType("resource")
                .findLast(
                  (e) =>
                    new URL(e.name).pathname ===
                    "/src/session-mode/stores/useEditorStore.ts",
                )?.name ?? "/src/session-mode/stores/useEditorStore.ts"
            );
            return useEditorStore.getState().revealLocation;
          }),
        )
        .toMatchObject({ path: actual, line: 2, column: 1 });
      expect(requests).toContainEqual({ action: "resolve", root, path: alias });
      expect(requests).toContainEqual({
        action: "read",
        root: actualRoot,
        path: actual,
      });
      expect(
        requests.some((r) => r.action === "read" && r.path === alias),
      ).toBe(false);
      await editor.evaluate((el) =>
        (el as any).env.editor.setValue(
          "# saved real file\ndef select_kv():\n    return 'edited'\n",
          -1,
        ),
      );
      await page
        .getByRole("button", { name: "保存文件（Ctrl+S）", exact: true })
        .click();
      await expect
        .poll(() => readFile(actual, "utf8"))
        .toContain("return 'edited'");
      expect(requests).toContainEqual({
        action: "save",
        root: actualRoot,
        path: actual,
      });
      // Back to the same captured message and open the original alias as a native range citation.
      await page.evaluate(async () => {
        const { useLayoutStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast(
              (e) =>
                new URL(e.name).pathname ===
                "/src/session-mode/stores/useLayoutStore.ts",
            )?.name ?? "/src/session-mode/stores/useLayoutStore.ts"
        );
        useLayoutStore.getState().setRightPanelOpen(false);
      });
      await page
        .getByRole("button", { name: /sparse_attention_select_kv\.py.*2-3/ })
        .click();
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const { useEditorStore } = await import(
              performance
                .getEntriesByType("resource")
                .findLast(
                  (e) =>
                    new URL(e.name).pathname ===
                    "/src/session-mode/stores/useEditorStore.ts",
                )?.name ?? "/src/session-mode/stores/useEditorStore.ts"
            );
            return useEditorStore.getState().revealLocation;
          }),
        )
        .toMatchObject({ path: actual, line: 2, endLine: 3 });
      await expect(page.getByText(/无法读取文件：/)).toHaveCount(0);
      // Native directory enumeration returns the real path beneath the linked directory.
      const panel = page.getByRole("region", { name: "会话文件管理" });
      if (width < 768)
        await panel
          .getByRole("button", { name: "显示文件树", exact: true })
          .click();
      await panel
        .getByRole("button", { name: "展开文件夹 xhquant", exact: true })
        .click();
      await panel
        .getByRole("button", {
          name: "文件 sparse_attention_select_kv.py",
          exact: true,
        })
        .click();
      await expect
        .poll(() => requests.filter((r) => r.action === "resolve").at(-1))
        .toEqual({ action: "resolve", root: actualRoot, path: actual });
      await expect
        .poll(() =>
          page
            .locator(".session-mode .ace_editor:visible")
            .evaluate((el) => (el as any).env.editor.getValue()),
        )
        .toContain("return 'edited'");
      expect(
        requests.some((r) => r.action === "read" && r.path === alias),
      ).toBe(false);
      await expect(
        page.getByRole("heading", { name: "会话界面加载失败", exact: true }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      await rm(base, { recursive: true, force: true });
    }
  });
}

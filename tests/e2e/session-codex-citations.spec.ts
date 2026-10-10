import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const notes = [
  {
    path: "/private/native-memory-one.md",
    lineStart: 2,
    lineEnd: 3,
    note: "Public memory: keep the captured project",
  },
  {
    path: "/private/native-memory-two.md",
    lineStart: 4,
    lineEnd: 5,
    note: "Public memory: keep the original draft",
  },
];

for (const width of [1440, 390])
  test.describe(`${width}px native citations`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`native reference, memory notes, copy/export and captured multi-project Ace range (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(150_000);
        const fixture = await installSessionUxFixture(page, 2);
        const root = fixture.threads[0].cwd,
          path = root + "/src/source.ts";
        const directive = `:codex-file-citation{path="${path}" line_range_start="502" line_range_end="503"}`;
        const legacy = `【${root}/src/legacy.py†L8-L9】`;
        const external =
          ':codex-file-citation{path="https://example.invalid/reference" label="External source"}';
        const literal = ':codex-file-citation{path="/literal/example.ts"}';
        const text = `Native source ${directive} and ${legacy}.\n\n${external}\n\n\`${literal}\`\n\n<div>${literal}</div>\n\n[Literal link](${literal})`;
        const turn = {
          id: "citation-turn",
          status: "completed",
          startedAt: 1,
          durationMs: 1000,
          error: null,
          items: [
            {
              type: "userMessage",
              id: "citation-user",
              clientId: null,
              content: [
                {
                  type: "text",
                  text: "Citation acceptance fixture",
                  text_elements: [],
                },
              ],
            },
            {
              type: "agentMessage",
              id: "citation-assistant",
              text,
              phase: "final_answer",
              memoryCitation: {
                entries: notes,
                threadIds: ["private-source-thread"],
              },
            },
          ],
        };
        fixture.threads[0].turns = [turn];
        fixture.threads[1].cwd = "/other-project";
        const content = Array.from(
          { length: 600 },
          (_, index) => `line ${index + 1}`,
        ).join("\n");
        await page.route("**/api/filesystem/canonicalize-path", (route) =>
          route.fulfill({ json: route.request().postDataJSON().path }),
        );
        await page.route("**/api/filesystem/read-directory", (route) =>
          route.fulfill({ json: [] }),
        );
        const fileReads: Array<{ root: string; path: string }> = [];
        await page.route("**/workspace-files/read", (route) => {
          const query = new URL(route.request().url()).searchParams;
          const body =
            route.request().method() === "POST"
              ? route.request().postDataJSON()
              : {};
          fileReads.push({
            root: body.root ?? query.get("root") ?? "",
            path: body.path ?? query.get("path") ?? "",
          });
          return route.fulfill({
            json: {
              path,
              content,
              size: content.length,
              version: "citation-fixture",
            },
          });
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/?mode=session");
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60_000 });
        await seedSessionUx(page, 2);
        await page.evaluate(
          async ({ turn, root, theme }) => {
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
              { useLayoutStore },
              { useThemeStore },
              { useSessionDraftStore, sessionDraftKey },
            ] = await Promise.all([
              module(
                "/src/session-mode/components/codex/stores/useCodexStore.ts",
              ),
              module("/src/session-mode/stores/useAgentCenterStore.ts"),
              module("/src/session-mode/stores/useLayoutStore.ts"),
              module("/src/session-mode/stores/settings/useThemeStore.ts"),
              module("/src/session-mode/stores/useSessionDraftStore.ts"),
            ]);
            useThemeStore.getState().setTheme(theme);
            useLayoutStore.setState({
              view: "agent",
              isSidebarOpen: false,
              isRightPanelOpen: false,
            });
            const events = [
              ...turn.items.map((item: any) => ({
                method:
                  item.type === "userMessage"
                    ? "item/started"
                    : "item/completed",
                params: { threadId: "ux-0", turnId: turn.id, item },
              })),
              { method: "turn/completed", params: { threadId: "ux-0", turn } },
            ];
            useCodexStore.setState((state: any) => ({
              threads: state.threads.map((thread: any) =>
                thread.id === "ux-0"
                  ? { ...thread, cwd: root, turns: [turn] }
                  : thread,
              ),
              events: { ...state.events, "ux-0": events },
              historyLoadedMap: { ...state.historyLoadedMap, "ux-0": true },
              currentThreadId: "ux-0",
              currentTurnId: null,
              threadStatusMap: {
                "ux-0": { type: "idle" },
                "ux-1": { type: "idle" },
              },
            }));
            useAgentCenterStore.getState().addAgentCard(
              {
                kind: "codex",
                id: "ux-0",
                cwd: root,
                preview: "Citation owner A",
              },
              { activate: true },
            );
            useAgentCenterStore.getState().addAgentCard(
              {
                kind: "codex",
                id: "ux-1",
                cwd: "/other-project",
                preview: "Input owner B",
              },
              { activate: false },
            );
            useAgentCenterStore.setState({
              cardsViewMode: "solo",
              currentAgentCardId: "ux-0",
              currentAgentCardKind: "codex",
            });
            useSessionDraftStore
              .getState()
              .setText(sessionDraftKey("codex", "ux-0"), "Original A draft");
            useSessionDraftStore
              .getState()
              .setText(sessionDraftKey("codex", "ux-1"), "Original B draft");
          },
          { turn, root, theme },
        );
        const message = page.locator(
          '.codex-assistant[data-owner-thread="ux-0"]',
        );
        await expect(
          message.getByRole("button", { name: /source\.ts.*502-503/ }),
        ).toBeVisible();
        await expect(message.locator("[data-file-reference=true]")).toHaveCount(
          2,
        );
        await expect(
          message.getByRole("link", { name: "External source" }),
        ).toHaveAttribute("href", "https://example.invalid/reference");
        await expect(message).toContainText(literal);
        await page
          .context()
          .grantPermissions(["clipboard-read", "clipboard-write"]);
        if (width !== 390) await message.hover();
        await message
          .getByRole("button", { name: "复制消息", exact: true })
          .click();
        const copied = await page.evaluate(() =>
          navigator.clipboard.readText(),
        );
        expect(copied).toContain("source.ts （第 502-503 行）");
        expect(copied).toContain("legacy.py （第 8-9 行）");
        expect(copied).toContain("`" + literal + "`");
        expect(copied).toContain("<div>" + literal + "</div>");
        await page.getByRole("button", { name: "当前会话的更多操作" }).click();
        const downloadPromise = page.waitForEvent("download");
        await page
          .getByRole("menuitem", { name: "导出 Markdown", exact: true })
          .click();
        const download = await downloadPromise,
          exported = await readFile((await download.path())!, "utf8");
        expect(exported).toContain("source.ts （第 502-503 行）");
        expect(exported).not.toContain("private/native-memory");
        const memory = message.getByRole("button", { name: "2 条记忆引用" });
        await expect(
          message.locator(".codex-native-memory-citation"),
        ).toHaveCount(1);
        if (width !== 390) await message.hover();
        await memory.scrollIntoViewIfNeeded();
        if (width === 390) await memory.tap();
        else await memory.focus();
        await expect(page.getByRole("tooltip")).toContainText("引用的记忆");
        for (const note of notes)
          await expect(page.getByRole("tooltip")).toContainText(note.note);
        if (width === 390) {
          // A tap must leave a readable popup, rather than only a transient
          // role node between transcript layout and scroll restoration.
          await page.waitForTimeout(300);
          await expect(page.getByRole("tooltip")).toContainText(notes[0].note);
        }
        await expect(page.locator("body")).not.toContainText(
          "/private/native-memory",
        );
        const productTooltipGeometry = await page
          .getByRole("tooltip")
          .evaluate((element) => {
            const style = getComputedStyle(
              element.closest("[data-slot=tooltip-content]") ?? element,
            );
            return {
              font: style.fontSize,
              line: style.lineHeight,
              radius: style.borderRadius,
              padding: style.padding,
            };
          });
        const productMemoryGeometry = await memory.evaluate((element) => {
          const style = getComputedStyle(element);
          return { radius: style.borderRadius, padding: style.padding };
        });
        if (width === 390) {
          const target = await memory.boundingBox();
          expect(target!.width).toBeGreaterThanOrEqual(44);
          expect(target!.height).toBeGreaterThanOrEqual(44);
        }
        const productFileGeometry = await message
          .getByRole("button", { name: /source\.ts.*502-503/ })
          .evaluate((element) => {
            const style = getComputedStyle(element),
              rect = element.getBoundingClientRect();
            return {
              font: style.fontSize,
              line: style.lineHeight,
              width: rect.width,
              height: rect.height,
            };
          });
        const productMemorySvg = await memory
          .locator("svg")
          .evaluate((element) => ({
            paths: [...element.querySelectorAll("path")].map((path) =>
              path.getAttribute("d"),
            ),
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          }));
        await page.screenshot({
          path: info.outputPath(
            `product-citations-memory-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        if (reference) {
          const native = await page.context().newPage();
          await native.route("**/*", (route) => {
            const url = new URL(route.request().url());
            return url.origin === new URL(reference).origin &&
              route.request().method() === "GET" &&
              !/\/api\/|backend-api|wham/.test(url.pathname)
              ? route.continue()
              : route.fulfill({ json: {} });
          });
          await native.goto(reference);
          await native.waitForFunction(() => (window as any).nativeLoaded);
          await native.evaluate(
            async ({ text, root, theme, width }) => {
              document.documentElement.setAttribute("data-theme", theme);
              document.getElementById("root")!.style.width =
                width === 390 ? "358px" : "616px";
              const dark = theme === "dark";
              for (const [key, value] of Object.entries({
                "editor-background": dark ? "#20211d" : "#fff",
                foreground: dark ? "#ccc" : "#3b3b3b",
                descriptionForeground: dark ? "#858585" : "#717171",
                "sideBar-background": dark ? "#282a23" : "#f5f5f3",
                "textLink-foreground": dark ? "#a9c5de" : "#006ab1",
              }))
                document.documentElement.style.setProperty(
                  "--vscode-" + key,
                  value,
                );
              const module = await import(
                /* @vite-ignore */ "./native-citation-reference.js?v=1"
              );
              module.initNativeCitations();
              (window as any).renderNativeElement(
                module.NativeCitationReference,
                { kind: "markdown", text, cwd: root },
              );
            },
            {
              text: `Native source ${directive} and ${legacy}.`,
              root,
              theme,
              width,
            },
          );
          await expect(
            native.getByRole("button", { name: /source\.ts.*502-503/ }),
          ).toBeVisible();
          expect(
            await native.evaluate(
              () => (window as any).nativeCitationCopyLabel,
            ),
          ).toBe("source.ts （第 502-503 行）");
          const sourceSvg = await native
            .getByRole("button", { name: /source\.ts.*502-503/ })
            .locator("svg")
            .first()
            .evaluate((element) =>
              [...element.querySelectorAll("path")].map((path) =>
                path.getAttribute("d"),
              ),
            );
          const productSvg = await message
            .getByRole("button", { name: /source\.ts.*502-503/ })
            .locator("svg")
            .evaluate((element) =>
              [...element.querySelectorAll("path")].map((path) =>
                path.getAttribute("d"),
              ),
            );
          expect(productSvg).toEqual(sourceSvg);
          const nativeFileGeometry = await native
            .getByRole("button", { name: /source\.ts.*502-503/ })
            .evaluate((element) => {
              const style = getComputedStyle(element),
                rect = element.getBoundingClientRect();
              return {
                font: style.fontSize,
                line: style.lineHeight,
                width: rect.width,
                height: rect.height,
              };
            });
          expect(productFileGeometry.font).toBe(nativeFileGeometry.font);
          expect(productFileGeometry.line).toBe(nativeFileGeometry.line);
          if (width !== 390)
            expect(
              Math.abs(productFileGeometry.width - nativeFileGeometry.width),
            ).toBeLessThanOrEqual(1);
          await native.screenshot({
            path: info.outputPath(`native-citations-${width}-${theme}.png`),
            fullPage: true,
          });
          await native.evaluate(async (notes) => {
            const module = await import(
              /* @vite-ignore */ "./native-citation-reference.js?v=1"
            );
            (window as any).renderNativeElement(
              module.NativeCitationReference,
              { kind: "memory", entries: notes },
            );
          }, notes);
          const sourceMemory = native.getByRole("button", {
            name: "2 条记忆引用",
          });
          await expect(sourceMemory).toBeVisible();
          const nativeMemorySvg = await sourceMemory
            .locator("svg")
            .evaluate((element) => ({
              paths: [...element.querySelectorAll("path")].map((path) =>
                path.getAttribute("d"),
              ),
              width: element.getBoundingClientRect().width,
              height: element.getBoundingClientRect().height,
            }));
          expect(productMemorySvg).toEqual(nativeMemorySvg);
          await sourceMemory.focus();
          await expect(native.getByRole("tooltip")).toContainText("引用的记忆");
          const nativeTooltipGeometry = await native
            .getByRole("tooltip")
            .evaluate((element) => {
              const style = getComputedStyle(element);
              return {
                font: style.fontSize,
                line: style.lineHeight,
                radius: style.borderRadius,
                padding: style.padding,
              };
            });
          const nativeMemoryGeometry = await sourceMemory.evaluate(
            (element) => {
              const style = getComputedStyle(element);
              return { radius: style.borderRadius, padding: style.padding };
            },
          );
          expect(productTooltipGeometry).toEqual(nativeTooltipGeometry);
          expect(productMemoryGeometry).toEqual(nativeMemoryGeometry);
          await native.screenshot({
            path: info.outputPath(`native-memory-${width}-${theme}.png`),
            fullPage: true,
          });
          await native.close();
        }
        await page.evaluate(async () => {
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
          ] = await Promise.all([
            module(
              "/src/session-mode/components/codex/stores/useCodexStore.ts",
            ),
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
            module("/src/session-mode/stores/useWorkspaceStore.ts"),
          ]);
          useCodexStore.setState({ currentThreadId: "ux-1" });
          useWorkspaceStore.setState({ cwd: "/other-project" });
          useAgentCenterStore.setState({
            cardsViewMode: "grid",
            currentAgentCardId: "ux-1",
            currentAgentCardKind: "codex",
          });
        });
        await message
          .getByRole("button", { name: /source\.ts.*502-503/ })
          .click();
        const ace = page.locator(".session-mode .ace_editor").first();
        await expect(ace).toBeVisible();
        await expect
          .poll(() =>
            ace.evaluate((element: any) =>
              element.env.editor.getSelectedText(),
            ),
          )
          .toBe("line 502\nline 503");
        expect(
          await ace.evaluate((element: any) =>
            element.env.editor.getReadOnly(),
          ),
        ).toBe(true);
        const state = await page.evaluate(async () => {
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
            { useEditorStore },
            { readDraft, sessionDraftKey },
          ] = await Promise.all([
            module(
              "/src/session-mode/components/codex/stores/useCodexStore.ts",
            ),
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
            module("/src/session-mode/stores/useWorkspaceStore.ts"),
            module("/src/session-mode/stores/useEditorStore.ts"),
            module("/src/session-mode/stores/useSessionDraftStore.ts"),
          ]);
          return {
            thread: useCodexStore.getState().currentThreadId,
            card: useAgentCenterStore.getState().currentAgentCardId,
            cwd: useWorkspaceStore.getState().cwd,
            reveal: useEditorStore.getState().revealLocation,
            fileRoot:
              useEditorStore.getState().roots[
                useEditorStore.getState().activeFile
              ],
            a: readDraft(sessionDraftKey("codex", "ux-0")).text,
            b: readDraft(sessionDraftKey("codex", "ux-1")).text,
            keyboard:
              document.activeElement?.tagName === "TEXTAREA" ||
              (document.activeElement as HTMLElement)?.isContentEditable,
          };
        });
        expect(state).toMatchObject({
          thread: "ux-1",
          card: "ux-1",
          cwd: "/other-project",
          reveal: { path, line: 502, endLine: 503 },
          fileRoot: root,
          a: "Original A draft",
          b: "Original B draft",
          keyboard: false,
        });
        expect(
          fileReads.every((read) => !read.path.startsWith("/private")),
        ).toBe(true);
        expect(
          fixture.calls.filter((call) =>
            /\/codex\/(turn\/(start|steer)|thread\/(resume|fork|rollback))/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        expect(errors).toEqual([]);
        await page.screenshot({
          path: info.outputPath(
            `product-citations-range-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
        const receipt = {
          state,
          fileReads,
          productMemorySvg,
          productTooltipGeometry,
          productMemoryGeometry,
          productFileGeometry,
          copied,
          exported,
        };
        await writeFile(
          info.outputPath("captured-owner-receipt.json"),
          JSON.stringify(receipt, null, 2),
        );
        await info.attach("captured-owner-receipt", {
          body: JSON.stringify(receipt),
          contentType: "application/json",
        });
      });
  });

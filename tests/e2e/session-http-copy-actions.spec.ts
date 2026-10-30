import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { setup } from "./session-composer-v2-fixture";

const code = "  exact 中文 code\nconst answer = 42;\n";
const project = "/fixture/复制项目";
const rollout = "/fixture/rollouts/exact-thread.jsonl";
const message = "  完整消息原文\n引用 filecitefixture\n";
const todo = "待办原文\n第二行";
const uri = "https://example.invalid/resource?value=exact%20source";

async function observeRealCopyEvents(page: Page) {
  expect(
    await page.evaluate(() => ({
      secure: isSecureContext,
      clipboard: typeof navigator.clipboard,
    })),
  ).toEqual({ secure: false, clipboard: "undefined" });
  await page.evaluate(() => {
    (window as any).__httpActionCopies = [];
    (window as any).__httpActionProjectEvents = [];
    for (const name of ["session-open-projects", "session-reveal-project"])
      window.addEventListener(name, () =>
        (window as any).__httpActionProjectEvents.push(name),
      );
    // Observe the real event. Neither Clipboard API nor execCommand is replaced.
    // The boolean helper uses the browser's selected textarea/default copy;
    // the native writer supplies plain data on the event itself.
    window.addEventListener("copy", (event) => {
      const active = document.activeElement;
      const selected =
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement
          ? active.value.slice(
              active.selectionStart ?? 0,
              active.selectionEnd ?? 0,
            )
          : "";
      const plain = event.clipboardData?.getData("text/plain") ?? "";
      (window as any).__httpActionCopies.push({
        text: plain || selected || document.getSelection()?.toString() || "",
        source: plain
          ? "copy-event-data"
          : selected
            ? "selected-textarea"
            : "document-selection",
        prevented: event.defaultPrevented,
        activeTag: active?.tagName ?? null,
      });
    });
  });
}

async function saveEvidence(
  page: Page,
  path: string,
  boundary: string,
  errors: string[],
  calls: unknown[],
) {
  const state = await page.evaluate(() => ({
    copies: (window as any).__httpActionCopies ?? [],
    projectEvents: (window as any).__httpActionProjectEvents ?? [],
    todoDone: (window as any).__httpActionTodoDone ?? [],
    paste: (window as any).__httpActionPaste ?? null,
  }));
  writeFileSync(
    path,
    JSON.stringify({ boundary, ...state, errors, calls }, null, 2),
  );
  return state;
}

test("normal conversation copy actions transfer exact text on LAN HTTP", async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(60_000);
  test.skip(!baseURL?.startsWith("http:"), "Requires nonsecure LAN HTTP");
  const fixture = await setup(page, false, async (fixture) => {
    Object.assign(fixture.threads[0], {
      cwd: project,
      path: rollout,
      turns: [
        {
          id: "http-copy-turn",
          status: "completed",
          items: [
            {
              type: "agentMessage",
              id: "http-copy-reply",
              phase: "final_answer",
              text: "```text\n" + code + "```",
            },
          ],
        },
      ],
    });
  });
  try {
    await expect(page.locator(".codex-native-code-fence")).toBeVisible();
    await observeRealCopyEvents(page);
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await editor.fill("菜单复制不能发送这份草稿");
    for (const label of [
      "复制最后一个代码块",
      "复制工作目录",
      "复制对话路径",
      "复制页面链接",
    ]) {
      const more = page.getByRole("button", {
        name: "当前会话的更多操作",
        exact: true,
      });
      if (!(await more.isVisible()))
        await page
          .getByRole("button", { name: "附加文件", exact: true })
          .click();
      await page
        .getByRole("button", { name: "当前会话的更多操作", exact: true })
        .click();
      await page.getByRole("menuitem", { name: label, exact: true }).click();
    }
    if (
      await page
        .getByRole("button", { name: "当前会话的更多操作", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "附加文件", exact: true }).click();
    const rowMenu = page
      .getByRole("button", { name: "会话操作", exact: true })
      .first();
    // Desktop row actions appear on row hover/focus. Enter through the row as a
    // user would; clicking the hidden action itself correctly hits the age label.
    await rowMenu.locator("xpath=ancestor::*[contains(@class, 'session-nav-row')][1]").hover();
    await expect(rowMenu).toHaveCSS("pointer-events", "auto");
    await rowMenu.click();
    await page.getByRole("menuitem", { name: "复制会话 ID", exact: true }).click();
    const state = await saveEvidence(
      page,
      info.outputPath("conversation-http-copy.json"),
      "Normal current-conversation menu in the fixture-backed product page; real HTTP copy events, no system paste assertion.",
      fixture.errors,
      fixture.calls,
    );
    // lastAssistantCodeBlock deliberately removes the fence's final newline.
    expect(state.copies).toEqual(
      [code.slice(0, -1), project, rollout, page.url(), "ux-0"].map((text) =>
        expect.objectContaining({
          text,
          source: "copy-event-data",
          prevented: true,
        }),
      ),
    );
    await expect(editor).toHaveText("菜单复制不能发送这份草稿");
    expect(fixture.calls).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

async function mountCopyComponents(page: Page) {
  await page.evaluate(
    async ({ message, todo, uri, project }) => {
      const load = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const react = await import(
        (window as any).__sessionFixtureDependency("react.js")
      );
      const dom = await import(
        (window as any).__sessionFixtureDependency("react-dom_client.js")
      );
      const React = react.default ?? react;
      const [
        { CopyButton },
        { TodoContextMenu },
        { ToolContent },
        remote,
        identity,
      ] = await Promise.all([
        load("/src/session-mode/components/common/CopyButton.tsx"),
        load("/src/session-mode/features/todos/TodoContextMenu.tsx"),
        load("/src/session-mode/components/codex/presentation/ToolContent.tsx"),
        load("/src/session-mode/components/settings/RemoteAccessSettings.tsx"),
        load("/src/session-mode/components/agent/SessionIdentity.tsx"),
      ]);
      const noop = () => {};
      (window as any).__httpActionTodoDone = [];
      const target = {
        id: "http-todo",
        text: todo,
        isDone: false,
        categoryId: null,
        pinnedAt: null,
      };
      function Harness() {
        return React.createElement(
          React.Fragment,
          null,
          React.createElement("h2", null, "隔离组件复制验收"),
          React.createElement(CopyButton, { text: message }),
          React.createElement("textarea", { "aria-label": "粘贴验证" }),
          React.createElement(
            TodoContextMenu,
            {
              targets: [target],
              categories: [],
              isExpanded: false,
              onToggleDone: (done: boolean) =>
                (window as any).__httpActionTodoDone.push({
                  id: target.id,
                  done,
                }),
              onPin: noop,
              onMove: noop,
              onToggleExpand: noop,
              onEdit: noop,
              onDelete: noop,
              onSendToComposer: noop,
            },
            React.createElement("button", { type: "button" }, "待办复制行"),
          ),
          React.createElement(ToolContent, {
            content: [{ type: "resource_link", uri, name: "复制资源" }],
          }),
          React.createElement(remote.RemoteAccessSettings),
          React.createElement(identity.SessionProjectLabel, {
            card: { cwd: project },
          }),
        );
      }
      const host = document.createElement("div");
      host.id = "http-copy-components";
      host.className = "session-mode codex-presentation";
      host.style.cssText =
        "position:fixed;z-index:100;inset:70px 12px 210px;overflow:auto;padding:16px;background:var(--codex-surface)";
      document.querySelector(".session-mode")!.append(host);
      const root = (dom.default ?? dom).createRoot(host);
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(Harness),
        ),
      );
      (window as any).__httpActionUnmount = () => {
        root.unmount();
        host.remove();
        delete (window as any).__httpActionUnmount;
      };
    },
    { message, todo, uri, project },
  );
  return page.locator("#http-copy-components");
}

for (const width of [390, 1440]) {
  test.describe(`HTTP component copies ${width}`, () => {
    test.use({ viewport: { width, height: 1000 }, hasTouch: width === 390 });
    test("copies message, Todo, resource, web URL and project without task writes", async ({
      page,
      baseURL,
    }, info) => {
      test.setTimeout(60_000);
      test.skip(!baseURL?.startsWith("http:"), "Requires nonsecure LAN HTTP");
      const fixture = await setup(page, false);
      try {
        await observeRealCopyEvents(page);
        const host = await mountCopyComponents(page);
        await host.getByRole("heading", { name: "隔离组件复制验收" }).waitFor();
        await host.getByRole("button", { name: "Copy", exact: true }).click();
        await expect(
          host.getByRole("button", { name: "Copied", exact: true }),
        ).toBeVisible();
        const paste = host.getByRole("textbox", { name: "粘贴验证" });
        await paste.focus();
        await page.keyboard.press("ControlOrMeta+v");
        const nativePaste = await paste.inputValue();
        for (const label of ["Copy", "Copy as list"]) {
          await host
            .getByRole("button", { name: "待办复制行" })
            .click({ button: "right" });
          await page
            .getByRole("menuitem", {
              name: label === "Copy" ? /^Copy\s*⌘C$/ : /^Copy as list\s*⇧⌘C$/,
            })
            .click();
        }
        await host
          .getByRole("button", { name: "打开方式", exact: true })
          .click();
        await host
          .getByRole("menuitem", { name: "复制链接", exact: true })
          .click();
        await host
          .getByRole("button", { name: "复制地址", exact: true })
          .click();
        await host.getByRole("button", { name: /^项目详情：/ }).click();
        await page
          .getByRole("menuitem", { name: "复制项目路径", exact: true })
          .click();
        await page
          .locator(".session-project-details-menu")
          .waitFor({ state: "detached" });
        await paste.fill("");
        await paste.focus();
        await page.keyboard.press("ControlOrMeta+v");
        const projectPaste = await paste.inputValue();
        await page.evaluate(
          ({ nativePaste, projectPaste, expected }) => {
            (window as any).__httpActionPaste = {
              supportedByNativeControl: nativePaste === expected,
              nativePaste,
              projectPaste,
            };
          },
          { nativePaste, projectPaste, expected: message },
        );
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).__httpActionCopies.length),
          )
          .toBe(6);
        const state = await saveEvidence(
          page,
          info.outputPath("component-http-copy.json"),
          "Actual product components in a private fixture React root; Todo uses real browser right-click, including the touch-capable viewport. This is not the complete navigation flow, physical-device testing, or external paste verification.",
          fixture.errors,
          fixture.calls,
        );
        expect(state.copies.map((copy: { text: string }) => copy.text)).toEqual(
          [
            message,
            todo,
            "- " + todo,
            uri,
            new URL("/?mode=session", page.url()).href,
            project,
          ],
        );
        expect(state.todoDone).toEqual([
          { id: "http-todo", done: true },
          { id: "http-todo", done: true },
        ]);
        expect(state.projectEvents).toEqual([]);
        if (state.paste?.supportedByNativeControl)
          expect(state.paste.projectPaste).toBe(project);
        expect(fixture.calls).toEqual([]);
        expect(fixture.errors).toEqual([]);
        await page.screenshot({
          path: info.outputPath(`http-copy-components-${width}.png`),
        });
      } finally {
        await page
          .evaluate(() => (window as any).__httpActionUnmount?.())
          .catch(() => {});
        await fixture.close();
      }
    });
  });
}

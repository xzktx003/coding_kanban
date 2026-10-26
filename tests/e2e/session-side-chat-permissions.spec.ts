import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const inputs = [
  "apps/web/src/session-mode/components/codex/composer/AccessModePopover.tsx",
  "apps/web/src/session-mode/components/codex/composer/Composer.tsx",
  "apps/web/src/session-mode/components/codex/composer/SideChatPanel.tsx",
  "apps/web/src/session-mode/components/codex/composer/AccessModePopover.native.test.tsx",
  "apps/web/src/session-mode/components/codex/composer/SideChatPanel.permissions.test.tsx",
  "apps/web/src/session-mode/services/conversationActions.ts",
  "apps/web/src/session-mode/services/conversationActions.fork-settings.test.ts",
  "apps/web/src/session-mode/services/nativeThreadSettings.ts",
  "apps/web/src/session-mode/services/followupService.ts",
  "apps/web/src/session-mode/hooks/useThreadModelSettings.ts",
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/components/common/useSessionActionConfirmation.tsx",
  "apps/web/src/session-mode/components/ui/dropdown-menu.tsx",
  "apps/web/src/session-mode/components/ui/dialog.tsx",
  "apps/web/src/session-mode/session-composer-compact.css",
  "apps/web/src/session-mode/components/codex/composer/composer-native.css",
  "apps/web/src/session-mode/components/codex/composer/v2/drafts.ts",
  "apps/web/src/session-mode/features/subagents/store.ts",
  "tests/e2e/session-side-chat-permissions.spec.ts",
  "tests/e2e/session-ux-fixture.ts",
];
const hashes = () =>
  inputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));

for (const width of [1440, 390]) {
  test(`side permission actions preserve the main thread and drafts at ${width}px`, async ({
    page,
  }, info) => {
    const before = hashes();
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    const states: Array<{ phase: string; value: unknown }> = [];
    const layouts: Array<{
      phase: string;
      value: Awaited<ReturnType<typeof layout>>;
    }> = [];
    let failure: string | null = null;
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const effectivePolicy = {
      type: "workspaceWrite" as const,
      writableRoots: ["/fixture/effective-root"],
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    };
    const fixture = await installSessionUxFixture(page, 1, {
      forkSettings: {
        sandbox: effectivePolicy,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        reasoningEffort: null,
        serviceTier: "fast",
      },
    });
    const hmrConnections: Array<{ host: string; path: string }> = [];
    // Only the owned Vite handshake stays real; application sockets remain
    // isolated by the existing fixture route throughout page teardown.
    await page.routeWebSocket(
      (url) =>
        url.host === new URL(info.project.use.baseURL!).host &&
        url.pathname === "/" &&
        url.searchParams.has("token") &&
        [...url.searchParams.keys()].every((key) => key === "token"),
      (socket) => {
        const url = new URL(socket.url());
        hmrConnections.push({ host: url.host, path: url.pathname });
        socket.connectToServer();
      },
    );
    const snapshot = () =>
      page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const [
          { useCodexStore },
          { getThreadModelSettings },
          { useSideChatStore },
        ] = await Promise.all([
          load("/src/session-mode/components/codex/stores/useCodexStore.ts"),
          load("/src/session-mode/stores/useThreadModelStore.ts"),
          load("/src/session-mode/stores/useSideChatStore.ts"),
        ]);
        const select = (id: string | null) => {
          const value = getThreadModelSettings(id);
          return {
            model: value.model,
            reasoningEffort: value.reasoningEffort,
            serviceTier: value.serviceTier,
            sandbox: value.sandbox,
            sandboxPolicy: value.sandboxPolicy,
            approvalPolicy: value.approvalPolicy,
            approvalsReviewer: value.approvalsReviewer,
            collaborationMode: value.collaborationMode,
          };
        };
        const sideId = useSideChatStore.getState().chat?.id ?? null;
        const active = document.activeElement;
        return {
          main: select("ux-0"),
          side: sideId ? select(sideId) : null,
          defaults: select(null),
          sideId,
          currentThreadId: useCodexStore.getState().currentThreadId,
          inputFocusTrigger: useCodexStore.getState().inputFocusTrigger,
          active: active
            ? {
                tag: active.tagName,
                label: active.getAttribute("aria-label"),
                inSide: Boolean(active.closest(".session-side-chat")),
              }
            : null,
        };
      });
    const layout = () =>
      page.evaluate(() => {
        const side = document.querySelector<HTMLElement>(".session-side-chat")!;
        const frame = side.querySelector<HTMLElement>(
          "form.session-compact-composer > .session-compact-frame",
        )!;
        const toolbar = frame.querySelector<HTMLElement>(
          ".session-composer-toolbar",
        )!;
        const rect = (element: Element) => {
          const r = element.getBoundingClientRect();
          return {
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            left: r.left,
            width: r.width,
            height: r.height,
          };
        };
        const meta = toolbar.querySelector<HTMLElement>(
          ".session-compact-meta",
        )!;
        const status = meta.querySelector<HTMLElement>(
          ".session-compact-status",
        )!;
        const main = document.querySelector<HTMLElement>(
          ".session-codex-composer > .session-composer-form > .session-compact-frame",
        )!;
        const mainStyle = getComputedStyle(main);
        return {
          frame: rect(frame),
          body: rect(frame.querySelector(".session-compact-body")!),
          policy: rect(toolbar.querySelector(".session-composer-policy")!),
          actions: rect(toolbar.querySelector(".session-composer-actions")!),
          meta: rect(meta),
          helper: rect(meta.firstElementChild!),
          status: rect(status),
          statusText: status.textContent,
          statusRole: status.getAttribute("role"),
          metaPosition: getComputedStyle(meta).position,
          statusWhiteSpace: getComputedStyle(status).whiteSpace,
          frameOverflow: frame.scrollHeight - frame.clientHeight,
          statusOverflow: status.scrollHeight - status.clientHeight,
          horizontalOverflow: Math.max(
            frame.scrollWidth - frame.clientWidth,
            meta.scrollWidth - meta.clientWidth,
            status.scrollWidth - status.clientWidth,
          ),
          buttons: [...toolbar.querySelectorAll("button")]
            .map((button) => ({
              label: button.getAttribute("aria-label") ?? button.textContent,
              ...rect(button),
            }))
            .filter((button) => button.height > 0),
          main: {
            width: main.clientWidth,
            height: main.clientHeight,
            display: mainStyle.display,
            padding: mainStyle.padding,
            gap: mainStyle.gap,
          },
        };
      });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/?mode=session&view=agent", {
        waitUntil: "domcontentloaded",
      });
      await seedSessionUx(page, 1);
      await page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const [{ useAgentCenterStore }, { useLayoutStore }] = await Promise.all(
          [
            load("/src/session-mode/stores/useAgentCenterStore.ts"),
            load("/src/session-mode/stores/useLayoutStore.ts"),
          ],
        );
        useLayoutStore.setState({ isSidebarOpen: false });
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "权限归属验收",
          },
          { activate: true },
        );
      });
      const mainEditor = page
        .locator(".session-codex-composer [contenteditable=true]")
        .first();
      await expect(mainEditor).toBeVisible();
      await mainEditor.fill("主会话未发送草稿");
      await page.getByRole("button", { name: "附加文件", exact: true }).click();
      await page
        .getByRole("button", { name: "当前会话的更多操作", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "侧边聊天", exact: true })
        .click();
      const side = page.getByRole("region", { name: "侧边聊天", exact: true });
      await expect(side).toBeVisible();
      const sideEditor = side.getByRole("textbox", { name: "侧边聊天输入" });
      await sideEditor.fill("侧边会话未发送草稿");
      const initial = await snapshot();
      states.push({ phase: "opened-through-fork-menu", value: initial });
      layouts.push({ phase: "idle", value: await layout() });
      expect(initial.sideId).toBe("ux-side");
      expect(initial.currentThreadId).toBe("ux-0");
      expect(initial.side).toMatchObject({
        sandbox: "workspace-write",
        sandboxPolicy: effectivePolicy,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        reasoningEffort: null,
        serviceTier: "fast",
      });
      expect(initial.main.sandbox).toBe("danger-full-access");
      expect(initial.defaults.approvalPolicy).toBe("never");
      const trigger = side.getByRole("button", { name: /^执行权限：/ });
      const open = async () => {
        await trigger.click();
        return page.getByRole("menu");
      };
      const check = async (phase: string) => {
        const state = await snapshot();
        states.push({ phase, value: state });
        expect(state.main).toEqual(initial.main);
        expect(state.defaults).toEqual(initial.defaults);
        expect(state.currentThreadId).toBe("ux-0");
        expect(state.inputFocusTrigger).toBe(initial.inputFocusTrigger);
        await expect(mainEditor).toHaveText("主会话未发送草稿");
        await expect(sideEditor).toHaveValue("侧边会话未发送草稿");
        return state;
      };
      await (await open()).getByRole("menuitemradio", { name: "只读" }).click();
      await expect(trigger).toBeFocused();
      expect((await check("read-only")).side?.sandbox).toBe("read-only");
      await (await open()).getByRole("menuitem", { name: "计划模式" }).click();
      await expect(trigger).toBeFocused();
      expect((await check("plan")).side?.collaborationMode).toBe("plan");
      await (await open())
        .getByRole("menuitemradio", { name: /请求批准/ })
        .click();
      await expect(trigger).toBeFocused();
      const requested = await check("request-approval");
      expect(requested.side?.sandbox).toBe("workspace-write");
      expect(requested.side?.collaborationMode).toBe("default");
      await (await open())
        .getByRole("menuitemradio", { name: /完全访问权限/ })
        .click();
      const dialog = page.getByRole("dialog", { name: "要开启完整访问权限吗？" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect((await check("full-access-cancelled")).side).toEqual(
        requested.side,
      );
      await (await open())
        .getByRole("menuitemradio", { name: /完全访问权限/ })
        .click();
      await dialog
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      expect((await check("full-access-confirmed")).side?.sandbox).toBe(
        "danger-full-access",
      );
      await open();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await check("escape");
      // Use the actual store-driven notice and alert, retaining business I/O
      // interception; no message is submitted to manufacture these states.
      await page.evaluate(async () => {
        const path = "/src/session-mode/stores/useThreadModelStore.ts";
        const { useThreadModelStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        useThreadModelStore.setState((s: any) => ({
          threads: {
            ...s.threads,
            "ux-side": {
              ...s.threads["ux-side"],
              notice: {
                id: 1,
                from: "原模型".repeat(24),
                to: "目标模型".repeat(24),
                dismissed: false,
              },
            },
          },
        }));
      });
      await expect(side.locator(".session-compact-status")).toContainText(
        "模型已从",
      );
      layouts.push({ phase: "long-model-notice", value: await layout() });
      const metadata = await page.evaluate(async () => {
        const path =
          "/src/session-mode/components/codex/stores/useCodexStore.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        return {
          ...useCodexStore
            .getState()
            .threads.find((thread: any) => thread.id === "ux-side"),
          source: { subAgent: {} },
          parentThreadId: "ux-0",
          canAcceptDirectInput: null,
        };
      });
      await page.route(
        (url) => url.pathname === "/api/session/api/codex/thread/metadata",
        async (route) => {
          if (route.request().postDataJSON()?.threadId !== "ux-side")
            return route.fallback();
          await route.fulfill({ json: { thread: metadata } });
        },
      );
      await page.evaluate(async (metadata) => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const [
          { useCodexStore },
          { useSubagentStore },
          { useComposerDraftStore },
        ] = await Promise.all([
          load("/src/session-mode/components/codex/stores/useCodexStore.ts"),
          load("/src/session-mode/features/subagents/store.ts"),
          load("/src/session-mode/components/codex/composer/v2/drafts.ts"),
        ]);
        useSubagentStore.setState((s: any) => {
          const identities = { ...s.identities };
          delete identities["ux-side"];
          return { identities };
        });
        useCodexStore.setState((s: any) => ({
          threads: s.threads.map((thread: any) =>
            thread.id === "ux-side" ? metadata : thread,
          ),
        }));
        useComposerDraftStore.setState({ error: "fixture storage error" });
      }, metadata);
      const recheck = side.getByRole("button", {
        name: "重新核对",
        exact: true,
      });
      await expect(recheck).toBeVisible();
      await expect(recheck).toBeEnabled();
      await expect(side.locator(".session-compact-status")).toHaveAttribute(
        "role",
        "alert",
      );
      layouts.push({
        phase: "identity-alert-and-recheck",
        value: await layout(),
      });
      await expect(mainEditor).toHaveText("主会话未发送草稿");
      await expect(sideEditor).toHaveValue("侧边会话未发送草稿");
      await expect(page.locator('[data-tab-key="codex:ux-0"]')).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        fixture.calls.filter((call) => call.path.endsWith("/thread/fork")),
      ).toHaveLength(1);
      expect(
        fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|steer|interrupt)|followups\/(?:submit|stop)|thread\/delete)$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      await page.screenshot({
        path: info.outputPath("side-permission-state.png"),
      });
      for (const { phase, value } of layouts) {
        expect(
          value.meta.top,
          `${phase}: footer below both control groups`,
        ).toBeGreaterThanOrEqual(
          Math.max(value.policy.bottom, value.actions.bottom) - 0.5,
        );
        expect(value.metaPosition, `${phase}: footer in normal flow`).toBe(
          "static",
        );
        expect(
          value.meta.bottom,
          `${phase}: footer inside frame`,
        ).toBeLessThanOrEqual(value.frame.bottom + 0.5);
        expect(
          value.body.height,
          `${phase}: usable editor area`,
        ).toBeGreaterThanOrEqual(62);
        expect(
          value.horizontalOverflow,
          `${phase}: no horizontal clipping`,
        ).toBeLessThanOrEqual(1);
        expect(
          value.frameOverflow,
          `${phase}: no vertical clipping`,
        ).toBeLessThanOrEqual(1);
        expect(
          value.statusOverflow,
          `${phase}: full status visible`,
        ).toBeLessThanOrEqual(1);
        expect(value.main, `${phase}: main frame unchanged`).toEqual(
          layouts[0].value.main,
        );
        for (const button of value.buttons) {
          expect(
            button.height,
            `${phase}: ${button.label} touch height`,
          ).toBeGreaterThanOrEqual(44);
          expect(
            button.width,
            `${phase}: ${button.label} touch width`,
          ).toBeGreaterThanOrEqual(44);
        }
      }
    } catch (error) {
      failure = String(error);
      throw error;
    } finally {
      const after = hashes();
      const path = info.outputPath("side-permission-evidence.json");
      writeFileSync(
        path,
        JSON.stringify(
          {
            width,
            boundary:
              "Actual product fork menu and permission controls under isolated HTTP fixtures; no native permission write or real turn",
            before,
            after,
            states,
            layouts,
            calls: fixture.calls,
            errors,
            consoleErrors,
            hmrConnections,
            failure,
          },
          null,
          2,
        ),
      );
      await info.attach("side-permission-evidence", {
        path,
        contentType: "application/json",
      });
      expect(after).toEqual(before);
      // Keep all API/WS interception through the page fixture's teardown.
    }
  });
}

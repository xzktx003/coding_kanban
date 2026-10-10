import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const claudeId = "cc-mixed-input";
const text = { codex: "Codex A 未发送的文字", cc: "Claude B 未发送的文字" };
const image = { codex: "codex-owner.png", cc: "claude-owner.png" };

const input = (page: Page, kind: "codex" | "cc") =>
  page.locator(
    kind === "codex"
      ? ".session-agent-view .session-codex-composer [contenteditable=true]:visible"
      : ".session-agent-view textarea:visible",
  );
const tab = (page: Page, kind: "codex" | "cc") =>
  page.locator(
    `[role=tab][data-tab-key="${kind}:${kind === "codex" ? "ux-0" : claudeId}"]`,
  );
const images = (page: Page) =>
  page.locator(
    ".session-agent-view .session-context-chip.is-image, .session-agent-view .session-attachment",
  );

for (const profile of [
  { width: 390, touch: true, theme: "dark" },
  { width: 390, touch: true, theme: "light" },
  { width: 1440, touch: false, theme: "dark" },
] as const) {
  test.describe(`mixed agent input ${profile.width}px ${profile.theme}`, () => {
    test.use({
      viewport: { width: profile.width, height: 844 },
      hasTouch: profile.touch,
      isMobile: profile.touch,
    });
    test("passive Codex and Claude tab navigation restores both drafts and images with the correct focus policy", async ({
      page,
    }, info) => {
      test.setTimeout(90000);
      const fixture = await installSessionUxFixture(page, 2);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const state = { phase: "setup", events: [] as unknown[] };
        (window as any).__mixedInputFocus = state;
        const record = (event: Event) => {
          const target = event.target instanceof Element ? event.target : null;
          state.events.push({
            phase: state.phase,
            type: event.type,
            trusted: event.isTrusted,
            tag: target?.tagName ?? null,
            tab: target
              ?.closest("[data-tab-key]")
              ?.getAttribute("data-tab-key"),
            activeTag: document.activeElement?.tagName,
            activeEditable:
              document.activeElement?.matches(
                "[contenteditable=true], textarea, input:not([type=file])",
              ) ?? false,
            stack:
              event.type === "cc-input-focus-request"
                ? new Error("native focus request witness").stack
                : undefined,
          });
        };
        document.addEventListener("pointerdown", record, true);
        document.addEventListener("focusin", record, true);
        window.addEventListener("cc-input-focus-request", record);
      });
      await page.route("**/api/session/files/upload", (route) =>
        route.fulfill({
          json: { path: `/fixture/${route.request().postDataJSON().name}` },
        }),
      );
      await page.route("**/api/**/cc/session-messages**", (route) =>
        route.fulfill({ json: [] }),
      );
      await page.route("**/api/**/cc/sessions?*", (route) =>
        route.fulfill({ json: { sessions: [], total: 0 } }),
      );
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await input(page, "codex").waitFor({ timeout: 60000 });
      await seedSessionUx(page, 2);
      await page.evaluate(
        async ({ theme, claudeId, codexCwd }) => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
          const [
            { useAgentCenterStore },
            { useCCStore },
            { useLayoutStore },
            { useThemeStore },
          ] = await Promise.all([
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
            module("/src/session-mode/stores/cc/index.ts"),
            module("/src/session-mode/stores/useLayoutStore.ts"),
            module("/src/session-mode/stores/settings/useThemeStore.ts"),
          ]);
          useThemeStore.getState().setTheme(theme);
          useLayoutStore.setState({
            view: "agent",
            isSidebarOpen: false,
            isRightPanelOpen: false,
          });
          useCCStore.setState({
            activeSessionIds: [claudeId],
            sessionMessagesMap: {
              [claudeId]: [
                {
                  type: "assistant",
                  uuid: "mixed-claude-original-renderer",
                  session_id: claudeId,
                  message: {
                    content: [
                      { type: "text", text: "Claude 原渲染器保持原样" },
                    ],
                  },
                },
              ],
            },
            sessionLoadingMap: {},
          });
          useAgentCenterStore.getState().addAgentCard(
            {
              kind: "codex",
              id: "ux-0",
              cwd: codexCwd,
              preview: "Mixed Codex A",
            },
            { activate: true },
          );
          useAgentCenterStore.getState().addAgentCard(
            {
              kind: "cc",
              id: claudeId,
              cwd: "/fixture/claude-original-project",
              preview: "Mixed Claude B",
            },
            { activate: false },
          );
          useAgentCenterStore.setState({ cardsViewMode: "solo" });
        },
        {
          theme: profile.theme,
          claudeId,
          codexCwd: fixture.threads[0].cwd,
        },
      );
      const activate = async (control: Locator) =>
        profile.touch ? control.tap() : control.click();
      const select = async (kind: "codex" | "cc") => {
        await activate(tab(page, kind).locator(".session-identity-title"));
        await expect(tab(page, kind)).toHaveAttribute("aria-selected", "true");
        await expect(input(page, kind)).toBeVisible();
      };
      const addImage = async (kind: "codex" | "cc") => {
        await activate(
          page.getByRole("button", {
            name: "添加附件与上下文",
            exact: true,
          }),
        );
        const chosen = page.waitForEvent("filechooser");
        await activate(
          page.getByRole("button", { name: "上传图片", exact: true }),
        );
        await (
          await chosen
        ).setFiles([{ name: image[kind], mimeType: "image/png", buffer: png }]);
        await expect(images(page)).toHaveCount(1);
        await expect(images(page)).toHaveAttribute("data-state", "ready");
        await expect(
          images(page).getByRole("button", {
            name: `预览 ${image[kind]}`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(images(page).locator("img")).toHaveJSProperty(
          "naturalWidth",
          1,
        );
      };
      await select("codex");
      await input(page, "codex").fill(text.codex);
      await addImage("codex");
      await select("cc");
      await input(page, "cc").fill(text.cc);
      await addImage("cc");
      await select("codex");
      const phases: unknown[] = [];
      const source = Object.fromEntries(
        await Promise.all(
          [
            "apps/web/src/session-mode/components/agent/AgentComposer.tsx",
            "apps/web/src/session-mode/components/cc/composer/Composer.tsx",
            "tests/e2e/session-mixed-agent-input.spec.ts",
          ].map(async (path) => [
            path,
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex"),
          ]),
        ),
      );
      for (const kind of ["cc", "codex", "cc"] as const) {
        await page.evaluate((kind) => {
          (window as any).__mixedInputFocus.phase = `passive-${kind}`;
        }, kind);
        await select(kind);
        if (kind === "cc") await expect(input(page, kind)).toHaveValue(text.cc);
        else await expect(input(page, kind)).toHaveText(text.codex);
        await expect(images(page)).toHaveCount(1);
        await expect(
          images(page).getByRole("button", {
            name: `预览 ${image[kind]}`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(images(page).locator("img")).toHaveJSProperty(
          "naturalWidth",
          1,
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        const focus = await page.evaluate(() => ({
          hasFocus: document.hasFocus(),
          activeTag: document.activeElement?.tagName,
          activeClass: document.activeElement?.className,
          editable:
            document.activeElement?.matches(
              "[contenteditable=true], textarea, input:not([type=file])",
            ) ?? false,
          target: document.querySelector(".session-input-target")?.textContent,
          events: (window as any).__mixedInputFocus.events,
        }));
        phases.push({ kind, focus });
        await writeFile(
          info.outputPath("mixed-agent-input-focus-witness.json"),
          JSON.stringify({ profile, source, phases, errors }, null, 2),
        );
        await page.screenshot({
          path: info.outputPath(`mixed-agent-${kind}-${phases.length}.png`),
          fullPage: true,
        });
        if (profile.touch) {
          expect(focus.editable).toBe(false);
          expect(
            focus.events.filter(
              (event: any) =>
                event.phase.startsWith("passive-") &&
                event.type === "cc-input-focus-request",
            ),
          ).toEqual([]);
        } else await expect(input(page, kind)).toBeFocused();
      }
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter((call) =>
          /\/turn\/(start|steer|interrupt)|\/thread\/(resume|start)|\/cc\/(send-message|resume-session)|\/followups\/submit|\/stop$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
    });
  });
}

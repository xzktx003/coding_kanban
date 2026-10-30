import { test, expect } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { writeFile } from "node:fs/promises";

for (const kind of ["cc", "acp"])
  for (const width of [1440, 393])
    test(`${kind} long history preserves reading, input and approvals at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 852 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await installSessionUxFixture(page, 0);
      const cards =
        kind === "cc"
          ? [
              {
                kind: "cc",
                id: "audit-cc",
                cwd: "/fixture/audit",
                preview: "Audit Claude",
              },
            ]
          : [];
      await page.route("**/api/session/tabs", (r) =>
        r.fulfill({
          json: { cards, initialized: true, revision: 1, sequence: 0 },
        }),
      );
      await page.goto("/?mode=session");
      await expect(
        page.locator(".session-mode [contenteditable=true]").first(),
      ).toBeVisible();
      const started = Date.now();
      await page.evaluate(async (kind) => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        const [
          { useAgentSettingsStore },
          { useAgentCenterStore },
          { useCCStore },
          { useAcpStore },
        ] = await Promise.all([
          load("/src/session-mode/stores/useAgentSettingsStore.ts"),
          load("/src/session-mode/stores/useAgentCenterStore.ts"),
          load("/src/session-mode/stores/cc/index.ts"),
          load("/src/session-mode/stores/useAcpStore.ts"),
        ]);
        useAgentCenterStore.setState({
          cards:
            kind === "cc"
              ? [
                  {
                    kind: "cc",
                    id: "audit-cc",
                    cwd: "/fixture/audit",
                    preview: "Audit Claude",
                  },
                ]
              : [],
          currentAgentCardId: kind === "cc" ? "audit-cc" : null,
          currentAgentCardKind: kind === "cc" ? "cc" : null,
          cardsViewMode: "solo",
        });
        useAgentSettingsStore.setState({
          selectedAgent: kind === "cc" ? "cc" : "codex",
        });
        if (kind === "cc") {
          const messages = Array.from({ length: 1000 }, (_, i) => ({
            type: "assistant",
            uuid: `audit-${i}`,
            message: {
              id: `audit-${i}`,
              role: "assistant",
              content: [
                {
                  type: "text",
                  text:
                    `Audit history ${i}\n\n` + "Readable content. ".repeat(10),
                },
              ],
            },
          }));
          useAcpStore.setState({ active: false });
          useCCStore.setState({
            activeSessionId: "audit-cc",
            messages,
            sessionMessagesMap: { "audit-cc": messages },
            isLoading: false,
          });
        } else
          useAcpStore.setState({
            active: true,
            connectionId: "audit-acp",
            sessionId: "audit-acp-session",
            entries: Array.from({ length: 1000 }, (_, i) => ({
              id: `audit-${i}`,
              role: "agent",
              text: `Audit history ${i}\n\n` + "Readable content. ".repeat(10),
            })),
            running: false,
            connecting: false,
          });
      }, kind);
      try {
        await expect(page.getByText(/^Audit history 999/)).toBeAttached({
          timeout: 30000,
        });
      } catch (error) {
        await info.attach("initial-layout.json", {
          contentType: "application/json",
          body: JSON.stringify(
            await page.evaluate(() => {
              const list = document.querySelector("[data-virtual-transcript]");
              let node: Element | null = list;
              const ancestry = [];
              while (node && ancestry.length < 10) {
                const style = getComputedStyle(node);
                ancestry.push({
                  className: node.className,
                  height: node.clientHeight,
                  scrollHeight: node.scrollHeight,
                  scrollTop: node.scrollTop,
                  overflow: style.overflowY,
                  rect: node.getBoundingClientRect().toJSON(),
                });
                node = node.parentElement;
              }
              return {
                rows: [
                  ...document.querySelectorAll("[data-transcript-row]"),
                ].map((n) => n.getAttribute("data-transcript-row")),
                ancestry,
              };
            }),
          ),
        });
        throw error;
      }
      const measured = await page.evaluate((kind) => {
        const root = document.querySelector(
          kind === "cc" ? ".thread-surface" : "[data-acp-history]",
        );
        return {
          kind,
          mountedRows:
            kind === "cc"
              ? document.querySelectorAll("[data-cc-message]").length
              : root?.children.length,
          mountedElements: root?.querySelectorAll("*").length,
        };
      }, kind);
      await writeFile(
        info.outputPath("provider-history.json"),
        JSON.stringify(
          {
            ...measured,
            seedToAttachedMs: Date.now() - started,
            boundary:
              "Synthetic store hydration, 1000 assistant messages, real React DOM. Not native history/network performance or UI-click latency.",
          },
          null,
          2,
        ),
      );
      expect(
        measured.mountedRows,
        "long histories should render a bounded viewport",
      ).toBeLessThan(100);
      const list = page
        .locator(`[data-virtual-transcript^="${kind}:"]`)
        .first();
      const viewport =
        kind === "cc"
          ? list.locator("xpath=../..")
          : page.locator("[data-acp-history]");
      await viewport.hover();
      await page.mouse.wheel(0, -1500);
      await expect(page.getByText(/^Audit history 999/)).not.toBeInViewport();
      const anchor = await viewport.evaluate((el) => {
        const node = [
          ...el.querySelectorAll<HTMLElement>("[data-transcript-row]"),
        ].find(
          (node) =>
            node.getBoundingClientRect().bottom >
            el.getBoundingClientRect().top,
        );
        return {
          key: node?.dataset.transcriptRow,
          offset: node
            ? node.getBoundingClientRect().top - el.getBoundingClientRect().top
            : 0,
        };
      });
      expect(anchor.key).toBeTruthy();
      await page.evaluate(async (kind) => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        if (kind === "cc") {
          const { useCCStore } = await load(
            "/src/session-mode/stores/cc/index.ts",
          );
          const messages = [
            ...useCCStore.getState().messages,
            {
              type: "assistant",
              uuid: "audit-1000",
              message: {
                role: "assistant",
                content: [
                  { type: "text", text: "New final reply while reading" },
                ],
              },
            },
            {
              type: "permission_request",
              sessionId: "audit-cc",
              requestId: "virtual-approval",
              toolName: "Read",
              toolInput: { file_path: "/fixture/read-only.txt" },
            },
          ];
          useCCStore.setState({
            messages,
            sessionMessagesMap: { "audit-cc": messages },
          });
        } else {
          const { useAcpStore } = await load(
            "/src/session-mode/stores/useAcpStore.ts",
          );
          useAcpStore.setState({
            entries: [
              ...useAcpStore.getState().entries,
              {
                id: "audit-1000",
                role: "agent",
                text: "New final reply while reading",
              },
            ],
            permission: {
              requestId: "virtual-approval",
              title: "Virtual history approval",
              options: [{ optionId: "allow", name: "Allow virtual operation" }],
            },
          });
        }
      }, kind);
      await expect(
        kind === "cc"
          ? page.getByRole("button", { name: "Allow Once", exact: true })
          : page.getByRole("region", { name: "待审批操作" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          viewport.evaluate((el, anchor) => {
            const node = [
              ...el.querySelectorAll<HTMLElement>("[data-transcript-row]"),
            ].find((node) => node.dataset.transcriptRow === anchor.key);
            return node
              ? Math.abs(
                  node.getBoundingClientRect().top -
                    el.getBoundingClientRect().top -
                    anchor.offset,
                )
              : 999;
          }, anchor),
        )
        .toBeLessThan(3);
      const editor = page.getByRole("textbox", {
        name: kind === "cc" ? "Message input" : "ACP 消息输入",
        exact: true,
      });
      await editor.fill("Read history without losing my draft");
      expect(
        await editor.evaluate((el: HTMLElement) =>
          el instanceof HTMLTextAreaElement ? el.value : el.textContent,
        ),
      ).toContain("Read history without losing my draft");
      await viewport.hover();
      await page.mouse.wheel(0, 1000000);
      await expect(
        page.getByText("New final reply while reading", { exact: true }),
      ).toBeVisible();
      expect(await list.locator("[data-transcript-row]").count()).toBeLessThan(
        100,
      );
      expect(errors).toEqual([]);
    });

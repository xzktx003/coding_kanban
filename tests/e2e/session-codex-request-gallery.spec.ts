import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const imageFixture =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZ0AAAAASUVORK5CYII=";

for (const width of [1440, 390])
  for (const theme of ["dark", "light"] as const)
    test.describe(`${width}px ${theme} actual request gallery`, () => {
      test.use({ hasTouch: width === 390, isMobile: width === 390 });
      test("arrows retain native circles and scroll without changing the selected template or submitting", async ({
        page,
      }, info) => {
        const fixture = await installSessionUxFixture(page, 1);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/?mode=session");
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60000 });
        await seedSessionUx(page, 1);
        await page.evaluate(
          async ({ theme, imageFixture }) => {
            const module = (path: string) =>
              import(
                performance
                  .getEntriesByType("resource")
                  .findLast((entry) => new URL(entry.name).pathname === path)
                  ?.name ?? path
              );
            const [
              { useThemeStore },
              { useLayoutStore },
              { useAgentCenterStore },
              { useCodexStore },
              { useElicitationStore },
              { useSessionDraftStore, sessionDraftKey },
            ] = await Promise.all([
              module("/src/session-mode/stores/settings/useThemeStore.ts"),
              module("/src/session-mode/stores/useLayoutStore.ts"),
              module("/src/session-mode/stores/useAgentCenterStore.ts"),
              module("/src/session-mode/components/codex/stores/index.ts"),
              module(
                "/src/session-mode/components/codex/stores/useElicitationStore.ts",
              ),
              module("/src/session-mode/stores/useSessionDraftStore.ts"),
            ]);
            const card = {
              kind: "codex",
              id: "ux-0",
              cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            };
            await fetch("/api/session/tabs", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                clientId: "native-gallery-fixture",
                operations: [{ seq: 1, action: { type: "add", card } }],
              }),
            });
            useThemeStore.getState().setTheme(theme);
            useLayoutStore.setState({
              view: "agent",
              isSidebarOpen: false,
              isRightPanelOpen: false,
            });
            useAgentCenterStore.setState({
              cards: [card],
              currentAgentCardId: "ux-0",
              currentAgentCardKind: "codex",
              cardsViewMode: "solo",
            });
            useCodexStore.setState({
              currentThreadId: "ux-0",
              historyLoadedMap: { "ux-0": true },
              historyLoadingMap: {},
            });
            useSessionDraftStore
              .getState()
              .setText(sessionDraftKey("codex", "ux-0"), "保留图库输入草稿");
            useElicitationStore.setState({
              pendingRequests: [
                {
                  threadId: "ux-0",
                  turnId: "gallery-turn",
                  itemId: "gallery-item",
                  requestId: 910,
                  requestToken: "gallery-fixture-instance",
                  mode: "openai/form",
                  serverName: "fixture",
                  message: "选择图片模板",
                  requestedSchema: {
                    type: "object",
                    properties: {
                      image: {
                        type: "openai/imagePicker",
                        title: "图片模板",
                        items: Array.from({ length: 8 }, (_, i) => ({
                          id: `native-template-${i}`,
                          title: `原生模板 ${i + 1}`,
                          image: `data:image/png;base64,${imageFixture}`,
                        })),
                      },
                    },
                    required: ["image"],
                  },
                },
              ],
              drafts: {},
            });
          },
          { theme, imageFixture },
        );

        const picker = page.locator(".codex-elicitation__image-picker");
        const card = page.locator(".codex-elicitation");
        const navigation = card.locator(
          ".codex-elicitation__gallery-navigation",
        );
        const next = navigation.getByRole("button", { name: "更多模板" });
        const previous = navigation.getByRole("button", {
          name: "上一组模板",
        });
        const activate = (target: Locator) =>
          width === 390 ? target.tap() : target.click();
        await expect(picker.locator("img")).toHaveCount(8);
        const imageState = () =>
          picker.evaluate((element) => {
            const gallery = element.getBoundingClientRect();
            return {
              gallery: {
                x: gallery.x,
                y: gallery.y,
                width: gallery.width,
                height: gallery.height,
              },
              scrollLeft: element.scrollLeft,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              images: Array.from(
                element.querySelectorAll<HTMLImageElement>("img"),
              ).map((img, index) => {
                const rect = img.getBoundingClientRect();
                const visible =
                  rect.right > Math.max(gallery.left, 0) &&
                  rect.left < Math.min(gallery.right, innerWidth) &&
                  rect.bottom > Math.max(gallery.top, 0) &&
                  rect.top < Math.min(gallery.bottom, innerHeight);
                const fullyVisible =
                  rect.left >= Math.max(gallery.left, 0) &&
                  rect.right <= Math.min(gallery.right, innerWidth) &&
                  rect.top >= Math.max(gallery.top, 0) &&
                  rect.bottom <= Math.min(gallery.bottom, innerHeight);
                return {
                  index,
                  loading: img.loading,
                  complete: img.complete,
                  naturalWidth: img.naturalWidth,
                  naturalHeight: img.naturalHeight,
                  visible,
                  fullyVisible,
                  rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                  },
                };
              }),
            };
          });
        const initialImageState = await imageState();
        const decodedTemplates = new Set<number>();
        const imageObservations: Array<{
          stage: string;
          state: Awaited<ReturnType<typeof imageState>>;
        }> = [];
        const saveImageWitness = async () => {
          await writeFile(
            info.outputPath("gallery-image-witness.json"),
            JSON.stringify(
              {
                browser: page.context().browser()?.browserType().name(),
                width,
                theme,
                initialImageState,
                imageObservations,
                fullyVisibleDecodedTemplates: [...decodedTemplates].sort(
                  (a, b) => a - b,
                ),
                finalState: await imageState(),
                errors,
              },
              null,
              2,
            ),
          );
        };
        const auditVisibleImages = async (stage: string) => {
          try {
            await expect
              .poll(async () => {
                const visible = (await imageState()).images.filter(
                  (image) => image.visible,
                );
                return (
                  visible.length > 0 &&
                  visible.every(
                    (image) =>
                      image.complete &&
                      image.naturalWidth === 1 &&
                      image.naturalHeight === 1,
                  )
                );
              })
              .toBe(true);
            const state = await imageState();
            for (const image of state.images)
              if (
                image.fullyVisible &&
                image.complete &&
                image.naturalWidth === 1 &&
                image.naturalHeight === 1
              )
                decodedTemplates.add(image.index);
            imageObservations.push({ stage, state });
          } finally {
            await saveImageWitness();
          }
        };
        const settleGallery = () =>
          expect
            .poll(async () => {
              const before = await picker.evaluate(
                (element) => element.scrollLeft,
              );
              await page.evaluate(
                () =>
                  new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve()),
                    ),
                  ),
              );
              return (
                before ===
                (await picker.evaluate((element) => element.scrollLeft))
              );
            })
            .toBe(true);
        await auditVisibleImages("initial");
        await expect(next).toBeVisible();
        await picker.evaluate((element) => {
          const state = window as any;
          state.__gallerySelectionEvents = [];
          const record = (event: Event) => {
            const target = event.target as HTMLElement;
            if (!element.closest(".codex-elicitation")!.contains(target))
              return;
            const touch = event as TouchEvent;
            state.__gallerySelectionEvents.push({
              type: event.type,
              trusted: event.isTrusted,
              prevented: event.defaultPrevented,
              target: target.tagName,
              className: target.className,
              label: target.closest("label")?.textContent,
              action: target.closest("button")?.getAttribute("aria-label"),
              checked:
                target instanceof HTMLInputElement ? target.checked : undefined,
              x: (event as MouseEvent).clientX,
              y: (event as MouseEvent).clientY,
              touches: Array.from(touch.touches ?? []).map((t) => ({
                x: t.clientX,
                y: t.clientY,
              })),
              changedTouches: Array.from(touch.changedTouches ?? []).map(
                (t) => ({ x: t.clientX, y: t.clientY }),
              ),
              scrollLeft: element.scrollLeft,
            });
          };
          for (const type of [
            "touchstart",
            "touchend",
            "touchcancel",
            "pointerdown",
            "pointerup",
            "click",
            "input",
            "change",
          ])
            window.addEventListener(type, record, { passive: true });
        });
        const selectionState = () =>
          picker.evaluate((element) => {
            const first = element.querySelector<HTMLElement>(
              ".codex-elicitation__image-option",
            )!;
            const rect = first.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return {
              events: (window as any).__gallerySelectionEvents,
              first: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                centerHit: hit?.tagName,
                centerClass: hit?.className,
                centerInFirst: Boolean(hit && first.contains(hit)),
              },
              radios: Array.from(
                element.querySelectorAll<HTMLInputElement>("input[type=radio]"),
              ).map((radio) => ({
                value: radio.value,
                checked: radio.checked,
                disabled: radio.disabled,
                connected: radio.isConnected,
              })),
              images: Array.from(
                element.querySelectorAll<HTMLImageElement>("img"),
              ).map((img) => ({
                complete: img.complete,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
              })),
              active: document.activeElement?.tagName,
              activeClass: document.activeElement?.className,
              scrollLeft: element.scrollLeft,
              html: first.outerHTML,
            };
          });
        const beforeSelection = await selectionState();
        await activate(
          picker.locator(".codex-elicitation__image-option").first(),
        );
        try {
          await expect(
            picker.getByRole("radio", { name: "原生模板 1", exact: true }),
          ).toBeChecked();
        } finally {
          await writeFile(
            info.outputPath("gallery-selection-trace.json"),
            JSON.stringify(
              {
                browser: page.context().browser()?.browserType().name(),
                width,
                theme,
                beforeSelection,
                afterSelection: await selectionState(),
                errors,
              },
              null,
              2,
            ),
          );
          await page.screenshot({
            path: info.outputPath(`gallery-selected-${width}-${theme}.png`),
            fullPage: true,
          });
        }
        const initialScroll = await picker.evaluate(
          (element) => element.scrollLeft,
        );
        expect(initialScroll).toBeGreaterThanOrEqual(0);
        const geometry: Array<Record<string, unknown>> = [];
        const measure = async (
          target: Locator,
          direction: "next" | "previous",
        ) => {
          const metrics = await target.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const carousel = element
              .closest(".codex-elicitation__image-carousel")!
              .getBoundingClientRect();
            const style = getComputedStyle(element);
            const pseudo = getComputedStyle(element, "::before");
            const hasCircle = !["none", "normal", ""].includes(pseudo.content);
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              relativeCenterX: rect.x + rect.width / 2 - carousel.x,
              relativeCenterY: rect.y + rect.height / 2 - carousel.y,
              carouselWidth: carousel.width,
              centerHit: Boolean(
                hit && (element === hit || element.contains(hit)),
              ),
              visibleWidth: hasCircle ? parseFloat(pseudo.width) : rect.width,
              visibleHeight: hasCircle
                ? parseFloat(pseudo.height)
                : rect.height,
              background: style.backgroundColor,
              visibleBackground: hasCircle
                ? pseudo.backgroundColor
                : style.backgroundColor,
              borderWidth: style.borderWidth,
              visibleBorderWidth: hasCircle
                ? pseudo.borderWidth
                : style.borderWidth,
              coarse: matchMedia("(pointer: coarse)").matches,
            };
          });
          geometry.push({ direction, ...metrics });
          await writeFile(
            info.outputPath("gallery-metrics.json"),
            JSON.stringify({ width, theme, geometry }, null, 2),
          );
          expect
            .soft(metrics.width, `${direction} hit width`)
            .toBe(width === 390 ? 44 : 32);
          expect
            .soft(metrics.height, `${direction} hit height`)
            .toBe(width === 390 ? 44 : 32);
          expect
            .soft(metrics.visibleWidth, `${direction} native circle width`)
            .toBe(32);
          expect
            .soft(metrics.visibleHeight, `${direction} native circle height`)
            .toBe(32);
          expect
            .soft(
              metrics.visibleBorderWidth,
              `${direction} native circle border`,
            )
            .toBe("1px");
          expect
            .soft(
              metrics.relativeCenterY,
              `${direction} original vertical center`,
            )
            .toBe(74);
          expect
            .soft(
              metrics.relativeCenterX,
              `${direction} original horizontal center`,
            )
            .toBe(direction === "next" ? metrics.carouselWidth - 16 : 16);
          expect
            .soft(metrics.centerHit, `${direction} actual center hit`)
            .toBe(true);
          expect(metrics.coarse).toBe(width === 390);
        };
        await measure(next, "next");
        await activate(next);
        await expect
          .poll(() => picker.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(initialScroll + 1);
        await expect(previous).toBeVisible();
        await settleGallery();
        await auditVisibleImages("first-forward");
        const forwardScroll = await picker.evaluate(
          (element) => element.scrollLeft,
        );
        await measure(previous, "previous");
        await page.screenshot({
          path: info.outputPath(`gallery-${width}-${theme}.png`),
          fullPage: true,
        });
        await card.screenshot({
          path: info.outputPath(`gallery-card-${width}-${theme}.png`),
        });
        await activate(previous);
        await expect
          .poll(() => picker.evaluate((element) => element.scrollLeft))
          .toBeLessThan(forwardScroll - 1);
        await expect
          .poll(() => picker.evaluate((element) => element.scrollLeft))
          .toBe(initialScroll);
        await auditVisibleImages("first-return");
        // Offscreen lazy images become visible through actual user navigation.
        for (let step = 1; step <= 8 && decodedTemplates.size < 8; step++) {
          await expect(next).toBeVisible();
          await expect(next).toBeEnabled();
          const before = await picker.evaluate((element) => element.scrollLeft);
          await activate(next);
          await expect
            .poll(() => picker.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(before + 1);
          await settleGallery();
          await auditVisibleImages(`all-templates-forward-${step}`);
        }
        expect([...decodedTemplates].sort((a, b) => a - b)).toEqual([
          0, 1, 2, 3, 4, 5, 6, 7,
        ]);
        for (let step = 1; step <= 8; step++) {
          const before = await picker.evaluate((element) => element.scrollLeft);
          if (before === initialScroll) break;
          await expect(previous).toBeVisible();
          await expect(previous).toBeEnabled();
          await activate(previous);
          await expect
            .poll(() => picker.evaluate((element) => element.scrollLeft))
            .toBeLessThan(before - 1);
          await settleGallery();
          await auditVisibleImages(`all-templates-return-${step}`);
        }
        await expect
          .poll(() => picker.evaluate((element) => element.scrollLeft))
          .toBe(initialScroll);

        await expect(
          picker.getByRole("radio", { name: "原生模板 1", exact: true }),
        ).toBeChecked();
        await expect(card).toHaveCount(1);
        const ownership = await page.evaluate(async () => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
          const [
            { useElicitationStore },
            { readDraft, sessionDraftKey },
            { useAgentCenterStore },
          ] = await Promise.all([
            module(
              "/src/session-mode/components/codex/stores/useElicitationStore.ts",
            ),
            module("/src/session-mode/stores/useSessionDraftStore.ts"),
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
          ]);
          return {
            target: useAgentCenterStore.getState().currentAgentCardId,
            draft: readDraft(sessionDraftKey("codex", "ux-0")).text,
            pending: useElicitationStore
              .getState()
              .pendingRequests.map((request: any) => ({
                threadId: request.threadId,
                requestId: request.requestId,
                requestToken: request.requestToken,
              })),
            keyboardFocused:
              document.activeElement?.matches(
                "textarea,[contenteditable=true],input:not([type=radio]):not([type=checkbox])",
              ) ?? false,
          };
        });
        expect(ownership).toEqual({
          target: "ux-0",
          draft: "保留图库输入草稿",
          pending: [
            {
              threadId: "ux-0",
              requestId: 910,
              requestToken: "gallery-fixture-instance",
            },
          ],
          keyboardFocused: false,
        });
        expect(
          fixture.calls.filter((call) =>
            /approval\/mcp-elicitation|\/followups\/submit|\/codex\/(turn\/(start|steer)|thread\/(resume|fork|rollback))/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        expect(errors).toEqual([]);
        await writeFile(
          info.outputPath("gallery-receipt.json"),
          JSON.stringify(
            {
              width,
              theme,
              activation: width === 390 ? "tap" : "click",
              geometry,
              initialScroll,
              forwardScroll,
              returnedScroll: await picker.evaluate(
                (element) => element.scrollLeft,
              ),
              ownership,
              errors,
              fullyVisibleDecodedTemplates: [...decodedTemplates].sort(
                (a, b) => a - b,
              ),
              trustedEvents: (await selectionState()).events,
            },
            null,
            2,
          ),
        );
      });
    });

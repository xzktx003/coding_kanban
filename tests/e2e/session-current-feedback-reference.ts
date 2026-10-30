import type { Page } from "@playwright/test";
/** Current immutable 26.51007 public upload coordinator; only host services are isolated. */
export async function currentFeedbackReference(
  page: Page,
  reference: string,
  width: number,
  theme: "dark" | "light",
  initialId: string | null = "ux-0",
) {
  await page.setViewportSize({ width, height: 852 });
  const url = new URL("native-goal.html", reference);
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).nativeLoaded));
  const identity = await (
    await page.request.get(new URL("reference.json", reference).href)
  ).json();
  if (
    identity.version !== "26.51007.21434" ||
    identity.hashes?.["feedback-upload-10d8b6133f0f.js"] !==
      "810e784944cd7b342c16f5dd46366466d87683d00251cffac6745141dc9e1f07"
  )
    throw new Error("Current unchanged feedback asset identity required");
  await page.evaluate(
    async ({ theme, initialId }) => {
      const w = window as any,
        { Core, Native, R, wrap, root } = w.nativeGoalCore;
      const Auth = await import("./assets/app-initial-fee819fe4f22.js"),
        Upload = await import("./assets/feedback-upload-10d8b6133f0f.js");
      Auth.xgt();
      document.documentElement.dataset.theme = theme;
      const colors =
        theme === "dark"
          ? {
              fg: "#ccc",
              bg: "#20211d",
              menu: "#282a23",
              description: "#858585",
              link: "#a9c5de",
            }
          : {
              fg: "#3b3b3b",
              bg: "#fff",
              menu: "#f5f5f3",
              description: "#717171",
              link: "#006ab1",
            };
      document.body.style.background = colors.bg;
      document.body.style.color = colors.fg;
      for (const [name, value] of Object.entries({
        "--vscode-foreground": colors.fg,
        "--vscode-editor-background": colors.bg,
        "--vscode-sideBar-background": colors.menu,
        "--vscode-menu-background": colors.menu,
        "--vscode-dropdown-background": colors.menu,
        "--vscode-descriptionForeground": colors.description,
        "--vscode-textLink-foreground": colors.link,
        "--vscode-textLink-activeForeground": colors.link,
        "--vscode-focusBorder": "currentColor",
      }))
        document.documentElement.style.setProperty(name, value);
      let modals = { modals: [] as any[], nextKey: 1 },
        formatter: any;
      w.feedbackNotifications = [];
      w.feedbackScopeStopped = 0;
      function Content() {
        formatter = Core.Bbt();
        const modal = modals.modals.at(-1),
          notification = [...w.feedbackNotifications]
            .reverse()
            .find((entry: any) => !entry.closed);
        return modal
          ? R.createElement(modal.ModalComponent, {
              ...modal.props,
              onClose: () => {
                modal.props.onClose?.();
                Auth.FHt(scope, modal.ModalComponent);
              },
            })
          : notification
            ? R.createElement(
                "aside",
                { "data-reference-feedback-notice": true },
                R.createElement("span", {}, notification.message),
                R.createElement(
                  "button",
                  { onClick: notification.options.primaryAction.onClick },
                  notification.options.primaryAction.label,
                ),
              )
            : R.createElement("span", {}, "Current feedback reference ready");
      }
      const render = () =>
        root.render(
          wrap(
            R.createElement(
              Auth.bgt.Provider,
              {
                value: {
                  accountId: null,
                  requiresAuth: false,
                  isLoading: false,
                  isAuthenticated: false,
                  authMethod: null,
                },
              },
              R.createElement(Content),
            ),
          ),
        );
      const notice = (kind: string) => (message: string, options: any) => {
        const item = { kind, message, options, closed: false };
        w.feedbackNotifications.push(item);
        render();
        return {
          close: () => {
            item.closed = true;
            options.onRemove?.();
            render();
          },
        };
      };
      const notices = {
        info: notice("info"),
        warning: notice("warning"),
        success: notice("success"),
      };
      const get = (token: unknown) =>
        token === Native.U9t ? formatter : token === Auth.eWt ? notices : null;
      const scope = {
        get,
        watch: (callback: any) => {
          callback({ get });
          return () => {
            w.feedbackScopeStopped++;
          };
        },
        set: (_: unknown, update: any) => {
          modals = update(modals);
          render();
        },
      };
      render();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Current native formatter not ready")),
          3000,
        );
        const poll = () =>
          formatter
            ? (clearTimeout(timeout), resolve())
            : requestAnimationFrame(poll);
        poll();
      });
      w.startCurrentFeedback = (
        correlationId: string | null = "fixture-feedback",
      ) =>
        Upload.startFeedbackUpload({
          scope,
          hostId: "local",
          initialCorrelationId: correlationId,
          submit: () =>
            new Promise<string>((resolve, reject) => {
              w.finishCurrentFeedback = resolve;
              w.failCurrentFeedback = (message: string) =>
                reject(new Error(message));
            }),
        });
    },
    { theme, initialId },
  );
  // Match the actual mouse-driven slash/form handoff, including focus-visible modality.
  await page.mouse.click(2, 2);
  await page.evaluate(
    (initialId) => (window as any).startCurrentFeedback(initialId),
    initialId,
  );
}

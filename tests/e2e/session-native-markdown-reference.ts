import type { Page } from "@playwright/test";

/** Render the unchanged VSIX Markdown component with its real providers. */
export async function renderNativeMarkdownReference(
  page: Page,
  url: string,
  text: string,
  theme: string,
  width: number,
  beforeRender?: () => Promise<void>,
) {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).nativeLoaded);
  await page.evaluate(
    async ({ theme, width }) => {
      const S = await import(
        /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
      );
      S.v();
      S.U();
      const w = window as any;
      w.renderNativeElement(S._, {
        children: w.nativeModules.React.createElement(
          "span",
          {},
          "persisted ready",
        ),
      });
      const viewport = document.createElement("meta");
      viewport.name = "viewport";
      viewport.content = "width=device-width,initial-scale=1";
      document.head.append(viewport);
      document.getElementById("root")!.style.cssText =
        `width:${width === 390 ? 388 : 616}px;box-sizing:border-box;padding:16px`;
      const host =
        theme === "dark"
          ? {
              "editor-background": "#20211d",
              "sideBar-background": "#282a23",
              foreground: "#ccc",
              descriptionForeground: "#858585",
              "textLink-foreground": "#a9c5de",
              "textLink-activeForeground": "#a9c5de",
            }
          : {
              "editor-background": "#fff",
              "sideBar-background": "#f5f5f3",
              foreground: "#3b3b3b",
              descriptionForeground: "#717171",
              "textLink-foreground": "#006ab1",
              "textLink-activeForeground": "#006ab1",
            };
      for (const [key, value] of Object.entries(host))
        document.documentElement.style.setProperty(`--vscode-${key}`, value);
      document.documentElement.style.setProperty(
        "--vscode-dropdown-background",
        host["sideBar-background"],
      );
      // Exercise native focus rules with the same fallback as the web host.
      document.documentElement.style.setProperty(
        "--vscode-focusBorder",
        "currentColor",
      );
      document.documentElement.dataset.theme = theme;
      document.body.style.background = host["editor-background"];
      document.body.style.color = host.foreground;
    },
    { theme, width },
  );
  await page.getByText("persisted ready", { exact: true }).waitFor();
  await beforeRender?.();
  await page.evaluate(async (text) => {
    const S = await import(
        /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
      ),
      Auth = await import(
        /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
      );
    const w = window as any,
      { React: R, Dst, zg } = w.nativeModules;
    Auth.QCt();
    w.renderNativeElement(S._, {
      children: R.createElement(
        Auth.Rpt.Provider,
        { value: { requiresAuth: false, isLoading: false, authMethod: null } },
        R.createElement(
          S.H,
          {},
          R.createElement(
            Auth.ZCt,
            {},
            R.createElement(
              Dst,
              {
                scope: S.l1t,
                value: { conversationId: "fixture", hostId: "local" },
              },
              R.createElement(
                Dst,
                { scope: S.W$t, value: { kind: "local" } },
                R.createElement(zg, { children: text }),
              ),
            ),
          ),
        ),
      ),
    });
    setTimeout(
      () =>
        S.s5t.dispatchHostMessage({
          type: "persisted-atom-sync",
          state: {},
          canWritePrimaryWindowTabPersistence: false,
        }),
      0,
    );
  }, text);
}

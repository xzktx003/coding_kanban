import type { Page } from "@playwright/test";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
/** Original notification provider, viewport, service and card, with no module mutation. */
export async function nativeNotifications(
  page: Page,
  reference: string,
  width: number,
  theme: string,
  markdown?: string,
) {
  await renderNativeMarkdownReference(page, reference, "", theme, width);
  await page.evaluate(async (markdown) => {
    const S = await import(
      /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
    );
    const Auth = await import(
      /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
    );
    const w = window as any,
      R = w.nativeModules.React;
    Auth.QK();
    w.nativeNoticeActions = [];
    w.nativeNoticeRemovals = 0;
    w.closeNativeNotices = () => Auth.ZBt().closeAll();
    w.renderNativeElement(S._, {
      children: R.createElement(
        Auth.Rpt.Provider,
        { value: { requiresAuth: false, isLoading: false, authMethod: null } },
        R.createElement(
          S.H,
          {},
          R.createElement(
            Auth.XK,
            {},
            R.createElement(
              R.Fragment,
              {},
              R.createElement("span", {}, "Native notifications ready"),
              markdown === undefined
                ? null
                : R.createElement(
                    Auth.ZCt,
                    {},
                    R.createElement(
                      w.nativeModules.Dst,
                      {
                        scope: S.l1t,
                        value: { conversationId: "fixture", hostId: "local" },
                      },
                      R.createElement(
                        w.nativeModules.Dst,
                        { scope: S.W$t, value: { kind: "local" } },
                        R.createElement(w.nativeModules.zg, {
                          children: markdown,
                        }),
                      ),
                    ),
                  ),
            ),
          ),
        ),
      ),
    });
    w.showNativeNotice = (level: string, title: string, options: any = {}) =>
      Auth.ZBt()[level](title, {
        ...options,
        onRemove: () => w.nativeNoticeRemovals++,
        primaryAction: options.action
          ? {
              label: options.action,
              onClick: () => w.nativeNoticeActions.push("primary"),
            }
          : undefined,
      });
    w.showNativeCustomNotice = (options: any = {}) =>
      Auth.ZBt().custom({
        ...options,
        onRemove: () => w.nativeNoticeRemovals++,
        onUserDismiss: () => w.nativeNoticeActions.push("dismiss"),
        content: ({ close, level }: any) =>
          R.createElement(Auth.$K, {
            title: "Reconnect MCP server “fixture”",
            description:
              "Authentication expired. Reconnect to keep using this MCP server",
            level,
            onClose: close,
            primaryAction: {
              label: "Reconnect",
              onClick: () => w.nativeNoticeActions.push("reconnect"),
            },
          }),
      });
  }, markdown);
  await page.getByText("Native notifications ready").waitFor();
}

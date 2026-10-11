import type { Page } from "@playwright/test";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";

/** Original public upload coordinator and its private report component; host services are isolated. */
export async function nativeFeedbackUpload(
  page: Page,
  reference: string,
  width: number,
  theme: string,
  correlationId: string | null,
  language = "zh",
) {
  await renderNativeMarkdownReference(page, reference, "", theme, width);
  await page.evaluate(() => {
    const style = document.documentElement.style;
    // The isolated host must update menu surfaces along with its selected theme.
    style.setProperty(
      "--vscode-menu-background",
      style.getPropertyValue("--vscode-sideBar-background"),
    );
  });
  await page.evaluate(
    async ({ correlationId, language }) => {
      const S = await import(
          /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
        ),
        Auth = await import(
          /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
        ),
        Core = await import(
          /* @vite-ignore */ "./native/assets/app-initial-3de816c37e10.js"
        ),
        Upload = await import(
          /* @vite-ignore */ "./native/assets/feedback-upload-cb5de3dd6947.js"
        );
      const w = window as any,
        R = w.nativeModules.React;
      const localePaths: Record<string, string> = {
        ja: "./native/assets/ja-JP-cccb9b32b90a.js",
        fr: "./native/assets/fr-FR-c8896d04a499.js",
      };
      const messages = localePaths[language]
        ? (await import(/* @vite-ignore */ localePaths[language])).default
        : {};
      const content = () =>
        language === "zh"
          ? R.createElement(Content)
          : R.createElement(
              Core.cyt,
              { locale: language, messages },
              R.createElement(Content),
            );
      let modals = { modals: [] as any[], nextKey: 1 },
        formatter: any;
      w.feedbackNotifications = [];
      w.feedbackScopeStopped = 0;
      function Content() {
        formatter = Core.hyt();
        const modal = modals.modals.at(-1);
        const notification = [...w.feedbackNotifications]
          .reverse()
          .find((n: any) => !n.closed);
        return modal
          ? R.createElement(modal.ModalComponent, {
              ...modal.props,
              // Original CIa modal renderer calls the workflow, then removes the modal.
              onClose: () => {
                modal.props.onClose?.();
                Auth.Fzt(scope, modal.ModalComponent);
              },
            })
          : notification
            ? R.createElement(
                "div",
                {
                  "data-native-fixture-notification":
                    "isolated-service-adapter",
                },
                R.createElement("span", {}, notification.message),
                R.createElement(
                  "button",
                  { onClick: notification.options.primaryAction.onClick },
                  notification.options.primaryAction.label,
                ),
              )
            : R.createElement("span", {}, "Upload reference ready");
      }
      const render = () =>
        w.renderNativeElement(S._, {
          children: R.createElement(
            Auth.Rpt.Provider,
            {
              value: {
                requiresAuth: false,
                isLoading: false,
                authMethod: null,
              },
            },
            R.createElement(S.H, {}, R.createElement(Auth.ZCt, {}, content())),
          ),
        });
      render();
      await new Promise<void>((resolve) => {
        const poll = () =>
          formatter ? resolve() : requestAnimationFrame(poll);
        poll();
      });
      const notice = (kind: string) => (message: string, options: any) => {
        const record = { kind, message, options, closed: false };
        w.feedbackNotifications.push(record);
        return {
          close: () => {
            record.closed = true;
            options.onRemove?.();
          },
        };
      };
      const notifications = {
        info: notice("info"),
        warning: notice("warning"),
        success: notice("success"),
      };
      const get = (key: any) =>
        key === S.e5t ? formatter : key === Auth.eVt ? notifications : null;
      const scope = {
        get,
        watch: (callback: any) => {
          callback({ get });
          return () => {
            w.feedbackScopeStopped++;
          };
        },
        set: (_key: any, updater: any) => {
          modals = updater(modals);
          render();
        },
      };
      Upload.startFeedbackUpload({
        scope,
        hostId: "local",
        initialCorrelationId: correlationId,
        submit: async () => {
          const response = await fetch(
            "/api/session/api/codex/feedback/upload",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                threadId: correlationId,
                classification: "bug",
                reason: "Captured diagnostics",
                includeLogs: false,
              }),
            },
          );
          const data = await response.json();
          if (!response.ok)
            throw new Error(
              data.message ?? data.error ?? "Isolated upload failure",
            );
          return data.threadId;
        },
      });
      w.reopenFeedbackUpload = () =>
        w.feedbackNotifications.at(-1).options.primaryAction.onClick();
      w.dismissFeedbackNotification = () => {
        const record = w.feedbackNotifications.at(-1);
        record.options.onRemove?.();
      };
    },
    { correlationId, language },
  );
}

/** Original extension RPC transport, isolated clipboard target and error-notice service. */
export async function installNativeFeedbackClipboard(
  page: Page,
  renderErrorNotice = false,
) {
  await page.evaluate(async (renderErrorNotice) => {
    const Core = await import(
      /* @vite-ignore */ "./native/assets/app-initial-3de816c37e10.js"
    );
    const S = await import(
      /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
    );
    await import(
      /* @vite-ignore */ "./native/assets/index.extension-7b9f4b95ae70.js"
    );
    const w = window as any;
    w.copyWrites = [];
    w.clipboardErrors = [];
    // Observe the native error service boundary; its visual host is not the golden reference.
    const Auth = await import(
      /* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"
    );
    const service = Auth.ZBt();
    Auth.$Bt({
      ...service,
      danger: (title: any, options: any) => {
        w.clipboardErrors.push({
          titleId: title.props.id,
          descriptionId: options.description.props.id,
          id: options.id,
        });
        if (renderErrorNotice) return service.danger(title, options);
      },
    });
    class Clipboard extends Core.Iat {
      writeText(value: string) {
        return new Promise<void>((resolve, reject) => {
          w.copyWrites.push(value);
          w.finishCopy = resolve;
          w.failCopy = reject;
        });
      }
    }
    class Host extends Core.Iat {
      get services() {
        return { clipboard: new Clipboard(), clientCoordination: null };
      }
    }
    let pending: ((message: unknown) => void) | undefined;
    const incoming: unknown[] = [];
    const messages = w.nativeMessages ?? (w.nativeMessages = []);
    const push = messages.push.bind(messages);
    // The unchanged extension transport connects to an isolated host RPC peer.
    messages.push = (message: any) => {
      push(message);
      if (message.type === "vscode-capn-rpc-connect") {
        const sessionId = message.sessionId;
        w.clipboardHost = new Core.Pat(
          {
            encodingLevel: "jsonCompatibleWithBytes",
            send: (message: unknown) =>
              window.dispatchEvent(
                new MessageEvent("message", {
                  origin: location.origin,
                  data: {
                    type: "vscode-capn-rpc-message",
                    sessionId,
                    message,
                  },
                }),
              ),
            receive: () =>
              incoming.length
                ? Promise.resolve(incoming.shift())
                : new Promise((resolve) => {
                    pending = resolve;
                  }),
            abort: () => {},
          },
          new Host(),
        );
      } else if (message.type === "vscode-capn-rpc-message") {
        if (pending) {
          const resolve = pending;
          pending = undefined;
          resolve(message.message);
        } else incoming.push(message.message);
      }
      return messages.length;
    };
    await S.a6t();
  }, renderErrorNotice);
}

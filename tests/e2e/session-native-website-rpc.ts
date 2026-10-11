import type { Page } from "@playwright/test";
/** Original RPC implementation on both peers; only the isolated host's public website service is supplied. */
export async function attachNativeWebsiteRpc(page: Page) {
  await page.addInitScript(() => {
    const w = window as any,
      messages: any[] = [];
    messages.push = (...values: any[]) => {
      const length = Array.prototype.push.apply(messages, values);
      for (const value of values) w.nativeHostMessage?.(value);
      return length;
    };
    w.nativeMessages = messages;
  });
}
export async function initializeNativeWebsiteRpc(page: Page) {
  await page.evaluate(async () => {
    const S = await import(
        /* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"
      ),
      C = await import(
        /* @vite-ignore */ "./native/assets/app-initial-3de816c37e10.js"
      ),
      w = window as any;
    S.i6t();
    C.Rat();
    const incoming: any[] = [],
      waiters: ((m: any) => void)[] = [];
    w.rpcWebsiteCalls = [];
    class Website extends C.Iat {
      async get(params: any) {
        w.rpcWebsiteCalls.push({ url: params.url });
        const response = await fetch("/api/session/api/codex/website-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        if (!response.ok) throw Error("Website host request failed");
        return response.json();
      }
    }
    class Main extends C.Iat {
      get services() {
        return { websitePreviews: new Website() };
      }
    }
    w.nativeHostMessage = (event: any) => {
      if (event.type === "vscode-capn-rpc-connect")
        w.rpcServer = new C.Pat(
          {
            encodingLevel: "jsonCompatibleWithBytes",
            send: (message: any) =>
              window.postMessage(
                {
                  type: "vscode-capn-rpc-message",
                  sessionId: event.sessionId,
                  message,
                },
                location.origin,
              ),
            receive: () =>
              incoming.length
                ? Promise.resolve(incoming.shift())
                : new Promise((r) => waiters.push(r)),
            abort: () => {},
          },
          new Main(),
        );
      else if (event.type === "vscode-capn-rpc-message") {
        const waiter = waiters.shift();
        if (waiter) waiter(event.message);
        else incoming.push(event.message);
      }
    };
    await S.a6t();
  });
}

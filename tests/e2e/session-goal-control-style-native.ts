/** Unchanged official Cu/qu; only the isolated fixture host/client is substituted. */
import type { Page } from "@playwright/test";

import { nativeGoalModules } from "./session-goal-control-style-source";

const nativeMainFile = nativeGoalModules.main;

export async function installNativeBridgeFence(page: Page) {
  // Install before goto: the existing fixture HTML's sloppy assignment cannot
  // replace this object. This replaces only the fixture host bridge, not Cu.
  await page.addInitScript(() => {
    const state = {
      calls: [] as unknown[],
      violations: [] as string[],
    };
    (window as any).__goalStyleHostFence = state;
    const deny = (method: string, value: unknown) => {
      state.calls.push({ method, value });
      const message = `Goal style fixture denied host bridge ${method}`;
      state.violations.push(message);
      throw new Error(message);
    };
    const bridge = Object.freeze({
      getState: () => {
        state.calls.push({ method: "getState", result: "empty fixture state" });
        return {};
      },
      setState: (value: unknown) => deny("setState", value),
      postMessage: (value: unknown) => deny("postMessage", value),
    });
    Object.defineProperty(window, "acquireVsCodeApi", {
      configurable: false,
      writable: false,
      value: () => bridge,
    });
  });
}

export async function installNativeBusyFixture(
  page: Page,
  expectedCuSource: string,
  expectedQuSource: string,
  goal: Record<string, unknown>,
) {
  return page.evaluate(
    async ({ expectedCuSource, expectedQuSource, goal, nativeMainFile }) => {
      const h = (window as any).nativeGoalCore;
      if (!h) throw new Error("Existing official Goal reference did not load");
      const { Core, Native, R, root, wrap } = h;
      const Main: any = await import(
        new URL(`./assets/${nativeMainFile}`, location.href).href
      );
      if (Function.prototype.toString.call(Native.Cu) !== expectedCuSource)
        throw new Error(
          "Native.Cu.toString differs from canonical original span",
        );
      if (Function.prototype.toString.call(Native.qu) !== expectedQuSource)
        throw new Error(
          "Native.qu.toString differs from canonical original span",
        );
      if (!Main.DUt || !Main.xUt || !Main.bUt)
        throw new Error(
          "Goal's original RPC initializer/export is unavailable",
        );
      // Existing Native.wu/hFi -> R0t -> Nl/Main.SUt/Ix already initializes
      // Main.DUt/Ax and Main.bUt/Fx. Do not run the manager/controller/IDE entry.
      const state = {
        ready: false,
        held: false,
        disposed: false,
        calls: [] as unknown[],
        violations: [] as string[],
        cuSourceEqual: true,
        quSourceEqual: true,
        clientIdentityEqual: false,
        initialStatus: null as string | null,
        initialManagerIsNull: false,
      };
      const deny = (message: string) => {
        state.violations.push(message);
        throw new Error(message);
      };
      const client = new Proxy(Object.create(null), {
        get(_target, method) {
          if (method !== "setThreadGoal")
            return (...args: unknown[]) => {
              state.calls.push({
                method: String(method),
                args,
                rejected: true,
              });
              return deny(`Unexpected fixture client method ${String(method)}`);
            };
          return (threadId: string, params: any) => {
            state.calls.push({ method, threadId, params, outcome: "held" });
            if (threadId !== "fixture")
              return deny(`GoalSet target is not fixture: ${String(threadId)}`);
            if (
              state.disposed ||
              state.held ||
              params?.appendTranscriptItem !== false ||
              params?.objective !== "控制样式验收：仅持有 fixture 保存" ||
              params?.threadSettings !== undefined ||
              Object.keys(params ?? {}).some(
                (key) =>
                  ![
                    "objective",
                    "appendTranscriptItem",
                    "threadSettings",
                  ].includes(key),
              )
            )
              return deny("Unexpected or duplicate fixture GoalSet parameters");
            state.held = true;
            // No native transport, no success/failure receipt. The page realm
            // will be destroyed after measuring real Cu's pending UI.
            return new Promise<void>(() => {});
          };
        },
      });
      function CaptureOriginalAppScope({ children }: any) {
        const scope = Core._lt(Native.W9t); // the same hook/token as Cu/oFi
        R.useLayoutEffect(() => {
          const previous = scope.get(Main.DUt, "local");
          const previousManager = scope.get(Main.bUt);
          state.initialStatus = previous?.status ?? null;
          state.initialManagerIsNull = previousManager === null;
          if (
            previous?.status !== "unavailable" ||
            previous?.client !== null ||
            previousManager !== null
          )
            return deny(
              "Fixture AppScope already owns an unexpected RPC client",
            );
          // Px's real fallback returns Ax(local).client.rpc when Fx is null.
          // Preserve status=unavailable; do not fabricate ready/auth authority.
          const owned = {
            ...previous,
            client: { hostId: "local", rpc: client },
          };
          scope.set(Main.DUt, "local", owned);
          state.clientIdentityEqual = Main.xUt(scope, "local") === client;
          if (!state.clientIdentityEqual)
            return deny("Original Px did not return the exact fixture client");
          state.ready = true;
          return () => {
            state.ready = false;
            if (scope.get(Main.DUt, "local") === owned)
              scope.set(Main.DUt, "local", previous);
          };
        }, [scope]);
        return children;
      }
      const render = (kind: "card" | "replace") => {
        if (state.disposed) return deny("Disposed Goal fixture rendered again");
        const content =
          kind === "card"
            ? R.createElement(Native.Cu, {
                conversationId: "fixture",
                hostId: "local",
                goal: { ...goal, threadId: "fixture" },
              })
            : R.createElement(Native.qu, {
                confirmation: {
                  draft: { objective: "原生与本地一致的替换目标" },
                },
                onClose: () => render("card"),
                onConfirm: () => deny("Replacement confirm was not authorized"),
              });
        root.render(
          wrap(R.createElement(CaptureOriginalAppScope, null, content)),
        );
      };
      (window as any).__goalStyleNative = {
        state,
        render,
        dispose() {
          state.disposed = true;
          root.unmount(); // real scope cleanup, then the page is closed
          h.client.clear();
        },
      };
      render("card");
      return {
        cuSourceEqual: state.cuSourceEqual,
        scopeToken: "Native.W9t",
        hook: "Core._lt",
        clientAtom: "Main.DUt",
        method: "setThreadGoal",
        threadId: "fixture",
        hostId: "local",
        statusIsNotForgedReady: true,
      };
    },
    { expectedCuSource, expectedQuSource, goal, nativeMainFile },
  );
}

export async function nativeFenceEvidence(page: Page) {
  return page.evaluate(() => ({
    host: (window as any).__goalStyleHostFence,
    native: (window as any).__goalStyleNative?.state ?? null,
    originalErrors: (window as any).nativeErrors ?? [],
    originalMessages: (window as any).nativeMessages ?? [],
  }));
}

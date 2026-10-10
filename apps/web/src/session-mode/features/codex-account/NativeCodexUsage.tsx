import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type {
  GetAccountRateLimitsResponse,
  GetAccountResponse,
} from "@session/bindings/v2";
import { openEventStream } from "@session/lib/eventStream";
import {
  getJsonWithOptions,
  postJsonWithOptions,
} from "@session/services/apiAdapt/shared";
import {
  CodexAccountUsageController,
  type CodexAccountUsageApi,
} from "./controller";
import { nativeUsageGroups, nativeUsageWindow } from "./usage";
import "./account-native.css";
const defaultApi: CodexAccountUsageApi = {
  readAccount: (signal) =>
    postJsonWithOptions<GetAccountResponse>(
      "/api/codex/account/get",
      { refreshToken: false },
      { suppressToast: true, signal },
    ),
  readRateLimits: (signal) =>
    getJsonWithOptions<GetAccountRateLimitsResponse>(
      "/api/codex/account/rate-limits",
      { suppressToast: true, signal },
    ),
};
export function NativeCodexUsage({
  api = defaultApi,
  refreshKey = 0,
  onSignIn,
  onUpdated,
}: {
  api?: CodexAccountUsageApi;
  refreshKey?: number;
  onSignIn?: () => void;
  onUpdated?: (date: Date) => void;
}) {
  const { t, i18n } = useTranslation("thread");
  const controller = useMemo(() => new CodexAccountUsageController(api), [api]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  useEffect(() => {
    controller.activate();
    const close = openEventStream({
      agents: ["codex"],
      label: "native-account-usage",
      onEvent: (event) => {
        if (event.event === "codex:notification")
          controller.notification(event.payload);
      },
      onResync: () => {
        void controller.refresh(true);
      },
    });
    const focus = () => {
      void controller.refresh();
    };
    const runtimeRestarted = () => {
      void controller.refresh(true);
    };
    const timer = window.setInterval(focus, 180_000);
    window.addEventListener("focus", focus);
    window.addEventListener("session-runtime-restarted", runtimeRestarted);
    return () => {
      close();
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("session-runtime-restarted", runtimeRestarted);
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    void controller.refresh();
  }, [controller, refreshKey]);
  useEffect(() => {
    if (state.updatedAt !== null) onUpdated?.(new Date(state.updatedAt));
  }, [state.updatedAt, onUpdated]);
  const groups = nativeUsageGroups(state.response);
  const reset = (timestamp: number | null) => {
    if (timestamp === null || !Number.isFinite(timestamp))
      return t("accountUsage.resetUnknown");
    const date = new Date(timestamp * 1000);
    if (Number.isNaN(date.getTime())) return t("accountUsage.resetUnknown");
    return t("accountUsage.reset", {
      time: new Intl.DateTimeFormat(i18n.language, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(date),
    });
  };
  return (
    <section
      className="codex-presentation codex-native-usage"
      aria-label="Codex usage"
      aria-busy={state.loading}
    >
      <header>
        <h2>Codex</h2>
        <button
          type="button"
          disabled={state.loading}
          onClick={() => {
            void controller.refresh();
          }}
        >
          {t("accountUsage.refresh")}
        </button>
      </header>
      {groups.length ? (
        groups.map((group) => (
          <div
            className="codex-native-usage__group"
            key={group.id}
            data-limit-id={group.id}
          >
            <h3>{group.label}</h3>
            {group.windows.length ? (
              group.windows.map((window) => {
                const duration = nativeUsageWindow(window.minutes);
                return (
                  <div className="codex-native-usage__row" key={window.key}>
                    <span>
                      {t(
                        `accountUsage.windows.${duration.unit}`,
                        duration.count !== null
                          ? { count: duration.count }
                          : undefined,
                      )}
                      :
                    </span>
                    <span>
                      {window.remainingPercent === null
                        ? t("accountUsage.unavailable")
                        : t("accountUsage.remaining", {
                            percent: Math.round(window.remainingPercent),
                          })}
                    </span>
                    <span className="codex-native-usage__reset">
                      {reset(window.resetsAt)}
                    </span>
                  </div>
                );
              })
            ) : (
              <p>{t("accountUsage.unavailable")}</p>
            )}
          </div>
        ))
      ) : (
        <p className="codex-native-usage__empty" role="status">
          {t(
            state.loading ? "accountUsage.loading" : "accountUsage.unavailable",
          )}
        </p>
      )}
      {state.error && (
        <p className="codex-native-usage__error" role="status">
          {state.error}
        </p>
      )}
      {state.error &&
        state.account?.requiresOpenaiAuth === true &&
        state.account.account === null &&
        onSignIn && (
          <button type="button" onClick={onSignIn}>
            {t("accountUsage.signIn")}
          </button>
        )}
    </section>
  );
}

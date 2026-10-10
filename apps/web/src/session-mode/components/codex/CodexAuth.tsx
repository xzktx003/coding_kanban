import { listen } from "@tauri-apps/api/event";
import { open } from "@session/browser-opener";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerNotification } from "@session/bindings/ServerNotification";
import type {
  AccountLoginCompletedNotification,
  GetAccountResponse,
  LoginAccountParams,
} from "@session/bindings/v2";
import { Button } from "@session/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@session/components/ui/card";
import { Input } from "@session/components/ui/input";
import { Label } from "@session/components/ui/label";
import { Separator } from "@session/components/ui/separator";
import { openEventStream } from "@session/lib/eventStream";
import { buildUrl, isTauri } from "@session/hooks/runtime";
import {
  accountRuntime,
  beginConfirmedAccountEra,
  mutateAccount,
} from "@session/features/codex-account/account-mutations";
import {
  getAccountWithParams,
  loginAccount,
  saveAccountSnapshot,
} from "@session/services";

interface CodexAuthProps {
  onAuthenticated?: () => void;
}

interface OwnedLogin {
  epoch: number;
  source: string;
  instance: string | null;
  loginId: string | null;
  dispatched: boolean;
  checking: boolean;
  ready: boolean;
  early: AccountLoginCompletedNotification[];
  supportsMutations: boolean;
}

export function CodexAuth({ onAuthenticated }: CodexAuthProps = {}) {
  const isTauriRuntime = isTauri();
  const [accountResponse, setAccountResponse] =
    useState<GetAccountResponse | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loginLink, setLoginLink] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [canCancelLogin, setCanCancelLogin] = useState(false);
  const [cancelPhase, setCancelPhase] = useState<
    "idle" | "sending" | "uncertain"
  >("idle");
  const lifecycle = useRef({ active: false, epoch: 0, read: 0 });
  const pendingLogin = useRef<OwnedLogin | null>(null);
  const authenticatedRef = useRef(onAuthenticated);
  const completeRef = useRef<
    (result: AccountLoginCompletedNotification) => Promise<void>
  >(async () => {});
  authenticatedRef.current = onAuthenticated;

  const ownsLogin = useCallback(
    (attempt: OwnedLogin) =>
      lifecycle.current.active &&
      pendingLogin.current === attempt &&
      lifecycle.current.epoch === attempt.epoch &&
      buildUrl("/health") === attempt.source,
    [],
  );

  useEffect(() => {
    lifecycle.current.active = true;
    const invalidate = () => {
      lifecycle.current.epoch++;
      lifecycle.current.read++;
      if (!pendingLogin.current) return;
      pendingLogin.current = null;
      setIsLoggingIn(false);
      setLoginLink("");
      setDeviceCode("");
      setCanCancelLogin(false);
      setCancelPhase("idle");
      setLastStatus(null);
      setLastError("运行实例已改变，请在当前实例中重新开始登录。");
    };
    window.addEventListener("session-runtime-restarted", invalidate);
    return () => {
      lifecycle.current.active = false;
      lifecycle.current.epoch++;
      lifecycle.current.read++;
      pendingLogin.current = null;
      window.removeEventListener("session-runtime-restarted", invalidate);
    };
  }, []);

  const refreshAccount = useCallback(async (force: boolean) => {
    const generation = ++lifecycle.current.read;
    const epoch = lifecycle.current.epoch;
    const source = buildUrl("/health");
    try {
      const response = await getAccountWithParams({
        refreshToken: force,
      });
      if (
        lifecycle.current.active &&
        generation === lifecycle.current.read &&
        epoch === lifecycle.current.epoch &&
        source === buildUrl("/health")
      )
        setAccountResponse(response);
    } catch (error) {
      if (
        !lifecycle.current.active ||
        generation !== lifecycle.current.read ||
        epoch !== lifecycle.current.epoch ||
        source !== buildUrl("/health")
      )
        return;
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown");
      setLastError(message);
    }
  }, []);

  const handleLogin = useCallback(
    async (params: LoginAccountParams) => {
      if (pendingLogin.current) return;
      const attempt: OwnedLogin = {
        epoch: lifecycle.current.epoch,
        source: buildUrl("/health"),
        instance: null,
        loginId: null,
        dispatched: false,
        checking: false,
        ready: false,
        early: [],
        supportsMutations: false,
      };
      pendingLogin.current = attempt;
      setIsLoggingIn(true);
      setLastStatus(
        `Starting ${params.type === "chatgpt" ? "ChatGPT" : "API Key"} login...`,
      );
      setLastError(null);
      setCanCancelLogin(false);
      setCancelPhase("idle");
      try {
        const before = await accountRuntime();
        attempt.instance = before.instance;
        attempt.supportsMutations = before.supportsMutations;
        if (!ownsLogin(attempt)) return;
        attempt.dispatched = true;
        const response = await loginAccount(params);
        if (!ownsLogin(attempt)) return;
        if (
          response.type === "chatgptDeviceCode" ||
          response.type === "chatgpt"
        )
          attempt.loginId = response.loginId;
        const live = await accountRuntime();
        if (!ownsLogin(attempt)) return;
        if (live.instance !== attempt.instance)
          throw new Error("运行实例已改变，无法确认本次登录结果。");
        attempt.ready = true;
        attempt.supportsMutations =
          attempt.supportsMutations && live.supportsMutations;
        setCanCancelLogin(
          Boolean(attempt.loginId && attempt.supportsMutations),
        );
        const early = [...attempt.early]
          .reverse()
          .find((result) => result.loginId === attempt.loginId);
        attempt.early = [];
        if (early) {
          await completeRef.current(early);
          if (!ownsLogin(attempt)) return;
        }

        if (response.type === "chatgptDeviceCode") {
          attempt.loginId = response.loginId;
          setDeviceCode(response.userCode);
          setLoginLink(response.verificationUrl);
          setLastStatus("输入授权码完成登录；登录结果会自动更新。");
        } else if (response.type === "chatgpt") {
          attempt.loginId = response.loginId;
          setLoginLink(response.authUrl);
          await open(response.authUrl);
          setLastStatus("ChatGPT login started - please complete in browser");
        } else if (response.type === "apiKey") {
          pendingLogin.current = null;
          setIsLoggingIn(false);
          setLastStatus("Login successful");
          setApiKey("");
          beginConfirmedAccountEra();
          refreshAccount(true);
          authenticatedRef.current?.();
        } else {
          throw new Error("无法确认本次登录结果，请检查当前登录状态。");
        }
      } catch (error) {
        if (!ownsLogin(attempt)) return;
        const message =
          error instanceof Error ? error.message : String(error ?? "Unknown");
        setLastStatus(null);
        setLastError(message);
        // A dispatched login may have succeeded even if its response was lost.
        // Preserve its lock; never replay a credential mutation automatically.
        if (!attempt.dispatched) {
          pendingLogin.current = null;
          setIsLoggingIn(false);
        }
      }
    },
    [refreshAccount, ownsLogin],
  );

  const completeLogin = useCallback(
    async (result: AccountLoginCompletedNotification) => {
      const attempt = pendingLogin.current;
      if (!attempt || !ownsLogin(attempt) || !result.loginId) return;
      // Native completion may race ahead of the login/start HTTP response. Keep
      // a bounded transient inbox, then match the actual acknowledged login ID.
      if (!attempt.ready) {
        attempt.early = [
          ...attempt.early.filter((value) => value.loginId !== result.loginId),
          result,
        ].slice(-16);
        return;
      }
      if (
        !attempt.loginId ||
        result.loginId !== attempt.loginId ||
        attempt.checking
      )
        return;
      attempt.checking = true;
      try {
        const live = await accountRuntime();
        if (!ownsLogin(attempt)) return;
        if (live.instance !== attempt.instance)
          throw new Error("运行实例已改变，无法确认本次登录结果。");
        pendingLogin.current = null;
        setIsLoggingIn(false);
        setDeviceCode("");
        setLoginLink("");
        setCanCancelLogin(false);
        setCancelPhase("idle");
        if (result.success) {
          setLastError(null);
          setLastStatus("登录成功");
          beginConfirmedAccountEra();
          void refreshAccount(true);
          authenticatedRef.current?.();
        } else {
          setLastStatus(null);
          setLastError(result.error ?? "登录未完成，请重试");
        }
      } catch (error) {
        if (!ownsLogin(attempt)) return;
        setLastStatus(null);
        setLastError(
          error instanceof Error
            ? error.message
            : "无法确认本次登录结果，请检查当前登录状态。",
        );
      } finally {
        attempt.checking = false;
      }
    },
    [ownsLogin, refreshAccount],
  );
  completeRef.current = completeLogin;

  const cancelLogin = useCallback(async () => {
    const attempt = pendingLogin.current;
    if (
      !attempt?.instance ||
      !attempt.loginId ||
      !attempt.supportsMutations ||
      !attempt.ready ||
      !ownsLogin(attempt) ||
      cancelPhase !== "idle"
    )
      return;
    setCancelPhase("sending");
    const result = await mutateAccount({
      operation: "cancel",
      owner: {
        instance: attempt.instance,
        source: attempt.source,
        supportsMutations: attempt.supportsMutations,
      },
      loginId: attempt.loginId,
      isCurrent: () => ownsLogin(attempt),
    });
    if (!ownsLogin(attempt)) return;
    if (result.status === "complete") {
      pendingLogin.current = null;
      setCanCancelLogin(false);
      setCancelPhase("idle");
      setIsLoggingIn(false);
      setDeviceCode("");
      setLoginLink("");
      setLastError(null);
      setLastStatus(
        result.cancelStatus === "notFound"
          ? "未找到待取消的登录；请检查当前登录状态。"
          : "已取消本次登录",
      );
      if (result.cancelStatus === "notFound") void refreshAccount(false);
    } else {
      setCancelPhase(result.status === "uncertain" ? "uncertain" : "idle");
      setLastStatus(null);
      setLastError(
        result.error ?? "无法确认操作结果，请检查当前状态；不会重复发送。",
      );
    }
  }, [ownsLogin, cancelPhase, refreshAccount]);

  const startChatGptLogin = useCallback(() => {
    handleLogin({ type: isTauriRuntime ? "chatgpt" : "chatgptDeviceCode" });
  }, [handleLogin, isTauriRuntime]);

  const startApiKeyLogin = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!apiKey.trim()) {
        setLastError("Please enter an API key");
        return;
      }
      handleLogin({ type: "apiKey", apiKey: apiKey.trim() });
    },
    [handleLogin, apiKey],
  );

  useEffect(() => {
    refreshAccount(false);
  }, [refreshAccount]);

  // Keep a local snapshot of every ChatGPT account the user signs into, so
  // it can be switched back to later without logging out.
  useEffect(() => {
    const account = accountResponse?.account;
    if (account?.type === "chatgpt" && account.email) {
      saveAccountSnapshot(account.email, account.email, account.planType).catch(
        console.error,
      );
    }
  }, [accountResponse]);

  useEffect(() => {
    if (!isTauriRuntime) {
      return openEventStream({
        agents: ["codex"],
        onEvent: (event) => {
          if (event.event !== "codex:notification") return;
          const payload = event.payload as ServerNotification;
          if (payload.method === "account/updated") void refreshAccount(true);
          if (payload.method === "account/login/completed") {
            void completeLogin(
              payload.params as AccountLoginCompletedNotification,
            );
          }
        },
      });
    }

    const unlistenPromise = listen<ServerNotification>(
      "codex:notification",
      (event) => {
        const { method, params } = event.payload;
        if (method === "account/updated") {
          refreshAccount(true);
          return;
        }
        if (method === "account/login/completed") {
          void completeLogin(params as AccountLoginCompletedNotification);
        }
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isTauriRuntime, refreshAccount, completeLogin]);

  return (
    <Card className="w-full max-w-md mx-auto border border-border/50 shadow-sm">
      <CardHeader>
        <CardTitle className="text-center">Codex 登录</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {accountResponse?.account?.type === "chatgpt" && (
          <div className="space-y-1">
            <p>Email: {accountResponse.account.email}</p>
          </div>
        )}
        <div className="space-y-4">
          <Button
            onClick={startChatGptLogin}
            disabled={isLoggingIn}
            className="w-full"
            size="lg"
          >
            {isLoggingIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoggingIn ? "Starting ChatGPT login…" : "登录 ChatGPT"}
          </Button>

          <div className="relative my-2 text-center text-xs uppercase text-muted-foreground">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <span className="relative bg-background px-2">或使用 API Key</span>
          </div>

          <form
            onSubmit={startApiKeyLogin}
            className="space-y-3 p-3 border rounded-lg bg-muted/30"
          >
            <div className="space-y-2">
              <Label htmlFor="apiKey">OpenAI API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                disabled={isLoggingIn}
                autoComplete="off"
              />
            </div>
            <Button
              type="submit"
              disabled={isLoggingIn || !apiKey.trim()}
              className="w-full"
            >
              {isLoggingIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoggingIn ? "Verifying…" : "验证 API Key"}
            </Button>
          </form>
        </div>

        {loginLink && (
          <div className="rounded border p-3 space-y-2 text-sm">
            {deviceCode && (
              <p>
                授权码：
                <strong className="font-mono select-all">{deviceCode}</strong>
              </p>
            )}
            <a
              className="underline text-primary"
              href={loginLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开登录页面
            </a>
          </div>
        )}
        {canCancelLogin && (
          <Button
            variant="outline"
            className="w-full max-sm:h-11"
            disabled={cancelPhase !== "idle"}
            onClick={() => void cancelLogin()}
          >
            取消本次登录
          </Button>
        )}
        {lastStatus && !lastError && (
          <p className="text-xs text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{lastStatus}</span>
          </p>
        )}

        {lastError && (
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{lastError}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

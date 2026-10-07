import { startInputFacadeSync } from "./stores/useInputStore";
import { startCCInputFacadeSync } from "./stores/cc/useCCInputStore";
import { useCCBackgroundEvents } from "@session/hooks/useCCBackgroundEvents";
import { useCodexStore } from "@session/components/codex/stores";
import { codexService } from "@session/services/codexService";
import { useAcpStore } from "@session/stores/useAcpStore";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense, useEffect, useState } from "react";
import { I18nextProvider } from "react-i18next";

import "./App.css";

import { useBotActivity } from "@session/components/bot/useBotActivity";
import { useCodexEvents } from "@session/components/codex/hooks";
import { QuitDialog } from "@session/components/dialogs";
import { AppLayout } from "@session/components/layout";
import { MobileShell } from "@session/components/mobile/MobileShell";
import { PairingView } from "@session/components/pairing/PairingView";
import { TelemetryConsentDialog } from "@session/components/settings/TelemetryConsentDialog";
import { Toaster } from "@session/components/ui/toaster";
import { TooltipProvider } from "@session/components/ui/tooltip";
import { ThemeProvider } from "@session/contexts/ThemeContext";
import { HistoryProjectsDialog } from "@session/features/ProjectSelector";
import { TodoCaptureHint } from "@session/features/todos/TodoCaptureHint";
import { isDesktopTauri, isPhone } from "@session/hooks/runtime";
import { useAppDeepLink } from "@session/hooks/useAppDeepLink";
import { useDoubleShiftCapture } from "@session/hooks/useDoubleShiftCapture";
import { useUrlParamThread } from "@session/hooks/useUrlParamThread";
import { hasActiveWork } from "@session/lib/hasActiveWork";
import { i18n } from "@session/lib/i18n";
import {
  initSettingsSync,
  loadRemoteSettings,
  loadSettings,
} from "@session/lib/settings";
import { reportAppActive } from "@session/lib/telemetry";
import { initializeCodexAsync } from "@session/services/apiAdapt";
import { usePairingStore } from "@session/stores/usePairingStore";
import type { InitializeResponse } from "./bindings";

const AboutView = lazy(() => import("@session/views/AboutView"));
const UsagePanel = lazy(() => import("@session/views/UsagePanel"));

function AppShell() {
  useEffect(() => {
    const stopInput = startInputFacadeSync(),
      stopCC = startCCInputFacadeSync();
    return () => {
      stopInput();
      stopCC();
    };
  }, []);
  useCCBackgroundEvents();
  const [quitDialogOpen, setQuitDialogOpen] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  // True once codex backend signals it is ready; only desktop Tauri has a
  // local backend to initialize — mobile and web talk to a remote one.
  const [codexReady, setCodexReady] = useState(!isDesktopTauri());

  useEffect(() => {
    // A phone has no settings file of its own: the projects it shows are the
    // paired desktop's. `/api/settings` is the direct route; reading the file
    // over the remote filesystem API is the fallback if that answers nothing.
    const load = isPhone()
      ? loadRemoteSettings().then((ok) => (ok ? undefined : loadSettings()))
      : loadSettings();
    load
      .catch((error) => console.warn("Unable to load session settings", error))
      .finally(() => {
        setSettingsReady(true);
        reportAppActive();
      });
  }, []);
  useEffect(() => {
    // Only the machine that owns the settings file writes it back — a phone
    // browsing a desktop's projects must not overwrite them.
    if (isPhone()) return;
    return initSettingsSync();
  }, []);

  useEffect(() => {
    if (!isDesktopTauri()) {
      return;
    }

    initializeCodexAsync().catch((error) => {
      console.warn("Failed to initialize codex asynchronously", error);
    });

    // Listen for codex initialized event
    const unlisten = listen<InitializeResponse>(
      "codex:initialized",
      (event) => {
        console.log(
          "[App] Codex initialized, userAgent:",
          event.payload.userAgent,
        );
        setCodexReady(true);
      },
    );

    // Cmd+Q quits immediately when nothing is running, otherwise confirms first
    const unlistenQuit = listen("quit-requested", () => {
      hasActiveWork().then((active) => {
        if (active) {
          setQuitDialogOpen(true);
        } else {
          invoke("quit_app");
        }
      });
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenQuit.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen to codex events only after backend is initialized
  useCodexEvents(codexReady);

  useEffect(() => {
    const recover = () => {
      const thread = useCodexStore.getState().currentThreadId;
      useCodexStore.setState({ activeThreadIds: [], currentTurnId: null });
      useAcpStore.getState().setActive(false);
      toast.info("会话服务已重启，正在恢复历史。");
      if (thread)
        void codexService
          .threadResume(thread)
          .catch(() => toast.error("会话历史恢复失败，请从项目列表重新打开。"));
    };
    window.addEventListener("session-runtime-restarted", recover);
    return () =>
      window.removeEventListener("session-runtime-restarted", recover);
  }, []);
  // Shift-Shift on a text selection captures it as a todo
  useDoubleShiftCapture();

  // Web-mode deep link: ?agent=codex&thread=<id>&cwd=<path> (or agent=cc&session=<id>)
  useUrlParamThread(codexReady);

  // Bots finish routines and other bots' requests in the background; follow
  // them app-wide, not only while the Bot sidebar is showing.
  useBotActivity();

  // Wait for settings load before rendering
  if (!settingsReady) return null;

  // A phone gets its own two-screen shell instead of the desktop layout. It
  // shows the projects the desktop has added and nothing more — adding or
  // removing them stays on the machine that owns them.
  if (isPhone()) return <MobileShell />;

  return (
    <>
      <AppLayout />
      <TodoCaptureHint />
      <HistoryProjectsDialog />
      <TelemetryConsentDialog />
      <QuitDialog open={quitDialogOpen} onOpenChange={setQuitDialogOpen} />
    </>
  );
}

function AppEntry() {
  useAppDeepLink();

  const isPaired = usePairingStore((s) => s.desktops.length > 0);

  // A phone has no local backend, so it cannot do anything until it is paired.
  if (isPhone() && !isPaired) return <PairingView />;

  return <AppShell />;
}

export default function App() {
  const isAboutWindow = window.location.pathname === "/about";
  const isUsageWindow = window.location.pathname === "/usage";

  return (
    <ThemeProvider>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          {isUsageWindow ? (
            <Suspense>
              <UsagePanel />
            </Suspense>
          ) : isAboutWindow ? (
            <Suspense>
              <AboutView />
            </Suspense>
          ) : (
            <>
              <AppEntry />
              <Toaster />
            </>
          )}
        </TooltipProvider>
      </I18nextProvider>
    </ThemeProvider>
  );
}

import { lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DeferredComposerPanel } from "@session/components/codex/composer/DeferredComposerPanel";
import { useCodexStore } from "@session/components/codex/stores";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import {
  openEventStream,
  isEventStreamConnected,
} from "@session/lib/eventStream";
import { useAgentInteractionVisible } from "@session/session-dom";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { activeDraftOwner } from "@session/stores/useInputStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { usePairingStore } from "@session/stores/usePairingStore";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { useSessionSyncStore } from "@session/stores/useSessionSyncStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { nativeNotifications } from "@session/features/native-notifications/service";
import {
  feedbackPreflightPath,
  readFeedbackPreflight,
  type FeedbackTarget,
  type FeedbackPreflightReason,
} from "./preflight";
import { feedbackPreflightMessage } from "./preflightMessages";
import { startFeedbackUpload } from "./service";

const READ_TIMEOUT_MS = 15000;
const NativeFeedbackDialog = lazy(() =>
  import("@session/components/codex/composer/NativeFeedbackDialog").then(
    (module) => ({ default: module.NativeFeedbackDialog }),
  ),
);
type Workflow = {
  target: FeedbackTarget;
  identity: string;
  runtimeInstance?: string;
  revoked: boolean;
  connected: boolean;
  read?: AbortController;
  stop: () => void;
};

/** Only bounded connection/account primitives, never transcript bodies or auth tokens from native. */
function connectionIdentity() {
  const pairing = usePairingStore.getState();
  const desktop = pairing.desktops.find((d) => d.host === pairing.selectedHost);
  const { account, accountNamespace } = useCodexStore.getState();
  return JSON.stringify([
    pairing.selectedHost,
    desktop?.port,
    desktop?.token,
    buildUrl(feedbackPreflightPath),
    authHeaders().Authorization,
    account?.type ?? null,
    accountNamespace ?? (account?.type === "chatgpt" ? account.email : null),
  ]);
}

/** This host owns only preflight reads; a handed-off upload keeps its original service lifetime. */
export function FeedbackPreflightWorkflow({
  requested,
  target,
  onClose,
}: {
  requested: boolean;
  target: FeedbackTarget | null;
  onClose: () => void;
}) {
  const { i18n } = useTranslation();
  const visible = useAgentInteractionVisible();
  const marker = useRef<HTMLSpanElement>(null);
  const props = useRef({
    target,
    onClose,
    language: i18n.language,
    visible,
    requested,
  });
  props.current = {
    target,
    onClose,
    language: i18n.language,
    visible,
    requested,
  };
  const current = useRef<Workflow | null>(null);
  const alive = useRef(false);
  const requestedBefore = useRef(false);
  const [form, setForm] = useState<Workflow | null>(null);

  function targetMatches(captured: FeedbackTarget) {
    const actual = props.current.target;
    return (
      actual?.threadId === captured.threadId &&
      actual.cwd === captured.cwd &&
      actual.draftOwner === captured.draftOwner &&
      useCodexStore.getState().currentThreadId === captured.threadId &&
      useWorkspaceStore.getState().cwd === captured.cwd &&
      captured.draftOwner ===
        sessionDraftKey("codex", captured.threadId, captured.cwd) &&
      activeDraftOwner() === captured.draftOwner
    );
  }
  function hostMatches(captured: FeedbackTarget) {
    const parent = marker.current?.parentElement;
    return (
      !!parent?.isConnected &&
      !parent.closest("[hidden], [inert]") &&
      props.current.visible &&
      useLayoutStore.getState().view === "agent" &&
      useAgentSettingsStore.getState().selectedAgent === "codex" &&
      !useAcpStore.getState().active &&
      targetMatches(captured)
    );
  }

  function revoke(workflow: Workflow, closeRequest = false) {
    if (workflow.revoked) return;
    const clearOwnRequest =
      closeRequest &&
      alive.current &&
      current.current === workflow &&
      props.current.requested &&
      targetMatches(workflow.target);
    workflow.revoked = true;
    workflow.read?.abort();
    workflow.stop();
    if (current.current === workflow) {
      current.current = null;
      if (alive.current) setForm(null);
    }
    // Clear only this still-current feedback request, so a fresh slash action has a new edge.
    if (clearOwnRequest) props.current.onClose();
  }
  function valid(workflow: Workflow) {
    return (
      alive.current &&
      current.current === workflow &&
      !workflow.revoked &&
      hostMatches(workflow.target) &&
      connectionIdentity() === workflow.identity &&
      (!workflow.connected || isEventStreamConnected())
    );
  }
  function guard(workflow: Workflow) {
    if (valid(workflow)) return true;
    revoke(workflow, true);
    return false;
  }
  function notify(reason: FeedbackPreflightReason) {
    nativeNotifications.info(
      feedbackPreflightMessage(props.current.language ?? "zh", reason),
    );
  }

  async function check(
    workflow: Workflow,
  ): Promise<FeedbackPreflightReason | null | undefined> {
    if (!guard(workflow)) return;
    const controller = new AbortController();
    workflow.read = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAborted: (() => void) | undefined;
    try {
      const receipt = await Promise.race([
        readFeedbackPreflight(workflow.target, controller.signal),
        new Promise<never>((_resolve, reject) => {
          rejectAborted = () =>
            reject(new Error("Feedback preflight cancelled"));
          controller.signal.addEventListener("abort", rejectAborted, {
            once: true,
          });
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Feedback preflight timed out"));
          }, READ_TIMEOUT_MS);
        }),
      ]);
      if (!guard(workflow)) return;
      if (
        workflow.runtimeInstance &&
        workflow.runtimeInstance !== receipt.runtimeInstance
      )
        return "unavailable";
      workflow.runtimeInstance = receipt.runtimeInstance;
      return receipt.reason;
    } catch {
      if (guard(workflow)) return "unavailable";
    } finally {
      clearTimeout(timer);
      if (rejectAborted)
        controller.signal.removeEventListener("abort", rejectAborted);
      if (workflow.read === controller) workflow.read = undefined;
    }
  }

  function begin() {
    const captured = props.current.target;
    if (
      !alive.current ||
      current.current ||
      !captured ||
      !hostMatches(captured)
    )
      return;
    const workflow: Workflow = {
      target: { ...captured },
      identity: connectionIdentity(),
      revoked: false,
      connected: isEventStreamConnected(),
      stop: () => {},
    };
    current.current = workflow;
    const stops: Array<() => void> = [];
    workflow.stop = () => {
      for (const stop of stops.splice(0)) stop();
    };
    const changed = () => {
      guard(workflow);
    };
    stops.push(
      useCodexStore.subscribe(changed),
      useWorkspaceStore.subscribe(changed),
      usePairingStore.subscribe(changed),
      useAgentSettingsStore.subscribe(changed),
      useAcpStore.subscribe(changed),
      useLayoutStore.subscribe(changed),
      useSessionSyncStore.subscribe((state, previous) => {
        if (
          previous.connection === "connected" &&
          state.connection !== "connected"
        )
          revoke(workflow, true);
      }),
    );
    const restart = () => revoke(workflow, true);
    const visibilityChanged = () => {
      if (marker.current?.parentElement?.closest("[hidden], [inert]"))
        revoke(workflow, true);
    };
    window.addEventListener("session-runtime-restarted", restart);
    window.addEventListener("workbench-mode-changed", visibilityChanged);
    stops.push(() => {
      window.removeEventListener("session-runtime-restarted", restart);
      window.removeEventListener("workbench-mode-changed", visibilityChanged);
    });
    // Keep transient hidden/inert changes even when a same-task ABA ends visible.
    // Observe only this host's ancestors, only for this workflow, never message bodies.
    const visibilityObserver = new MutationObserver(() =>
      revoke(workflow, true),
    );
    for (
      let node = marker.current?.parentElement;
      node;
      node = node.parentElement
    ) {
      visibilityObserver.observe(node, {
        attributes: true,
        attributeFilter: ["hidden", "inert"],
      });
      if (node.classList.contains("session-mode")) break;
    }
    stops.push(() => visibilityObserver.disconnect());
    let opened = false;
    stops.push(
      openEventStream({
        agents: ["codex"],
        label: "feedback-preflight",
        onOpen: () => {
          if (opened) revoke(workflow, true);
          else {
            opened = true;
            workflow.connected = true;
          }
        },
        onResync: restart,
        onEvent: (event) => {
          const payload = event.payload;
          const method =
            payload && typeof payload === "object" && "method" in payload
              ? payload.method
              : undefined;
          if (
            event.event === "codex:disconnected" ||
            method === "account/updated" ||
            method === "account/login/completed"
          )
            revoke(workflow, true);
        },
      }),
    );
    void check(workflow).then((reason) => {
      if (!guard(workflow)) return;
      if (reason === null) setForm(workflow);
      else if (reason !== undefined) {
        notify(reason);
        revoke(workflow);
        props.current.onClose();
      }
    });
  }

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestedBefore.current = false;
      if (current.current) revoke(current.current);
    };
  }, []);
  useLayoutEffect(() => {
    if (current.current) guard(current.current);
  });
  useEffect(() => {
    if (requested && !requestedBefore.current) begin();
    if (!requested && requestedBefore.current && current.current)
      revoke(current.current);
    requestedBefore.current = requested;
  }, [requested]);
  useEffect(() => {
    if (!visible && current.current) revoke(current.current, true);
  }, [visible]);
  useEffect(() => {
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as unknown;
      const captured = props.current.target;
      if (
        !detail ||
        typeof detail !== "object" ||
        !captured ||
        !("threadId" in detail) ||
        !("draftOwner" in detail) ||
        detail.threadId !== captured.threadId ||
        detail.draftOwner !== captured.draftOwner
      )
        return;
      begin();
    };
    window.addEventListener("codex-open-feedback", open);
    return () => window.removeEventListener("codex-open-feedback", open);
  }, []);

  return (
    <>
      <span ref={marker} hidden data-feedback-preflight-host />
      {form && form === current.current && !form.revoked && (
        <DeferredComposerPanel
          label="反馈表单"
          onClose={() => {
            if (!guard(form)) return;
            revoke(form);
            props.current.onClose();
          }}
        >
          <NativeFeedbackDialog
            threadId={form.target.threadId}
            owner={form.target.draftOwner}
            onClose={() => {
              if (!guard(form)) return;
              revoke(form);
              props.current.onClose();
            }}
            submitFeedback={async (threadId, text, selection) => {
              if (threadId !== form.target.threadId || !guard(form)) return;
              const reason = await check(form);
              if (!guard(form)) return;
              if (reason !== null) {
                if (reason !== undefined) notify(reason);
                return;
              }
              // No await between the final scope fence and the existing captured upload handoff.
              startFeedbackUpload(
                form.target.threadId,
                text,
                selection,
                form.target.draftOwner,
              );
            }}
          />
        </DeferredComposerPanel>
      )}
    </>
  );
}

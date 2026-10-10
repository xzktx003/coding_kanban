import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import {
  useApprovalStore,
  type ApprovalRequest,
} from "../stores/useApprovalStore";
import {
  approvalDecisions,
  approvalDecisionKey,
  type ApprovalDecision,
} from "../stores/approvalDecisions";
import { rpcKey, useRpcDeliveryStore } from "../stores/rpcLifecycle";
import { NativeChevronDown } from "../presentation/NativeIcons";
import { NativeTextPreview } from "../presentation/NativeTextPreview";
import { RpcDeliveryNotice } from "./RpcDeliveryNotice";
import {
  NativeApprovalFile,
  NativeApprovalPermission,
  NativeApprovalTerminal,
} from "./ApprovalItem.icons";
import { useCodexStore } from "../stores/useCodexStore";
import { NativeDiffContent } from "@session/features/NativeDiffContent";
import { nativeDiffLines } from "@session/features/nativeDiffLines";
import type { FileUpdateChange } from "@session/bindings/v2";
import "./request-native.css";

export function ApprovalItem({
  currentThreadId,
}: { currentThreadId?: string } = {}) {
  const first = useApprovalStore((state) => state.currentApproval);
  const pending = useApprovalStore((state) => state.pendingApprovals);
  const matching = currentThreadId
    ? pending.filter((request) => request.threadId === currentThreadId)
    : pending;
  const request = currentThreadId
    ? (matching[0] ?? (first?.threadId === currentThreadId ? first : null))
    : (first ?? matching[0]);
  return request ? (
    <ApprovalCard
      key={rpcKey(request)}
      request={request}
      pendingCount={matching.length}
    />
  ) : null;
}

function ApprovalCard({
  request,
  pendingCount,
}: {
  request: ApprovalRequest;
  pendingCount: number;
}) {
  const { t } = useTranslation("thread");
  const delivery = useRpcDeliveryStore(
    (state) => state.states[rpcKey(request)],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const lock = useRef(false);
  const events = useCodexStore((state) => state.events[request.threadId]);
  // Read the original awaiting snapshot only. Never read current Git contents
  // or borrow a later turn's patch to describe this approval.
  let changes: FileUpdateChange[] = [];
  if (request.type === "fileChange")
    for (const event of events ?? []) {
      if (
        (event.method === "item/started" ||
          event.method === "item/completed") &&
        event.params.threadId === request.threadId &&
        event.params.turnId === request.turnId &&
        event.params.item.id === request.itemId &&
        event.params.item.type === "fileChange"
      )
        changes = event.params.item.changes;
    }
  const disabled =
    submitting ||
    delivery?.phase === "submitting" ||
    delivery?.phase === "uncertain";
  const decisions = approvalDecisions(request);
  const once = decisions.find((decision) => decision === "accept");
  const deny = decisions.filter(
    (decision) => decision === "decline" || decision === "cancel",
  );
  const scopes = decisions.filter(
    (decision) =>
      decision !== "accept" && decision !== "decline" && decision !== "cancel",
  );
  const command = request.type === "commandExecution" ? request : null;
  // Older runtime snapshots used argv, while native v2 sends a command string.
  // Normalize only the display; the request object remains the RPC identity.
  const commandValue: unknown = command?.command;
  const commandText =
    typeof commandValue === "string"
      ? commandValue
      : Array.isArray(commandValue) &&
          commandValue.every((part) => typeof part === "string")
        ? commandValue.join(" ")
        : null;
  const network = command?.networkApprovalContext;
  const destination = network
    ? /^(https?|socks5)$/.test(network.protocol)
      ? `${network.protocol}://${network.host}`
      : network.host
    : null;
  const title = network
    ? t("approval.networkPrompt", { destination })
    : request.reason?.trim() ||
      t(command ? "approval.commandPrompt" : "approval.filePrompt");

  const describe = (
    decision: ApprovalDecision,
  ): { label: string; detail?: string } => {
    if (decision === "accept") return { label: t("approval.approveOnce") };
    if (decision === "acceptForSession")
      return {
        label: t(
          request.type === "fileChange"
            ? "approval.allowAllEdits"
            : "approval.approveForSession",
        ),
        detail: t("approval.sessionScopeHint"),
      };
    if (decision === "decline") return { label: t("common.decline") };
    if (decision === "cancel")
      return { label: t("common.cancel"), detail: t("approval.cancelHint") };
    if ("acceptWithExecpolicyAmendment" in decision)
      return {
        label: t("approval.allowSimilarCommands"),
        detail:
          decision.acceptWithExecpolicyAmendment.execpolicy_amendment.join(" "),
      };
    const amendment =
      decision.applyNetworkPolicyAmendment.network_policy_amendment;
    return {
      label: t(
        amendment.action === "allow"
          ? "approval.alwaysAllowHost"
          : "approval.blockHost",
      ),
      detail: amendment.host,
    };
  };
  const respond = async (decision: ApprovalDecision) => {
    if (disabled || lock.current) return;
    lock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await useApprovalStore
        .getState()
        .respondToApproval(
          request.requestId,
          request.type === "commandExecution",
          decision,
          request,
        );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  };
  const button = (decision: ApprovalDecision, primary = false) => {
    const { label, detail } = describe(decision);
    return (
      <button
        key={approvalDecisionKey(decision)}
        type="button"
        disabled={disabled}
        className={`codex-approval-button${primary ? " is-primary" : ""}`}
        title={detail}
        onClick={() => void respond(decision)}
      >
        {label}
        {primary && (
          <kbd className="codex-approval-hotkey" aria-hidden="true">
            ↵
          </kbd>
        )}
      </button>
    );
  };

  return (
    <section
      className="codex-approval"
      data-codex-approval-surface="true"
      aria-busy={submitting}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.repeat ||
          event.nativeEvent.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          (event.target as HTMLElement).closest(
            '[inert],[aria-hidden="true"],[hidden],[role="dialog"],[role="menu"],input,textarea,select,[contenteditable=true]',
          )
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setCollapsed(true);
        } else if (
          event.key === "Enter" &&
          !collapsed &&
          once &&
          !(event.target as HTMLElement).closest("button,a")
        ) {
          event.preventDefault();
          event.stopPropagation();
          void respond(once);
        }
      }}
    >
      {collapsed ? (
        <div className="codex-approval-heading">
          <span>{t("approval.waitingRequest")}</span>
          <button
            type="button"
            className="codex-approval-button"
            onClick={() => setCollapsed(false)}
          >
            {t("approval.expandRequest")}
          </button>
        </div>
      ) : (
        <>
          <div className="codex-approval-heading">
            <div role="alert" aria-atomic="true">
              <div className="codex-approval-identity">
                {network ? (
                  <NativeApprovalPermission />
                ) : command ? (
                  <NativeApprovalTerminal />
                ) : (
                  <NativeApprovalFile />
                )}
                <span>
                  {t(
                    network
                      ? "approval.internetAccess"
                      : command
                        ? "approval.terminal"
                        : "approval.fileEdits",
                  )}
                </span>
                {pendingCount > 1 && (
                  <span className="codex-approval-pending">
                    {t("common.pending", { count: pendingCount })}
                  </span>
                )}
              </div>
              <div className="codex-approval-title">{title}</div>
              {destination && (
                <div className="codex-approval-destination">{destination}</div>
              )}
            </div>
            {network && request.reason && (
              <div className="codex-approval-reason">{request.reason}</div>
            )}
            {command?.cwd && (
              <div className="codex-approval-detail">
                <span>{t("approval.cwd")}</span>
                <code>{command.cwd}</code>
              </div>
            )}
            {request.type === "fileChange" && request.grantRoot && (
              <div className="codex-approval-detail">
                <span>{t("approval.allowWritesUnder")}</span>
                <code>{request.grantRoot}</code>
              </div>
            )}
            {command?.additionalPermissions && (
              <div className="codex-approval-permissions">
                {command.additionalPermissions.network?.enabled === true && (
                  <div>{t("permissions.networkAccess")}</div>
                )}
                {command.additionalPermissions.fileSystem?.read?.map((path) => (
                  <div key={`read-${path}`}>
                    {t("approval.readPath")}: <code>{path}</code>
                  </div>
                ))}
                {command.additionalPermissions.fileSystem?.write?.map(
                  (path) => (
                    <div key={`write-${path}`}>
                      {t("approval.writePath")}: <code>{path}</code>
                    </div>
                  ),
                )}
                {command.additionalPermissions.fileSystem?.entries?.map(
                  (entry, index) => (
                    <div key={index}>
                      <code>
                        {entry.path.type === "path"
                          ? entry.path.path
                          : entry.path.type === "glob_pattern"
                            ? entry.path.pattern
                            : JSON.stringify(entry.path.value)}
                      </code>{" "}
                      · {entry.access}
                    </div>
                  ),
                )}
              </div>
            )}
            <RpcDeliveryNotice request={request} />
            {error && !delivery && (
              <div role="alert" className="codex-approval-error">
                {error}
              </div>
            )}
          </div>
          {commandText && (
            <div className="codex-approval-body">
              <NativeTextPreview
                text={commandText}
                expandLabel={t("approval.expandCommand")}
                collapseLabel={t("approval.collapseCommand")}
              />
            </div>
          )}
          {changes.length > 0 && (
            <div className="codex-approval-patches">
              {changes.map((change, index) => (
                <details key={`${index}:${change.path}`}>
                  <summary>
                    {change.path}
                    {change.kind.type === "update" && change.kind.move_path
                      ? ` → ${change.kind.move_path}`
                      : ""}
                  </summary>
                  <NativeDiffContent
                    path={change.path}
                    lines={nativeDiffLines(
                      change.kind.type === "delete" ? change.diff : "",
                      change.kind.type === "add" ? change.diff : "",
                      change.diff,
                    )}
                  />
                </details>
              ))}
            </div>
          )}
          <div className="codex-approval-actions">
            {decisions.length === 0 && (
              <span role="status">{t("approval.noDecisions")}</span>
            )}
            {deny.map((decision) => button(decision))}
            {once ? (
              <div className="codex-approval-split">
                {button(once, true)}
                {scopes.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="codex-approval-button is-primary codex-approval-scope-trigger"
                        type="button"
                        disabled={disabled}
                        aria-label={t("approval.scopeOptions")}
                      >
                        <NativeChevronDown />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="codex-approval-menu"
                    >
                      {decisions
                        .filter(
                          (decision) =>
                            decision !== "decline" && decision !== "cancel",
                        )
                        .map((decision) => {
                          const { label, detail } = describe(decision);
                          return (
                            <DropdownMenuItem
                              key={approvalDecisionKey(decision)}
                              disabled={disabled}
                              title={detail}
                              onSelect={() => void respond(decision)}
                            >
                              <div>
                                <div>{label}</div>
                                {detail && (
                                  <div className="codex-approval-scope-detail">
                                    {detail}
                                  </div>
                                )}
                              </div>
                            </DropdownMenuItem>
                          );
                        })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ) : (
              scopes.map((decision, index) => button(decision, index === 0))
            )}
          </div>
        </>
      )}
    </section>
  );
}

import { useState } from "react";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { Button } from "@session/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { useNativeFullAccessConfirmation } from "./NativeFullAccessConfirmation";
import { ComposerFooterLabel } from "./ComposerToolbarContext";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { ComposerTooltip } from "./ComposerTooltip";
import { PermissionProfiles } from "./PermissionProfiles";
import { useCodexStore } from "../stores";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";

/** Main PermissionsModeDropdown semantics; auto review needs an authoritative native capability. */
export function AccessModePopover({ threadId }: { threadId: string | null }) {
  const { t } = useTranslation("composer");
  const {
    sandbox,
    permissionsKnown,
    sandboxPolicy,
    approvalPolicy,
    approvalsReviewer,
    autoReviewCapability,
    setAccessMode,
    collaborationMode,
    setCollaborationMode,
    setApprovalsReviewer,
    permissions,
    setPermissions,
  } = useThreadModelSettings(threadId);
  const threadCwd = useCodexStore((state) => state.threads?.find((thread) => thread.id === threadId)?.cwd);
  const workspaceCwd = useWorkspaceStore((state) => state.cwd);
  const {
    ask,
    confirmation,
    open: fullAccessOpen,
  } = useNativeFullAccessConfirmation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const full = !permissions && permissionsKnown && sandbox === "danger-full-access";
  const auto = !permissions && permissionsKnown && approvalsReviewer !== "user";
  const readOnly = !permissions && permissionsKnown && sandbox === "read-only";
  const custom =
    permissionsKnown &&
    (sandboxPolicy?.type === "externalSandbox" ||
      typeof approvalPolicy === "object");
  const label =
    collaborationMode === "plan"
      ? t("plan")
      : permissions
        ? `配置：${permissions}`
      : !permissionsKnown
        ? "权限待确认"
        : auto
          ? "帮我批准"
          : full
            ? "完全访问"
            : readOnly
              ? "只读"
              : custom
                ? "自定义"
                : "请求批准";
  const finish = () => {
    setCollaborationMode("default");
    // Keep the menu primitive's own trigger restoration. A side conversation
    // must not dispatch a focus request to the shared main composer.
  };
  const rows = [
    {
      key: "default",
      label: "请求批准",
      description: "编辑外部文件和使用互联网时始终询问",
      active: !permissions && !!permissionsKnown && !full && !auto && !readOnly && !custom,
      disabled: false,
      choose: () => {
        setAccessMode("workspace-write");
        setApprovalsReviewer("user");
        finish();
      },
    },
    {
      key: "auto",
      label: "帮我批准",
      description: autoReviewCapability
        ? "仅对检测到的风险操作请求批准"
        : "运行服务尚未确认自动审批审查能力",
      active: auto,
      disabled: !autoReviewCapability,
      choose: () => {
        if (!autoReviewCapability) return;
        setAccessMode("workspace-write");
        setApprovalsReviewer(autoReviewCapability);
        finish();
      },
    },
    {
      key: "full",
      label: "完全访问权限",
      description: "可不受限制地访问互联网和你电脑上的任何文件",
      active: full && !auto,
      disabled: false,
      choose: async () => {
        if (!(await ask())) return;
        setAccessMode("danger-full-access");
        setApprovalsReviewer("user");
        finish();
      },
    },
  ];
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); if (!open) setProfilesOpen(false); }}>
        <ComposerTooltip
          label="更改权限"
          popupOpen={menuOpen || fullAccessOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="session-access-trigger h-8 gap-2 px-2"
              aria-label={`执行权限：${label}`}
              title={`执行权限：${label}`}
            >
              {collaborationMode === "plan" ? (
                <ListChecks className="h-4 w-4" />
              ) : (
                <NativeComposerIcon
                  name={
                    auto ? "approvalAuto" : full ? "approvalFull" : "approval"
                  }
                />
              )}
              {/*
               * Official gives the permissions trigger `collapse: "xs"` on its
               * unflagged path (`permissions-mode-dropdown-6fd05cb80d75.js`
               * @25656, the `an` trigger that `tn` renders), so
               * the text goes only once the footer is <=300px. The icon and
               * `aria-label` stay at every width: this menu can grant full disk
               * and network access, so it must never become an unlabelled button.
               */}
              <ComposerFooterLabel collapse="xs" className="text-xs">
                {label}
              </ComposerFooterLabel>
              <NativeComposerIcon name="chevron" />
            </Button>
          </DropdownMenuTrigger>
        </ComposerTooltip>
        <DropdownMenuContent
          className="session-native-permission-menu"
          align="start"
          side="top"
          collisionPadding={8}
        >
          <div className="session-native-permission-heading">
            <span>应如何批准 Codex 操作？</span>
            <a
              href="https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it"
              target="_blank"
              rel="noreferrer"
            >
              了解更多
            </a>
          </div>
          {rows.map((row) => (
            <DropdownMenuItem
              key={row.key}
              role="menuitemradio"
              aria-checked={row.active}
              disabled={row.disabled}
              className={`session-native-permission-option ${row.key === "full" ? "is-full-access" : ""}`}
              onSelect={() => void row.choose()}
              title={row.description}
            >
              <NativeComposerIcon
                name={
                  row.key === "default"
                    ? "approvalHand"
                    : row.key === "auto"
                      ? "approvalAuto"
                      : "approvalFull"
                }
              />
              <span className="session-native-permission-copy">
                <span>{row.label}</span>
                <small>{row.description}</small>
              </span>
              {row.active && <NativeComposerIcon name="check" />}
            </DropdownMenuItem>
          ))}
          {custom && (
            <DropdownMenuItem
              role="menuitemradio"
              aria-checked
              className="session-native-permission-option"
            >
              <NativeComposerIcon name="shield" />
              <span className="session-native-permission-copy">
                <span>自定义（原生配置）</span>
                <small>保留此会话运行服务提供的权限。</small>
              </span>
              <NativeComposerIcon name="check" />
            </DropdownMenuItem>
          )}
          {profilesOpen ? <PermissionProfiles cwd={threadId ? threadCwd ?? null : workspaceCwd ?? null} selected={permissions} onSelect={(id) => { setPermissions(id); finish(); }} /> : <DropdownMenuItem disabled={!!threadId && !threadCwd} title={threadId && !threadCwd ? "会话工作目录尚待核对" : undefined} onSelect={(event) => { event.preventDefault(); setProfilesOpen(true); }}>选择权限配置…</DropdownMenuItem>}
          <div className="session-native-permission-adaptations">
            <DropdownMenuItem
              role="menuitemradio"
              aria-checked={readOnly}
              onSelect={() => {
                setAccessMode("read-only");
                setApprovalsReviewer("user");
                finish();
              }}
            >
              <NativeComposerIcon name="shield" />
              只读{readOnly && <NativeComposerIcon name="check" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setCollaborationMode(
                  collaborationMode === "plan" ? "default" : "plan",
                );
              }}
            >
              <ListChecks size={16} />
              {t("planMode")}
              {collaborationMode === "plan" && (
                <NativeComposerIcon name="check" />
              )}
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmation}
    </>
  );
}

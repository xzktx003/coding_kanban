import { useShallow } from "zustand/react/shallow";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCodexStore } from "@session/components/codex/stores";
import { useThreadModelSettings } from "@session/hooks/useThreadModelSettings";
import { Button } from "@session/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@session/components/ui/dropdown-menu";
import { useSessionActionConfirmation } from "@session/components/common/useSessionActionConfirmation";
import { useComposerToolbarNarrow } from "./ComposerToolbarContext";
import { NativeComposerIcon } from "./NativeComposerIcon";
import { ComposerTooltip } from "./ComposerTooltip";

/** Main PermissionsModeDropdown semantics; auto review needs an authoritative native capability. */
export function AccessModePopover({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("composer");
  const threadId = useCodexStore((s) => s.currentThreadId);
  const {
    sandbox,
    sandboxPolicy,
    approvalPolicy,
    approvalsReviewer,
    autoReviewCapability,
    setAccessMode,
    collaborationMode,
    setCollaborationMode,
    setApprovalsReviewer,
  } = useThreadModelSettings(threadId);
  const { triggerInputFocus } = useCodexStore(
    useShallow((s) => ({ triggerInputFocus: s.triggerInputFocus })),
  );
  const isNarrow = useComposerToolbarNarrow();
  const { ask, confirmation } = useSessionActionConfirmation();
  const full = sandbox === "danger-full-access";
  const auto = approvalsReviewer !== "user";
  const readOnly = sandbox === "read-only";
  const custom =
    sandboxPolicy?.type === "externalSandbox" ||
    typeof approvalPolicy === "object";
  const label =
    collaborationMode === "plan"
      ? t("plan")
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
    triggerInputFocus();
  };
  const rows = [
    {
      key: "default",
      label: "请求批准",
      description: "编辑外部文件和使用互联网时始终询问",
      active: !full && !auto && !readOnly && !custom,
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
        if (
          !(await ask({
            title: "开启完全访问权限？",
            description:
              "Codex 将能够运行命令、使用互联网，并在这台电脑上的任何位置创建和编辑文件，无需逐次请求你的许可。",
            confirmLabel: "开启完全访问权限",
          }))
        )
          return;
        setAccessMode("danger-full-access");
        setApprovalsReviewer("user");
        finish();
      },
    },
  ];
  return (
    <>
      <DropdownMenu>
        <ComposerTooltip label="更改权限">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="session-access-trigger h-8 gap-2 px-2"
              aria-label={`执行权限：${label}`}
              title={label}
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
              {(compact || !isNarrow) && (
                <span className="text-xs">{label}</span>
              )}
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
                triggerInputFocus();
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

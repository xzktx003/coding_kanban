import { useId, useRef, useState } from "react";
import { NativeToolIcon } from "../presentation/NativeToolIcons";
import { useTranslation } from "react-i18next";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";
import type { HookPromptFragment } from "@session/bindings/v2/HookPromptFragment";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@session/components/ui/dialog";
import { UserMessageItem } from "./UserMessageItem";
import "./tool-native.css";
export function NativeHookStats({ runs }: { runs: readonly HookRunSummary[] }) {
  const [open, setOpen] = useState(false),
    closeRef = useRef<HTMLButtonElement>(null),
    historyId = useId(),
    { i18n } = useTranslation("thread"),
    chinese = (i18n?.language ?? "zh").startsWith("zh");
  const finished = runs.filter((run) => run.status !== "running");
  if (!finished.length) return null;
  const warning = finished.some(
      (run) => run.status === "blocked" || run.status === "failed",
    ),
    label = chinese ? "钩子统计信息" : "Hook stats";
  const status = (value: string) =>
    chinese
      ? ({
          completed: "已完成",
          blocked: "已阻止",
          failed: "未成功",
          stopped: "已停止",
          running: "未知",
        }[value] ?? "未知")
      : value[0].toUpperCase() + value.slice(1);
  const source = (value: string) => {
    const category = [
      "system",
      "mdm",
      "cloudRequirements",
      "cloudManagedConfig",
      "legacyManagedConfigFile",
      "legacyManagedConfigMdm",
    ].includes(value)
      ? "admin"
      : value;
    return chinese
      ? ({
          admin: "管理员",
          user: "用户",
          project: "项目",
          plugin: "插件",
          sessionFlags: "会话",
        }[category] ?? "未知")
      : category === "admin"
        ? "Admin"
        : category === "sessionFlags"
          ? "Session"
          : category[0].toUpperCase() + category.slice(1);
  };
  return (
    <>
      <button
        type="button"
        className={`codex-native-hook-trigger${warning ? " is-warning" : ""}`}
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        <NativeToolIcon name="hook" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="codex-file-preview codex-native-hook-dialog"
          showCloseButton={false}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
        >
          <div className="codex-native-hook-body">
            <DialogTitle className="codex-native-hook-title">
              {label}
            </DialogTitle>
            <div className="codex-native-hook-counts">
              <span>{chinese ? "运行次数" : "Runs"}</span>
              <span>
                {finished.length.toLocaleString(i18n?.language ?? "zh")}
              </span>
              <span>{chinese ? "已阻止" : "Blocked"}</span>
              <span>
                {finished
                  .filter((run) => run.status === "blocked")
                  .length.toLocaleString(i18n?.language ?? "zh")}
              </span>
              <span>{chinese ? "未成功" : "Failed"}</span>
              <span>
                {finished
                  .filter((run) => run.status === "failed")
                  .length.toLocaleString(i18n?.language ?? "zh")}
              </span>
            </div>
            <section className="codex-native-hook-history">
              <div id={historyId}>{chinese ? "运行记录" : "Run history"}</div>
              <ul aria-labelledby={historyId} tabIndex={0}>
                {finished.map((run) => {
                  const entries = run.entries.filter(
                    (entry) => entry.kind !== "context",
                  );
                  return (
                    <li key={run.id}>
                      <details>
                        <summary>
                          <span
                            className={
                              run.status === "blocked" ||
                              run.status === "failed"
                                ? "codex-native-hook-outcome is-warning"
                                : "codex-native-hook-outcome"
                            }
                          >
                            <NativeToolIcon name="hookChevron" />
                            {status(run.status)}
                          </span>
                          <span className="codex-native-hook-origin">
                            <span>
                              {run.eventName[0].toUpperCase() +
                                run.eventName.slice(1)}
                            </span>
                            <span>{source(String(run.source))}</span>
                          </span>
                        </summary>
                        <div>
                          {run.statusMessage?.trim() && (
                            <p className="codex-native-hook-status-message">
                              {run.statusMessage.trim()}
                            </p>
                          )}
                          {entries.map((entry, index) => (
                            <div
                              className={
                                entry.kind === "error"
                                  ? "codex-native-hook-entry is-error"
                                  : "codex-native-hook-entry"
                              }
                              key={index}
                            >
                              <span>
                                {chinese
                                  ? ({
                                      warning: "消息",
                                      feedback: "反馈",
                                      error: "错误",
                                      stop: "停止原因",
                                      context: "输出",
                                    }[entry.kind] ?? "输出")
                                  : ({
                                      warning: "Message",
                                      feedback: "Feedback",
                                      error: "Error",
                                      stop: "Stop reason",
                                      context: "Output",
                                    }[entry.kind] ?? "Output")}
                              </span>
                              <p>{entry.text}</p>
                            </div>
                          ))}
                          {!entries.length && run.status !== "completed" && (
                            <p className="codex-native-hook-status-message">
                              {chinese
                                ? run.status === "blocked"
                                  ? "钩子未提供原因"
                                  : run.status === "failed"
                                    ? "钩子未提供错误详情"
                                    : "钩子未提供停止原因"
                                : run.status === "blocked"
                                  ? "The hook did not provide a reason"
                                  : run.status === "failed"
                                    ? "The hook did not provide error details"
                                    : "The hook did not provide a stop reason"}
                            </p>
                          )}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
          <DialogClose className="codex-native-hook-close" ref={closeRef}>
            <NativeToolIcon name="close" />
            <span className="sr-only">
              {chinese ? "关闭对话框" : "Close dialog"}
            </span>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function NativeHookPromptItem({
  fragments,
  runs = [],
}: {
  fragments: readonly HookPromptFragment[];
  runs?: readonly HookRunSummary[];
}) {
  const text = fragments
    .map((fragment) => fragment.text)
    .filter(Boolean)
    .join("\n\n");
  return text ? (
    <div data-native-hook-feedback>
      <UserMessageItem content={[{ type: "text", text, text_elements: [] }]} />
      {runs.length > 0 && <NativeHookStats runs={runs} />}
    </div>
  ) : null;
}

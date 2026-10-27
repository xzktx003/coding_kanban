import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { v4 as uuid } from "uuid";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
  type CodexOperationScope,
} from "@session/services/codexOperationScope";
import { useSessionLeaveGuard } from "@session/hooks/useSessionLeaveGuard";
import { isSessionInteractionVisible } from "@session/session-dom";
import {
  changeConversationForm,
  releaseEmptyConversationForm,
  reserveConversationForm,
  retainConversationForm,
  updateConversationForm,
  useConversationFormDrafts,
} from "./conversationFormDrafts";
export type ConversationFormKind =
  | "archive"
  | "delete"
  | "notes"
  | "commitOptions"
  | "commit"
  | "branch"
  | "pullRequest"
  | "draftPullRequest"
  | "fileSearch"
  | "merge"
  | "openPullRequest";
export type ConversationFormTarget = {
  id: string;
  threadId: string;
  cwd: string | null;
  title: string;
  draftOwner: string;
  scope: CodexOperationScope;
  key: string;
};
export type ConversationOwnerForm = {
  kind: ConversationFormKind;
  target: ConversationFormTarget;
};
export function captureConversationForm(
  kind: ConversationFormKind,
  input: {
    threadId: string;
    cwd?: string | null;
    title: string;
    draftOwner: string;
  },
): ConversationOwnerForm {
  const scope = captureCodexOperationScope();
  const key = JSON.stringify([
    scope.accountNamespace ?? ["unverified", scope.revision],
    scope.hasAccount,
    scope.accountType,
    input.threadId,
    input.cwd ?? null,
    kind === "commitOptions" ? "commit" : kind,
  ]);
  reserveConversationForm(key);
  return {
    kind,
    target: { ...input, cwd: input.cwd ?? null, scope, key, id: uuid() },
  };
}
type Context = {
  target: ConversationFormTarget;
  pending: boolean;
  error: string | null;
  assertCurrent: () => void;
  run: <T>(
    write: () => Promise<T>,
    accepted?: (result: T) => void,
    clear?: boolean,
  ) => Promise<boolean>;
};
const OwnerFormContext = createContext<Context | null>(null);
export function ConversationOwnerFormProvider({
  target,
  children,
}: {
  target: ConversationFormTarget;
  children: ReactNode;
}) {
  const draft = useConversationFormDrafts((s) => s.drafts[target.key]);
  useSessionLeaveGuard(!!draft?.dirty, !!draft?.pending);
  useEffect(() => retainConversationForm(target.key), [target.key]);
  const assertCurrent = () => {
    if (
      !isSessionInteractionVisible() ||
      !isCodexOperationScopeCurrent(target.scope)
    )
      throw new Error(
        "运行环境或账号已变化，尚未执行操作；原表单内容已保留，请返回原会话核对后重新打开。",
      );
  };
  const run = async <T,>(
    write: () => Promise<T>,
    accepted?: (result: T) => void,
    clear = true,
  ) => {
    try {
      assertCurrent();
    } catch (error) {
      updateConversationForm(target.key, (d) => ({
        ...d,
        error: String(error),
      }));
      throw error;
    }
    const current = useConversationFormDrafts.getState().drafts[target.key];
    if (!current || current.pending || current.receipt === target.id)
      return false;
    const request = uuid(),
      revision = current.revision;
    updateConversationForm(target.key, (d) => ({
      ...d,
      pending: request,
      error: null,
    }));
    try {
      const result = await write();
      if (
        useConversationFormDrafts.getState().drafts[target.key]?.pending !==
        request
      )
        return false;
      updateConversationForm(target.key, (d) =>
        d.pending === request ? { ...d, receipt: target.id } : d,
      );
      if (!isCodexOperationScopeCurrent(target.scope)) {
        updateConversationForm(target.key, (d) =>
          d.pending === request
            ? {
                ...d,
                pending: null,
                error:
                  "运行环境已变化，未将旧操作回执用于当前会话；原内容已保留。",
              }
            : d,
        );
        return false;
      }
      updateConversationForm(target.key, (d) =>
        d.pending !== request
          ? d
          : clear && d.revision === revision
            ? {
                fields: {},
                revision: d.revision + 1,
                dirty: false,
                pending: null,
                error: null,
                receipt: target.id,
              }
            : { ...d, pending: null },
      );
      accepted?.(result);
      return true;
    } catch (error) {
      updateConversationForm(target.key, (d) =>
        d.pending === request
          ? {
              ...d,
              pending: null,
              error: error instanceof Error ? error.message : String(error),
            }
          : d,
      );
      throw error;
    } finally {
      releaseEmptyConversationForm(target.key);
    }
  };
  return (
    <OwnerFormContext.Provider
      value={{
        target,
        pending: !!draft?.pending || draft?.receipt === target.id,
        error: draft?.error ?? null,
        assertCurrent,
        run,
      }}
    >
      {children}
    </OwnerFormContext.Provider>
  );
}
export const useConversationOwnerForm = () => useContext(OwnerFormContext);
export function OwnerFormSummary() {
  const owner = useConversationOwnerForm();
  const draft = useConversationFormDrafts((s) =>
    owner ? s.drafts[owner.target.key] : undefined,
  );
  return owner ? (
    <>
      <p
        className="text-xs text-muted-foreground"
        data-conversation-form-owner={owner.target.threadId}
      >
        目标：{owner.target.title} · {owner.target.cwd ?? owner.target.threadId}
      </p>
      {draft?.dirty && (
        <div className="text-xs text-muted-foreground">
          未提交内容仅在本页暂存，刷新不会自动恢复。
          <button
            type="button"
            disabled={owner.pending}
            onClick={() =>
              updateConversationForm(owner.target.key, (d) => ({
                ...d,
                fields: {},
                dirty: false,
                revision: d.revision + 1,
                error: null,
              }))
            }
          >
            清空未提交内容
          </button>
        </div>
      )}
      {owner.error && <p role="alert">{owner.error}</p>}
    </>
  ) : null;
}
export function useConversationFormField(field: string, initial = "") {
  const owner = useConversationOwnerForm();
  const [local, setLocal] = useState(initial);
  const stored = useConversationFormDrafts((s) =>
    owner ? s.drafts[owner.target.key]?.fields[field] : undefined,
  );
  const set = (value: string) =>
    owner
      ? changeConversationForm(owner.target.key, field, value)
      : setLocal(value);
  const initialize = (value: string) =>
    owner
      ? changeConversationForm(owner.target.key, field, value, true)
      : setLocal(value);
  return [owner ? (stored ?? initial) : local, set, initialize] as const;
}

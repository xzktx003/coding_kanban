import { deliverRpc, sameRpc, rpcRequestContext, rpcKey } from "./rpcLifecycle";
import {
  elicitationFields,
  initialElicitationValues,
  validateElicitationValues,
  type ElicitationValues,
  type ElicitationFieldError,
  type ElicitationCustomDraft,
  elicitationSchema,
} from "./elicitationFields";
export { elicitationFields } from "./elicitationFields";
export type { ElicitationField } from "./elicitationFields";
import { create } from "zustand";
import type { RequestId } from "@session/bindings";
import type {
  McpElicitationSchema,
  McpServerElicitationAction,
  McpServerElicitationRequestParams,
} from "@session/bindings/v2";
import { respondToMcpElicitation } from "@session/services";

/// Codex tags privileged approval elicitations through `_meta`; mirrors
/// codex-rs `protocol/src/mcp_approval_meta.rs`.
const APPROVAL_KIND_KEY = "codex_approval_kind";
const APPROVAL_KIND_MCP_TOOL_CALL = "mcp_tool_call";
const PERSIST_KEY = "persist";
const PERSIST_SESSION = "session";
const PERSIST_ALWAYS = "always";

export type ElicitationRequest = McpServerElicitationRequestParams & {
  requestId: RequestId;
  requestToken?: string;
};

export type ElicitationChoice = {
  label: string;
  description?: string;
  action: McpServerElicitationAction;
  persist?: typeof PERSIST_SESSION | typeof PERSIST_ALWAYS;
};

function metaObject(
  request: ElicitationRequest,
): Record<string, unknown> | null {
  if (request.mode === "url") return null;
  const meta = request._meta;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
}

function supportsPersist(
  meta: Record<string, unknown> | null,
  mode: typeof PERSIST_SESSION | typeof PERSIST_ALWAYS,
): boolean {
  const persist = meta?.[PERSIST_KEY];
  if (typeof persist === "string") return persist === mode;
  return Array.isArray(persist) && persist.includes(mode);
}

function isMessageOnlySchema(schema: McpElicitationSchema | null): boolean {
  if (!schema) return true;
  return (
    schema.type === "object" &&
    Object.keys(schema.properties ?? {}).length === 0
  );
}

/// A message-only schema means the server wants a decision, not form input —
/// the response carries the choice in `action` and leaves `content` null.
export function isApprovalElicitation(request: ElicitationRequest): boolean {
  if (request.mode !== "form") return false;
  return isMessageOnlySchema(request.requestedSchema);
}

function metaText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** Plugin `Be`: English protocol titles become “是否允许 {连接器} 运行 {工具} 工具？”. */
export function mcpToolApprovalTitle(request: ElicitationRequest): {
  connectorName: string;
  toolName: string;
  elevated: boolean;
} | null {
  const meta = metaObject(request);
  if (!meta || meta[APPROVAL_KIND_KEY] !== APPROVAL_KIND_MCP_TOOL_CALL)
    return null;
  const connectorName =
    metaText(meta.connector_name) ||
    metaText(meta.connectorName) ||
    request.serverName.trim() ||
    "连接器";
  const fromMessage = /^Allow\s+(.+?)\s+to\s+run\s+tool\s+"([^"]+)"\?$/.exec(
    request.message,
  );
  const toolName =
    metaText(meta.tool_name) || metaText(meta.toolName) || fromMessage?.[2] || "";
  if (!toolName) return null;
  return {
    connectorName,
    toolName,
    elevated: meta.risk_level === "high" || meta.riskLevel === "high",
  };
}

export function elicitationChoices(
  request: ElicitationRequest,
): ElicitationChoice[] {
  const meta = metaObject(request);
  const isToolCall = meta?.[APPROVAL_KIND_KEY] === APPROVAL_KIND_MCP_TOOL_CALL;

  const choices: ElicitationChoice[] = [
    {
      label: "允许一次",
      description: isToolCall ? "运行该工具并继续。" : "允许此请求并继续。",
      action: "accept",
    },
  ];
  if (supportsPersist(meta, PERSIST_SESSION)) {
    choices.push({
      label: "允许此对话",
      description: "在本次会话中记住此选择。",
      action: "accept",
      persist: PERSIST_SESSION,
    });
  }
  if (supportsPersist(meta, PERSIST_ALWAYS)) {
    choices.push({
      label: "始终允许",
      description: "记住此选择，用于以后的请求。",
      action: "accept",
      persist: PERSIST_ALWAYS,
    });
  }
  if (!isToolCall) {
    choices.push({
      label: "拒绝",
      description: "拒绝并继续。",
      action: "decline",
    });
  }
  choices.push({
    label: "取消",
    description: "取消此请求。",
    action: "cancel",
  });
  return choices;
}

type ElicitationDraft = {
  values: ElicitationValues;
  errors: Record<string, ElicitationFieldError>;
  fieldIndex: number;
  collapsed: boolean;
  customDrafts: Record<string, ElicitationCustomDraft>;
};
const initialDraft = (request: ElicitationRequest): ElicitationDraft => ({
  values: initialElicitationValues(elicitationFields(request)),
  errors: {},
  fieldIndex: 0,
  collapsed: false,
  customDrafts: {},
});
interface ElicitationStore {
  pendingRequests: ElicitationRequest[];
  drafts: Record<string, ElicitationDraft>;
  setFieldIndex: (request: ElicitationRequest, index: number) => void;
  setCollapsed: (request: ElicitationRequest, collapsed: boolean) => void;
  setCustomDraft: (
    request: ElicitationRequest,
    fieldId: string,
    draft: ElicitationCustomDraft,
  ) => void;
  setFieldValue: (
    request: ElicitationRequest,
    fieldId: string,
    value: unknown,
  ) => void;
  setFieldErrors: (
    request: ElicitationRequest,
    errors: Record<string, ElicitationFieldError>,
  ) => void;
  addRequest: (request: ElicitationRequest) => void;
  respond: (
    requestId: RequestId,
    action: McpServerElicitationAction,
    content?: unknown,
    meta?: unknown,
    target?: ElicitationRequest,
  ) => Promise<void>;
}

export const useElicitationStore = create<ElicitationStore>((set, get) => ({
  pendingRequests: [],
  drafts: {},
  setCustomDraft: (request, fieldId, draft) => {
    if (!get().pendingRequests.includes(request)) return;
    const key = rpcKey(request);
    set((state) => {
      const previous = state.drafts[key] ?? initialDraft(request);
      const field = elicitationFields(request).find(
        (field) => field.id === fieldId,
      );
      const values =
        field?.schema.type === "string"
          ? { ...previous.values, [fieldId]: draft.selected ? draft.text : "" }
          : previous.values;
      const errors = { ...previous.errors };
      delete errors[fieldId];
      return {
        drafts: {
          ...state.drafts,
          [key]: {
            ...previous,
            values,
            errors,
            customDrafts: { ...previous.customDrafts, [fieldId]: draft },
          },
        },
      };
    });
  },
  setFieldIndex: (request, index) => {
    if (!get().pendingRequests.includes(request)) return;
    const key = rpcKey(request);
    set((state) => ({
      drafts: {
        ...state.drafts,
        [key]: {
          ...(state.drafts[key] ?? initialDraft(request)),
          fieldIndex: Math.max(
            0,
            Math.min(index, elicitationFields(request).length - 1),
          ),
        },
      },
    }));
  },
  setCollapsed: (request, collapsed) => {
    if (!get().pendingRequests.includes(request)) return;
    const key = rpcKey(request);
    set((state) => ({
      drafts: {
        ...state.drafts,
        [key]: { ...(state.drafts[key] ?? initialDraft(request)), collapsed },
      },
    }));
  },
  setFieldValue: (request, fieldId, value) => {
    if (!get().pendingRequests.includes(request)) return;
    const key = rpcKey(request);
    set((state) => {
      const previous = state.drafts[key] ?? initialDraft(request);
      const values = {
        ...(previous?.values ??
          initialElicitationValues(elicitationFields(request))),
        [fieldId]: value,
      };
      const errors = { ...previous?.errors };
      delete errors[fieldId];
      return {
        drafts: { ...state.drafts, [key]: { ...previous, values, errors } },
      };
    });
  },
  setFieldErrors: (request, errors) => {
    if (!get().pendingRequests.includes(request)) return;
    const key = rpcKey(request);
    set((state) => ({
      drafts: {
        ...state.drafts,
        [key]: {
          ...(state.drafts[key] ?? initialDraft(request)),
          values:
            state.drafts[key]?.values ??
            initialElicitationValues(elicitationFields(request)),
          errors,
        },
      },
    }));
  },
  addRequest: (request) => {
    set((state) => ({
      pendingRequests: state.pendingRequests.some((r) => sameRpc(r, request))
        ? state.pendingRequests
        : [...state.pendingRequests, request],
    }));
  },
  respond: async (requestId, action, content = null, meta = null, target) => {
    const request =
      target ?? get().pendingRequests.find((r) => r.requestId === requestId);
    if (
      !request ||
      request.requestId !== requestId ||
      !get().pendingRequests.includes(request)
    )
      throw new Error("请求已过期");
    if (
      action === "accept" &&
      request.mode === "openai/form" &&
      !elicitationSchema(request)
    )
      throw new Error("当前表单类型尚不支持，请核对请求");
    if (
      action === "accept" &&
      request.mode !== "url" &&
      !isApprovalElicitation(request)
    ) {
      if (!content || typeof content !== "object" || Array.isArray(content))
        throw new Error("请核对表单字段");
      const validated = validateElicitationValues(
        elicitationFields(request),
        content as ElicitationValues,
      );
      if (!validated.content) {
        get().setFieldErrors(request, validated.errors);
        throw new Error("请核对表单字段");
      }
      content = validated.content;
    }
    await deliverRpc(
      request,
      () =>
        respondToMcpElicitation(
          requestId,
          action,
          content,
          meta,
          rpcRequestContext(request),
        ),
      () => {
        set((state) => {
          const drafts = { ...state.drafts };
          delete drafts[rpcKey(request)];
          return {
            pendingRequests: state.pendingRequests.filter((r) => r !== request),
            drafts,
          };
        });
      },
    );
  },
}));

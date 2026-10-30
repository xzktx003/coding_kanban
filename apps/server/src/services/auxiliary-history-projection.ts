/** These are the existing runtime recent-page contracts, not a raw-history adapter. */
export const AUXILIARY_HISTORY_PAGE_BYTES = 2 * 1024 * 1024;
type Provider = "cc" | "acp";
type ObjectValue = Record<string, unknown>;
interface RecentRequest {
  provider: Provider;
  sessionId: string;
  limit: number;
  cursor?: string;
  metadataOnly: boolean;
}

export class AuxiliaryHistoryError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function auxiliaryRecentProvider(
  method: string,
  suffix: string,
): Provider | null {
  if (method !== "POST") return null;
  const url = new URL(suffix, "http://session.invalid");
  if (!url.searchParams.getAll("view").includes("recent")) return null;
  const pathname = decodeURIComponent(url.pathname);
  return pathname === "/api/cc/session-messages"
    ? "cc"
    : pathname === "/api/acp/session"
      ? "acp"
      : null;
}
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identity = (value: unknown, max = 512): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\x00-\x1f]/.test(value);
const integer = (value: unknown, min = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min;
function invalid(): never {
  throw new AuxiliaryHistoryError(
    502,
    "AUXILIARY_HISTORY_INVALID",
    "会话服务返回了无效的近期历史投影，请核对会话服务版本后重试。",
  );
}
function unsupported(): never {
  throw new AuxiliaryHistoryError(
    501,
    "AUXILIARY_HISTORY_UNSUPPORTED",
    "当前会话服务不支持有界近期历史；请在安全维护窗口更新服务后重试。",
  );
}
function exceeded(): never {
  throw new AuxiliaryHistoryError(
    502,
    "AUXILIARY_HISTORY_LIMIT_EXCEEDED",
    "会话服务的近期历史响应超过 2 MiB 预算，已停止本次只读传输。",
  );
}
/** The only version currently sent by the runtime is inside its cursor tuple. */
function cursorBefore(
  value: unknown,
  provider: Provider,
  sessionId: string,
): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    return Array.isArray(decoded) &&
      decoded.length === 4 &&
      decoded[0] === 1 &&
      decoded[1] === provider &&
      decoded[2] === sessionId &&
      identity(decoded[3])
      ? decoded[3]
      : null;
  } catch {
    return null;
  }
}
export function auxiliaryRecentRequest(
  provider: Provider,
  suffix: string,
  body: unknown,
): RecentRequest {
  const views = new URL(suffix, "http://session.invalid").searchParams.getAll(
    "view",
  );
  const sessionId = object(body)
    ? (body.session_id ?? (provider === "cc" ? body.sessionId : undefined))
    : undefined;
  if (
    !object(body) ||
    views.length !== 1 ||
    views[0] !== "recent" ||
    !identity(sessionId) ||
    (provider === "cc" && !/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) ||
    (body.limit !== undefined &&
      (!integer(body.limit, 1) || body.limit > 256)) ||
    (body.metadataOnly !== undefined &&
      typeof body.metadataOnly !== "boolean") ||
    (body.cursor !== undefined &&
      !cursorBefore(body.cursor, provider, sessionId))
  )
    throw new AuxiliaryHistoryError(
      400,
      "AUXILIARY_HISTORY_INVALID_REQUEST",
      "无效的近期历史读取参数。",
    );
  return {
    provider,
    sessionId,
    limit: Number(body.limit ?? 80),
    ...(typeof body.cursor === "string" ? { cursor: body.cursor } : {}),
    metadataOnly: body.metadataOnly === true,
  };
}

function validDetail(row: ObjectValue): boolean {
  if (row.truncated !== undefined && typeof row.truncated !== "boolean")
    return false;
  if (
    row.historyDetail !== undefined &&
    (!object(row.historyDetail) ||
      !identity(row.historyDetail.itemId) ||
      Object.keys(row.historyDetail).some((key) => key !== "itemId"))
  )
    return false;
  return (
    row.historyImages === undefined ||
    (Array.isArray(row.historyImages) &&
      row.historyImages.length <= 32 &&
      row.historyImages.every(
        (image) =>
          object(image) &&
          integer(image.index) &&
          image.index < 32 &&
          ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            String(image.mimeType),
          ) &&
          (image.label === undefined || typeof image.label === "string") &&
          Object.keys(image).every((key) =>
            ["index", "mimeType", "label"].includes(key),
          ),
      ))
  );
}
function validatePage(value: unknown, request: RecentRequest): ObjectValue {
  if (Array.isArray(value) || (object(value) && value.projection === undefined))
    unsupported();
  if (
    !object(value) ||
    value.projection !==
      (request.provider === "cc" ? "cc-messages" : "acp-entries") ||
    !Array.isArray(value.data) ||
    value.data.length > request.limit ||
    typeof value.truncated !== "boolean" ||
    !identity(value.revision) ||
    Object.keys(value).some(
      (key) =>
        ![
          "projection",
          "data",
          "nextCursor",
          "revision",
          "truncated",
          "metadata",
        ].includes(key),
    )
  )
    invalid();
  if (
    request.metadataOnly &&
    (value.data.length ||
      value.nextCursor !== null ||
      value.truncated ||
      value.metadata !== undefined)
  )
    invalid();
  // Current Claude revisions are source-metadata digests; ACP revisions bind a
  // persistent update count and the exact snapshot's last source row.
  let source = 0;
  if (request.provider === "cc") {
    if (!/^[a-f0-9]{64}$/.test(value.revision) || value.metadata !== undefined)
      invalid();
  } else {
    const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value.revision);
    if (
      !match ||
      !integer(Number(match[1])) ||
      !integer(Number(match[2])) ||
      Number(match[1]) > Number(match[2])
    )
      invalid();
    source = Number(match[2]);
    if (
      !request.metadataOnly &&
      (!object(value.metadata) ||
        value.metadata.historySourceId !== source ||
        !integer(value.metadata.historySourceId) ||
        (value.metadata.currentModeId !== undefined &&
          typeof value.metadata.currentModeId !== "string") ||
        (value.metadata.configOptions !== undefined &&
          (!Array.isArray(value.metadata.configOptions) ||
            !value.metadata.configOptions.every(object))) ||
        Object.keys(value.metadata).some(
          (key) =>
            !["historySourceId", "currentModeId", "configOptions"].includes(
              key,
            ),
        ))
    )
      invalid();
  }
  const ids = new Set<string>();
  for (const row of value.data) {
    if (!object(row) || !validDetail(row)) invalid();
    const id = row[request.provider === "cc" ? "uuid" : "id"];
    if (!identity(id) || ids.has(id)) invalid();
    ids.add(id);
    if (request.provider === "cc") {
      if (
        (row.session_id !== undefined &&
          row.session_id !== request.sessionId) ||
        (row.type !== undefined && typeof row.type !== "string") ||
        (row.message !== undefined &&
          row.message !== null &&
          !object(row.message))
      )
        invalid();
    } else if (
      !integer(row.historySourceId, 1) ||
      row.historySourceId > source ||
      !["user", "agent", "thought", "tool", "error"].includes(
        String(row.role),
      ) ||
      (row.role === "tool"
        ? !identity(row.toolCallId) ||
          typeof row.title !== "string" ||
          typeof row.status !== "string"
        : typeof row.text !== "string") ||
      (row.images !== undefined &&
        (!Array.isArray(row.images) ||
          !row.images.every((image) => typeof image === "string"))) ||
      (row.clientMessageId !== undefined && !identity(row.clientMessageId)) ||
      (row.partIndex !== undefined && !integer(row.partIndex)) ||
      Object.keys(row).some(
        (key) =>
          ![
            "id",
            "role",
            "text",
            "images",
            "clientMessageId",
            "partIndex",
            "historySourceId",
            "truncated",
            "historyDetail",
            "historyImages",
            "toolCallId",
            "title",
            "status",
            "kind",
            "content",
            "locations",
            "rawInput",
            "rawOutput",
          ].includes(key),
      )
    )
      invalid();
  }
  if (value.nextCursor !== null) {
    const before = cursorBefore(
      value.nextCursor,
      request.provider,
      request.sessionId,
    );
    const first = value.data[0];
    if (
      !before ||
      !object(first) ||
      before !== first[request.provider === "cc" ? "uuid" : "id"] ||
      value.nextCursor === request.cursor
    )
      invalid();
  }
  return value;
}

export async function readAuxiliaryRecentResponse(
  response: Response,
  request: RecentRequest,
  signal: AbortSignal,
): Promise<ObjectValue> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if ([404, 501].includes(response.status)) unsupported();
    throw new AuxiliaryHistoryError(
      response.status,
      "AUXILIARY_HISTORY_UPSTREAM_ERROR",
      `会话服务暂时无法读取近期历史（HTTP ${response.status}），请重试。`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) invalid();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  let complete = false;
  try {
    signal.throwIfAborted();
    const length = response.headers.get("content-length");
    if (
      length &&
      /^\d+$/.test(length) &&
      Number(length) > AUXILIARY_HISTORY_PAGE_BYTES
    )
      exceeded();
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      invalid();
    const chunks: Buffer[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) {
        complete = true;
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > AUXILIARY_HISTORY_PAGE_BYTES) exceeded();
      chunks.push(Buffer.from(chunk.value));
    }
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks, bytes),
        ),
      );
    } catch {
      invalid();
    }
    return validatePage(value, request);
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

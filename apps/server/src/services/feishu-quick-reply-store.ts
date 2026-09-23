import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export interface FeishuQuickReply {
  id: string;
  label: string;
  category?: string;
  text: string;
  requiresEditing?: boolean;
}

export interface FeishuQuickReplyCatalog {
  items: FeishuQuickReply[];
  revision: string;
  message?: string;
}

const FILE_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_REPLIES = 80;
const MAX_LABEL_CHARS = 80;
const MAX_CATEGORY_CHARS = 40;
const MAX_TEXT_CHARS = 8_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UNSAFE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

interface PersistedQuickReply {
  id?: unknown;
  label?: unknown;
  category?: unknown;
  text?: unknown;
  requiresEditing?: unknown;
  enabled?: unknown;
}

interface PersistedQuickReplyFile {
  version?: unknown;
  replies?: unknown;
}

export class FeishuQuickReplyStore {
  readonly #filePath: string;

  constructor(options: { filePath: string }) {
    this.#filePath = options.filePath;
  }

  read(): FeishuQuickReplyCatalog {
    let raw: string;
    try {
      const stats = statSync(this.#filePath);
      if (!stats.isFile()) {
        return emptyCatalog("快捷回复文件无法读取。");
      }
      if (stats.size > MAX_FILE_BYTES) {
        return emptyCatalog("快捷回复文件超过 512 KiB 上限。");
      }
      raw = readFileSync(this.#filePath, "utf8");
    } catch {
      return emptyCatalog("未找到快捷回复文件，或当前用户无法读取。");
    }

    let parsed: PersistedQuickReplyFile;
    try {
      parsed = JSON.parse(raw) as PersistedQuickReplyFile;
    } catch {
      return emptyCatalog("快捷回复文件格式无效，请检查结构。");
    }

    const validated = validateCatalog(parsed);
    if (typeof validated === "string") {
      return emptyCatalog(validated);
    }

    return {
      items: validated,
      revision: revisionFor(validated),
    };
  }
}

function emptyCatalog(message: string): FeishuQuickReplyCatalog {
  return {
    items: [],
    revision: revisionFor([]),
    message,
  };
}

function validateCatalog(
  value: PersistedQuickReplyFile,
): FeishuQuickReply[] | string {
  if (
    value === null ||
    typeof value !== "object" ||
    value.version !== FILE_VERSION ||
    !Array.isArray(value.replies)
  ) {
    return "快捷回复文件格式无效：需要 version: 1 和 replies 数组。";
  }
  if (value.replies.length > MAX_REPLIES) {
    return `快捷回复最多支持 ${MAX_REPLIES} 条。`;
  }

  const seenIds = new Set<string>();
  const items: FeishuQuickReply[] = [];

  for (const entry of value.replies) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return "快捷回复条目格式无效。";
    }

    const reply = entry as PersistedQuickReply;
    if (reply.enabled !== undefined && typeof reply.enabled !== "boolean") {
      return "快捷回复条目启用标记格式无效。";
    }
    if (reply.enabled === false) {
      continue;
    }

    const item = validateReply(reply);
    if (typeof item === "string") {
      return item;
    }
    if (seenIds.has(item.id)) {
      return "快捷回复 ID 不能重复。";
    }
    seenIds.add(item.id);
    items.push(item);
  }

  return items;
}

function validateReply(value: PersistedQuickReply): FeishuQuickReply | string {
  if (!isValidId(value.id)) {
    return "快捷回复条目包含无效 ID。";
  }
  if (!isBoundedCleanString(value.label, MAX_LABEL_CHARS, false)) {
    return "快捷回复条目标题无效或超过长度上限。";
  }
  if (!isBoundedCleanString(value.text, MAX_TEXT_CHARS, true)) {
    return "快捷回复条目正文无效、超过长度上限，或包含不支持的控制字符。";
  }

  const item: FeishuQuickReply = {
    id: value.id,
    label: value.label,
    text: value.text,
  };

  if (value.category !== undefined) {
    if (!isBoundedCleanString(value.category, MAX_CATEGORY_CHARS, false)) {
      return "快捷回复条目分类无效或超过长度上限。";
    }
    item.category = value.category;
  }

  if (value.requiresEditing !== undefined) {
    if (typeof value.requiresEditing !== "boolean") {
      return "快捷回复条目编辑标记格式无效。";
    }
    item.requiresEditing = value.requiresEditing;
  }

  return item;
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isBoundedCleanString(
  value: unknown,
  maxLength: number,
  allowWhitespaceControls: boolean,
): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (Array.from(value).length > maxLength) {
    return false;
  }
  if (allowWhitespaceControls) {
    return !UNSAFE_CONTROL_CHARACTER_PATTERN.test(value);
  }
  return !/[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function revisionFor(items: FeishuQuickReply[]): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(items))
    .digest("hex")}`;
}

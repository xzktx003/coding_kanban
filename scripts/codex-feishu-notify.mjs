#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { config as loadDotenv } from "dotenv";

const EVENT_TYPE = "agent-turn-complete";
const DEFAULT_MESSAGE_CHUNK_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const RETRY_DELAY_MS = 250;
const LEGACY_NOTIFICATION_SETTINGS_VERSION = 1;
const KANBAN_NOTIFICATION_SETTINGS_VERSION = 2;
const NOTIFICATION_SETTINGS_VERSION = 3;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;
const USER_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const IMAGE_KEY_PATTERN = /^img_[A-Za-z0-9_-]{8,}$/;
const MAX_COMPLETION_IMAGE_BYTES = 10 * 1024 * 1024;
const COMPLETION_IMAGE_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const notificationSettingsPath = resolve(
  repositoryRoot,
  ".dev-runtime/feishu-notification-settings.json",
);

class LarkCliResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = "LarkCliResponseError";
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record, key) {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Codex notification field ${key} must be a non-empty string`,
    );
  }
  return value.trim();
}

function parseNotification(rawNotification) {
  if (
    typeof rawNotification !== "string" ||
    rawNotification.trim().length === 0
  ) {
    throw new Error("Codex notify JSON argument is required");
  }

  let notification;
  try {
    notification = JSON.parse(rawNotification);
  } catch {
    throw new Error("Codex notify argument must be valid JSON");
  }

  if (!isRecord(notification) || typeof notification.type !== "string") {
    throw new Error("Codex notify argument must be a JSON object with a type");
  }
  return notification;
}

function parseBoundedInteger(value, name, defaultValue, minimum, maximum) {
  if (value === undefined || String(value).trim() === "") {
    return defaultValue;
  }

  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

function readFeishuNotificationSettings(statePath = notificationSettingsPath) {
  let raw;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { enabled: true, deliveryMode: "hook" };
    }
    throw new Error("Unable to read Feishu notification settings");
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.enabled !== "boolean") {
      throw new Error("invalid settings shape");
    }
    if (parsed.version === LEGACY_NOTIFICATION_SETTINGS_VERSION) {
      return { enabled: parsed.enabled, deliveryMode: "hook" };
    }
    if (
      (parsed.version === KANBAN_NOTIFICATION_SETTINGS_VERSION ||
        parsed.version === NOTIFICATION_SETTINGS_VERSION) &&
      parsed.deliveryMode === "kanban"
    ) {
      return { enabled: parsed.enabled, deliveryMode: "kanban" };
    }
    throw new Error("invalid settings version");
  } catch {
    throw new Error("Feishu notification settings are invalid");
  }
}

export function readCodexHookNotificationEnabled(
  statePath = notificationSettingsPath,
) {
  const settings = readFeishuNotificationSettings(statePath);
  return settings.enabled && settings.deliveryMode === "hook";
}

export function readKanbanNotificationEnabled(
  statePath = notificationSettingsPath,
) {
  return readFeishuNotificationSettings(statePath).enabled;
}

export const readFeishuNotificationEnabled = readCodexHookNotificationEnabled;

function resolveDestination(env) {
  const chatId = env.FEISHU_NOTIFY_CHAT_ID?.trim() ?? "";
  const userId = env.FEISHU_NOTIFY_USER_ID?.trim() ?? "";

  if (Boolean(chatId) === Boolean(userId)) {
    throw new Error(
      "Configure exactly one of FEISHU_NOTIFY_CHAT_ID or FEISHU_NOTIFY_USER_ID",
    );
  }
  if (chatId && !CHAT_ID_PATTERN.test(chatId)) {
    throw new Error(
      "FEISHU_NOTIFY_CHAT_ID is invalid; expected an oc_ chat ID",
    );
  }
  if (userId && !USER_ID_PATTERN.test(userId)) {
    throw new Error(
      "FEISHU_NOTIFY_USER_ID is invalid; expected an ou_ open_id",
    );
  }

  return chatId
    ? { flag: "--chat-id", id: chatId }
    : { flag: "--user-id", id: userId };
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeOutputText(value) {
  return String(value ?? "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function truncateText(value, maxCharacters) {
  const characters = Array.from(value);
  if (characters.length <= maxCharacters) {
    return value;
  }
  return `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

function projectNameFromCwd(cwd) {
  const normalized = sanitizeText(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  return truncateText(
    normalized.split("/").filter(Boolean).at(-1) || "未知项目",
    120,
  );
}

function formatAgentKind(value) {
  const normalized = sanitizeText(value).toLowerCase();
  const labels = {
    claude: "Claude",
    codex: "Codex",
    copilot: "Copilot",
    opencode: "OpenCode",
    shell: "Shell",
  };
  return labels[normalized] ?? truncateText(sanitizeText(value), 80);
}

function redactCurrentWorkingDirectory(value, cwd, projectName) {
  const sanitizedCwd = sanitizeText(cwd).replace(/[\\/]+$/, "");
  if (sanitizedCwd.length < 3 || projectName === "未知项目") {
    return value;
  }

  const variants = new Set([
    sanitizedCwd,
    sanitizedCwd.replace(/\\/g, "/"),
    sanitizedCwd.replace(/\//g, "\\"),
  ]);
  let redacted = value;
  for (const variant of variants) {
    if (variant.length >= 3) {
      redacted = redacted.split(variant).join(projectName);
    }
  }
  return redacted;
}

function isRepositoryWorkingDirectory(cwd) {
  if (typeof cwd !== "string" || cwd.trim().length === 0) {
    return false;
  }

  const relativePath = relative(repositoryRoot, resolve(cwd.trim()));
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function splitOutputText(value, maxChunkCharacters) {
  const characters = Array.from(value);
  if (characters.length === 0) {
    return [""];
  }

  const chunks = [];
  for (let index = 0; index < characters.length; ) {
    let end = Math.min(index + maxChunkCharacters, characters.length);
    if (end < characters.length) {
      // Prefer complete Markdown lines; hard-split only oversized single lines.
      for (let boundary = end - 1; boundary >= index; boundary -= 1) {
        if (characters[boundary] === "\n") {
          end = boundary + 1;
          break;
        }
      }
      // Do not cut an uploaded formula image reference between cards.
      const tail = characters.slice(index, end).join("");
      const remaining = characters.slice(index, end + 2000).join("");
      for (const image of remaining.matchAll(
        /!\[[^\]]*\]\(img_[A-Za-z0-9_-]+\)/g,
      )) {
        if (
          image.index < tail.length &&
          image.index + image[0].length > tail.length
        ) {
          end =
            index +
            Array.from(remaining.slice(0, image.index || image[0].length))
              .length;
          break;
        }
      }
    }
    chunks.push(characters.slice(index, end).join(""));
    index = end;
  }
  return chunks;
}

function splitMarkdownOutput(value, maxChunkCharacters) {
  let fence = null;
  return splitOutputText(value, maxChunkCharacters).map((chunk) => {
    const prefix = fence ? `${fence.opening}\n` : "";
    for (const line of chunk.split("\n")) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!match) continue;
      const [, marker, suffix] = match;
      if (!fence) {
        fence = { marker, opening: line };
      } else if (
        marker[0] === fence.marker[0] &&
        marker.length >= fence.marker.length &&
        !suffix.trim()
      ) {
        fence = null;
      }
    }
    const suffix = fence
      ? `${chunk.endsWith("\n") ? "" : "\n"}${fence.marker}`
      : "";
    // Generated output is not authority to mention users or resolve person IDs.
    return `${prefix}${chunk}${suffix}`.replace(
      /<(?=\/?(?:at|person)\b)/gi,
      "&#60;",
    );
  });
}

function completionOutput(notification) {
  const cwd = typeof notification.cwd === "string" ? notification.cwd : "";
  const rawOutput =
    typeof notification["last-assistant-message"] === "string" &&
    notification["last-assistant-message"].trim()
      ? notification["last-assistant-message"]
      : "Codex 已完成本轮任务，请打开 Coding Kanban 查看结果。";
  const projectName = projectNameFromCwd(cwd);
  return redactCurrentWorkingDirectory(
    sanitizeOutputText(rawOutput),
    cwd,
    projectName,
  );
}

function completionReferencedFiles(notification) {
  if (!Array.isArray(notification["referenced-files"])) {
    return [];
  }
  const references = [];
  for (const candidate of notification["referenced-files"].slice(0, 5)) {
    if (!isRecord(candidate) || typeof candidate.path !== "string") {
      continue;
    }
    const filePath = candidate.path;
    const segments = filePath.split("/");
    if (
      !filePath ||
      filePath.length > 2_048 ||
      filePath.startsWith("/") ||
      filePath.includes("\\") ||
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      )
    ) {
      continue;
    }
    const line =
      Number.isSafeInteger(candidate.line) &&
      candidate.line >= 1 &&
      candidate.line <= 10_000_000
        ? candidate.line
        : undefined;
    references.push({ path: filePath, ...(line ? { line } : {}) });
  }
  return references;
}

function isContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function hasMatchingImageSignature(buffer, extension) {
  if (extension === ".png") {
    return (
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (extension === ".gif") {
    const signature = buffer.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (extension === ".webp") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function completionImageFiles(notification) {
  const cwd = typeof notification.cwd === "string" ? notification.cwd : "";
  if (!cwd || !isAbsolute(cwd)) {
    return [];
  }

  let root;
  try {
    const rootStats = lstatSync(cwd);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return [];
    }
    root = realpathSync(cwd);
    if (root !== resolve(cwd)) {
      return [];
    }
  } catch {
    return [];
  }

  return completionReferencedFiles(notification).flatMap((reference) => {
    const extension = extname(reference.path).toLowerCase();
    if (
      !COMPLETION_IMAGE_EXTENSIONS.has(extension) ||
      reference.path.split("/").some((segment) => segment.startsWith("."))
    ) {
      return [];
    }
    const candidate = resolve(root, reference.path);
    if (!isContainedPath(root, candidate)) {
      return [];
    }
    try {
      const stats = lstatSync(candidate);
      if (
        !stats.isFile() ||
        stats.isSymbolicLink() ||
        stats.size <= 0 ||
        stats.size > MAX_COMPLETION_IMAGE_BYTES ||
        realpathSync(candidate) !== candidate
      ) {
        return [];
      }
      const content = readFileSync(candidate);
      return hasMatchingImageSignature(content, extension)
        ? [{ path: reference.path, cwd: root }]
        : [];
    } catch {
      return [];
    }
  });
}

async function uploadCompletionImages({
  notification,
  runCommand,
  commandEnv,
  timeout,
}) {
  const imageKeys = new Map();
  for (const image of completionImageFiles(notification)) {
    try {
      const { stdout } = await runCommand(
        "lark-cli",
        [
          "im",
          "images",
          "create",
          "--format",
          "json",
          "--as",
          "bot",
          "--data",
          JSON.stringify({ image_type: "message" }),
          "--file",
          image.path,
        ],
        { env: commandEnv, timeout, cwd: image.cwd },
      );
      const response = parseLarkCliResponse(stdout);
      const imageKey = isRecord(response.data)
        ? response.data.image_key
        : undefined;
      if (typeof imageKey === "string" && IMAGE_KEY_PATTERN.test(imageKey)) {
        imageKeys.set(image.path, imageKey);
      }
    } catch {
      // Image presentation is best-effort; the file callback remains available.
    }
  }
  return imageKeys;
}

export function buildCompletionCards(
  notification,
  maxChunkCharacters = DEFAULT_MESSAGE_CHUNK_CHARS,
  referencedImageKeys = new Map(),
) {
  const cwd = typeof notification.cwd === "string" ? notification.cwd : "";
  const projectName = projectNameFromCwd(cwd);
  const output = completionOutput(notification);
  const agentKind =
    typeof notification["agent-kind"] === "string"
      ? formatAgentKind(notification["agent-kind"])
      : "Codex";
  const displayName =
    typeof notification["display-name"] === "string"
      ? truncateText(sanitizeText(notification["display-name"]), 160)
      : "";

  // Only the turn-bound field supplied by Kanban is eligible. Legacy hook
  // input-messages may contain unrelated/private context and must stay ignored.
  const question =
    typeof notification["user-question"] === "string"
      ? redactCurrentWorkingDirectory(
          sanitizeOutputText(notification["user-question"]),
          cwd,
          projectName,
        )
      : "";
  // Leave JSON/metadata headroom when a question accompanies the answer,
  // including four-byte Unicode characters. Keep legacy cards unchanged.
  const chunkLimit = question.trim()
    ? Math.min(maxChunkCharacters, 4000)
    : maxChunkCharacters;
  const chunks = splitMarkdownOutput(output, chunkLimit);
  const longQuestion = Array.from(question).length > Math.min(500, chunkLimit);
  const questionChunks = longQuestion
    ? splitOutputText(question, chunkLimit)
    : [];
  const parts = [
    ...chunks.map((chunk, index) => ({ chunk, index, questionPart: false })),
    ...questionChunks.map((chunk, index) => ({
      chunk,
      index,
      questionPart: true,
    })),
  ];
  const questionPanel = (content, title, expanded) => ({
    tag: "collapsible_panel",
    expanded,
    background_color: "grey-50",
    header: { title: { tag: "plain_text", content: title }, width: "fill" },
    elements: [{ tag: "div", text: { tag: "plain_text", content } }],
  });
  const recordsAvailable = notification["records-available"] === true;
  const quickRepliesAvailable =
    notification["quick-replies-available"] === true &&
    sanitizeText(notification["agent-kind"]).toLowerCase() === "codex";
  const referencedFiles = completionReferencedFiles(notification);
  const referencedImages = referencedFiles.flatMap((reference) => {
    const imageKey = referencedImageKeys.get(reference.path);
    return typeof imageKey === "string" && IMAGE_KEY_PATTERN.test(imageKey)
      ? [{ reference, imageKey }]
      : [];
  });
  const footerActions = (index, questionPart) => {
    const buttons = [];
    if (quickRepliesAvailable) {
      buttons.push({
        tag: "button",
        text: { tag: "plain_text", content: "快捷回复" },
        type: "default",
        size: "tiny",
        width: "default",
        behaviors: [
          {
            type: "callback",
            value: { action: "kanban_completion_quick_reply" },
          },
        ],
      });
    }
    if (recordsAvailable) {
      buttons.push({
        tag: "button",
        text: { tag: "plain_text", content: "查看完整记录" },
        type: "primary",
        size: "tiny",
        width: "default",
        behaviors: [
          {
            type: "callback",
            value: { action: "kanban_completion_records" },
          },
        ],
      });
    }
    if (!questionPart && index === 0 && recordsAvailable) {
      referencedFiles.forEach((reference, referenceIndex) => {
        const basename = reference.path.split("/").at(-1);
        buttons.push({
          tag: "button",
          text: {
            tag: "plain_text",
            content: truncateText(
              `查看 ${basename}${reference.line ? `:${reference.line}` : ""}`,
              100,
            ),
          },
          type: "default",
          size: "tiny",
          width: "default",
          behaviors: [
            {
              type: "callback",
              value: {
                action: "kanban_completion_file",
                reference: referenceIndex,
              },
            },
          ],
        });
      });
    }
    return buttons.length
      ? [
          {
            tag: "column_set",
            flex_mode: "flow",
            horizontal_spacing: "8px",
            columns: buttons.map((button) => ({
              tag: "column",
              elements: [button],
            })),
          },
        ]
      : [];
  };
  return parts.map(({ chunk, index, questionPart }) => ({
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill",
      enable_forward: true,
      summary: {
        content: `${agentKind || "Agent"} 任务完成 · ${projectName}`,
      },
    },
    header: {
      title: {
        tag: "plain_text",
        content: `Coding Kanban · ${agentKind || "Agent"} 任务完成`,
      },
      subtitle: {
        tag: "plain_text",
        content: `项目：${projectName}${displayName ? `　会话：${displayName}` : ""}`,
      },
      template: "green",
      icon: {
        tag: "standard_icon",
        token: "ai-common_colorful",
      },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: "已完成" },
          color: "green",
        },
      ],
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements: [
        ...(!questionPart && index === 0 && question.trim()
          ? [
              longQuestion
                ? {
                    tag: "div",
                    text: {
                      tag: "plain_text",
                      content: `你的问题：${truncateText(question, 200)}\n完整问题见后续“你的问题”卡片，点击标题展开。`,
                    },
                  }
                : questionPanel(question, "你的问题", true),
            ]
          : []),
        ...(questionPart
          ? [
              questionPanel(
                chunk,
                `你的问题（${index + 1}/${questionChunks.length}）`,
                false,
              ),
            ]
          : [
              {
                tag: "collapsible_panel",
                expanded: true,
                background_color: "grey-50",
                border: { color: "grey-100", corner_radius: "8px" },
                padding: "0px 12px 12px 12px",
                vertical_spacing: "8px",
                header: {
                  title: {
                    tag: "plain_text",
                    content:
                      chunks.length === 1
                        ? "完整输出"
                        : `完整输出（${index + 1}/${chunks.length}）`,
                  },
                  width: "fill",
                },
                elements: [
                  {
                    tag: "markdown",
                    content: chunk,
                  },
                ],
              },
            ]),
        ...(!questionPart && index === 0
          ? referencedImages.map(({ reference, imageKey }) => {
              const basename = reference.path.split("/").at(-1);
              return {
                tag: "img",
                img_key: imageKey,
                alt: { tag: "plain_text", content: basename },
                title: { tag: "plain_text", content: basename },
                scale_type: "fit_horizontal",
                corner_radius: "8px",
                preview: true,
              };
            })
          : []),
        ...footerActions(index, questionPart),
      ],
    },
  }));
}

export function createIdempotencyKey(notification, partIndex = 0) {
  const threadId = requiredString(notification, "thread-id");
  const turnId = requiredString(notification, "turn-id");
  const digest = createHash("sha256")
    .update(threadId)
    .update("\0")
    .update(turnId)
    .update("\0")
    .update(String(partIndex))
    .digest("hex")
    .slice(0, 40);
  return `codex-${digest}`;
}

export function parseLarkCliResponse(stdout) {
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new LarkCliResponseError("lark-cli did not return valid JSON");
  }

  if (!isRecord(response) || response.ok !== true) {
    throw new LarkCliResponseError("lark-cli response must contain ok=true");
  }
  return response;
}

function execFileCommand(binary, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      binary,
      args,
      {
        encoding: "utf8",
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        windowsHide: true,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          rejectPromise(error);
          return;
        }
        resolvePromise({ stdout, stderr });
      },
    );
  });
}

function parseLarkCliError(stderr) {
  if (typeof stderr !== "string" || !stderr.trim()) {
    return null;
  }
  try {
    const response = JSON.parse(stderr);
    return isRecord(response) && isRecord(response.error)
      ? response.error
      : null;
  } catch {
    return null;
  }
}

function isRetryableCommandError(error) {
  if (error instanceof LarkCliResponseError) {
    return false;
  }
  if (error?.code === "ENOENT" || error?.code === 10) {
    return false;
  }

  const larkError = parseLarkCliError(error?.stderr);
  return ![
    "authorization",
    "configuration",
    "permission",
    "validation",
  ].includes(String(larkError?.type ?? "").toLowerCase());
}

function safeCommandError(error) {
  if (error instanceof LarkCliResponseError) {
    return error;
  }

  const larkError = parseLarkCliError(error?.stderr);
  if (larkError) {
    const type = sanitizeText(
      larkError.subtype || larkError.type || "lark_error",
    );
    const message = sanitizeText(larkError.message || "飞书消息发送失败");
    return new Error(`${type}: ${truncateText(message, 500)}`);
  }
  if (error?.code === "ENOENT") {
    return new Error("lark-cli was not found on PATH");
  }
  if (error?.code === 10) {
    return new Error("lark-cli requires an interactive high-risk confirmation");
  }
  if (error?.killed || error?.code === "ETIMEDOUT") {
    return new Error("lark-cli send timed out");
  }
  return new Error("lark-cli send failed");
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

export async function runCodexFeishuNotification({
  rawNotification,
  env = process.env,
  resolveNotificationEnabled = () => true,
  enforceRepositoryScope = true,
  runCommand = execFileCommand,
  sleep = delay,
}) {
  const notification = parseNotification(rawNotification);
  if (notification.type !== EVENT_TYPE) {
    return { status: "ignored" };
  }
  if (
    enforceRepositoryScope &&
    !isRepositoryWorkingDirectory(notification.cwd)
  ) {
    return { status: "ignored" };
  }
  if (!resolveNotificationEnabled()) {
    return { status: "disabled" };
  }

  const destination = resolveDestination(env);
  const messageChunkCharacters = parseBoundedInteger(
    env.FEISHU_NOTIFY_MESSAGE_CHUNK_CHARS,
    "FEISHU_NOTIFY_MESSAGE_CHUNK_CHARS",
    DEFAULT_MESSAGE_CHUNK_CHARS,
    1_000,
    30_000,
  );
  const timeout = parseBoundedInteger(
    env.FEISHU_NOTIFY_TIMEOUT_MS,
    "FEISHU_NOTIFY_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
    1_000,
    30_000,
  );
  const maxAttempts = parseBoundedInteger(
    env.FEISHU_NOTIFY_MAX_ATTEMPTS,
    "FEISHU_NOTIFY_MAX_ATTEMPTS",
    DEFAULT_MAX_ATTEMPTS,
    1,
    3,
  );
  const commandEnv = {
    ...process.env,
    ...env,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
  };
  const directNotification =
    destination.flag === "--user-id"
      ? notification
      : { ...notification, "referenced-files": [] };
  const referencedImageKeys =
    destination.flag === "--user-id"
      ? await uploadCompletionImages({
          notification: directNotification,
          runCommand,
          commandEnv,
          timeout,
        })
      : new Map();
  const cards = buildCompletionCards(
    directNotification,
    messageChunkCharacters,
    referencedImageKeys,
  );

  const messageIds = [];
  const sentMessages = [];
  for (const [partIndex, card] of cards.entries()) {
    const args = [
      "im",
      "+messages-send",
      "--format",
      "json",
      "--as",
      "bot",
      destination.flag,
      destination.id,
      "--msg-type",
      "interactive",
      "--content",
      JSON.stringify(card),
      "--idempotency-key",
      createIdempotencyKey(notification, partIndex),
    ];
    let lastError;
    let sent = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const { stdout } = await runCommand("lark-cli", args, {
          env: commandEnv,
          timeout,
        });
        const response = parseLarkCliResponse(stdout);
        const messageId = isRecord(response.data)
          ? response.data.message_id
          : undefined;
        if (typeof messageId === "string") {
          messageIds.push(messageId);
        }
        const chatId = isRecord(response.data)
          ? response.data.chat_id
          : undefined;
        if (typeof messageId === "string" && typeof chatId === "string") {
          sentMessages.push({ messageId, chatId });
        }
        sent = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts - 1 || !isRetryableCommandError(error)) {
          break;
        }
        await sleep(RETRY_DELAY_MS * 2 ** attempt);
      }
    }
    if (!sent) {
      throw safeCommandError(lastError);
    }
  }

  return {
    status: "sent",
    messages: sentMessages,
    ...(messageIds.length === 1 ? { messageId: messageIds[0] } : {}),
    ...(messageIds.length > 1 ? { messageIds } : {}),
  };
}

function loadRepositoryEnv() {
  loadDotenv({
    path: resolve(repositoryRoot, ".env"),
    override: false,
    quiet: true,
  });
}

async function main() {
  loadRepositoryEnv();
  const kanbanDelivery = process.argv[2] === "--kanban";
  const rawNotification = process.argv[kanbanDelivery ? 3 : 2];
  if (!rawNotification) {
    process.stderr.write(
      "Usage: codex-feishu-notify.mjs [--kanban] '<notification-json>'\n",
    );
    process.exitCode = 2;
    return;
  }

  try {
    const result = await runCodexFeishuNotification({
      rawNotification,
      resolveNotificationEnabled: kanbanDelivery
        ? readKanbanNotificationEnabled
        : readCodexHookNotificationEnabled,
      enforceRepositoryScope: !kanbanDelivery,
    });
    if (kanbanDelivery) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (result.status === "sent") {
      process.stdout.write("Codex completion notification sent to Feishu.\n");
    }
  } catch (error) {
    process.stderr.write(
      `Codex completion notification failed: ${sanitizeText(error?.message || "unknown error")}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}

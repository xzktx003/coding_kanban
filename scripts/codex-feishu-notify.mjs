#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
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

export function buildCompletionMessage(
  notification,
  maxChunkCharacters = DEFAULT_MESSAGE_CHUNK_CHARS,
) {
  return buildCompletionMessages(notification, maxChunkCharacters).join("\n\n");
}

function splitOutputText(value, maxChunkCharacters) {
  const characters = Array.from(value);
  if (characters.length === 0) {
    return [""];
  }

  const chunks = [];
  for (let index = 0; index < characters.length; index += maxChunkCharacters) {
    chunks.push(characters.slice(index, index + maxChunkCharacters).join(""));
  }
  return chunks;
}

export function buildCompletionMessages(
  notification,
  maxChunkCharacters = DEFAULT_MESSAGE_CHUNK_CHARS,
) {
  const cwd = typeof notification.cwd === "string" ? notification.cwd : "";
  const rawOutput =
    typeof notification["last-assistant-message"] === "string" &&
    notification["last-assistant-message"].trim()
      ? notification["last-assistant-message"]
      : "Codex 已完成本轮任务，请打开 Coding Kanban 查看结果。";
  const projectName = projectNameFromCwd(cwd);
  const output = redactCurrentWorkingDirectory(
    sanitizeOutputText(rawOutput),
    cwd,
    projectName,
  );
  const agentKind =
    typeof notification["agent-kind"] === "string"
      ? formatAgentKind(notification["agent-kind"])
      : "Codex";
  const displayName =
    typeof notification["display-name"] === "string"
      ? truncateText(sanitizeText(notification["display-name"]), 160)
      : "";

  const header = [
    `Coding Kanban · ${agentKind || "Agent"} 任务完成`,
    `项目：${projectName}`,
    ...(displayName ? [`会话：${displayName}`] : []),
  ].join("\n");
  const chunks = splitOutputText(output, maxChunkCharacters);
  return chunks.map((chunk, index) =>
    [
      header,
      chunks.length === 1
        ? "最后输出："
        : `最后输出（${index + 1}/${chunks.length}）：`,
      chunk,
    ].join("\n"),
  );
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
  const messages = buildCompletionMessages(
    notification,
    messageChunkCharacters,
  );
  const commandEnv = {
    ...process.env,
    ...env,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
  };

  const messageIds = [];
  const sentMessages = [];
  for (const [partIndex, message] of messages.entries()) {
    const args = [
      "im",
      "+messages-send",
      "--format",
      "json",
      "--as",
      "bot",
      destination.flag,
      destination.id,
      "--text",
      message,
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

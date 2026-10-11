export type NativeSlackTarget =
  | { kind: "profile"; hostname: string; userId: string }
  | {
      kind: "message";
      hostname: string;
      channelId: string;
      messageTs: string;
      threadTs: string;
    };
export type NativeSlackData =
  | { status: "unavailable" }
  | { status: "ready"; title: string | null; description: string | null };
export function nativeSlackUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.enterprise)?\.slack\.com$/u.test(
        url.hostname,
      ) &&
      !["www.slack.com", "api.slack.com", "status.slack.com"].includes(
        url.hostname,
      )
      ? url
      : null;
  } catch {
    return null;
  }
}
export function nativeSlackTarget(href: string): NativeSlackTarget | null {
  const url = nativeSlackUrl(href);
  if (!url || url.hostname === "app.slack.com") return null;
  const profile = /^\/team\/([UW][A-Z0-9]+)\/?$/u.exec(url.pathname);
  if (profile)
    return { kind: "profile", hostname: url.hostname, userId: profile[1] };
  const message = /^\/archives\/([CDG][A-Z0-9]+)\/p(\d{10})(\d{6})\/?$/u.exec(
    url.pathname,
  );
  if (!message) return null;
  const messageTs = `${message[2]}.${message[3]}`,
    threadTs = url.searchParams.get("thread_ts") ?? messageTs;
  return /^\d{10}\.\d{6}$/u.test(threadTs)
    ? {
        kind: "message",
        hostname: url.hostname,
        channelId: message[1],
        messageTs,
        threadTs,
      }
    : null;
}
const profileKeys = new Set([
  "User ID",
  "Username",
  "Display Name",
  "Real Name",
  "Pronouns",
  "Title",
  "Email",
  "Organization Name",
  "Phone",
  "Status",
  "Timezone",
  "Admin",
  "Owner",
  "Bot",
  "Restricted",
]);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
// Copy short display fields so a slice cannot retain a large tool result.
const displayText = (value: string, limit: number) =>
  Array.from(value.slice(0, limit)).join("");
/** Validate the bounded HTTP projection, never an arbitrary tool body. */
export function nativeSlackDisplayData(value: unknown): NativeSlackData {
  if (!record(value) || value.status !== "ready")
    return { status: "unavailable" };
  const field = (text: unknown, limit: number) =>
    text === null ||
    (typeof text === "string" && text.length > 0 && text.length <= limit);
  if (
    !field(value.title, 200) ||
    !field(value.description, 300) ||
    (value.title === null && value.description === null)
  )
    return { status: "unavailable" };
  return {
    status: "ready",
    title:
      value.title === null ? null : displayText(value.title as string, 200),
    description:
      value.description === null
        ? null
        : displayText(value.description as string, 300),
  };
}
/** Native state-5eb30f7a10ad k: return only matched, bounded display fields. */
export function nativeSlackResult(
  value: unknown,
  target: NativeSlackTarget,
): NativeSlackData {
  const unavailable: NativeSlackData = { status: "unavailable" };
  // Native e98 Fg unwraps Codex Apps' MCP envelope before state-5eb k.
  // Match its error-flag semantics; transport failures still fall back below.
  if (record(value) && record(value.structuredContent)) {
    const wrapped = value.structuredContent;
    if (Array.isArray(wrapped.content) && typeof wrapped.isError === "boolean")
      value = {
        content: wrapped.content,
        structuredContent: wrapped.structuredContent,
        ...("isError" in value ? { isError: wrapped.isError } : {}),
      };
  }
  if (!record(value) || value.isError) return unavailable;
  if (target.kind === "message") {
    const structured = record(value.structuredContent)
      ? value.structuredContent.slack_data
      : null;
    if (
      !record(structured) ||
      structured.schema_version !== 1 ||
      structured.ok !== true ||
      structured.channel_id !== target.channelId ||
      structured.message_ts !== target.threadTs ||
      !Array.isArray(structured.messages) ||
      !structured.messages.every(
        (m) =>
          record(m) && typeof m.ts === "string" && typeof m.text === "string",
      )
    )
      return unavailable;
    const message = structured.messages.find((m) => m.ts === target.messageTs);
    const description = message?.text
      .replace(/<[^<>|]+\|([^<>]+)>/gu, "$1")
      .replace(/<(https?:\/\/[^<>]+)>/gu, "$1")
      .replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">")
      .replace(/&amp;/gu, "&")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 300);
    return description
      ? {
          status: "ready",
          title: null,
          description: displayText(description, 300),
        }
      : unavailable;
  }
  if (
    !Array.isArray(value.content) ||
    value.content.length !== 1 ||
    !record(value.content[0]) ||
    value.content[0].type !== "text" ||
    typeof value.content[0].text !== "string"
  )
    return unavailable;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value.content[0].text);
  } catch {
    return unavailable;
  }
  if (!record(decoded) || typeof decoded.result !== "string")
    return unavailable;
  const fields = new Map<string, string>();
  for (const line of decoded.result.trimEnd().split("\n")) {
    const colon = line.indexOf(":"),
      key = line.slice(0, colon);
    if (!profileKeys.has(key) || fields.has(key)) return unavailable;
    fields.set(key, line.slice(colon + 1).trim());
  }
  const title = fields.get("Real Name") || fields.get("Display Name");
  return fields.get("User ID") === target.userId && title
    ? {
        status: "ready",
        title: displayText(title, 200),
        description: fields.get("Title")
          ? displayText(fields.get("Title")!, 300)
          : null,
      }
    : unavailable;
}

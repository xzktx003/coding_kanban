/** Presentation-independent text sources. Never construct exports by scraping the UI. */
import { cleanNativeFileCitationSource } from "@session/features/native-citations/nativeCitationCopy";
export interface WorkflowMessage {
  rowId: string;
  itemId: string;
  turnId: string;
  role: "user" | "assistant" | "plan" | "summary";
  text: string;
  completed?: boolean;
  phase?: string | null;
}
export interface WorkflowAnchor {
  rowId: string;
  itemId: string;
  turnId: string;
  query?: string;
  offset?: number;
  occurrence?: number;
}
export interface ThreadSearchMatch extends Omit<WorkflowAnchor, "rowId"> {
  /** Remote occurrences gain a row identity only after native history hydration. */
  rowId?: string;
  threadId?: string;
  turnCursor?: string;
  snippetMatchRange?: { start: number; end: number };
  query: string;
  offset?: number;
  occurrence: number;
  preview: string;
  role?: WorkflowMessage["role"];
}
export interface WorkflowTurn {
  id: string;
  completed: boolean;
}
export type TurnSource = Readonly<{
  threadId: string;
  turnId: string;
  rowId: string;
  itemId: string;
}>;

export function findThreadMatches(
  rows: readonly WorkflowMessage[],
  query: string,
): ThreadSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const found: ThreadSearchMatch[] = [];
  for (const row of rows) {
    if (
      row.role !== "user" &&
      (row.role !== "assistant" ||
        row.completed === false ||
        row.phase === "commentary")
    )
      continue;
    const text = row.text.toLocaleLowerCase();
    let from = 0,
      occurrence = 0;
    for (;;) {
      const offset = text.indexOf(needle, from);
      if (offset === -1) break;
      found.push({
        rowId: row.rowId,
        itemId: row.itemId,
        turnId: row.turnId,
        role: row.role,
        query: query.trim(),
        offset,
        occurrence: occurrence++,
        preview: `${offset > 40 ? "…" : ""}${row.text.slice(Math.max(0, offset - 40), offset + needle.length + 60).replace(/\s+/g, " ")}${offset + needle.length + 60 < row.text.length ? "…" : ""}`,
      });
      from = offset + Math.max(1, needle.length);
    }
  }
  return found;
}

/** Remove protocol-only attribution envelopes outside literal fenced code. */
export function cleanMarkdown(value: string, language = "en"): string {
  let fence: { char: string; length: number } | null = null;
  let citation = false;
  const output: string[] = [];
  for (const line of cleanNativeFileCitationSource(
    value.replace(/\r\n?/g, "\n"),
    language,
  ).split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      output.push(line);
      if (
        marker &&
        marker[1][0] === fence.char &&
        marker[1].length >= fence.length &&
        /^\s{0,3}[`~]+\s*$/.test(line)
      )
        fence = null;
      continue;
    }
    if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      output.push(line);
      continue;
    }
    if (citation) {
      if (line.includes("</oai-mem-citation>")) citation = false;
      continue;
    }
    if (line.includes("<oai-mem-citation>")) {
      citation = !line.includes("</oai-mem-citation>");
      continue;
    }
    output.push(
      line.replace(/(?:cite|filecite|navlist|entity|image_group)[^]*/g, ""),
    );
  }
  return output.join("\n").trim();
}

export function exportThreadMarkdown(
  rows: readonly WorkflowMessage[],
  title?: string,
  language = "en",
): string {
  const headings = {
    user: "User",
    assistant: "Assistant",
    plan: "Plan",
    summary: "Summary",
  };
  const body = rows
    .filter(
      (row) =>
        row.role !== "summary" && row.completed !== false && row.text.trim(),
    )
    .map(
      (row) =>
        `## ${headings[row.role]}\n\n${cleanMarkdown(row.text, language)}`,
    )
    .join("\n\n---\n\n");
  return `${title?.trim() ? `# ${title.trim().replace(/\r?\n/g, " ")}\n\n` : ""}${body}\n`;
}
export function makeThreadUrl(
  base: string,
  threadId: string,
  turnId?: string,
): string {
  const url = new URL(base);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "session");
  url.searchParams.set("thread", threadId);
  if (turnId) url.searchParams.set("turn", turnId);
  return url.toString();
}
export function readThreadLink(
  value: string,
): { threadId: string; turnId?: string } | null {
  const url = new URL(
    value,
    typeof window !== "undefined"
      ? window.location.href
      : "https://invalid.example/",
  );
  const threadId = url.searchParams.get("thread");
  if (
    url.searchParams.get("mode") !== "session" ||
    url.searchParams.getAll("thread").length !== 1 ||
    !threadId ||
    threadId.length > 512 ||
    /[\u0000-\u001f]/.test(threadId)
  )
    return null;
  const turnId = url.searchParams.get("turn");
  if (
    url.searchParams.getAll("turn").length > 1 ||
    (turnId !== null &&
      (!turnId.trim() || turnId.length > 512 || /[\u0000-\u001f]/.test(turnId)))
  )
    return null;
  return {
    threadId,
    ...(turnId && turnId.length <= 512 && !/[\u0000-\u001f]/.test(turnId)
      ? { turnId }
      : {}),
  };
}
export function captureTurnSource(
  threadId: string,
  row: WorkflowMessage,
): TurnSource {
  if (!threadId || !row.turnId || row.completed === false)
    throw new Error("只能选择已完成的真实轮次。");
  return Object.freeze({
    threadId,
    turnId: row.turnId,
    rowId: row.rowId,
    itemId: row.itemId,
  });
}

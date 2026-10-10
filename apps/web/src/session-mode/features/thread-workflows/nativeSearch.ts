import type { ThreadSearchOccurrencesParams } from "@session/bindings/v2/ThreadSearchOccurrencesParams";
import type { ThreadSearchOccurrencesResponse } from "@session/bindings/v2/ThreadSearchOccurrencesResponse";
import type { ThreadSearchOccurrence } from "@session/bindings/v2/ThreadSearchOccurrence";
import {
  postJsonWithOptions,
  SessionApiError,
} from "@session/services/apiAdapt/shared";
import type { ThreadSearchMatch } from "./model";

const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);

/** Only a definite missing native capability permits the loaded-history fallback. */
export async function searchThreadOccurrences(
  params: Omit<ThreadSearchOccurrencesParams, "limit">,
  signal?: AbortSignal,
): Promise<ThreadSearchOccurrencesResponse | null> {
  if (
    !bounded(params.threadId, 512) ||
    !bounded(params.searchTerm, 2048) ||
    (params.cursor != null && !bounded(params.cursor, 4096))
  )
    throw new Error("无效的原生搜索参数");
  let response: ThreadSearchOccurrencesResponse;
  try {
    response = await postJsonWithOptions<ThreadSearchOccurrencesResponse>(
      "/api/codex/thread/search-occurrences",
      {
        threadId: params.threadId,
        searchTerm: params.searchTerm,
        ...(params.cursor == null ? {} : { cursor: params.cursor }),
        limit: 250,
      },
      { suppressToast: true, signal },
    );
  } catch (error) {
    if (
      error instanceof SessionApiError &&
      [404, 405, 501].includes(error.status)
    )
      return null;
    throw error;
  }
  if (
    !response ||
    !Array.isArray(response.data) ||
    response.data.length > 250 ||
    (response.nextCursor !== null && !bounded(response.nextCursor, 4096))
  )
    throw new Error("无效的原生搜索响应");
  for (const occurrence of response.data) {
    const range = occurrence?.snippetMatchRange;
    if (
      !bounded(occurrence?.turnId, 512) ||
      !bounded(occurrence?.itemId, 512) ||
      !bounded(occurrence?.turnCursor, 4096) ||
      typeof occurrence?.snippet !== "string" ||
      occurrence.snippet.length > 65536 ||
      !range ||
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > occurrence.snippet.length
    )
      throw new Error("无效的原生搜索位置");
  }
  return response;
}

/** Preserve actual native identifiers and UTF-16 snippet ranges; never invent a virtual row. */
export function nativeSearchMatches(
  threadId: string,
  query: string,
  occurrences: readonly ThreadSearchOccurrence[],
): ThreadSearchMatch[] {
  const ordinals = new Map<string, number>();
  return occurrences.map((occurrence) => {
    const identity = JSON.stringify([occurrence.turnId, occurrence.itemId]);
    const ordinal = ordinals.get(identity) ?? 0;
    ordinals.set(identity, ordinal + 1);
    return {
      threadId,
      turnId: occurrence.turnId,
      itemId: occurrence.itemId,
      turnCursor: occurrence.turnCursor,
      query,
      occurrence: ordinal,
      snippetMatchRange: { ...occurrence.snippetMatchRange },
      preview: occurrence.snippet,
    };
  });
}

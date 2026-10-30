/**
 * Decode fetch JSON from its byte stream. Chromium's native JSON body consumer
 * can retain sizeable native response strings until a later GC; bytes delivered
 * to this reader are accounted for by V8 instead. Endpoint/RPC byte budgets are
 * still enforced by the gateway before this consumer receives a response.
 */
export async function readResponseJson<T = unknown>(
  response: Response,
): Promise<T> {
  if (response.bodyUsed) throw new TypeError("Body has already been consumed");
  if (!response.body) return JSON.parse("") as T;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as T;
  } finally {
    text = "";
    reader.releaseLock();
  }
}

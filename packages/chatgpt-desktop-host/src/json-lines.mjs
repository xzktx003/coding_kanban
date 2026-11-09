/** Maximum UTF-8 bytes in one JSON document, excluding its line delimiter. */
export const MAX_JSON_LINE_BYTES = 32 * 1024 * 1024;
/** Bounds the single source chunk retained while the consumer handles a line. */
export const MAX_INPUT_CHUNK_BYTES = MAX_JSON_LINE_BYTES + 2;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function limit(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw fail("JSONL_INVALID_LIMIT", "Invalid JSONL byte limit");
  }
  return value;
}

/** Pull no more than maxChunkBytes from an owned Node byte Readable at once. */
export async function* readBoundedChunks(source, maxChunkBytes) {
  const maximum = limit(maxChunkBytes, MAX_INPUT_CHUNK_BYTES);
  if (!source || typeof source.read !== "function" || typeof source.on !== "function" ||
      typeof source.removeListener !== "function" || typeof source.destroy !== "function" ||
      source.readableObjectMode || source.readableEncoding) {
    throw fail("JSONL_INVALID_CHUNK", "Expected an owned byte Readable");
  }
  let wake, streamError, ended = false, closed = false, complete = false;
  const signal = () => { const resolve = wake; wake = undefined; resolve?.(); };
  const onEnd = () => { ended = true; signal(); };
  const onClose = () => { closed = true; signal(); };
  const onError = error => { streamError = error; signal(); };
  const cleanup = () => {
    source.removeListener("readable", signal);
    source.removeListener("end", onEnd);
    source.removeListener("close", onClose);
    source.removeListener("error", onError);
  };
  source.on("readable", signal);
  source.on("end", onEnd);
  source.on("close", onClose);
  source.on("error", onError);
  try {
    for (;;) {
      if (streamError || source.errored) throw streamError ?? source.errored;
      const available = source.readableLength;
      if (!Number.isSafeInteger(available) || available < 0) throw fail("JSONL_INVALID_CHUNK", "Invalid readable byte count");
      if (available > 0) {
        const chunk = source.read(Math.min(available, maximum));
        if (chunk !== null) {
          if (!(chunk instanceof Uint8Array) || chunk.byteLength > maximum) throw fail("JSONL_INVALID_CHUNK", "Expected a bounded byte chunk");
          yield chunk;
          continue;
        }
      } else {
        // Prompt Node to finish an already drained stream or request data;
        // read(0) never consumes bytes and keeps the requested bound intact.
        source.read(0);
        if (source.readableLength > 0) continue;
      }
      if (ended || source.readableEnded) { complete = true; return; }
      if (closed || source.destroyed) throw fail("ERR_STREAM_PREMATURE_CLOSE", "Readable closed before end");
      await new Promise(resolve => { wake = resolve; });
    }
  } finally {
    // Keep the error listener until an owned stream actually closes: a pending
    // destroy error must not become an unhandled event after cancellation.
    if (!complete && !source.closed) {
      source.removeListener("readable", signal);
      source.removeListener("end", onEnd);
      source.once("close", cleanup);
      if (!source.destroyed) source.destroy();
      if (source.closed) cleanup();
    } else cleanup();
  }
}

/**
 * Incrementally validate byte-oriented JSONL and yield each original JSON text.
 * LF is mandatory; one CR immediately before LF is a delimiter, not data. UTF-8
 * decoding is fatal; JSON is validated without reserializing the original text.
 * Empty lines, BOMs, malformed JSON and a final unterminated line are rejected.
 *
 * Iteration is pull based: the next source chunk is requested only after all
 * lines from the current chunk have been consumed. Cancellation or a parsing
 * error closes the source iterator; for a Node Readable this destroys that
 * Readable. The caller owns connection/write policy and must await its own
 * downstream backpressure before requesting another item. No request is retried.
 *
 * maxLineBytes and maxChunkBytes may only lower these fixed hard caps. A chunk
 * larger than MAX_INPUT_CHUNK_BYTES fails even if it contains many short lines;
 * this bounds the chunk held across a yield. String chunks are refused because
 * they cannot establish that the original bytes were valid UTF-8.
 *
 * @param {AsyncIterable<Uint8Array>|Iterable<Uint8Array>} source
 * @param {{maxLineBytes?: number, maxChunkBytes?: number}} [options]
 * @returns {AsyncGenerator<string, void, unknown>}
 */
export async function* parseJsonLines(source, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw fail("JSONL_INVALID_LIMIT", "Invalid JSONL byte limits");
  }
  const maxLineBytes = limit(
    options.maxLineBytes ?? MAX_JSON_LINE_BYTES,
    MAX_JSON_LINE_BYTES,
  );
  const maxChunkBytes = limit(
    options.maxChunkBytes ?? MAX_INPUT_CHUNK_BYTES,
    MAX_INPUT_CHUNK_BYTES,
  );
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let pending = Buffer.alloc(0);
  let pendingLength = 0;

  function append(part) {
    const nextLength = pendingLength + part.length;
    const last = part.length ? part[part.length - 1] : pending[pendingLength - 1];
    if (
      nextLength > maxLineBytes + 1 ||
      (nextLength > maxLineBytes && last !== 13)
    ) {
      throw fail("JSONL_FRAME_TOO_LARGE", "JSONL document exceeds byte limit");
    }
    if (nextLength > pending.length) {
      const capacity = Math.min(
        maxLineBytes + 1,
        Math.max(nextLength, pending.length * 2, Math.min(1024, maxLineBytes + 1)),
      );
      const next = Buffer.allocUnsafe(capacity);
      pending.copy(next, 0, 0, pendingLength);
      pending = next;
    }
    part.copy(pending, pendingLength);
    pendingLength = nextLength;
  }

  try {
    for await (const input of source) {
      if (!(input instanceof Uint8Array)) {
        throw fail("JSONL_INVALID_CHUNK", "JSONL source must yield bytes");
      }
      if (input.byteLength > maxChunkBytes) {
        throw fail("JSONL_CHUNK_TOO_LARGE", "JSONL input chunk exceeds byte limit");
      }
      // Retain a private bounded snapshot while the consumer handles a yield.
      const chunk = Buffer.from(input);
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start);
        const end = newline < 0 ? chunk.length : newline;
        append(chunk.subarray(start, end));
        if (newline < 0) break;

        const lineLength = pendingLength && pending[pendingLength - 1] === 13
          ? pendingLength - 1 : pendingLength;
        let line;
        try {
          line = decoder.decode(pending.subarray(0, lineLength));
        } catch {
          throw fail("JSONL_INVALID_UTF8", "Invalid UTF-8 in JSONL document");
        }
        try {
          JSON.parse(line);
        } catch {
          throw fail("JSONL_INVALID_JSON", "Invalid JSONL document");
        }
        // Do not retain an oversized backing buffer between complete lines.
        pending = Buffer.alloc(0);
        pendingLength = 0;
        start = newline + 1;
        yield line;
      }
    }
    if (pendingLength) {
      throw fail("JSONL_TRUNCATED_EOF", "JSONL stream ended mid-document");
    }
  } finally {
    pending = Buffer.alloc(0);
    pendingLength = 0;
  }
}

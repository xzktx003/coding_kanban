import { describe, expect, it, vi } from "vitest";
import { readResponseJson } from "./readResponseJson";

describe("streamed JSON response consumption", () => {
  it("decodes split UTF-8 and a BOM without the opaque native JSON consumer", async () => {
    const bytes = new TextEncoder().encode('\uFEFF{"text":"手机😀","value":3}');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    );
    const nativeJson = vi.spyOn(response, "json");
    expect(await readResponseJson(response)).toEqual({
      text: "手机😀",
      value: 3,
    });
    expect(nativeJson).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(true);
    expect(response.body!.locked).toBe(false);
  });

  it("matches replacement decoding and JSON syntax failures", async () => {
    const bytes = new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]);
    expect(await readResponseJson(new Response(bytes))).toEqual({ x: "�" });
    const invalid = new Response('{"unfinished":');
    await expect(readResponseJson(invalid)).rejects.toBeInstanceOf(SyntaxError);
    expect(invalid.body!.locked).toBe(false);
    await expect(readResponseJson(new Response())).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });

  it("propagates a body read failure and releases the reader", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    );
    const result = readResponseJson(response);
    const failure = new DOMException("owned read cancelled", "AbortError");
    controller.error(failure);
    await expect(result).rejects.toBe(failure);
    expect(response.body!.locked).toBe(false);
  });

  it("retains native TypeError semantics for an already-consumed body", async () => {
    const response = new Response('{"once":true}');
    const reader = response.body!.getReader();
    while (!(await reader.read()).done) {}
    reader.releaseLock();
    expect(response.bodyUsed).toBe(true);
    expect(response.body!.locked).toBe(false);
    await expect(readResponseJson(response)).rejects.toBeInstanceOf(TypeError);
  });
});

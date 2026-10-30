import { expect } from "@playwright/test";

export async function observeNativeCapture(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript(() => {
    const state = {
      streams: [] as MediaStream[],
      contexts: [] as AudioContext[],
      frames: 0,
    };
    (window as any).__dictationCapture = state;
    const media = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      let stream: MediaStream;
      try {
        stream = await media(...args);
      } catch (error) {
        (state as any).failure = {
          name: (error as any)?.name,
          message: (error as any)?.message,
          isError: error instanceof Error,
          ctor: (error as any)?.constructor?.name,
        };
        throw error;
      }
      state.streams.push(stream);
      return stream;
    };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        state.contexts.push(this);
      }
      createScriptProcessor(
        ...args: Parameters<AudioContext["createScriptProcessor"]>
      ) {
        const node = super.createScriptProcessor(...args);
        node.addEventListener("audioprocess", () => state.frames++);
        return node;
      }
    };
  });
}
export async function released(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (window as any).__dictationCapture;
        return (
          state.streams.every((stream: MediaStream) =>
            stream.getTracks().every((track) => track.readyState === "ended"),
          ) &&
          state.contexts.every(
            (context: AudioContext) => context.state === "closed",
          )
        );
      }),
    )
    .toBe(true);
}

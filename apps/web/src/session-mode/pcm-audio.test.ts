import { describe, expect, it } from "vitest";
import { encodePcm16k } from "./pcm-audio";

describe("browser dictation PCM", () => {
  it("uses little endian signed mono samples and clamps input", () => {
    expect(Array.from(encodePcm16k([new Float32Array([-2, 0, 1])], 16000))).toEqual([0, 128, 0, 0, 255, 127]);
  });
  it("resamples the actual capture rate to 16 kHz", () => {
    expect(encodePcm16k([new Float32Array(48000)], 48000).length).toBe(32000);
  });
  it("rejects invalid rates and recordings longer than 120 seconds", () => {
    expect(() => encodePcm16k([], 0)).toThrow();
    expect(() => encodePcm16k([new Float32Array(16000 * 121)], 16000)).toThrow();
  });
});

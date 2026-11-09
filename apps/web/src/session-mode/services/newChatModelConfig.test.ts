import { beforeEach, expect, it, vi } from "vitest";
const post = vi.hoisted(() => vi.fn());
vi.mock("./apiAdapt/shared", () => ({ postJsonWithOptions: post }));
import {
  readNewChatModelConfig,
  resolveNewChatModelConfig,
} from "./newChatModelConfig";
beforeEach(() => post.mockReset());
it("captures configured model/provider without borrowing a catalog default", async () => {
  post.mockResolvedValue({
    status: "ready",
    model: "houmo/h200",
    modelProvider: "magpie",
    reasoningEffort: "high",
  });
  const captured = await readNewChatModelConfig("/project");
  expect(post.mock.calls[0][1]).toEqual({ cwd: "/project" });
  expect(
    resolveNewChatModelConfig(
      { model: "old", modelProvider: "openai", reasoningEffort: "medium" },
      captured,
    ),
  ).toEqual({
    model: "houmo/h200",
    modelProvider: "magpie",
    reasoningEffort: "high",
  });
});
it("does not turn missing capabilities or malformed config into subscription defaults", async () => {
  post.mockRejectedValue({ status: 405 });
  await expect(readNewChatModelConfig("/project")).rejects.toThrow(
    "当前运行服务",
  );
  post.mockResolvedValue({ status: "ready", model: 12 });
  await expect(readNewChatModelConfig("/project")).rejects.toThrow();
});
it("uses null native defaults rather than inventing an openai provider", () => {
  expect(
    resolveNewChatModelConfig(
      { model: "old", modelProvider: "openai", reasoningEffort: "medium" },
      {
        status: "ready",
        model: null,
        modelProvider: null,
        reasoningEffort: null,
      },
    ),
  ).toEqual({ model: null, modelProvider: null, reasoningEffort: null });
});

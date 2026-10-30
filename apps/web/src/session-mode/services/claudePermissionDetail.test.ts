import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock("./apiAdapt/cc", () => ({ ccReadPermissionDetail: api.detail }));
import { readClaudePermissionInput } from "./claudePermissionDetail";
const request = {
  type: "permission_request" as const,
  requestId: "request",
  sessionId: "thread",
  toolName: "Bash",
  toolInput: {},
  inputAvailable: true,
  inputRevision: "r1",
  recoveryRuntimeInstance: "runtime",
};
it("reads exact revision-fenced chunks and rejects a changed item or nonadvancing cursor", async () => {
  api.detail
    .mockReset()
    .mockResolvedValueOnce({
      text: '{"command":',
      nextOffset: 11,
      itemRevision: "r1",
      format: "json",
    })
    .mockResolvedValueOnce({
      text: '"hello"}',
      nextOffset: null,
      itemRevision: "r1",
      format: "json",
    });
  expect(await readClaudePermissionInput(request)).toEqual({
    command: "hello",
  });
  expect(api.detail.mock.calls[1].slice(0, 5)).toEqual([
    "thread",
    "request",
    "runtime",
    11,
    "r1",
  ]);
  api.detail.mockResolvedValueOnce({
    text: "{}",
    nextOffset: null,
    itemRevision: "changed",
    format: "json",
  });
  await expect(readClaudePermissionInput(request)).rejects.toThrow("身份");
  api.detail.mockResolvedValueOnce({
    text: "{}",
    nextOffset: 0,
    itemRevision: "r1",
    format: "json",
  });
  await expect(readClaudePermissionInput(request)).rejects.toThrow("游标");
});

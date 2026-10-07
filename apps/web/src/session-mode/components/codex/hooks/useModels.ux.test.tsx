import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn().mockResolvedValue([]),
  listConfigProviders: vi.fn().mockResolvedValue([]),
  listProviderPresets: vi.fn().mockResolvedValue([]),
}));
vi.mock("@session/services/apiAdapt", () => api);
it("reports model loading failure and permits a coalesced retry", async () => {
  api.listModels
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({
      data: [{ id: "model", model: "model", displayName: "模型" }],
    });
  const { useModels } = await import("./useModels");
  const hook = renderHook(() => useModels());
  await waitFor(() => expect(hook.result.current.error).toContain("offline"));
  await act(async () => {
    await Promise.all([
      hook.result.current.reload(),
      hook.result.current.reload(),
    ]);
  });
  expect(api.listModels).toHaveBeenCalledTimes(2);
  expect(hook.result.current.openAiModels[0].id).toBe("model");
  expect(hook.result.current.error).toBeNull();
  api.listModels.mockResolvedValue({
    data: [{ id: "model", model: "model", displayName: "模型" }],
  });
  api.listOtherModels.mockRejectedValueOnce(
    new Error("other models unavailable"),
  );
  await act(async () => {
    await hook.result.current.reload();
  });
  expect(hook.result.current.error).toContain("other models unavailable");
  expect(hook.result.current.openAiModels[0].id).toBe("model");
  await act(async () => {
    await hook.result.current.reload();
  });
  expect(hook.result.current.error).toBeNull();
});

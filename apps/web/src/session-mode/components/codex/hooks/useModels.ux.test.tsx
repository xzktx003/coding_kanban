import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  listOtherModels: vi.fn().mockResolvedValue([]),
  listConfigProviders: vi.fn().mockResolvedValue([]),
  listProviderPresets: vi.fn().mockResolvedValue([]),
}));
vi.mock("@session/services/apiAdapt/codex", () => api);

type ModelResponse = {
  data: { id: string; model: string; displayName: string }[];
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

it("keeps a completed provider refresh newer than an initial catalog read", async () => {
  api.listModels.mockReset();
  api.listOtherModels.mockReset();
  api.listConfigProviders.mockReset();
  api.listProviderPresets.mockReset();
  let resolveInitial!: (providers: { name: string }[]) => void;
  let resolveRefresh!: (providers: { name: string }[]) => void;
  api.listConfigProviders
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    )
    .mockResolvedValue([{ name: "latest" }]);
  api.listModels.mockResolvedValue({ data: [] });
  api.listOtherModels.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);

  const { useModelCacheStore } = await import("./useModels");
  useModelCacheStore.setState({
    configProviders: [],
    loaded: false,
    loading: false,
    error: null,
  });
  let initialLoad!: Promise<void>;
  act(() => {
    initialLoad = useModelCacheStore.getState().load();
  });
  await waitFor(() => expect(api.listConfigProviders).toHaveBeenCalledTimes(1));

  let refresh!: Promise<void>;
  act(() => {
    refresh = useModelCacheStore.getState().refreshProviders();
  });
  await waitFor(() => expect(api.listConfigProviders).toHaveBeenCalledTimes(2));
  resolveRefresh([{ name: "latest" }]);
  resolveInitial([{ name: "stale" }]);
  await act(async () => {
    await initialLoad;
    await refresh;
  });

  expect(useModelCacheStore.getState().configProviders).toEqual([
    { name: "latest" },
  ]);
});

it("refreshes the model catalog after an older initial read completes", async () => {
  api.listModels.mockReset();
  api.listOtherModels.mockReset();
  api.listConfigProviders.mockReset();
  api.listProviderPresets.mockReset();
  const initial = deferred<ModelResponse>();
  const fresh = deferred<ModelResponse>();
  api.listModels
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(fresh.promise);
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);

  const { useModels, useModelCacheStore } = await import("./useModels");
  useModelCacheStore.setState({
    openAiModels: [],
    modelSnapshot: null,
    modelStatus: "pending",
    loaded: false,
    loading: false,
    error: null,
  });
  const hook = renderHook(() => useModels());
  await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1));

  let firstRefresh!: Promise<void>;
  let secondRefresh!: Promise<void>;
  act(() => {
    firstRefresh = hook.result.current.reload();
    secondRefresh = hook.result.current.reload();
  });
  await act(async () => {
    initial.resolve({
      data: [{ id: "stale", model: "stale", displayName: "旧模型" }],
    });
  });
  await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(2));
  expect(useModelCacheStore.getState().openAiModels).toEqual([]);

  await act(async () => {
    fresh.resolve({
      data: [{ id: "fresh", model: "fresh", displayName: "新模型" }],
    });
    await Promise.all([firstRefresh, secondRefresh]);
  });
  expect(api.listModels).toHaveBeenCalledTimes(2);
  expect(hook.result.current.openAiModels.map((model) => model.id)).toEqual([
    "fresh",
  ]);
  hook.unmount();
});

it("refreshes again when the catalog changes during an earlier refresh", async () => {
  api.listModels.mockReset();
  api.listOtherModels.mockReset();
  api.listConfigProviders.mockReset();
  api.listProviderPresets.mockReset();
  const oldRefresh = deferred<ModelResponse>();
  const newRefresh = deferred<ModelResponse>();
  api.listModels
    .mockReturnValueOnce(oldRefresh.promise)
    .mockReturnValueOnce(newRefresh.promise);
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);

  const { useModels, useModelCacheStore } = await import("./useModels");
  useModelCacheStore.setState({
    openAiModels: [],
    modelSnapshot: null,
    modelStatus: "pending",
    loaded: true,
    loading: false,
    error: null,
  });
  const hook = renderHook(() => useModels());
  let firstRefresh!: Promise<void>;
  act(() => {
    firstRefresh = hook.result.current.reload();
  });
  await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1));

  let secondRefresh!: Promise<void>;
  let thirdRefresh!: Promise<void>;
  act(() => {
    secondRefresh = hook.result.current.reload();
    thirdRefresh = hook.result.current.reload();
  });
  await act(async () => {
    oldRefresh.resolve({
      data: [{ id: "stale", model: "stale", displayName: "旧模型" }],
    });
  });
  await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(2));
  expect(useModelCacheStore.getState().openAiModels).toEqual([]);

  await act(async () => {
    newRefresh.resolve({
      data: [{ id: "fresh", model: "fresh", displayName: "新模型" }],
    });
    await Promise.all([firstRefresh, secondRefresh, thirdRefresh]);
  });
  expect(api.listModels).toHaveBeenCalledTimes(2);
  expect(hook.result.current.openAiModels.map((model) => model.id)).toEqual([
    "fresh",
  ]);
  hook.unmount();
});

it("replaces a stalled catalog read when the user refreshes", async () => {
  api.listModels.mockReset();
  api.listOtherModels.mockReset();
  api.listConfigProviders.mockReset();
  api.listProviderPresets.mockReset();
  const stalled = deferred<ModelResponse>();
  api.listModels.mockReturnValueOnce(stalled.promise).mockResolvedValueOnce({
    data: [{ id: "fresh", model: "fresh", displayName: "新模型" }],
  });
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);

  const { useModels, useModelCacheStore } = await import("./useModels");
  useModelCacheStore.setState({
    openAiModels: [],
    modelSnapshot: null,
    modelStatus: "pending",
    loaded: false,
    loading: false,
    error: null,
  });
  const hook = renderHook(() => useModels());
  await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1));
  const firstOptions = api.listModels.mock.calls[0]?.[0] as {
    signal: AbortSignal;
  };
  let refresh!: Promise<void>;
  act(() => {
    refresh = hook.result.current.reload();
  });
  await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(2));
  await act(async () => {
    await refresh;
  });
  expect(firstOptions.signal.aborted).toBe(true);
  expect(hook.result.current.openAiModels.map((model) => model.id)).toEqual([
    "fresh",
  ]);

  await act(async () => {
    stalled.resolve({
      data: [{ id: "stale", model: "stale", displayName: "旧模型" }],
    });
  });
  expect(hook.result.current.openAiModels.map((model) => model.id)).toEqual([
    "fresh",
  ]);
  hook.unmount();
});

it("does not let an older provider refresh overwrite a newer catalog refresh", async () => {
  api.listModels.mockReset();
  api.listOtherModels.mockReset();
  api.listConfigProviders.mockReset();
  api.listProviderPresets.mockReset();
  const oldProviders = deferred<{ name: string }[]>();
  api.listModels.mockResolvedValue({ data: [] });
  api.listOtherModels.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);
  api.listConfigProviders
    .mockReturnValueOnce(oldProviders.promise)
    .mockResolvedValue([{ name: "new-provider" }]);

  const { useModels, useModelCacheStore } = await import("./useModels");
  useModelCacheStore.setState({
    configProviders: [],
    loaded: true,
    loading: false,
    error: null,
  });
  const hook = renderHook(() => useModels());
  let providerRefresh!: Promise<void>;
  act(() => {
    providerRefresh = useModelCacheStore.getState().refreshProviders();
  });
  await waitFor(() => expect(api.listConfigProviders).toHaveBeenCalledTimes(1));
  const oldOptions = api.listConfigProviders.mock.calls[0]?.[0] as {
    signal: AbortSignal;
  };
  await act(async () => {
    await Promise.all([providerRefresh, hook.result.current.reload()]);
  });
  expect(oldOptions.signal.aborted).toBe(true);
  expect(useModelCacheStore.getState().configProviders).toEqual([
    { name: "new-provider" },
  ]);
  await act(async () => {
    oldProviders.resolve([{ name: "old-provider" }]);
  });
  expect(useModelCacheStore.getState().configProviders).toEqual([
    { name: "new-provider" },
  ]);
  hook.unmount();
});

it("reports a timed-out catalog read instead of remaining in the loading state", async () => {
  api.listModels.mockReset();
  api.listOtherModels.mockReset();
  api.listConfigProviders.mockReset();
  api.listProviderPresets.mockReset();
  api.listModels.mockReturnValue(new Promise(() => {}));
  api.listOtherModels.mockResolvedValue([]);
  api.listConfigProviders.mockResolvedValue([]);
  api.listProviderPresets.mockResolvedValue([]);

  const { useModelCacheStore } = await import("./useModels");
  useModelCacheStore.setState({
    openAiModels: [],
    modelSnapshot: null,
    modelStatus: "pending",
    loaded: false,
    loading: false,
    error: null,
  });
  vi.useFakeTimers();
  try {
    const loading = useModelCacheStore.getState().load();
    const options = api.listModels.mock.calls[0]?.[0] as {
      signal: AbortSignal;
    };
    await vi.advanceTimersByTimeAsync(15_000);
    await loading;
    expect(options.signal.aborted).toBe(true);
    expect(useModelCacheStore.getState().loading).toBe(false);
    expect(useModelCacheStore.getState().modelStatus).toBe("error");
    expect(useModelCacheStore.getState().error).toContain("超时");
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the known providers when a provider refresh times out", async () => {
  api.listConfigProviders.mockReset();
  api.listConfigProviders.mockReturnValue(new Promise(() => {}));
  const { useModelCacheStore } = await import("./useModels");
  useModelCacheStore.setState({
    configProviders: [{ name: "known" }],
    loaded: true,
    loading: false,
    error: null,
  });
  vi.useFakeTimers();
  try {
    const refresh = useModelCacheStore.getState().refreshProviders();
    const options = api.listConfigProviders.mock.calls[0]?.[0] as {
      signal: AbortSignal;
    };
    await vi.advanceTimersByTimeAsync(15_000);
    await refresh;
    expect(options.signal.aborted).toBe(true);
    expect(useModelCacheStore.getState().configProviders).toEqual([
      { name: "known" },
    ]);
    expect(useModelCacheStore.getState().error).toContain("超时");
  } finally {
    vi.useRealTimers();
  }
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useThreadModelSettings } from "./useThreadModelSettings";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import {
  getThreadModelSettings,
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { followupParameters } from "@session/services/followupService";
beforeEach(() => {
  useThreadModelStore.setState({ threads: {} });
  useConfigStore.setState({
    webSearchRequest: false,
    collaborationMode: "default",
  });
});
it("connects owner menu setters to the exact sent permissions, preserving native external policy and other owners", () => {
  hydrateThreadModel("a", {
    model: "model-a",
    sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" },
  });
  hydrateThreadModel("b", {
    model: "model-b",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  });
  const { result } = renderHook(() => useThreadModelSettings("a"));
  act(() => {
    result.current.setWebSearch(true);
    result.current.setCollaborationMode("plan");
  });
  expect(followupParameters("a")).toMatchObject({
    sandboxPolicy: { type: "externalSandbox", networkAccess: "enabled" },
    collaborationMode: { mode: "plan" },
  });
  expect(getThreadModelSettings("b")).toMatchObject({
    webSearchRequest: false,
    collaborationMode: "default",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  });
  expect(useConfigStore.getState()).toMatchObject({
    webSearchRequest: false,
    collaborationMode: "default",
  });
});

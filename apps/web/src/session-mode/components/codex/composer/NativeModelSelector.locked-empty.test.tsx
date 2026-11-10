import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConfigStore } from "../stores/useConfigStore";
import { NativeModelSelector } from "./NativeModelSelector";

const catalog = vi.hoisted(() => ({
  status: "success" as "success" | "error",
  error: null as string | null,
  reload: vi.fn(),
}));

beforeEach(() => {
  useConfigStore.getState().setModelSelectionMode("manual");
  useConfigStore.setState({ model: "", modelProvider: "openai" });
  catalog.status = "success";
  catalog.error = null;
  catalog.reload.mockReset();
});

afterEach(() => {
  cleanup();
  useConfigStore.getState().setModelSelectionMode("follow-config");
});

vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: (selector: (state: unknown) => unknown) => selector({ currentThreadId: null }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ loading: false, error: catalog.error, reload: catalog.reload, providerItems: () => [], openAiModels: [], modelStatus: catalog.status, hasModelSnapshot: false }),
}));
vi.mock("../hooks/useMagpieCatalog", () => ({
  useMagpieCatalog: () => ({ models: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({ model: "", modelProvider: "openai", reasoningEffort: "medium", setModel: vi.fn(), setReasoningEffort: vi.fn(), setModelSelection: vi.fn() }),
}));

it("shows the locked logged-out notice without opening a model list", async () => {
  render(<div className="session-mode"><NativeModelSelector threadId={null} /></div>);
  fireEvent.pointerDown(screen.getByRole("button", { name: "自定义，中" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "选择模型" }));
  expect(screen.getByText("已锁定，打开访问选项。用量已达上限。")).toBeTruthy();
  expect(screen.queryByRole("menuitemradio")).toBeNull();
  expect(document.body.textContent).toContain("共");
  expect(document.body.textContent).toContain("6");
  expect(document.body.textContent).toContain("第");
  expect(document.body.textContent).toContain("3");
  expect(document.body.textContent).toContain("自定义 标准");
});

it("shows a retryable catalog error instead of a usage-limit notice", async () => {
  catalog.status = "error";
  catalog.error = "读取模型目录超时，请重试";
  render(<div className="session-mode"><NativeModelSelector threadId={null} /></div>);
  fireEvent.pointerDown(screen.getByRole("button", { name: "模型目录不可用" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
  expect((await screen.findByRole("alert")).textContent).toContain("读取模型目录超时，请重试");
  expect(screen.queryByText("已锁定，打开访问选项。用量已达上限。")).toBeNull();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "重试" }), { key: "Enter" });
  expect(catalog.reload).toHaveBeenCalledTimes(1);
});

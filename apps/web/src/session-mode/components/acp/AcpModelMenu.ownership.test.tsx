import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import type { AcpConfigOption } from "@session/services/apiAdapt/acp";
import { AcpModelMenu } from "./AcpModelMenu";

const api = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  config: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpAuthenticate: api.authenticate,
  acpNewSession: api.create,
  acpCancel: vi.fn(),
  acpSetConfigOption: api.config,
  acpSetModel: vi.fn(),
}));
vi.mock("./AcpChoiceMenu", () => ({
  AcpChoiceMenu: ({ onSelectAuthMethod }: any) => (
    <button onClick={() => onSelectAuthMethod("account")}>切换账号</button>
  ),
}));
vi.mock("@session/components/ui/use-toast", () => ({ toast: vi.fn() }));

test("late account model alignment cannot set effort on a later selected session", async () => {
  useAcpStore.getState().reset();
  useWorkspaceStore.setState({ cwd: "/fixture" });
  useAcpStore.setState({
    active: true,
    connectionId: "connection",
    sessionId: "initial",
    agentId: "fixture",
  });
  api.authenticate.mockResolvedValue(undefined);
  const options: AcpConfigOption[] = [
    {
      id: "model",
      name: "Model",
      type: "select",
      category: "model",
      currentValue: "old",
      options: [{ name: "Account model", value: "account-model" }],
    },
    {
      id: "effort",
      name: "Effort",
      type: "select",
      category: "thought_level",
      currentValue: "high",
      options: [{ name: "Low", value: "low" }],
    },
  ];
  api.create.mockResolvedValue({
    sessionId: "authenticated",
    configOptions: options,
  });
  let resolve!: () => void;
  api.config.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  render(<AcpModelMenu />);
  fireEvent.click(screen.getByRole("button", { name: "切换账号" }));
  await waitFor(() =>
    expect(api.config).toHaveBeenCalledExactlyOnceWith(
      "connection",
      "authenticated",
      "model",
      "account-model",
    ),
  );
  act(() =>
    useAcpStore.setState({ sessionId: "later", configOptions: options }),
  );
  await act(async () => resolve());
  expect(api.config).toHaveBeenCalledTimes(1);
  expect(
    useAcpStore.getState().configOptions.find((o) => o.id === "effort")
      ?.currentValue,
  ).toBe("high");
});

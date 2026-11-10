import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const loadEnvKeys = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ configProviders: [], refreshProviders: refresh }),
}));
vi.mock("@session/services/apiAdapt", () => ({
  loadEnvKeys,
  removeModelProvider: vi.fn(),
  setEnv: vi.fn(),
}));
vi.mock("@session/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("./AddProviderDialog", () => ({
  AddProviderDialog: ({
    onAdded,
  }: {
    onAdded?: (provider: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        void (async () => {
          // The real child refreshes the shared catalog before this callback.
          await refresh();
          onAdded?.("magpie");
        })();
      }}
    >
      simulate provider addition
    </button>
  ),
}));

import { EnvKeysDialog } from "./EnvKeysDialog";

beforeEach(() => {
  refresh.mockClear();
  loadEnvKeys.mockClear();
});

it("does not refetch the model catalog a second time after adding a provider", async () => {
  const onProviderChange = vi.fn();
  render(
    <EnvKeysDialog
      open
      onOpenChange={vi.fn()}
      provider="openai"
      onProviderChange={onProviderChange}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "simulate provider addition" }));
  await waitFor(() => expect(onProviderChange).toHaveBeenCalledWith("magpie"));

  expect(refresh).toHaveBeenCalledTimes(1);
});

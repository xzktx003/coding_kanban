import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PluginsMarketplaceView } from "./PluginsMarketplaceView";
const data = vi.hoisted(() => ({
  marketplaces: [],
  errors: [],
  loadError: "503 catalog offline",
  isLoading: false,
  query: "",
  setQuery: vi.fn(),
  loadPlugins: vi.fn(),
  browseGroups: [],
  handleInstall: vi.fn(),
  handleUsePlugin: vi.fn(),
  handleShowDetail: vi.fn(),
  installingPluginId: null,
}));
vi.mock("../hooks/usePluginsMarketplace", () => ({
  usePluginsMarketplace: () => data,
}));
test("plugin failure is an actionable error rather than no plugins", () => {
  render(<PluginsMarketplaceView />);
  expect(screen.getByRole("alert").textContent).toContain(
    "503 catalog offline",
  );
  expect(screen.queryByText("No plugins found")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新加载插件" }));
  expect(data.loadPlugins).toHaveBeenCalledWith();
});

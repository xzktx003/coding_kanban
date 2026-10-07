import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { OpenAppMenu } from "./OpenAppMenu";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  api: vi.fn(),
  close: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("../../../../lib/api", () => ({ openProjectVsCodeWeb: mocks.api }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockReturnValue({
    close: mocks.close,
    location: { replace: mocks.replace },
    opener: null,
  });
  vi.stubGlobal("open", mocks.open);
});

test("opens the current server project in VS Code Web after reserving a browser tab", async () => {
  let resolve!: (value: { url: string }) => void;
  mocks.api.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<OpenAppMenu path="/projects/my project" />);
  fireEvent.click(
    screen.getByRole("button", { name: "在 VS Code Web 中打开当前项目" }),
  );
  expect(mocks.open).toHaveBeenCalled();
  expect(mocks.api).toHaveBeenCalledWith("/projects/my project");
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  resolve({ url: "https://lan.example/vscode/?workspace=project" });
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith(
      "https://lan.example/vscode/?workspace=project",
    ),
  );
  expect(screen.queryByText("Open in")).toBeNull();
  expect(screen.queryByText("Cursor")).toBeNull();
});

test("reports launch failures and closes the reserved tab", async () => {
  mocks.api.mockRejectedValue(new Error("服务暂时不可用"));
  render(<OpenAppMenu path="/projects/demo" />);
  fireEvent.click(
    screen.getByRole("button", { name: "在 VS Code Web 中打开当前项目" }),
  );
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("服务暂时不可用");
  expect(mocks.close).toHaveBeenCalled();
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
});

test("does not start a service when the browser blocks the new tab", async () => {
  mocks.open.mockReturnValue(null);
  render(<OpenAppMenu path="/projects/demo" />);
  fireEvent.click(
    screen.getByRole("button", { name: "在 VS Code Web 中打开当前项目" }),
  );
  await screen.findByRole("alert");
  expect(mocks.api).not.toHaveBeenCalled();
});

import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FileViewer } from "./FileViewer";

const dependencies = vi.hoisted(() => ({
  officeLoaded: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@session/services", () => ({
  readTextFile: dependencies.read,
  canonicalizePath: async (path: string) => path,
  writeFile: vi.fn(),
}));
vi.mock("@session/services/workspaceFiles", () => ({
  readWorkspaceText: async (_root: string, path: string) => ({
    path,
    content: await dependencies.read(path),
    version: "v1",
    size: 4,
  }),
  saveWorkspaceText: vi.fn(),
}));
vi.mock("@session/hooks/useDirWatch", () => ({ useDirWatch: () => {} }));
vi.mock("@session/stores", () => ({
  useInputStore: () => ({ setInputValue: vi.fn() }),
}));
vi.mock("../editor/CodeEditor", () => ({
  CodeEditor: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("./OfficeView", () => {
  dependencies.officeLoaded();
  return {
    OfficeView: ({ filePath }: { filePath: string }) => (
      <div>文档预览：{filePath}</div>
    ),
  };
});

test("loads office preview only when an office file is opened", async () => {
  expect(dependencies.officeLoaded).not.toHaveBeenCalled();
  dependencies.read.mockResolvedValue("代码正文");
  const view = render(<FileViewer filePath="/fixture/a.ts" />);
  await screen.findByText("代码正文");
  expect(dependencies.officeLoaded).not.toHaveBeenCalled();

  view.rerender(<FileViewer filePath="/fixture/report.xlsx" />);
  await screen.findByText("文档预览：/fixture/report.xlsx");
  expect(dependencies.officeLoaded).toHaveBeenCalledTimes(1);
});

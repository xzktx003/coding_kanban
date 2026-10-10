import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { IndividualFileChanges } from "./IndividualFileChanges";
import { useCodexStore } from "../stores/useCodexStore";
import { CodexContentOwner } from "../presentation/ownerContext";
import { useEditorStore, useWorkspaceStore } from "@session/stores";
import { getChangeCounts, getDiffViewerProps } from "./fileChangeLogic";
it("opens literal protocol paths at their own project without Markdown URL/line parsing", () => {
  useWorkspaceStore.setState({ cwd: "/foreign" });
  useCodexStore.setState({
    threads: [{ id: "owner", cwd: "/owner" }] as never,
  });
  useEditorStore.getState().resetFiles();
  const path = "/owner/100%:12[blue](tag).ts";
  render(
    <CodexContentOwner.Provider value="owner">
      <IndividualFileChanges
        changes={[
          {
            path,
            kind: { type: "update", move_path: null },
            diff: "@@ -80 +80 @@\n-old\n+new\n",
          },
        ]}
        fileChangeMap={{ add: "创建", update: "编辑", delete: "删除" }}
        getChangeCounts={getChangeCounts}
        getDiffViewerProps={getDiffViewerProps}
      />
    </CodexContentOwner.Provider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "100%:12[blue](tag).ts" }),
  );
  expect(useEditorStore.getState().activeFile).toBe(path);
  expect(useEditorStore.getState().roots[path]).toBe("/owner");
  expect(useWorkspaceStore.getState().cwd).toBe("/foreign");
});

it("keeps projected file paths usable without showing zero changes or an empty Diff", () => {
  const changes = [
    {
      path: "/owner/projected.ts",
      kind: { type: "update" as const, move_path: null },
      diff: "",
      transcriptMetadataOnly: true,
    },
  ];
  render(
    <CodexContentOwner.Provider value="owner">
      <IndividualFileChanges
        changes={changes}
        fileChangeMap={{ add: "创建", update: "编辑", delete: "删除" }}
        getChangeCounts={getChangeCounts}
        getDiffViewerProps={getDiffViewerProps}
      />
    </CodexContentOwner.Provider>,
  );
  expect(screen.getByText("详情未加载")).toBeTruthy();
  expect(screen.queryByText("+0")).toBeNull();
  expect(screen.queryByText("-0")).toBeNull();
  const disclosure = screen.getByRole("button", {
    name: /projected.ts Diff/,
  }) as HTMLButtonElement;
  expect(disclosure.disabled).toBe(true);
  fireEvent.click(disclosure);
  expect(document.querySelector(".codex-diff-viewer")).toBeNull();
});

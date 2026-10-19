import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { FileTreeNode } from "./FileTreeNode";
import type { FileNode } from "./types";
import { useInputStore } from "@session/stores/useInputStore";
import {
  useSessionDraftStore,
  readDraft,
  sessionDraftKey,
} from "@session/stores/useSessionDraftStore";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAcpStore } from "@session/stores/useAcpStore";

beforeEach(() => {
  localStorage.clear();
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useCodexStore.setState({ currentThreadId: "tree-input-a" });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useWorkspaceStore.setState({ cwd: "/fixture" });
  useAcpStore.setState({ active: false });
});

function tree(node: FileNode) {
  return (
    <FileTreeNode
      node={node}
      depth={0}
      rootPath="/fixture"
      activeExpanded={new Set(["/fixture"])}
      loadingNodes={new Set()}
      onToggle={() => {}}
      onLoadChildren={() => {}}
    />
  );
}

test("typing does not execute any of the mounted file rows", () => {
  let reads = 0;
  const children: FileNode[] = Array.from({ length: 100 }, (_, i) => ({
    get name() {
      reads++;
      return `file-${i}.ts`;
    },
    path: `/fixture/file-${i}.ts`,
    kind: "file",
  }));
  render(tree({ name: "fixture", path: "/fixture", kind: "dir", children }));
  expect(screen.getAllByRole("button", { name: /^文件 file-/ })).toHaveLength(
    100,
  );
  expect(reads).toBeGreaterThan(0);
  reads = 0;
  for (const value of ["t", "ty", "typ", "type"]) {
    act(() => useInputStore.getState().setInputValue(value));
  }
  expect(reads).toBe(0);
  expect(readDraft(sessionDraftKey("codex", "tree-input-a")).text).toBe("type");
});

test("a stable path insertion action still targets the newly selected session", () => {
  render(tree({ name: "entry.ts", path: "/fixture/entry.ts", kind: "file" }));
  fireEvent.click(screen.getByRole("button", { name: "插入路径 entry.ts" }));
  expect(readDraft(sessionDraftKey("codex", "tree-input-a")).text).toBe(
    "`entry.ts`",
  );
  act(() => useCodexStore.setState({ currentThreadId: "tree-input-b" }));
  fireEvent.click(screen.getByRole("button", { name: "插入路径 entry.ts" }));
  expect(readDraft(sessionDraftKey("codex", "tree-input-b")).text).toBe(
    "`entry.ts`",
  );
  expect(readDraft(sessionDraftKey("codex", "tree-input-a")).text).toBe(
    "`entry.ts`",
  );
});

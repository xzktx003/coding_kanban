import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@session/services/codexService", () => ({ codexService: {} }));
import { SLASH_COMMANDS } from "./slashCommands";
import { goalDrafts, useGoalDraftStore } from "./goalDrafts";
import { useCodexStore } from "../stores";
import { useConfigStore } from "../stores/useConfigStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import {
  changeThreadModel,
  getThreadModelSettings,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";

beforeEach(() => {
  useGoalDraftStore.setState({ owners: {}, legacyMigrated: true });
  useCodexStore.setState({ currentThreadId: null });
  useConfigStore.setState({ collaborationMode: "plan" });
  useThreadModelStore.setState({ threads: {} });
  useWorkspaceStore.setState({ cwd: "/fixture/project" });
});

it("enables Goal repeatedly and leaves plan mode without creating a thread", async () => {
  const context = {
    currentThreadId: null,
    ensureThread: vi.fn(),
    openDialog: vi.fn(),
  };
  const goal = SLASH_COMMANDS.find((command) => command.id === "goal")!;
  await goal.run(context);
  await goal.run(context);
  expect(useConfigStore.getState().collaborationMode).toBe("default");
  expect(
    goalDrafts.read(sessionDraftKey("codex", null, "/fixture/project")).enabled,
  ).toBe(true);
  expect(context.ensureThread).not.toHaveBeenCalled();
});

it("leaves only the selected thread's plan mode and enables its own Goal draft", async () => {
  useCodexStore.setState({ currentThreadId: "goal-thread" });
  changeThreadModel("goal-thread", { collaborationMode: "plan" });
  const context = {
    currentThreadId: "goal-thread",
    ensureThread: vi.fn(),
    openDialog: vi.fn(),
  };
  await SLASH_COMMANDS.find((command) => command.id === "goal")!.run(context);
  expect(getThreadModelSettings("goal-thread").collaborationMode).toBe(
    "default",
  );
  expect(useConfigStore.getState().collaborationMode).toBe("plan");
  expect(goalDrafts.read(sessionDraftKey("codex", "goal-thread")).enabled).toBe(
    true,
  );
  expect(context.ensureThread).not.toHaveBeenCalled();
});

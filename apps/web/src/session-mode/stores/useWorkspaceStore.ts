import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import {
  applyProjectAction,
  type ProjectAction,
  type ProjectOperation,
  type SharedProjects,
} from "@agent-orchestrator/shared";
import { useEditorStore } from "./useEditorStore";

export type ProjectSortKey =
  | "added_desc"
  | "added_asc"
  | "name_asc"
  | "name_desc";
const MAX_HISTORY_PROJECTS = 30;

function normalizeProjectPath(project: string): string {
  return project.trim();
}

function dedupeProjects(projects: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const project of projects) {
    const normalized = normalizeProjectPath(project);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function pushRecentProject(
  history: string[],
  project: string | null,
): string[] {
  if (!project) {
    return history;
  }
  const normalized = normalizeProjectPath(project);
  if (!normalized) {
    return history;
  }
  const withoutCurrent = history.filter((item) => item !== normalized);
  return [normalized, ...withoutCurrent].slice(0, MAX_HISTORY_PROJECTS);
}

export function sortProjects(
  projects: string[],
  sortKey: ProjectSortKey,
): string[] {
  const next = [...projects];
  if (sortKey === "added_desc") {
    return next.reverse();
  }
  if (sortKey === "added_asc") {
    return next;
  }
  return next.sort((a, b) =>
    sortKey === "name_asc"
      ? a.localeCompare(b, undefined, { sensitivity: "base" })
      : b.localeCompare(a, undefined, { sensitivity: "base" }),
  );
}

interface WorkspaceStore {
  projectSyncClientId: string;
  nextProjectSequence: number;
  pendingProjectOperations: ProjectOperation[];
  projectsInitialized: boolean;
  projectSyncError: string | null;
  acceptSharedProjects: (
    snapshot: SharedProjects,
    acknowledgedSequence?: number,
  ) => void;
  projects: string[];
  setProjects: (projects: string[]) => void;
  addProject: (project: string) => void;
  removeProject: (project: string) => void;
  addProjectAndSelect: (project: string) => void;
  historyProjects: string[];
  setHistoryProjects: (projects: string[]) => void;
  addHistoryProject: (project: string) => void;
  clearHistoryProjects: () => void;
  projectSort: ProjectSortKey;
  setProjectSort: (sortKey: ProjectSortKey) => void;
  cwd: string | null;
  setCwd: (path: string | null) => void;
}

function enqueue(state: WorkspaceStore, actions: ProjectAction[]) {
  if (!actions.length) return {};
  return {
    nextProjectSequence: state.nextProjectSequence + actions.length,
    pendingProjectOperations: [
      ...state.pendingProjectOperations,
      ...actions.map((action, i) => ({
        seq: state.nextProjectSequence + i,
        action,
      })),
    ],
  };
}
export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      projectSyncClientId: uuid(),
      nextProjectSequence: 1,
      pendingProjectOperations: [],
      projectsInitialized: false,
      projectSyncError: null,
      acceptSharedProjects: (snapshot, sequence = 0) =>
        set((state) => {
          const pending = state.pendingProjectOperations.filter(
            (op) => op.seq > sequence,
          );
          const projects = pending.reduce(
            (current, op) => applyProjectAction(current, op.action),
            snapshot.projects,
          );
          return {
            projects:
              JSON.stringify(projects) === JSON.stringify(state.projects)
                ? state.projects
                : projects,
            pendingProjectOperations:
              pending.length === state.pendingProjectOperations.length
                ? state.pendingProjectOperations
                : pending,
            projectsInitialized: snapshot.initialized,
            projectSyncError: null,
          };
        }),
      projects: [],
      setProjects: (projects) =>
        set((state) => {
          const next = dedupeProjects(projects),
            actions: ProjectAction[] = [];
          let current = [...state.projects];
          for (const path of current)
            if (!next.includes(path)) actions.push({ type: "remove", path });
          for (const path of next)
            if (!current.includes(path)) actions.push({ type: "add", path });
          current = actions.reduce(applyProjectAction, current);
          if (JSON.stringify(current) !== JSON.stringify(next)) {
            for (let i = next.length - 1; i >= 0; i--)
              actions.push({
                type: "move",
                path: next[i],
                beforePath: next[i + 1] ?? null,
              });
          }
          return { projects: next, ...enqueue(state, actions) };
        }),
      addProject: (project) =>
        set((state) => {
          const normalized = normalizeProjectPath(project);
          if (!normalized) {
            return state;
          }
          return {
            ...(!state.projects.includes(normalized)
              ? enqueue(state, [{ type: "add", path: normalized }])
              : {}),
            projects: state.projects.includes(normalized)
              ? state.projects
              : [...state.projects, normalized],
            historyProjects: pushRecentProject(
              state.historyProjects,
              normalized,
            ),
          };
        }),
      removeProject: (project) =>
        set((state) => {
          const normalized = normalizeProjectPath(project);
          const projects = state.projects.filter((p) => p !== normalized);
          const shouldClearCwd = state.cwd === normalized;
          const nextCwd = shouldClearCwd ? (projects[0] ?? null) : state.cwd;

          if (shouldClearCwd) {
            useEditorStore.getState().resetFiles();
          }

          return {
            ...(state.projects.includes(normalized)
              ? enqueue(state, [{ type: "remove", path: normalized }])
              : {}),
            projects,
            cwd: nextCwd,
          };
        }),
      addProjectAndSelect: (project) => {
        const trimmed = normalizeProjectPath(project);
        const state = get();
        if (trimmed && !state.projects.includes(trimmed)) {
          set({
            ...enqueue(state, [{ type: "add", path: trimmed }]),
            projects: [...state.projects, trimmed],
            cwd: trimmed,
            historyProjects: pushRecentProject(state.historyProjects, trimmed),
          });
        }
      },
      historyProjects: [],
      setHistoryProjects: (projects) =>
        set({ historyProjects: dedupeProjects(projects) }),
      addHistoryProject: (project) =>
        set((state) => ({
          historyProjects: pushRecentProject(state.historyProjects, project),
        })),
      clearHistoryProjects: () => set({ historyProjects: [] }),
      projectSort: "added_desc",
      setProjectSort: (sortKey) => set({ projectSort: sortKey }),
      cwd: null,
      setCwd: (path) => {
        const normalized = path ? normalizeProjectPath(path) : null;
        set((state) => ({
          cwd: normalized,
          historyProjects: normalized
            ? pushRecentProject(state.historyProjects, normalized)
            : state.historyProjects,
        }));
      },
    }),
    {
      name: "kanban.session.workspace",
      version: 1,
      partialize: (state) => ({
        projects: state.projects,
        cwd: state.cwd,
        historyProjects: state.historyProjects,
        projectSort: state.projectSort,
        projectSyncClientId: state.projectSyncClientId,
        nextProjectSequence: state.nextProjectSequence,
        pendingProjectOperations: state.pendingProjectOperations,
        projectsInitialized: state.projectsInitialized,
      }),
    },
  ),
);

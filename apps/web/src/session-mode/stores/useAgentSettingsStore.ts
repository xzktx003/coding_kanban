import { create } from "zustand";
import {
  createPerFieldStorage,
  createStorageSync,
  oneOf,
} from "@session/lib/perFieldStorage";

export type AgentType = "codex" | "cc";
export const AGENT_TYPES: AgentType[] = ["cc", "codex"];

interface AgentSettings {
  selectedAgent: AgentType;
  instructionType: string;
}

interface AgentSettingsStore extends AgentSettings {
  setSelectedAgent: (agent: AgentType) => void;
  setInstructionType: (type: string) => void;
}

/**
 * Two independent same-device preferences. `instructionType` is not cosmetic:
 * `AgentsMdView` turns it into the file it reads and writes — `system` resolves
 * to `~/.codex/AGENTS.md`, `project` to `$cwd/AGENTS.md` — so a whole-map write
 * from a stale second page would point the editor at the wrong file. Each field
 * therefore owns its own key; see `lib/perFieldStorage.ts` for the boundary.
 */
const storage = createPerFieldStorage<AgentSettings>({
  legacyKey: "kanban.session.agent-settings",
  version: 2,
  defaults: { selectedAgent: "codex", instructionType: "system" },
  validators: {
    selectedAgent: oneOf(...AGENT_TYPES),
    instructionType: oneOf("system", "project"),
  },
});

export const useAgentSettingsStore = create<AgentSettingsStore>()((set) => {
  /** Apply an explicit choice to this page, then persist exactly that field. */
  const choose = (patch: Partial<AgentSettings>) => {
    set(patch);
    storage.save(patch);
  };
  return {
    ...storage.readAll(),
    setSelectedAgent: (selectedAgent) => choose({ selectedAgent }),
    setInstructionType: (instructionType) => choose({ instructionType }),
  };
});

/** Re-read the current keys. Never applies a delayed event's stale newValue. */
function refresh() {
  const patch = storage.changes(useAgentSettingsStore.getState());
  if (Object.keys(patch).length) useAgentSettingsStore.setState(patch);
}

const sync = createStorageSync(refresh, storage.owns);

/** Adopt another page's Agent and instruction-scope choices as they are saved. */
export const startAgentSettingsSync = sync.start;

import.meta.hot?.dispose(() => sync.detach());

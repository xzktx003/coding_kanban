import { useEffect } from "react";
import { create } from "zustand";
import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { useCCStore } from "./cc/ccStore";
import { useAcpStore } from "./useAcpStore";
import { useAgentSettingsStore } from "./useAgentSettingsStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import {
  appendDraft,
  fileLinks,
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "./useSessionDraftStore";

export function activeDraftOwner() {
  const acp = useAcpStore.getState();
  const cwd = useWorkspaceStore.getState().cwd;
  if (acp.active)
    return sessionDraftKey("acp", acp.sessionId, cwd, acp.agentId);
  const kind = useAgentSettingsStore.getState().selectedAgent;
  return sessionDraftKey(
    kind,
    kind === "cc"
      ? useCCStore.getState().activeSessionId
      : useCodexStore.getState().currentThreadId,
    cwd,
  );
}
/** File/skill/todo actions target the active session. Async sends use captured owners. */
interface InputFacadeState {
  inputValue: string;
  setInputValue: (value: string) => void;
  appendInputValue: (value: string) => void;
  appendFileLinks: (paths: string[]) => void;
  clearInputValue: () => void;
}
const facade = create<InputFacadeState>(() => ({
  inputValue: "",
  setInputValue: (value) => {
    useSessionDraftStore.getState().setText(activeDraftOwner(), value);
    sync();
  },
  appendInputValue: (value) => {
    appendDraft(activeDraftOwner(), value);
    sync();
  },
  appendFileLinks: (paths) => {
    if (paths.length)
      appendDraft(
        activeDraftOwner(),
        fileLinks(paths, useWorkspaceStore.getState().cwd),
      );
  },
  clearInputValue: () => {
    useSessionDraftStore.getState().setText(activeDraftOwner(), "");
    sync();
  },
}));
function useFacade(): InputFacadeState;
function useFacade<T>(selector: (state: InputFacadeState) => T): T;
function useFacade<T = InputFacadeState>(
  selector?: (state: InputFacadeState) => T,
) {
  useEffect(() => startInputFacadeSync(), []);
  return facade(selector ?? ((state) => state as T));
}
export const useInputStore = Object.assign(useFacade, facade);

const sync = () => {
  const inputValue = readDraft(activeDraftOwner()).text;
  if (useInputStore.getState().inputValue !== inputValue)
    useInputStore.setState({ inputValue });
};
let consumers = 0;
let stops: Array<() => void> = [];
/** Bind only after module initialization; multiple consumers share subscriptions. */
export function startInputFacadeSync() {
  if (consumers++ === 0) {
    sync();
    stops = [
      useCodexStore,
      useCCStore,
      useAcpStore,
      useAgentSettingsStore,
      useWorkspaceStore,
      useSessionDraftStore,
    ].map((store) => store.subscribe(sync));
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (--consumers === 0) {
      stops.forEach((stop) => stop());
      stops = [];
    }
  };
}

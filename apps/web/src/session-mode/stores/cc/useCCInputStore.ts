import { useEffect } from "react";
import { create } from "zustand";
import { useCCStore } from "./ccStore";
import { useWorkspaceStore } from "../useWorkspaceStore";
import {
  appendDraft,
  fileLinks,
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "../useSessionDraftStore";

export const ccDraftOwner = () =>
  sessionDraftKey(
    "cc",
    useCCStore.getState().activeSessionId,
    useWorkspaceStore.getState().cwd,
  );
/** Compatibility facade for file/skill actions; composers capture an explicit owner. */
interface InputFacadeState {
  inputValue: string;
  setInputValue: (value: string) => void;
  appendInputValue: (value: string) => void;
  appendFileLinks: (paths: string[], cwd?: string) => void;
  clearInputValue: () => void;
}
const facade = create<InputFacadeState>(() => ({
  inputValue: "",
  setInputValue: (value) => {
    useSessionDraftStore.getState().setText(ccDraftOwner(), value);
    sync();
  },
  appendInputValue: (value) => {
    appendDraft(ccDraftOwner(), value);
    sync();
  },
  appendFileLinks: (paths, cwd) => {
    if (paths.length)
      appendDraft(
        ccDraftOwner(),
        fileLinks(paths, cwd ?? useWorkspaceStore.getState().cwd),
      );
  },
  clearInputValue: () => {
    useSessionDraftStore.getState().setText(ccDraftOwner(), "");
    sync();
  },
}));
function useFacade(): InputFacadeState;
function useFacade<T>(selector: (state: InputFacadeState) => T): T;
function useFacade<T = InputFacadeState>(
  selector?: (state: InputFacadeState) => T,
) {
  useEffect(() => startCCInputFacadeSync(), []);
  return facade(selector ?? ((state) => state as T));
}
export const useCCInputStore = Object.assign(useFacade, facade);

const sync = () => {
  const inputValue = readDraft(ccDraftOwner()).text;
  if (useCCInputStore.getState().inputValue !== inputValue)
    useCCInputStore.setState({ inputValue });
};
let consumers = 0;
let stops: Array<() => void> = [];
/** Bind only after module initialization; multiple consumers share subscriptions. */
export function startCCInputFacadeSync() {
  if (consumers++ === 0) {
    sync();
    stops = [useCCStore, useWorkspaceStore, useSessionDraftStore].map((store) =>
      store.subscribe(sync),
    );
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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CCSettingsState {
  enabledThinking: boolean;
  toggleThinking: () => void;
  showPermissionCards: boolean;
  toggleShowPermissionCards: () => void;
  /**
   * `claudeCode.useCtrlEnterToSend`. When on, only Ctrl/Cmd+Enter submits and
   * a bare Enter inserts a newline.
   */
  useCtrlEnterToSend: boolean;
  toggleUseCtrlEnterToSend: () => void;
  /** `claudeCode.showMessageTimestamps`, default on as in the extension. */
  showMessageTimestamps: boolean;
  toggleShowMessageTimestamps: () => void;
}

export const useCCSettingsStore = create<CCSettingsState>()(
  persist(
    (set) => ({
      enabledThinking: false,
      toggleThinking: () => set((state) => ({ enabledThinking: !state.enabledThinking })),
      showPermissionCards: false,
      toggleShowPermissionCards: () =>
        set((state) => ({ showPermissionCards: !state.showPermissionCards })),
      useCtrlEnterToSend: false,
      toggleUseCtrlEnterToSend: () =>
        set((state) => ({ useCtrlEnterToSend: !state.useCtrlEnterToSend })),
      showMessageTimestamps: true,
      toggleShowMessageTimestamps: () =>
        set((state) => ({
          showMessageTimestamps: !state.showMessageTimestamps,
        })),
    }),
    {
      name: 'kanban.session.cc-settings',
    }
  )
);

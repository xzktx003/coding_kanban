import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OAuthProvider = 'github' | 'google' | 'apple';

interface AuthState {
  lastOAuthProvider: OAuthProvider | null;
  setLastOAuthProvider: (provider: OAuthProvider) => void;
  clearLastOAuthProvider: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      lastOAuthProvider: null,
      setLastOAuthProvider: (provider: OAuthProvider) => set({ lastOAuthProvider: provider }),
      clearLastOAuthProvider: () => set({ lastOAuthProvider: null }),
    }),
    {
      name: 'kanban.session.auth-store',
      version: 2,
      partialize: (state) => ({
        lastOAuthProvider: state.lastOAuthProvider,
      }),
    }
  )
);

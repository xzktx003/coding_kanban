import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppLocale } from '@session/locales';

interface LocaleState {
  locale: AppLocale | 'auto';
  setLocale: (locale: AppLocale | 'auto') => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'zh',
      setLocale: (locale: AppLocale | 'auto') => set({ locale }),
    }),
    {
      name: 'kanban.session.locale-storage',
    }
  )
);

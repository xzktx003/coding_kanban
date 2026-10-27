import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { type AppLocale, localeLabels, localeResources } from '@session/locales';
import { useLocaleStore } from '@session/stores/settings/useLocaleStore';

const fallbackLocale: AppLocale = 'en';
let initialization: Promise<unknown> | undefined;
let stopLocaleSync: (() => void) | undefined;

// Helper to detect locale from navigator
const detectLocale = (): AppLocale => {
  if (typeof navigator === 'undefined') {
    return fallbackLocale;
  }
  const lang = navigator.language.slice(0, 2).toLowerCase();
  // Check if the detected language is supported
  if (['en', 'zh', 'ja'].includes(lang as AppLocale)) {
    return lang as AppLocale;
  }
  return fallbackLocale;
};

const getInitialLocale = (): AppLocale | 'auto' => {
  const stored = useLocaleStore.getState().locale;
  return stored;
};

/** Initialize locale state only when the session application is actually mounted. */
export function initializeSessionI18n() {
  if (!i18n.isInitialized && !initialization) {
    const initialLocaleValue = getInitialLocale();
    const initialLocale =
      initialLocaleValue === 'auto' ? detectLocale() : initialLocaleValue;
    initialization = i18n.use(initReactI18next).init({
      resources: localeResources,
      lng: initialLocale,
      fallbackLng: fallbackLocale,
      interpolation: {
        escapeValue: false,
      },
    });
  }

  // Keep the active i18next language in sync with the persisted locale store.
  stopLocaleSync ??= useLocaleStore.subscribe((state) => {
    const newLocale =
      state.locale === 'auto' ? detectLocale() : state.locale;
    if (i18n.language !== newLocale) void i18n.changeLanguage(newLocale);
  });
  return initialization ?? Promise.resolve();
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopLocaleSync?.();
    stopLocaleSync = undefined;
    initialization = undefined;
  });

export { i18n };

export const supportedLocales = (Object.keys(localeResources) as AppLocale[]).map((code) => ({
  code,
  label: localeLabels[code],
}));

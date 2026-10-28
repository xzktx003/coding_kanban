import { useMemo, useState } from "react";
import { en } from "./en";
import { zh, type TranslationKey } from "./zh";

export type Locale = "zh" | "en";

const dictionaries = { zh, en } as const;

export type Translator = (key: TranslationKey, vars?: Record<string, string>) => string;

// Minimal, dependency-free i18n with a tiny interpolation helper.
export function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string>): string {
  const dict = dictionaries[locale] ?? zh;
  let text: string = dict[key] ?? zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, v);
    }
  }
  return text;
}

export function useI18n(locale: Locale): { t: Translator; locale: Locale } {
  const t = useMemo<Translator>(
    () => (key, vars) => translate(locale, key, vars),
    [locale],
  );
  return { t, locale };
}

// Locale is deliberately kept simple for v1; a full locale store can replace this.
const [currentLocale, setCurrentLocale] = useState<Locale>("zh");
export function getLocale(): Locale {
  return currentLocale;
}
export function setLocale(next: Locale): void {
  setCurrentLocale(next);
}

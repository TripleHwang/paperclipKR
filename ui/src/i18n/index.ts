import i18n, { type InitOptions, type TOptions } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation } from "react-i18next";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  i18nextResources,
  resolveSupportedLocale,
  supportedLocales,
} from "./locales";

function initialLocale() {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const storedLocale = resolveSupportedLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    if (storedLocale) return storedLocale;
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
  const browserLocales = window.navigator.languages?.length
    ? window.navigator.languages
    : [window.navigator.language];
  for (const locale of browserLocales) {
    const supportedLocale = resolveSupportedLocale(locale);
    if (supportedLocale) return supportedLocale;
  }
  return DEFAULT_LOCALE;
}

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

void i18n.use(initReactI18next).init(i18nextOptions).catch((error: unknown) => {
  console.error("Failed to initialize i18next", error);
});

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.language;
  i18n.on("languageChanged", (locale) => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  });
}

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export const useTranslation = useReactI18nextTranslation;
export { i18n };

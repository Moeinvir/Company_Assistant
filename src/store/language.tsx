import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { startDomTranslation, stopDomTranslation } from "@/i18n/dom";
import { translateFa } from "@/i18n/engine";
import { LEGACY_EN } from "@/i18n/legacyEn";

export type Language = "en" | "fa";

const LANGUAGE_KEY = "pyre.language";

interface LanguageContextValue {
  language: Language;
  isPersian: boolean;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  /** Translates a complete UI string. Unknown strings are returned unchanged. */
  translate: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  try {
    // Persian is the default; an explicit earlier choice of English is respected.
    return window.localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "fa";
  } catch {
    return "fa";
  }
}

/**
 * English is the source language of the interface. In Persian mode the whole
 * rendered UI is translated from the dictionary in `@/i18n` (see
 * `@/i18n/glossary.ts` for which terms deliberately stay in English).
 * `translate()` stays available for strings built in code.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "fa" ? "rtl" : "ltr";
    try {
      window.localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // The selected language still applies for this session if storage is unavailable.
    }
    if (language === "fa") startDomTranslation();
    else stopDomTranslation();
    return () => stopDomTranslation();
  }, [language]);

  const translate = useCallback(
    (text: string) => (language === "fa" ? translateFa(text) : (LEGACY_EN.get(text) ?? text)),
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      isPersian: language === "fa",
      setLanguage,
      toggleLanguage: () => setLanguage((current) => (current === "en" ? "fa" : "en")),
      translate,
    }),
    [language, translate],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { language, toggleLanguage } = useLanguage();
  const targetLanguage = language === "en" ? "Persian" : "English";
  return (
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={`Switch language to ${targetLanguage}`}
      title={`Switch language to ${targetLanguage}`}
      className={`inline-flex h-8 min-w-10 items-center justify-center rounded-lg border border-hairline bg-black/20 px-2 text-[11px] font-semibold tracking-wide text-ink-soft transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-ink ${className}`}
    >
      {language === "en" ? "فا" : "EN"}
    </button>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_FIRE_SETTINGS,
  FIRE_THEME_MAP,
  resolveSettings,
  themeToCssVars,
  type FireSettings,
  type FireTheme,
  type FireThemeId,
} from "./fireThemes";
import { useCoarsePointer, useMediaQuery, useReducedMotion } from "@/lib/hooks";

const SETTINGS_KEY = "pyre.fire.settings.v1";
const VARS_KEY = "pyre.fire.vars.v1";

export type QualityTier = "high" | "balanced" | "low";

interface FireThemeContextValue {
  /** User-controlled settings. */
  settings: FireSettings;
  /** Settings after per-theme tuning is applied — what the renderers use. */
  effective: FireSettings;
  theme: FireTheme;
  setTheme: (id: FireThemeId) => void;
  update: (patch: Partial<FireSettings>) => void;
  reset: () => void;
  /** Rendering budget, derived from device capability. */
  tier: QualityTier;
  reducedMotion: boolean;
  /** True when the heavy layers should be dropped (mobile / reduced motion). */
  liteMode: boolean;
}

const FireThemeContext = createContext<FireThemeContextValue | null>(null);

function readStoredSettings(): FireSettings {
  if (typeof window === "undefined") return DEFAULT_FIRE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_FIRE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<FireSettings>;
    const themeId =
      parsed.themeId && parsed.themeId in FIRE_THEME_MAP
        ? parsed.themeId
        : DEFAULT_FIRE_SETTINGS.themeId;
    return { ...DEFAULT_FIRE_SETTINGS, ...parsed, themeId };
  } catch {
    return DEFAULT_FIRE_SETTINGS;
  }
}

function detectTier(coarse: boolean): QualityTier {
  if (typeof navigator === "undefined") return "balanced";
  if (coarse) return "low";
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  if (saveData || cores <= 3 || memory <= 3) return "low";
  if (cores >= 8 && memory >= 8) return "high";
  return "balanced";
}

export function FireThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<FireSettings>(readStoredSettings);
  const reducedMotion = useReducedMotion();
  const coarse = useCoarsePointer();
  const narrow = useMediaQuery("(max-width: 767px)");
  const [tier, setTier] = useState<QualityTier>(() => detectTier(coarse));

  // Device capability can change (e.g. resizing a browser with touch), so the
  // budget is re-evaluated rather than captured once.
  useEffect(() => {
    setTier(detectTier(coarse));
  }, [coarse, narrow]);

  const effective = useMemo(() => resolveSettings(settings), [settings]);
  const theme = FIRE_THEME_MAP[effective.themeId];

  // Publish theme + light settings to the document for the design system.
  useEffect(() => {
    const vars = themeToCssVars(effective, theme);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
    root.dataset.fireTheme = theme.id;
    try {
      // Cached so the boot script can paint the right theme before React runs.
      window.localStorage.setItem(VARS_KEY, JSON.stringify(vars));
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable — preferences simply do not persist */
    }
  }, [effective, theme, settings]);

  const update = useCallback((patch: Partial<FireSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const setTheme = useCallback((id: FireThemeId) => update({ themeId: id }), [update]);

  const reset = useCallback(() => setSettings(DEFAULT_FIRE_SETTINGS), []);

  const value = useMemo<FireThemeContextValue>(
    () => ({
      settings,
      effective,
      theme,
      setTheme,
      update,
      reset,
      tier,
      reducedMotion,
      liteMode: reducedMotion || coarse || narrow || tier === "low",
    }),
    [settings, effective, theme, setTheme, update, reset, tier, reducedMotion, coarse, narrow],
  );

  return <FireThemeContext.Provider value={value}>{children}</FireThemeContext.Provider>;
}

export function useFireTheme() {
  const context = useContext(FireThemeContext);
  if (!context) throw new Error("useFireTheme must be used inside <FireThemeProvider>");
  return context;
}

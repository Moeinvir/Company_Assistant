/**
 * Centralized atmosphere and interface-accent configuration.
 *
 * Components read interface accent variables published by `themeToCssVars()`;
 * the cinematic background keeps its restrained neutral particle palette.
 */

export type FireThemeId =
  | "ember-orange"
  | "crimson"
  | "magma"
  | "blue-flame"
  | "purple-flame"
  | "toxic-green"
  | "white-heat";

export interface FireHsl {
  h: number;
  s: number;
  l: number;
}

export interface FireTheme {
  id: FireThemeId;
  name: string;
  blurb: string;
  /** Temperature of the UI accent layer. */
  accent: FireHsl;
  /** Text color that sits on top of a solid accent fill. */
  onAccent: string;
  /** Particle palette: hottest core → deepest tail. */
  particles: { hot: FireHsl; mid: FireHsl; cool: FireHsl };
  /** Photographic bed treatment, applied as a CSS filter. */
  bedFilter: { hueRotate: number; saturate: number; brightness: number; contrast: number };
  /** Preview swatch for the theme picker (three-stop gradient). */
  swatch: [string, string, string];
  /** Per-theme tuning applied when the user has not overridden a value. */
  tuning?: Partial<Pick<FireSettings, "intensity" | "glow" | "density" | "speed" | "bed">>;
}

export interface FireSettings {
  themeId: FireThemeId;
  /** Particle visibility. */
  intensity: number;
  /** Soft glow on the atmospheric particle layer. */
  glow: number;
  /** Particle count and visibility multiplier. */
  density: number;
  /** Ambient particle movement speed multiplier. */
  speed: number;
  /** Visibility of the particle glow layer. */
  bed: number;
  /** Particles drift away from the cursor. */
  reactive: boolean;
}

export const hsl = ({ h, s, l }: FireHsl, alpha?: number) =>
  alpha === undefined ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${alpha})`;

const FIRE_THEME_LIST: FireTheme[] = [
  {
    id: "ember-orange",
    name: "Ember Orange",
    blurb: "The house default — forge-lit amber on charcoal.",
    accent: { h: 26, s: 94, l: 58 },
    onAccent: "#100a06",
    particles: {
      hot: { h: 46, s: 100, l: 80 },
      mid: { h: 24, s: 96, l: 56 },
      cool: { h: 14, s: 100, l: 40 },
    },
    bedFilter: { hueRotate: 0, saturate: 108, brightness: 102, contrast: 102 },
    swatch: ["#ffd479", "#ff7a18", "#8c2c05"],
  },
  {
    id: "crimson",
    name: "Crimson",
    blurb: "Blood-orange heat, for teams that mean business.",
    accent: { h: 355, s: 88, l: 60 },
    onAccent: "#ffffff",
    particles: {
      hot: { h: 22, s: 100, l: 78 },
      mid: { h: 355, s: 94, l: 56 },
      cool: { h: 344, s: 100, l: 38 },
    },
    bedFilter: { hueRotate: -26, saturate: 132, brightness: 94, contrast: 106 },
    swatch: ["#ff9b6a", "#ef2b2b", "#7a0616"],
  },
  {
    id: "magma",
    name: "Magma",
    blurb: "Molten pressure — deep red bleeding into violet.",
    accent: { h: 336, s: 84, l: 60 },
    onAccent: "#ffffff",
    particles: {
      hot: { h: 30, s: 100, l: 78 },
      mid: { h: 350, s: 100, l: 52 },
      cool: { h: 316, s: 88, l: 40 },
    },
    bedFilter: { hueRotate: -70, saturate: 142, brightness: 96, contrast: 108 },
    swatch: ["#ffc36b", "#e0234e", "#5d1250"],
  },
  {
    id: "blue-flame",
    name: "Blue Flame",
    blurb: "Laboratory cold burn. Highest contrast on dark.",
    accent: { h: 205, s: 90, l: 60 },
    onAccent: "#04121c",
    particles: {
      hot: { h: 190, s: 100, l: 82 },
      mid: { h: 206, s: 100, l: 58 },
      cool: { h: 226, s: 100, l: 46 },
    },
    bedFilter: { hueRotate: 186, saturate: 128, brightness: 88, contrast: 106 },
    swatch: ["#a8f4ff", "#1d8dff", "#0d2f9e"],
    tuning: { intensity: 0.72, glow: 0.5 },
  },
  {
    id: "purple-flame",
    name: "Purple Flame",
    blurb: "Argon-lit violet with a magenta heart.",
    accent: { h: 274, s: 86, l: 66 },
    onAccent: "#12061c",
    particles: {
      hot: { h: 288, s: 100, l: 84 },
      mid: { h: 273, s: 95, l: 62 },
      cool: { h: 256, s: 100, l: 48 },
    },
    bedFilter: { hueRotate: 250, saturate: 122, brightness: 90, contrast: 104 },
    swatch: ["#e9c2ff", "#a855f7", "#3b1d8f"],
    tuning: { intensity: 0.74 },
  },
  {
    id: "toxic-green",
    name: "Toxic Green",
    blurb: "Cold reagent green. Reads as monitoring and telemetry.",
    accent: { h: 138, s: 72, l: 55 },
    onAccent: "#03140a",
    particles: {
      hot: { h: 88, s: 100, l: 80 },
      mid: { h: 106, s: 92, l: 56 },
      cool: { h: 142, s: 100, l: 38 },
    },
    bedFilter: { hueRotate: 86, saturate: 118, brightness: 88, contrast: 104 },
    swatch: ["#f2ff96", "#4ade80", "#0b6b33"],
    tuning: { intensity: 0.7, glow: 0.5 },
  },
  {
    id: "white-heat",
    name: "White Heat",
    blurb: "Overdriven forge. Bright and neutral, minimal chroma.",
    accent: { h: 40, s: 88, l: 76 },
    onAccent: "#1a1206",
    particles: {
      hot: { h: 45, s: 100, l: 96 },
      mid: { h: 40, s: 62, l: 82 },
      cool: { h: 30, s: 48, l: 62 },
    },
    bedFilter: { hueRotate: 0, saturate: 16, brightness: 146, contrast: 98 },
    swatch: ["#ffffff", "#ffe7b8", "#a08a6b"],
    tuning: { intensity: 0.68, density: 0.62, glow: 0.72 },
  },
];

export const FIRE_THEMES = FIRE_THEME_LIST;

export const FIRE_THEME_MAP: Record<FireThemeId, FireTheme> = FIRE_THEME_LIST.reduce(
  (acc, theme) => {
    acc[theme.id] = theme;
    return acc;
  },
  {} as Record<FireThemeId, FireTheme>,
);

export const DEFAULT_FIRE_SETTINGS: FireSettings = {
  themeId: "ember-orange",
  intensity: 0.76,
  glow: 0.56,
  density: 0.95,
  speed: 1,
  bed: 0.86,
  reactive: true,
};

export interface FireSliderSpec {
  key: "intensity" | "glow" | "density" | "speed" | "bed";
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

/** Single source of truth for the atmospheric customization controls. */
export const FIRE_SLIDERS: FireSliderSpec[] = [
  {
    key: "intensity",
    label: "Intensity",
    hint: "Overall visibility of the atmospheric particle field.",
    min: 0.2,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "glow",
    label: "Glow",
    hint: "Soft haze and glow around a small number of particles.",
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "density",
    label: "Particle density",
    hint: "Density of suspended dust and ash particles.",
    min: 0.15,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "speed",
    label: "Speed",
    hint: "Ambient drift speed of the particle field.",
    min: 0.35,
    max: 1.9,
    step: 0.01,
    format: (v) => `${v.toFixed(2)}×`,
  },
  {
    key: "bed",
    label: "Particle glow",
    hint: "Visibility of the faint glow around selected particles.",
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
];

/** Resolve the effective settings for a theme, honoring user overrides. */
export function resolveSettings(settings: FireSettings): FireSettings {
  const theme = FIRE_THEME_MAP[settings.themeId] ?? FIRE_THEME_MAP["ember-orange"];
  return { ...settings, ...(theme.tuning ?? {}), themeId: theme.id };
}

/**
 * Publish the active theme to the document as CSS custom properties. UI accents
 * derive from these, so switching themes re-tints the whole product.
 */
export function themeToCssVars(settings: FireSettings, theme: FireTheme): Record<string, string> {
  const { h, s, l } = theme.accent;
  const strong = { h, s: Math.min(s + 4, 100), l: Math.min(l + 9, 92) };
  const depth = Math.max(l - 10, 34);

  return {
    "--fire-h": String(h),
    "--fire-s": `${s}%`,
    "--accent": hsl({ h, s, l }),
    "--accent-strong": hsl(strong),
    "--accent-muted": hsl({ h, s: Math.min(s, 70), l }, 0.16),
    "--accent-glow": hsl({ h, s: 92, l: depth }, 0.42),
    "--accent-ring": hsl({ h, s, l }, 0.55),
    "--accent-contrast": theme.onAccent,
    "--fire-intensity": String(settings.intensity),
    "--fire-glow": String(settings.glow),
    "--fire-density": String(settings.density),
    "--fire-speed": String(settings.speed),
  };
}

export function bedFilterCss(theme: FireTheme, intensity: number) {
  const f = theme.bedFilter;
  // The bed is atmosphere, not content: it is dimmed well below the vendor's
  // own brightness so interface text always keeps its contrast.
  return [
    `hue-rotate(${f.hueRotate}deg)`,
    `saturate(${Math.round(f.saturate * 0.88)}%)`,
    `brightness(${Math.round(f.brightness * (0.56 + intensity * 0.26))}%)`,
    `contrast(${f.contrast}%)`,
  ].join(" ");
}

export function particleColors(theme: FireTheme) {
  return {
    hot: hsl(theme.particles.hot),
    mid: hsl(theme.particles.mid),
    cool: hsl(theme.particles.cool),
  };
}

import { getPointer, subscribePointer } from "./pointer";
import type { QualityTier } from "./FireThemeProvider";
import { hsl, type FireHsl } from "./fireThemes";

/**
 * Magnetic Fire Ember Particle System
 *
 * Hundreds of subtle round embers float in dark air with extremely gentle
 * ambient drift. The cursor carries an invisible repulsion field: embers are
 * pushed away with a smooth `(1 - d/r)^2` falloff, then settle back toward
 * their stable home positions through spring physics + damping. Fast cursor
 * movement leaves a temporary wake of scattering embers.
 *
 * Physics and rendering are strictly separated: `update()` integrates forces,
 * `draw()` only paints current state. Nothing here sets a position directly
 * from the pointer.
 */

type EmberColor = 0 | 1 | 2 | 3 | 4;

/** A single ember. Homes are stable until the next resize/rebuild. */
interface Ember {
  /** Current position (px). */
  x: number;
  y: number;
  /** Rest position — the ember always springs back here. */
  homeX: number;
  homeY: number;
  /** Velocity (px/s), integrated from repulsion + spring forces. */
  vx: number;
  vy: number;
  /** Soft core radius (px). */
  size: number;
  /** Base visibility 0..1 — most embers stay subtle. */
  alpha: number;
  /** Pseudo-depth for size/brightness/parallax variation. */
  depth: number;
  /** Palette slot: deep red → dark orange → orange → amber → warm yellow. */
  color: EmberColor;
  /** True for the rare, strongly visible ember. */
  bright: boolean;
  /** True when the ember earns an extra glow halo. */
  halo: boolean;
  /** Ambient noise phase. */
  phase: number;
  phaseSpeed: number;
  /** Ambient drift amplitude (px) around home. */
  driftX: number;
  driftY: number;
  /** Spring stiffness back toward home (1/s²). */
  spring: number;
  /** Velocity damping coefficient (1/s). */
  friction: number;
}

/** Tiny bright spark with a short movement trail. */
interface Spark {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  age: number;
  lifetime: number;
  color: 3 | 4;
}

export interface FirePalette {
  hot: FireHsl;
  mid: FireHsl;
  cool: FireHsl;
}

export interface FieldSettings {
  intensity: number;
  glow: number;
  density: number;
  speed: number;
  bed: number;
  reactive: boolean;
}

export interface ParticleFieldOptions {
  canvas: HTMLCanvasElement;
  tier: QualityTier;
  reducedMotion: boolean;
  /** Read once per frame — never holds stale React state. */
  readSettings: () => FieldSettings;
  /** Live theme particle palette (hot / mid / cool). */
  readPalette: () => FirePalette;
}

/** Hard particle ceilings per device tier. */
const BUDGET: Record<QualityTier, number> = {
  high: 900,
  balanced: 780,
  low: 600,
};

/** Viewport pixels per ember at full density (1440×900 ≈ 850 embers). */
const AREA_PER_EMBER = 1500;
const SPARK_POOL = 18;
const TAU = Math.PI * 2;

/** Repulsion tuning (px/s² at point-blank range, before falloff). */
const REPULSION = 2750;
const BASE_RADIUS = 230;

/** Per-tier interaction: desktop full, tablet weaker, mobile effectively off. */
const INTERACTION: Record<QualityTier, number> = {
  high: 1,
  balanced: 0.72,
  low: 0.5,
};

function randomGaussian() {
  const u = Math.max(Math.random(), 0.0001);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random());
}

function lerpHsl(a: FireHsl, b: FireHsl, t: number): FireHsl {
  return {
    h: a.h + (b.h - a.h) * t,
    s: a.s + (b.s - a.s) * t,
    l: a.l + (b.l - a.l) * t,
  };
}

/**
 * Five ember stops interpolated through the theme's particle palette:
 * deep red → dark orange → orange → amber → warm yellow.
 */
function buildPalette(palette: FirePalette): FireHsl[] {
  const { hot, mid, cool } = palette;
  return [
    { h: cool.h, s: cool.s, l: Math.max(20, cool.l - 15) },
    { h: cool.h, s: cool.s, l: cool.l },
    { h: mid.h, s: mid.s, l: mid.l },
    lerpHsl(mid, hot, 0.55),
    { h: hot.h, s: hot.s, l: hot.l },
  ];
}

/**
 * Soft round glow sprite: hot core falling off to transparent edge. Drawn
 * scaled down this reads as a slightly blurred ember; drawn large it becomes
 * the halo of a rare bright ember. No per-frame gradients, no shadowBlur.
 */
function makeEmberSprite(color: FireHsl): HTMLCanvasElement {
  const size = 64;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const context = sprite.getContext("2d");
  if (!context) return sprite;
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, hsl(color, 1));
  gradient.addColorStop(0.14, hsl(color, 0.92));
  gradient.addColorStop(0.3, hsl(color, 0.5));
  gradient.addColorStop(0.55, hsl(color, 0.14));
  gradient.addColorStop(0.8, hsl(color, 0.03));
  gradient.addColorStop(1, hsl(color, 0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return sprite;
}

export class ParticleField {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly options: ParticleFieldOptions;
  private readonly unsubscribePointer: () => void;

  private embers: Ember[] = [];
  private sparks: Spark[] = [];

  private paletteHsl: FireHsl[] = [];
  private paletteKey = "";
  private sprites: HTMLCanvasElement[] = [];

  private width = 1;
  private height = 1;
  private dpr = 1;

  private interactionRadius = BASE_RADIUS;
  private interactionScale = 1;

  private frameId = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private nextSparkAt = 0.6;
  private destroyed = false;
  private resizeObserver: ResizeObserver;

  private readonly handleResize = () => this.resize();
  private readonly handleVisibility = () => {
    if (document.hidden) {
      if (this.frameId) cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    } else if (!this.options.reducedMotion) {
      this.scheduleFrame();
    } else {
      this.draw();
    }
  };

  constructor(options: ParticleFieldOptions) {
    this.options = options;
    this.canvas = options.canvas;
    const context = this.canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
    this.context = context;
    // Keeps the shared pointer tracker alive while the field exists; the field
    // itself polls `getPointer()` once per frame instead of reacting per event.
    this.unsubscribePointer = subscribePointer(() => {});
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.canvas);
    window.addEventListener("resize", this.handleResize, { passive: true });
    window.addEventListener("orientationchange", this.handleResize, { passive: true });
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.resize();
  }

  start() {
    this.ensurePalette();
    this.draw();
    if (!this.options.reducedMotion) this.scheduleFrame();
  }

  destroy() {
    this.destroyed = true;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("orientationchange", this.handleResize);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.unsubscribePointer();
    this.embers.length = 0;
    this.sparks.length = 0;
    this.sprites = [];
  }

  /* ------------------------------------------------------------------ sizing */

  private desiredBudget(settings: FieldSettings) {
    const areaCount = (this.width * this.height) / AREA_PER_EMBER;
    const tierScale =
      this.options.tier === "high" ? 1.15 : this.options.tier === "balanced" ? 1 : 0.85;
    const density = Math.min(1.25, Math.max(0.55, settings.density));
    return Math.min(
      BUDGET[this.options.tier],
      Math.max(150, Math.round(areaCount * tierScale * density)),
    );
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const previousWidth = this.width;
    const previousHeight = this.height;
    const firstRun = previousWidth <= 1 || this.embers.length === 0;

    this.width = Math.max(1, rect.width || window.innerWidth);
    this.height = Math.max(1, rect.height || window.innerHeight);

    // Cap DPR by both a hard limit and a total-pixel budget so 4K/high-DPI
    // displays never quadruple fill cost.
    const maxPixels = this.options.tier === "low" ? 900_000 : 1_800_000;
    this.dpr = Math.min(
      window.devicePixelRatio || 1,
      1.5,
      Math.sqrt(maxPixels / (this.width * this.height)),
    );
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.interactionScale = INTERACTION[this.options.tier];
    this.interactionRadius = BASE_RADIUS * (0.62 + this.interactionScale * 0.38);

    const settings = this.options.readSettings();
    const target = this.desiredBudget(settings);

    if (firstRun || Math.abs(target - this.embers.length) > Math.max(48, target * 0.16)) {
      this.embers = this.createEmbers(target);
      this.sparks = this.createSparks();
    } else {
      // Smooth remap: keep existing embers, scale homes into the new box so a
      // resize or fullscreen change never stretches or collapses the field.
      const sx = this.width / previousWidth;
      const sy = this.height / previousHeight;
      const clampX = (value: number) => Math.min(this.width - 2, Math.max(2, value * sx));
      const clampY = (value: number) => Math.min(this.height - 2, Math.max(2, value * sy));
      for (const ember of this.embers) {
        ember.homeX = clampX(ember.homeX);
        ember.homeY = clampY(ember.homeY);
        ember.x = clampX(ember.x);
        ember.y = clampY(ember.y);
      }
    }

    this.context.clearRect(0, 0, this.width, this.height);
    if (this.options.reducedMotion) this.draw();
  }

  /**
   * Dense, full-viewport distribution with three depth layers.
   *
   * ~60% of embers take a jittered position inside their own viewport cell,
   * which guarantees every region — top, bottom, edges, corners, center — is
   * populated and no large area reads empty. The rest scatter through loose
   * gaussian clusters and uniform noise for organic patchiness. Jitter keeps
   * it reading as random: no visible grid, rings, radial layouts or symmetry.
   */
  private createEmbers(count: number): Ember[] {
    const clusterCount = Math.max(6, Math.round(count / 150));
    const clusters = Array.from({ length: clusterCount }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      spreadX: this.width * (0.05 + Math.random() * 0.14),
      spreadY: this.height * (0.06 + Math.random() * 0.16),
    }));

    const cols = Math.max(1, Math.round(Math.sqrt((count * this.width) / this.height)));
    const rows = Math.max(1, Math.ceil(count / cols));

    return Array.from({ length: count }, (_, index): Ember => {
      const depth = Math.random();
      let rawX: number;
      let rawY: number;

      const placement = Math.random();
      if (placement < 0.6) {
        // Jittered strata: each index owns a cell, so coverage is even.
        const col = index % cols;
        const row = Math.floor(index / cols) % rows;
        rawX = ((col + Math.random()) * this.width) / cols;
        rawY = ((row + Math.random()) * this.height) / rows;
      } else if (placement < 0.85) {
        const cluster = clusters[Math.floor(Math.random() * clusters.length)];
        rawX = cluster.x + randomGaussian() * cluster.spreadX;
        rawY = cluster.y + randomGaussian() * cluster.spreadY;
      } else {
        rawX = Math.random() * this.width;
        rawY = Math.random() * this.height;
      }
      const x = Math.max(4, Math.min(this.width - 4, rawX));
      const y = Math.max(4, Math.min(this.height - 4, rawY));

      // Depth layers: many tiny/dim background motes (0), a solid middle of
      // main embers (1), and a thin foreground of larger, brighter pieces (2).
      const roll = Math.random();
      const layer: 0 | 1 | 2 = roll < 0.55 ? 0 : roll < 0.94 ? 1 : 2;
      const bright = roll > 0.985;
      const jitter = Math.random();
      const alpha =
        layer === 0
          ? 0.034 + jitter * 0.05
          : layer === 1
            ? 0.09 + jitter * 0.15
            : bright
              ? 0.52 + jitter * 0.33
              : 0.2 + jitter * 0.26;
      const size =
        layer === 0
          ? 0.5 + depth * 0.55 + Math.random() * 0.3
          : layer === 1
            ? 0.95 + depth * 0.9 + Math.random() * 0.35
            : 1.35 + depth * 1.05 + Math.random() * 0.5;

      // Deeper (dimmer) motes skew to the darkest fire stops; foreground
      // embers skew warm so brightness and hue both read as depth.
      const colorRoll = Math.random();
      const color: EmberColor = bright
        ? colorRoll > 0.5
          ? 4
          : colorRoll > 0.15
            ? 3
            : 2
        : layer === 0
          ? colorRoll > 0.82
            ? 2
            : colorRoll > 0.5
              ? 1
              : 0
          : layer === 1
            ? colorRoll > 0.92
              ? 3
              : colorRoll > 0.62
                ? 2
                : colorRoll > 0.3
                  ? 1
                  : 0
            : colorRoll > 0.35
              ? 4
              : colorRoll > 0.1
                ? 3
                : 2;

      // Foreground drifts slightly more, background barely moves — parallax.
      const layerDrift = layer === 0 ? 0.55 : layer === 2 ? 1.35 : 1;

      return {
        x,
        y,
        homeX: x,
        homeY: y,
        vx: 0,
        vy: 0,
        size,
        alpha: Math.min(0.9, alpha * (0.82 + color * 0.05)),
        depth,
        color,
        bright,
        halo:
          bright ||
          (layer === 2 && Math.random() < 0.55) ||
          (layer === 1 && Math.random() < 0.12),
        phase: Math.random() * TAU,
        phaseSpeed: (0.1 + Math.random() * 0.24) * (bright ? 0.6 : 1),
        driftX: (Math.random() * 2.4 + 1.4) * (0.6 + depth * 0.8) * layerDrift,
        driftY:
          (Math.random() * 2.8 + 1.6) * (0.6 + depth * 0.8) * layerDrift * (bright ? 1.7 : 1),
        spring: 10 + depth * 4,
        friction: 3.4 + depth * 1.5,
      };
    });
  }

  private createSparks(): Spark[] {
    return Array.from({ length: SPARK_POOL }, (): Spark => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 1,
      age: 0,
      lifetime: 1,
      color: Math.random() > 0.35 ? 4 : 3,
    }));
  }

  /* ----------------------------------------------------------------- palette */

  /** Rebuild sprites only when the theme's particle palette actually changes. */
  private ensurePalette() {
    const next = buildPalette(this.options.readPalette());
    const key = next.map((color) => hsl(color)).join("|");
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    this.paletteHsl = next;
    this.sprites = next.map(makeEmberSprite);
  }

  /* ------------------------------------------------------------------- frame */

  private scheduleFrame() {
    if (this.destroyed || this.frameId || document.hidden) return;
    this.lastFrame = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (time: number) => {
    this.frameId = 0;
    if (this.destroyed || document.hidden) return;
    const delta = Math.min((time - this.lastFrame) / 1000, 0.04);
    this.lastFrame = time;
    this.elapsed += delta;

    const settings = this.options.readSettings();
    this.ensurePalette();

    // Rebuild only when the density slider moves far enough to matter.
    const target = this.desiredBudget(settings);
    if (Math.abs(target - this.embers.length) > Math.max(48, target * 0.16)) {
      this.resize();
    } else {
      this.update(delta, settings);
    }
    this.draw();
    this.frameId = requestAnimationFrame(this.frame);
  };

  /* ----------------------------------------------------------------- physics */

  private update(delta: number, settings: FieldSettings) {
    const pointer = getPointer();
    const interactive =
      settings.reactive && pointer.active && this.interactionScale > 0;
    const radius = this.interactionRadius;
    const radiusSq = radius * radius;
    const speedBoost = 0.78 + Math.min(pointer.speed / 2600, 0.55);
    const repulsion = REPULSION * this.interactionScale * speedBoost;

    for (const ember of this.embers) {
      // 1. Ambient target: home + extremely subtle noise drift.
      ember.phase += ember.phaseSpeed * settings.speed * delta;
      const targetX = ember.homeX + Math.sin(ember.phase) * ember.driftX;
      const targetY =
        ember.homeY + Math.cos(ember.phase * 0.78 + 1.7) * ember.driftY;

      // 2. Spring force back toward the (drifting) home — soft, elastic return.
      ember.vx += (targetX - ember.x) * ember.spring * delta;
      ember.vy += (targetY - ember.y) * ember.spring * delta;

      // 3. Invisible magnetic repulsion: force grows with squared falloff as
      //    the cursor approaches. Position is never set from the pointer.
      if (interactive) {
        const dx = ember.x - pointer.x;
        const dy = ember.y - pointer.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < radiusSq && distSq > 1) {
          const distance = Math.sqrt(distSq);
          const falloff = 1 - distance / radius;
          const force = repulsion * falloff * falloff * (0.68 + ember.depth * 0.62);
          const nx = dx / distance;
          const ny = dy / distance;
          ember.vx += nx * force * delta;
          ember.vy += ny * force * delta;
        }
      }

      // 4. Friction / damping, then integrate velocity into position.
      const damping = Math.exp(-ember.friction * delta);
      ember.vx *= damping;
      ember.vy *= damping;
      const speedSq = ember.vx * ember.vx + ember.vy * ember.vy;
      const maxSpeed = 300 + ember.depth * 260;
      if (speedSq > maxSpeed * maxSpeed) {
        const speed = Math.sqrt(speedSq);
        ember.vx = (ember.vx / speed) * maxSpeed;
        ember.vy = (ember.vy / speed) * maxSpeed;
      }
      ember.x += ember.vx * delta;
      ember.y += ember.vy * delta;
    }

    this.updateSparks(delta, settings, interactive, radiusSq, repulsion);
  }

  private updateSparks(
    delta: number,
    settings: FieldSettings,
    interactive: boolean,
    radiusSq: number,
    repulsion: number,
  ) {
    // Occasional new spark somewhere across the viewport.
    this.nextSparkAt -= delta;
    if (this.nextSparkAt <= 0) {
      const spark = this.sparks.find((entry) => !entry.active);
      if (spark) {
        spark.active = true;
        spark.x = Math.random() * this.width;
        spark.y = Math.random() * this.height;
        spark.vx = (Math.random() - 0.5) * 14;
        spark.vy = -6 - Math.random() * 16;
        spark.size = 0.5 + Math.random() * 0.7;
        spark.age = 0;
        spark.lifetime = 1.4 + Math.random() * 2.4;
      }
      this.nextSparkAt = 0.22 + Math.random() * 0.55;
    }

    const pointer = getPointer();
    const radius = this.interactionRadius;

    for (const spark of this.sparks) {
      if (!spark.active) continue;
      spark.age += delta;
      if (spark.age >= spark.lifetime) {
        spark.active = false;
        continue;
      }

      // Sparks join the repulsion field — they make the wake feel alive.
      if (interactive) {
        const dx = spark.x - pointer.x;
        const dy = spark.y - pointer.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < radiusSq && distSq > 1) {
          const distance = Math.sqrt(distSq);
          const falloff = 1 - distance / radius;
          const force = repulsion * 1.35 * falloff * falloff;
          spark.vx += (dx / distance) * force * delta;
          spark.vy += (dy / distance) * force * delta;
        }
      }

      spark.vx *= Math.exp(-0.9 * delta);
      spark.vy = spark.vy * Math.exp(-0.55 * delta) - 7 * delta * settings.speed;
      spark.x += spark.vx * delta;
      spark.y += spark.vy * delta;
    }
  }

  /* --------------------------------------------------------------- rendering */

  private draw() {
    const context = this.context;
    const settings = this.options.readSettings();
    if (!this.paletteHsl.length || !this.sprites.length) this.ensurePalette();

    context.clearRect(0, 0, this.width, this.height);
    // Additive blending makes embers glow against near-black without filters.
    context.globalCompositeOperation = "lighter";

    const intensity = 0.5 + settings.intensity * 0.7;
    const haloStrength = 0.16 + settings.glow * settings.bed * 0.5;

    for (const ember of this.embers) {
      const sprite = this.sprites[ember.color];
      if (!sprite) continue;
      const pulse = ember.bright
        ? 0.78 + Math.sin(this.elapsed * 0.9 + ember.phase) * 0.22
        : 0.84 + Math.sin(ember.phase) * 0.16;
      const alpha = ember.alpha * pulse * intensity;
      if (alpha < 0.012) continue;

      const drawSize = ember.size * 7;
      if (ember.halo && haloStrength > 0.02) {
        const haloSize = drawSize * (ember.bright ? 6.5 : 3.6);
        context.globalAlpha = Math.min(0.6, alpha * haloStrength * (ember.bright ? 1.5 : 0.7));
        context.drawImage(sprite, ember.x - haloSize / 2, ember.y - haloSize / 2, haloSize, haloSize);
      }
      context.globalAlpha = Math.min(1, alpha);
      context.drawImage(sprite, ember.x - drawSize / 2, ember.y - drawSize / 2, drawSize, drawSize);
    }

    // Sparks: short bright trails, drawn as fading segments.
    for (const spark of this.sparks) {
      if (!spark.active) continue;
      const progress = spark.age / spark.lifetime;
      const fade = Math.min(1, progress * 6, (1 - progress) * 4);
      const color = this.paletteHsl[spark.color];
      if (!color) continue;
      const trailX = spark.x - spark.vx * 0.05;
      const trailY = spark.y - spark.vy * 0.05;
      context.globalAlpha = fade * 0.42 * intensity;
      context.strokeStyle = hsl(color, 1);
      context.lineWidth = spark.size;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(trailX, trailY);
      context.lineTo(spark.x, spark.y);
      context.stroke();
      context.globalAlpha = fade * 0.55 * intensity;
      context.drawImage(
        this.sprites[spark.color],
        spark.x - 5,
        spark.y - 5,
        10,
        10,
      );
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }
}

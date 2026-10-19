/**
 * One passive pointer tracker for the whole app.
 *
 * The particle field needs pointer position and velocity. Tracking it once
 * keeps global listeners (and layout reads) to a
 * minimum — listeners are attached lazily and detached when the last consumer
 * unsubscribes.
 */

export interface PointerState {
  /** Viewport coordinates. */
  x: number;
  y: number;
  /** Smoothed velocity in px/s. */
  vx: number;
  vy: number;
  speed: number;
  /** True while the primary button is held. */
  down: boolean;
  /** True when the pointer is over an interactive element. */
  overInteractive: boolean;
  /** False until the first real pointer sample arrives (touch/idle). */
  active: boolean;
  lastMoveAt: number;
}

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='switch']",
  "[data-interactive]",
].join(",");

const state: PointerState = {
  x: typeof window === "undefined" ? 0 : window.innerWidth / 2,
  y: typeof window === "undefined" ? 0 : window.innerHeight - 120,
  vx: 0,
  vy: 0,
  speed: 0,
  down: false,
  overInteractive: false,
  active: false,
  lastMoveAt: 0,
};

const subscribers = new Set<() => void>();
let attached = false;
let lastX = state.x;
let lastY = state.y;
let lastSample = 0;

function emit() {
  for (const cb of subscribers) cb();
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === "touch") return;

  const now = performance.now();
  const dt = Math.max((now - lastSample) / 1000, 0.001);
  const rawVx = (event.clientX - lastX) / dt;
  const rawVy = (event.clientY - lastY) / dt;

  // Exponential smoothing keeps velocities from spiking on single events.
  state.vx = state.vx * 0.72 + rawVx * 0.28;
  state.vy = state.vy * 0.72 + rawVy * 0.28;
  state.speed = Math.hypot(state.vx, state.vy);
  state.x = event.clientX;
  state.y = event.clientY;
  state.active = true;
  state.lastMoveAt = now;

  lastX = event.clientX;
  lastY = event.clientY;
  lastSample = now;
}

function onPointerOver(event: PointerEvent) {
  const target = event.target as Element | null;
  const next = Boolean(target?.closest?.(INTERACTIVE_SELECTOR));
  if (next !== state.overInteractive) {
    state.overInteractive = next;
  }
}

function onPointerDown() {
  state.down = true;
}
function onPointerUp() {
  state.down = false;
}
function onLeave() {
  state.active = false;
  state.speed = 0;
  state.vx = 0;
  state.vy = 0;
}

function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerover", onPointerOver, { passive: true, capture: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onPointerUp, { passive: true });
  document.addEventListener("pointerleave", onLeave);
  window.addEventListener("blur", onLeave);
}

function detach() {
  if (!attached) return;
  attached = false;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerover", onPointerOver, true);
  window.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  document.removeEventListener("pointerleave", onLeave);
  window.removeEventListener("blur", onLeave);
  onLeave();
}

/** Read the live pointer state without re-rendering. */
export function getPointer(): Readonly<PointerState> {
  return state;
}

/**
 * Subscribe to pointer updates. The callback fires on browser events, not every
 * frame, so consumers do their own per-frame smoothing.
 */
export function subscribePointer(callback: () => void) {
  subscribers.add(callback);
  attach();
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) detach();
  };
}

export { emit as notifyPointerSubscribers };

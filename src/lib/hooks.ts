import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
export const useCoarsePointer = () => useMediaQuery("(hover: none), (pointer: coarse)");
export const useFinePointer = () => useMediaQuery("(hover: hover) and (pointer: fine)");

/** A single shared rAF ticker. Subscribers run once per frame while mounted. */
type FrameListener = (delta: number, time: number) => void;
const listeners = new Set<FrameListener>();
let rafId = 0;
let lastTime = 0;
let running = false;

function loop(time: number) {
  const delta = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  rafId = requestAnimationFrame(loop);
  for (const listener of listeners) {
    try {
      listener(delta, time);
    } catch (error) {
      console.error("[parsis] animation listener failed", error);
    }
  }
}

function start() {
  if (running) return;
  running = true;
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function stop() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(rafId);
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

function onVisibilityChange() {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    running = false;
  } else if (listeners.size > 0) {
    start();
  }
}

export function useAnimationFrame(listener: FrameListener, enabled = true) {
  const ref = useRef(listener);
  ref.current = listener;

  useEffect(() => {
    if (!enabled) return;
    const fn: FrameListener = (delta, time) => ref.current(delta, time);
    listeners.add(fn);
    start();
    return () => {
      // Pause the whole ticker when the tab is hidden; rAF resumes on return.
      if (document.hidden === false) {
        listeners.delete(fn);
        if (listeners.size === 0) stop();
      } else {
        listeners.delete(fn);
      }
    };
  }, [enabled]);
}

/** Runs before paint so measurement-driven layout does not flash. */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useOnClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: () => void,
  enabled = true,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (!el || el.contains(event.target as Node)) return;
      handlerRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handlerRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, enabled]);
}

export function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function useCopyToClipboard(resetAfter = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), resetAfter);
      return true;
    },
    [resetAfter],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { copied, copy };
}

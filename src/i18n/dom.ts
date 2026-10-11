import { translateFa } from "./engine";

/**
 * Translates the rendered interface in place (text nodes and a few
 * accessibility/placeholder attributes) using the Persian dictionary, and
 * restores the original English when stopped. React never sees the change:
 * only existing text nodes are edited, never replaced or removed.
 */

const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
const EXCLUDE = "code, pre, kbd, samp, script, style, textarea, input, [translate='no'], [data-no-translate], [contenteditable='true']";

interface Rec {
  orig: string;
  applied: string;
}

let observer: MutationObserver | null = null;
const textRecs = new Map<Text, Rec>();
const attrRecs = new Map<Element, Map<string, Rec>>();

function excluded(el: Element | null): boolean {
  return !el || el.closest(EXCLUDE) !== null;
}

function processText(node: Text) {
  const parent = node.parentElement;
  if (!parent || excluded(parent)) return;
  const current = node.nodeValue ?? "";
  const rec = textRecs.get(node);
  if (rec && current === rec.applied) return; // our own write
  const next = translateFa(current);
  if (next === current) {
    textRecs.delete(node);
    return;
  }
  node.nodeValue = next;
  textRecs.set(node, { orig: current, applied: next });
}

function processAttrs(el: Element) {
  const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
  if (!isField && excluded(el)) return;
  for (const name of ATTRS) {
    const current = el.getAttribute(name);
    if (current === null) continue;
    const recs = attrRecs.get(el);
    const rec = recs?.get(name);
    if (rec && current === rec.applied) continue;
    const next = translateFa(current);
    if (next === current) {
      recs?.delete(name);
      continue;
    }
    el.setAttribute(name, next);
    const map = recs ?? new Map<string, Rec>();
    map.set(name, { orig: current, applied: next });
    attrRecs.set(el, map);
  }
}

function processTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    processText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  processAttrs(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) processText(node as Text);
    else processAttrs(node as Element);
    node = walker.nextNode();
  }
}

function prune() {
  if (textRecs.size > 3000) for (const node of textRecs.keys()) if (!node.isConnected) textRecs.delete(node);
  if (attrRecs.size > 3000) for (const el of attrRecs.keys()) if (!el.isConnected) attrRecs.delete(el);
}

export function startDomTranslation() {
  if (observer || typeof document === "undefined") return;
  processTree(document.documentElement);
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") processTree(m.target);
      else if (m.type === "attributes") processAttrs(m.target as Element);
      else m.addedNodes.forEach((n) => processTree(n));
    }
    prune();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS],
  });
}

export function stopDomTranslation() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  for (const [node, rec] of textRecs) if (node.isConnected && node.nodeValue === rec.applied) node.nodeValue = rec.orig;
  for (const [el, recs] of attrRecs)
    for (const [name, rec] of recs) if (el.isConnected && el.getAttribute(name) === rec.applied) el.setAttribute(name, rec.orig);
  textRecs.clear();
  attrRecs.clear();
}

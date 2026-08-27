/* =============================================================================
 * Cook County Cooks — v3 "Cinema"
 * assets/overlay.js  ·  Agent B  ·  tool viewer + live room screens
 * -----------------------------------------------------------------------------
 * Two systems live in this file because they are two halves of one idea:
 * a tool should never feel like "a github.io link". It should feel like a
 * thing inside the restaurant that you walked up to and switched on.
 *
 *   1. initOverlay()   — the full-screen tool viewer. Clicking any
 *                        [data-tool="<slug>"] opens that tool in a framed,
 *                        chrome-wrapped, deep-linkable, modal viewer.
 *
 *   2. mountScreen()   — mounts a *live*, scaled-down iframe onto a blank
 *                        black-glass TV rectangle in a room plate photo, so
 *                        the TVs in the photograph appear to be playing the
 *                        real dashboards. Clicking a screen opens system #1.
 *
 * Contract notes (see SPEC.md):
 *   · Plain ES module. No dependencies. No build step.
 *   · Only transform / opacity / filter are animated.
 *   · This module never writes the engine's stage vars and never sets
 *     `transform` on `.plate-wrap`. It owns its own layers only.
 *   · prefers-reduced-motion is honoured for every animation here.
 *
 * Exports:
 *   initOverlay(options)                 -> { open, close, isOpen, registry }
 *   mountScreen({ host, slug, url, title, width })  -> { destroy, refresh }
 *   mountRoomScreens(root)               -> Array<screen handle>
 *   openTool(slug), closeTool()
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * 0. Constants & tiny helpers
 * -------------------------------------------------------------------------- */

/** How long we wait for a framed tool before we assume it refused to frame. */
const FRAME_TIMEOUT_MS = 6000;

/** Hard ceiling on simultaneously mounted screen iframes. iPads are real. */
const MAX_LIVE_SCREENS = 4;

/** Virtual desktop width the screen iframes are rendered at before scaling. */
const SCREEN_RENDER_WIDTH = 1280;

/** Deep-link shape: #/tool/<slug> */
const HASH_RE = /^#\/tool\/([A-Za-z0-9_-]+)\/?$/;

/**
 * Hosts known, in advance, to refuse framing (X-Frame-Options /
 * frame-ancestors). For these we don't burn six seconds of the user's life on
 * a spinner — we go straight to the "open in a new tab" card, still dressed in
 * our own chrome so it reads as part of cookcountycooks.com.
 *
 * Kept deliberately SHORT. The link audit fetched all 37 URLs: the only
 * genuinely un-frameable tool in the registry is `printouts` (SharePoint),
 * which is already `external_only: true` and never reaches the iframe path.
 * Smartsheet returned 200 with no XFO and no frame-ancestors — it frames fine,
 * so it is NOT listed here. Pre-empting a working tool into a fallback card is
 * a worse bug than a 6s spinner on one that fails; the runtime detection in
 * showFrame() is the real safety net. This list is belt-and-braces only.
 */
const NEVER_FRAMES = [
  /(^|\.)sharepoint\.com$/i,
  /(^|\.)onedrive\.live\.com$/i,
  /(^|\.)1drv\.ms$/i,
  /(^|\.)office\.com$/i,
  /(^|\.)office365\.com$/i,
  /(^|\.)microsoftonline\.com$/i
];

const $ = (sel, root = document) => root.querySelector(sel);
const noop = () => {};

/** Build an element in one breath. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k in node && k !== 'title' && k !== 'list') { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/** Absolute URL, tolerant of the relative tool paths in tools.json. */
function absUrl(url) {
  try { return new URL(url, document.baseURI); } catch { return null; }
}

function isCrossOrigin(url) {
  const u = absUrl(url);
  return !!u && u.origin !== location.origin;
}

/** Would this URL be pointless to put in an iframe? */
function isKnownUnframeable(url) {
  const u = absUrl(url);
  if (!u) return false;
  return NEVER_FRAMES.some((re) => re.test(u.hostname));
}

/** Pretty host label for the fallback card ("blufoxmobile.github.io"). */
function hostLabel(url) {
  const u = absUrl(url);
  return u ? u.hostname.replace(/^www\./, '') : url;
}

const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Open a URL in a new tab, safely. Returns the window, or null if the popup
 * was genuinely blocked.
 *
 * NOTE the missing 'noopener' feature string. Passing it makes window.open
 * return **null by specification even on success**, which makes the return
 * value useless as a popup-blocked signal. We get the same protection by
 * nulling `opener` on the window we just opened.
 */
function openNewTab(url) {
  let win = null;
  try { win = window.open(url, '_blank'); } catch { win = null; }
  if (win) { try { win.opener = null; } catch { /* cross-origin: already safe */ } }
  return win;
}

/* -----------------------------------------------------------------------------
 * 1. Module state
 * -------------------------------------------------------------------------- */

const state = {
  /** slug -> tool record from tools.json */
  registry: new Map(),
  /** resolved once the registry is populated */
  ready: false,
  readyWaiters: [],
  /** live DOM of the viewer, built lazily on first open */
  ui: null,
  /** slug currently displayed, or null */
  activeSlug: null,
  /** the element that opened the viewer, so focus can go home */
  lastFocus: null,
  /** true when *we* pushed the #/tool/ entry (so close() can history.back()) */
  pushedHistory: false,
  /** scroll lock bookkeeping */
  scrollY: 0,
  locked: false,
  /** frame watchdog */
  frameTimer: 0,
  /** all mounted/monitored screens */
  screens: new Set(),
  /** optional access gate — see initOverlay({ canOpen, onRefused }) */
  canOpen: null,
  onRefused: null,
  initialised: false
};

function whenReady() {
  if (state.ready) return Promise.resolve();
  return new Promise((res) => state.readyWaiters.push(res));
}

function markReady() {
  state.ready = true;
  state.readyWaiters.splice(0).forEach((fn) => fn());
}

function getTool(slug) {
  return state.registry.get(slug) || null;
}

/* -----------------------------------------------------------------------------
 * 2. Stylesheet
 *    Injected once. Everything is prefixed `ccc-` and every colour is a
 *    custom property with a fallback, so assets/theme.css (Agent D) can
 *    retheme the viewer without touching this file.
 * -------------------------------------------------------------------------- */

const STYLES = `
:root {
  --ccc-ov-z: 9000;
  --ccc-ov-ease: cubic-bezier(.22,.61,.36,1);
}

/* --- background scroll lock ------------------------------------------------ */
html.ccc-locked { scroll-behavior: auto !important; }
body.ccc-locked {
  position: fixed;
  left: 0; right: 0; width: 100%;
  overscroll-behavior: none;
}

/* --- screen-reader-only text ---------------------------------------------- */
.ccc-sr {
  position: absolute !important; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* ==========================================================================
   THE VIEWER
   ========================================================================== */
.ccc-ov {
  position: fixed; inset: 0;
  z-index: var(--ccc-ov-z);
  display: grid;
  grid-template-rows: auto 1fr;
  color: var(--ccc-ov-ink, #f2efe9);
  font-family: var(--ccc-font-ui, var(--font-ui, system-ui, -apple-system, "Segoe UI", sans-serif));
  opacity: 0;
  transition: opacity .28s var(--ccc-ov-ease);
}
.ccc-ov[hidden] { display: none; }
.ccc-ov.is-in { opacity: 1; }

.ccc-ov__scrim {
  position: absolute; inset: 0;
  background:
    radial-gradient(120% 90% at 50% 0%, rgba(24,20,16,.72), rgba(6,6,7,.94) 70%),
    var(--ccc-ov-scrim, rgba(6,6,7,.92));
  backdrop-filter: blur(18px) saturate(.9);
  -webkit-backdrop-filter: blur(18px) saturate(.9);
}

/* The panel: a "service window" that slides up a hair as it arrives. */
.ccc-ov__panel {
  position: relative;
  grid-row: 1 / -1;
  display: grid;
  grid-template-rows: auto 1fr;
  width: min(1680px, 100vw - clamp(0px, 4vw, 56px));
  height: min(100svh - clamp(0px, 4vw, 56px), 1100px);
  margin: auto;
  border-radius: var(--ccc-ov-radius, 18px);
  overflow: hidden;
  background: var(--ccc-ov-panel, #101012);
  box-shadow:
    0 0 0 1px rgba(255,255,255,.07),
    0 60px 140px -30px rgba(0,0,0,.9);
  transform: translate3d(0, 18px, 0) scale(.985);
  opacity: 0;
  transition: transform .34s var(--ccc-ov-ease), opacity .34s var(--ccc-ov-ease);
}
.ccc-ov.is-in .ccc-ov__panel { transform: none; opacity: 1; }

@media (max-width: 720px) {
  .ccc-ov__panel { width: 100vw; height: 100svh; border-radius: 0; }
}

/* --- chrome bar ------------------------------------------------------------ */
.ccc-ov__bar {
  display: flex; align-items: center; gap: clamp(10px, 2vw, 22px);
  padding: 12px clamp(12px, 2vw, 20px);
  background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.015));
  border-bottom: 1px solid rgba(255,255,255,.09);
}
.ccc-ov__id { min-width: 0; flex: 1 1 auto; }
.ccc-ov__title {
  margin: 0;
  font-family: var(--ccc-font-display, var(--font-display, inherit));
  font-size: clamp(15px, 1.5vw, 19px);
  font-weight: 600;
  letter-spacing: .005em;
  line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ccc-ov__blurb {
  margin: 3px 0 0;
  font-size: clamp(11.5px, 1.05vw, 13px);
  line-height: 1.35;
  color: var(--ccc-ov-dim, rgba(242,239,233,.62));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
@media (max-width: 640px) { .ccc-ov__blurb { display: none; } }

.ccc-ov__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

.ccc-ov__btn {
  -webkit-appearance: none; appearance: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 40px; padding: 0 14px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 999px;
  background: rgba(255,255,255,.05);
  color: inherit; font: inherit; font-size: 13px; font-weight: 500;
  text-decoration: none; cursor: pointer;
  transition: background .18s ease, border-color .18s ease, transform .12s ease;
}
.ccc-ov__btn:hover { background: rgba(255,255,255,.11); border-color: rgba(255,255,255,.24); }
.ccc-ov__btn:active { transform: translateY(1px); }
.ccc-ov__btn:focus-visible,
.ccc-screen__hit:focus-visible {
  outline: 2px solid var(--ccc-focus, #e8b45a);
  outline-offset: 3px;
}
.ccc-ov__btn--primary {
  background: var(--ccc-accent, #e8b45a);
  border-color: transparent;
  color: var(--ccc-accent-ink, #17130c);
  font-weight: 600;
}
.ccc-ov__btn--primary:hover { background: var(--ccc-accent-hi, #f2c778); }
.ccc-ov__btn--icon { width: 40px; padding: 0; font-size: 15px; }
@media (max-width: 560px) { .ccc-ov__btn--tab .ccc-ov__btn-label { display: none; } .ccc-ov__btn--tab { width: 40px; padding: 0; } }

/* --- stage (frame / skeleton / fallback share one box) --------------------- */
.ccc-ov__stage { position: relative; background: var(--ccc-ov-stage, #f7f5f1); overflow: hidden; }

.ccc-ov__frame {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  border: 0; display: block;
  background: transparent;
  opacity: 0;
  transition: opacity .4s var(--ccc-ov-ease);
}
.ccc-ov__frame.is-shown { opacity: 1; }

/* --- loading skeleton: a plausible dashboard, gently shimmering ------------ */
.ccc-ov__skel {
  position: absolute; inset: 0;
  padding: clamp(16px, 3vw, 34px);
  display: grid; gap: clamp(12px, 1.6vw, 20px);
  grid-template-rows: auto auto 1fr;
  background: var(--ccc-ov-stage, #f7f5f1);
  overflow: hidden;
}
.ccc-ov__skel[hidden] { display: none; }
.ccc-ov__skel::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(100deg, transparent 25%, rgba(255,255,255,.85) 50%, transparent 75%);
  transform: translate3d(-60%,0,0);
  animation: ccc-shimmer 1.5s linear infinite;
  pointer-events: none;
}
@keyframes ccc-shimmer { to { transform: translate3d(60%,0,0); } }

.ccc-sk { background: rgba(20,22,26,.075); border-radius: 8px; }
.ccc-sk--title { height: clamp(20px, 2.4vw, 28px); width: min(340px, 52%); }
.ccc-sk--tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: clamp(10px, 1.4vw, 16px); background: none; }
.ccc-sk--tile { height: clamp(74px, 9vw, 104px); border-radius: 12px; background: rgba(20,22,26,.06); }
.ccc-sk--body { border-radius: 14px; background: rgba(20,22,26,.05); }

/* --- fallback card: the un-frameable path --------------------------------- */
.ccc-ov__fallback {
  position: absolute; inset: 0;
  display: grid; place-content: center; justify-items: center;
  gap: 14px; padding: clamp(24px, 5vw, 56px);
  text-align: center;
  background:
    radial-gradient(90% 70% at 50% 0%, rgba(255,255,255,.06), transparent 70%),
    var(--ccc-ov-panel, #101012);
  color: var(--ccc-ov-ink, #f2efe9);
}
.ccc-ov__fallback[hidden] { display: none; }
.ccc-ov__fb-mark {
  width: 58px; height: 58px; display: grid; place-content: center;
  border-radius: 16px; margin-bottom: 4px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.05);
  font-size: 26px; line-height: 1;
}
.ccc-ov__fb-title {
  margin: 0;
  font-family: var(--ccc-font-display, var(--font-display, inherit));
  font-size: clamp(19px, 2.4vw, 26px); font-weight: 600;
}
.ccc-ov__fb-copy {
  margin: 0; max-width: 48ch;
  font-size: clamp(13px, 1.3vw, 15px); line-height: 1.55;
  color: var(--ccc-ov-dim, rgba(242,239,233,.66));
}
.ccc-ov__fb-host {
  font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ccc-ov-dim, rgba(242,239,233,.45));
}
.ccc-ov__fb-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 8px; }

/* ==========================================================================
   LIVE ROOM SCREENS
   The host element is positioned/sized by the room layout (Agent A / theme).
   We only ever paint *inside* it.
   ========================================================================== */
.ccc-screen {
  position: relative;              /* defensive: host should already be positioned */
  overflow: hidden;
  background: #05060a;             /* black glass, the resting state */
  isolation: isolate;
  -webkit-tap-highlight-color: transparent;
}

/* The screen PLANE. Every visible layer lives inside it, so when a quad is
   supplied the single matrix3d on this wrapper carries the glass, the
   reflection, the bezel AND the hit target onto the wall plane together —
   the reflection stays welded to the screen instead of sliding off it. */
.ccc-screen__plane {
  position: absolute; inset: 0;
  transform-origin: 0 0;           /* the homography is solved for this origin */
  border-radius: inherit;
}

/* Perspective mode: the host becomes a full-bleed, click-through reference
   box over the plate, and only the transformed plane is solid and clickable. */
.ccc-screen--quad {
  overflow: visible;
  background: transparent;
  pointer-events: none;
}
.ccc-screen--quad .ccc-screen__plane {
  inset: auto;
  top: 0; left: 0;                 /* width/height are written in px by JS */
  background: #05060a;
  pointer-events: auto;
  overflow: hidden;
  -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
}

/* The viewport that clips the oversized, scaled-down iframe. */
.ccc-screen__glass {
  position: absolute; inset: 0;
  overflow: hidden;
  background:
    linear-gradient(160deg, #0b0d12 0%, #05060a 55%, #090a0f 100%);
  transform: translateZ(0);        /* own layer; keeps the scale cheap */
}
.ccc-screen__frame {
  position: absolute; top: 0; left: 0;
  border: 0; display: block;
  transform-origin: top left;
  background: #fff;
  opacity: 0;
  transition: opacity .7s ease;
  pointer-events: none;            /* the whole screen is one big button */
}
.ccc-screen.is-live .ccc-screen__frame { opacity: 1; }

/* Ambient brightness drift — a powered-on panel is never perfectly steady. */
.ccc-screen.is-live .ccc-screen__glass {
  animation: ccc-ambient 19s ease-in-out infinite;
}
@keyframes ccc-ambient {
  0%, 100% { filter: brightness(.96) saturate(.98); }
  37%      { filter: brightness(1.03) saturate(1.02); }
  68%      { filter: brightness(.99) saturate(1); }
}

/* Faint glass reflection: a soft diagonal wipe + a cool top sheen. */
.ccc-screen__sheen {
  position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background:
    linear-gradient(196deg, rgba(255,255,255,.13) 0%, rgba(255,255,255,.045) 18%, rgba(255,255,255,0) 42%),
    linear-gradient(12deg, rgba(150,190,255,.07) 0%, rgba(255,255,255,0) 46%);
  mix-blend-mode: screen;
  opacity: .9;
}
/* A very slow travelling highlight, as if the room lights breathe. */
.ccc-screen__sheen::after {
  content: ""; position: absolute; inset: -30%;
  background: linear-gradient(74deg, transparent 40%, rgba(255,255,255,.07) 50%, transparent 60%);
  transform: translate3d(-18%, 0, 0);
  animation: ccc-sheen 26s ease-in-out infinite alternate;
}
@keyframes ccc-sheen { to { transform: translate3d(18%, 0, 0); } }

/* Bezel: inner shadow + a hairline edge so it sits *in* the photo. */
.ccc-screen__bezel {
  position: absolute; inset: 0; pointer-events: none; z-index: 3;
  border-radius: inherit;
  box-shadow:
    inset 0 0 0 1px rgba(0,0,0,.55),
    inset 0 0 14px 4px rgba(0,0,0,.55),
    inset 0 1px 0 rgba(255,255,255,.06);
}
/* Scanline/pixel grain, extremely faint — kills the "screenshot on a wall" look. */
.ccc-screen__bezel::before {
  content: ""; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.12) 0 1px, transparent 1px 3px);
  opacity: .28;
}

/* The real, focusable control that covers the whole screen. */
.ccc-screen__hit {
  position: absolute; inset: 0; z-index: 4;
  -webkit-appearance: none; appearance: none;
  border: 0; padding: 0; margin: 0;
  background: transparent; color: inherit;
  cursor: pointer;
  border-radius: inherit;
  transition: box-shadow .25s ease, background-color .25s ease;
}
.ccc-screen__hit:hover {
  background: rgba(255,255,255,.05);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.22), 0 0 34px -6px rgba(180,210,255,.4);
}

/* Reduced motion: still a lit screen, just a still one. */
@media (prefers-reduced-motion: reduce) {
  .ccc-ov, .ccc-ov__panel, .ccc-ov__frame, .ccc-screen__frame { transition: none; }
  .ccc-ov__skel::after,
  .ccc-screen.is-live .ccc-screen__glass,
  .ccc-screen__sheen::after { animation: none; }
  .ccc-ov__panel { transform: none; }
}
`;

function injectStyles() {
  if (document.getElementById('ccc-overlay-css')) return;
  document.head.append(el('style', { id: 'ccc-overlay-css', text: STYLES }));
}

/* -----------------------------------------------------------------------------
 * 3. Scroll lock
 *    The position:fixed technique is the only one that reliably stops
 *    background scroll on iOS Safari — but it *loses the scroll position*
 *    unless you stash and restore it yourself. That restore is the classic
 *    bug; it is handled explicitly here, synchronously, with smooth scrolling
 *    temporarily disabled so the page does not visibly fly back.
 * -------------------------------------------------------------------------- */

function lockScroll() {
  if (state.locked) return;
  state.scrollY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.classList.add('ccc-locked');
  document.body.classList.add('ccc-locked');
  document.body.style.top = `-${state.scrollY}px`;
  state.locked = true;
}

function unlockScroll() {
  if (!state.locked) return;
  document.body.classList.remove('ccc-locked');
  document.body.style.top = '';
  // Restore synchronously, before the browser paints, and without smoothing.
  const prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, state.scrollY);
  document.documentElement.style.scrollBehavior = prev;
  document.documentElement.classList.remove('ccc-locked');
  state.locked = false;
}

/* -----------------------------------------------------------------------------
 * 4. Focus trap + background inerting
 * -------------------------------------------------------------------------- */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((n) => {
    if (n.hasAttribute('hidden') || n.closest('[hidden]')) return false;
    // offsetParent is null for display:none; position:fixed elements report
    // null too, so fall back to a rect check.
    const r = n.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  });
}

/**
 * Keeps Tab inside the dialog. Note: once focus enters a *cross-origin*
 * iframe we can no longer observe keystrokes — that is a browser boundary,
 * not an oversight. We mitigate it by putting the chrome bar (close button
 * included) BEFORE the frame in DOM order, so Shift+Tab out of the frame
 * lands on the close button.
 */
function trapFocus(ev) {
  if (ev.key !== 'Tab' || !state.ui) return;
  const items = focusables(state.ui.panel);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (ev.shiftKey && (active === first || !state.ui.panel.contains(active))) {
    ev.preventDefault(); last.focus();
  } else if (!ev.shiftKey && active === last) {
    ev.preventDefault(); first.focus();
  }
}

/** Hide the rest of the page from assistive tech (and, where supported, from
 *  interaction) while the dialog is up. */
function setBackgroundInert(on) {
  for (const node of Array.from(document.body.children)) {
    if (state.ui && node === state.ui.root) continue;
    if (on) {
      if (node.hasAttribute('aria-hidden')) node.dataset.cccPrevAria = node.getAttribute('aria-hidden');
      node.setAttribute('aria-hidden', 'true');
      if ('inert' in node) { node.dataset.cccPrevInert = node.inert ? '1' : '0'; node.inert = true; }
    } else {
      if ('cccPrevAria' in node.dataset) { node.setAttribute('aria-hidden', node.dataset.cccPrevAria); delete node.dataset.cccPrevAria; }
      else node.removeAttribute('aria-hidden');
      if ('inert' in node && 'cccPrevInert' in node.dataset) { node.inert = node.dataset.cccPrevInert === '1'; delete node.dataset.cccPrevInert; }
    }
  }
}

/* -----------------------------------------------------------------------------
 * 5. Building the viewer DOM (once, lazily)
 * -------------------------------------------------------------------------- */

function buildUI() {
  if (state.ui) return state.ui;

  const title = el('h2', { class: 'ccc-ov__title', id: 'ccc-ov-title' });
  const blurb = el('p', { class: 'ccc-ov__blurb', id: 'ccc-ov-blurb' });

  const tabBtn = el('a', {
    class: 'ccc-ov__btn ccc-ov__btn--tab',
    target: '_blank',
    rel: 'noopener noreferrer',
    href: '#'
  }, [
    el('span', { class: 'ccc-ov__btn-label', text: 'Open in new tab' }),
    el('span', { 'aria-hidden': 'true', text: '↗' })
  ]);

  const closeBtn = el('button', {
    class: 'ccc-ov__btn ccc-ov__btn--icon',
    type: 'button',
    'aria-label': 'Close tool and return to the restaurant',
    html: '<span aria-hidden="true">✕</span>'
  });

  const bar = el('header', { class: 'ccc-ov__bar' }, [
    el('div', { class: 'ccc-ov__id' }, [title, blurb]),
    el('div', { class: 'ccc-ov__actions' }, [tabBtn, closeBtn])
  ]);

  const skel = el('div', { class: 'ccc-ov__skel', 'aria-hidden': 'true' }, [
    el('div', { class: 'ccc-sk ccc-sk--title' }),
    el('div', { class: 'ccc-sk--tiles' }, [
      el('div', { class: 'ccc-sk--tile' }), el('div', { class: 'ccc-sk--tile' }),
      el('div', { class: 'ccc-sk--tile' }), el('div', { class: 'ccc-sk--tile' })
    ]),
    el('div', { class: 'ccc-sk ccc-sk--body' })
  ]);

  const frame = makeStageFrame();

  // --- fallback card (the un-frameable path) --------------------------------
  const fbTitle = el('h3', { class: 'ccc-ov__fb-title' });
  const fbCopy = el('p', { class: 'ccc-ov__fb-copy' });
  const fbHost = el('p', { class: 'ccc-ov__fb-host' });
  const fbOpen = el('a', {
    class: 'ccc-ov__btn ccc-ov__btn--primary',
    target: '_blank', rel: 'noopener noreferrer', href: '#'
  }, [el('span', { text: 'Open in a new tab' }), el('span', { 'aria-hidden': 'true', text: '↗' })]);
  const fbRetry = el('button', { class: 'ccc-ov__btn', type: 'button', text: 'Try again here' });
  const fbBack = el('button', { class: 'ccc-ov__btn', type: 'button', text: 'Back to the restaurant' });

  const fallback = el('div', { class: 'ccc-ov__fallback', hidden: true }, [
    el('div', { class: 'ccc-ov__fb-mark', 'aria-hidden': 'true', text: '⧉' }),
    fbTitle, fbCopy, fbHost,
    el('div', { class: 'ccc-ov__fb-actions' }, [fbOpen, fbRetry, fbBack])
  ]);

  const status = el('p', { class: 'ccc-sr', role: 'status', 'aria-live': 'polite' });

  const stage = el('div', { class: 'ccc-ov__stage' }, [frame, skel, fallback]);
  const panel = el('div', { class: 'ccc-ov__panel' }, [bar, stage, status]);

  const root = el('div', {
    class: 'ccc-ov',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'ccc-ov-title',
    'aria-describedby': 'ccc-ov-blurb',
    hidden: true
  }, [el('div', { class: 'ccc-ov__scrim' }), panel]);

  document.body.append(root);

  // --- wiring ---------------------------------------------------------------
  closeBtn.addEventListener('click', () => closeTool());
  fbBack.addEventListener('click', () => closeTool());
  fbRetry.addEventListener('click', () => {
    const tool = getTool(state.activeSlug);
    if (tool) showFrame(tool, { force: true });
  });
  // Clicking the scrim (the margin around the panel) closes, like any modal.
  root.addEventListener('mousedown', (ev) => {
    if (ev.target === root || ev.target.classList.contains('ccc-ov__scrim')) closeTool();
  });
  root.addEventListener('keydown', trapFocus);

  state.ui = {
    root, panel, title, blurb, tabBtn, closeBtn,
    stage, frame, skel, fallback, status,
    fbTitle, fbCopy, fbHost, fbOpen, fbRetry
  };
  return state.ui;
}

/* -----------------------------------------------------------------------------
 * 6. Frame loading + failure detection
 * -------------------------------------------------------------------------- */

/** Mint a viewer iframe. Fresh elements are how we stay out of history. */
function makeStageFrame() {
  return el('iframe', {
    class: 'ccc-ov__frame',
    title: 'Tool',
    allow: 'clipboard-write; fullscreen; geolocation',
    referrerpolicy: 'no-referrer-when-downgrade'
  });
}

/**
 * Point the viewer's iframe at `url` WITHOUT adding a session-history entry.
 *
 * This matters more than it looks. Assigning `.src` to a frame that has
 * already navigated away from its initial about:blank pushes a real entry onto
 * the joint session history. `closeTool()` calls history.back() to unwind its
 * own pushState — and it would unwind the *iframe's* navigation instead, so ✕,
 * Escape and the Back button all took two presses to close. Measured:
 * history.length went 2 -> 3 (our pushState) -> 4 (the iframe load).
 *
 * Two defences, in order:
 *   1. Replace the whole <iframe> element. A brand-new frame's first
 *      navigation *replaces* its initial about:blank rather than pushing, so
 *      the entry is never created. This also guarantees no stale load handlers
 *      and fully unloads the previous tool.
 *   2. If a live same-document window is somehow still there, use
 *      location.replace(), which is explicitly non-pushing.
 *
 * @returns {HTMLIFrameElement} the frame that is now in the DOM
 */
function navigateStageFrame(ui, url) {
  const fresh = makeStageFrame();
  ui.frame.replaceWith(fresh);          // keeps its slot/order inside the stage
  ui.frame = fresh;
  fresh.src = url;                      // initial navigation: replaces, no push
  return fresh;
}

/**
 * Blank the viewer frame by discarding the element entirely. Removing the
 * `src` attribute does NOT unload a frame (the document stays live and keeps
 * its timers running), and navigating it to about:blank would push yet another
 * history entry. Replacing the node does both jobs and pushes nothing.
 */
function blankStageFrame(ui) {
  if (!ui || !ui.frame) return;
  ui.frame.onload = ui.frame.onerror = null;
  const fresh = makeStageFrame();
  ui.frame.replaceWith(fresh);
  ui.frame = fresh;
}

function clearFrameTimer() {
  if (state.frameTimer) { clearTimeout(state.frameTimer); state.frameTimer = 0; }
}

/**
 * Did this frame actually get content, or did the server refuse us?
 *
 * READ THIS BEFORE CHANGING THE PROBE — the obvious version is wrong.
 *
 *   `frame.contentDocument` does NOT throw for a cross-origin document. Per
 *   spec it returns **null**, which is indistinguishable from "nothing loaded"
 *   — so probing it flags every successfully framed cross-origin tool as
 *   blocked. (Measured in-page: contentDocument returned null and did not
 *   throw; contentWindow.document threw.)
 *
 *   `frame.contentWindow.document` is the probe that discriminates: reading it
 *   across an origin boundary throws a SecurityError, and THAT THROW is the
 *   success signal — a real document from another origin is sitting there.
 *
 * When a server sends X-Frame-Options: DENY the browser instead leaves the
 * frame on a same-origin, effectively-empty about:blank / error document, so
 * the read succeeds and we can see that there is nothing in it. That is the
 * refusal case, and it is the only way we reach the checks below.
 *
 * Same-origin tools (tools/porting-guide/, tools/employee-of-week/) are exempt
 * up front: for them an accessible document is completely normal.
 */
function looksBlocked(frame, url) {
  if (!isCrossOrigin(url)) return false;

  let doc;
  try {
    const win = frame.contentWindow;
    if (!win) return true;                                   // no browsing context
    doc = win.document;                                      // throws if cross-origin
  } catch {
    return false;                                            // threw => it really loaded
  }

  // Only reachable when the document is same-origin, i.e. the browser parked
  // us on about:blank or an error page after a refusal.
  if (!doc) return true;
  if (doc.location && doc.location.href === 'about:blank') return true;
  if (!doc.body) return true;
  return doc.body.childElementCount === 0 && !doc.body.textContent.trim();
}

/** Swap the stage over to the "can't frame this" card. */
function showFallback(tool, reason) {
  const ui = state.ui;
  clearFrameTimer();
  ui.frame.classList.remove('is-shown');
  blankStageFrame(ui);                  // unloads the refused document, no history entry
  ui.skel.hidden = true;
  ui.fallback.hidden = false;

  ui.fbTitle.textContent = tool.label;
  ui.fbCopy.textContent = reason;
  ui.fbHost.textContent = hostLabel(tool.url);
  ui.fbOpen.href = tool.url;
  // Retrying a SharePoint/Smartsheet URL will never work — don't offer it.
  ui.fbRetry.hidden = isKnownUnframeable(tool.url);
  ui.status.textContent = `${tool.label} can't be shown inside the site. Use "Open in a new tab".`;

  // Put focus somewhere useful, but only if focus was inside the stage.
  if (!ui.panel.contains(document.activeElement)) ui.fbOpen.focus();
}

/** Point the iframe at a tool and start the watchdog. */
function showFrame(tool, { force = false } = {}) {
  const ui = state.ui;
  clearFrameTimer();

  ui.fallback.hidden = true;
  ui.frame.classList.remove('is-shown');
  ui.skel.hidden = false;
  ui.status.textContent = `Loading ${tool.label}…`;

  // Known refusers: skip the six-second spinner entirely and go straight to
  // the card. Nothing routes here today except SharePoint/Microsoft hosts, and
  // `printouts` is external_only so it never even gets this far — but the list
  // stays as cheap insurance for whatever gets added to tools.json next.
  if (!force && isKnownUnframeable(tool.url)) {
    showFallback(
      tool,
      `${hostLabel(tool.url)} doesn't allow itself to be displayed inside another site. It opens in a new tab — you'll come straight back here when you're done.`
    );
    return;
  }

  let settled = false;

  const onLoad = () => {
    // Give the blocked-frame error document a tick to settle before probing.
    setTimeout(() => {
      if (settled || frame !== ui.frame) return;   // superseded by a newer open
      if (looksBlocked(frame, tool.url)) {
        settled = true;
        showFallback(tool, `${hostLabel(tool.url)} refused to load inside the site. Open it in a new tab instead.`);
        return;
      }
      settled = true;
      clearFrameTimer();
      ui.skel.hidden = true;
      frame.classList.add('is-shown');
      ui.status.textContent = `${tool.label} loaded.`;
    }, 120);
  };

  const onError = () => {
    if (settled || frame !== ui.frame) return;
    settled = true;
    showFallback(tool, `${hostLabel(tool.url)} couldn't be reached from inside the site. Try opening it in a new tab.`);
  };

  // A FRESH element per navigation — see navigateStageFrame() for why.
  const frame = navigateStageFrame(ui, tool.url);
  frame.title = `${tool.label} — live tool`;
  frame.onload = onLoad;
  frame.onerror = onError;

  // Watchdog: some refusals are silent — no load, no error, just nothing.
  state.frameTimer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    showFallback(tool, `${tool.label} is taking too long to load in place — it may not allow embedding. Opening it in a new tab will work.`);
  }, FRAME_TIMEOUT_MS);
}

/* -----------------------------------------------------------------------------
 * 7. Open / close
 * -------------------------------------------------------------------------- */

function hashSlug() {
  const m = HASH_RE.exec(location.hash || '');
  return m ? m[1] : null;
}

/**
 * The gate said no. Undo any URL that claims otherwise, then hand control to
 * whoever owns the lock so they can put their keypad up.
 */
function refuseTool(slug, tool, { trigger = null, source = 'api' } = {}) {
  // A refused deep link must not leave #/tool/<slug> sitting in the address
  // bar claiming a tool is open. Strip it — but only if nothing else is open.
  if (state.activeSlug === null && hashSlug() === slug) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* noop */ }
  }

  // `retry` deliberately drops the original history/source options: by the
  // time it runs the hash is gone, so reopening should push a fresh entry.
  const retry = () => openTool(slug, { trigger, bypassGate: true });
  const detail = { slug, tool, trigger, source, retry };

  try {
    document.dispatchEvent(new CustomEvent('ccc:tool-refused', { bubbles: true, detail }));
  } catch { /* CustomEvent unavailable: the callback below still fires */ }

  if (typeof state.onRefused === 'function') {
    try { state.onRefused(slug, detail); } catch (err) { console.error('[overlay] onRefused threw:', err); }
  }
}

/**
 * Open a tool full-screen.
 * @param {string} slug
 * @param {object} [opts]
 * @param {boolean} [opts.history=true]     push #/tool/<slug> (false when we're
 *                                          reacting to a history event ourselves)
 * @param {Element} [opts.trigger]          element to return focus to on close
 * @param {boolean} [opts.bypassGate=false] skip canOpen — for the retry handed
 *                                          to onRefused after a successful unlock
 * @param {string}  [opts.source='api']     'click' | 'hash' | 'api', passed to onRefused
 */
export function openTool(slug, opts = {}) {
  const { history: doPush = true, trigger = null, bypassGate = false, source = 'api' } = opts;
  const tool = getTool(slug);

  if (!tool) {
    // Registry may not have arrived yet (deep link on a cold load).
    if (!state.ready) { whenReady().then(() => openTool(slug, opts)); return; }
    console.warn(`[overlay] unknown tool "${slug}"`);
    return;
  }

  // --- access gate ----------------------------------------------------------
  // Consulted on EVERY path into the viewer — click, deep link, hash sync,
  // programmatic call — and BEFORE the external_only shortcut, so a gated tool
  // cannot be reached by typing #/tool/<slug> past a keypad that only ever
  // guarded clicks. The predicate is re-evaluated each time, so an unlock that
  // happened in between is simply seen.
  if (!bypassGate && typeof state.canOpen === 'function') {
    let allowed = false;
    try { allowed = !!state.canOpen(slug, tool); }
    catch (err) { console.error('[overlay] canOpen threw; refusing:', err); }
    if (!allowed) { refuseTool(slug, tool, { trigger, source }); return; }
  }

  // external_only: never frame, never take over the page — straight out. No
  // modal, no scroll lock, no history entry.
  //
  // The fallthrough below is ONLY for a genuinely blocked popup. It used to
  // run on every success too, because window.open(url, '_blank', 'noopener')
  // returns null by specification even when the tab opens fine — see
  // openNewTab(), which no longer passes that feature string.
  //
  // Nothing here keys off a slug: `printouts` is external_only today purely
  // because tools.json says so. Drop the flag when the PDFs come out of
  // SharePoint and this tool starts framing like any other, no code change.
  if (tool.external_only) {
    const win = openNewTab(tool.url);
    if (win) return;                             // opened: leave the page alone
    // Popup blocked: fall through into the viewer showing the card, so the
    // user still gets a real link they can click.
  }

  injectStyles();
  const ui = buildUI();
  const swapping = state.activeSlug !== null;

  state.activeSlug = slug;
  ui.title.textContent = tool.label;
  ui.blurb.textContent = tool.blurb || '';
  ui.tabBtn.href = tool.url;
  ui.tabBtn.setAttribute('aria-label', `Open ${tool.label} in a new browser tab`);

  if (!swapping) {
    state.lastFocus = trigger || document.activeElement;
    lockScroll();
    ui.root.hidden = false;
    setBackgroundInert(true);
    // Next frame so the transition has a starting state to animate from.
    requestAnimationFrame(() => ui.root.classList.add('is-in'));
    document.addEventListener('keydown', onKeydown, true);
  }

  if (tool.external_only) {
    showFallback(tool, `${tool.label} lives in ${hostLabel(tool.url)} and opens in its own tab.`);
  } else {
    showFrame(tool);
  }

  if (doPush) {
    try {
      history.pushState({ cccTool: slug }, '', `#/tool/${slug}`);
      state.pushedHistory = true;
    } catch { state.pushedHistory = false; }
  }

  // Focus the close button: predictable, and one Shift+Tab from everything.
  // (Unless the fallback card already claimed focus for its primary action —
  // don't yank it back from a more useful target.)
  if (!swapping) requestAnimationFrame(() => {
    if (state.activeSlug === null) return;
    if (!ui.panel.contains(document.activeElement)) ui.closeBtn.focus();
  });
}

/**
 * Close the viewer.
 * @param {object} [opts]
 * @param {boolean} [opts.history=true] let the Back button do the closing
 *                                      (false when a popstate is closing us)
 */
export function closeTool(opts = {}) {
  const { history: useHistory = true } = opts;
  if (state.activeSlug === null) return;

  // If we pushed the #/tool/ entry, closing should *rewind* history so Back
  // and the ✕ leave the user in the same place. popstate then re-enters here
  // with history:false and does the real teardown.
  if (useHistory && state.pushedHistory) {
    state.pushedHistory = false;
    history.back();
    return;
  }

  // Deep-linked straight into a tool: no entry of ours to pop, so just strip
  // the hash in place rather than sending the user off the site.
  if (useHistory && !state.pushedHistory && hashSlug()) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  }

  teardown();
}

function teardown() {
  const ui = state.ui;
  const slug = state.activeSlug;
  state.activeSlug = null;
  state.pushedHistory = false;
  clearFrameTimer();
  document.removeEventListener('keydown', onKeydown, true);

  if (!ui) return;

  ui.root.classList.remove('is-in');
  ui.frame.onload = ui.frame.onerror = null;
  ui.frame.classList.remove('is-shown');
  ui.status.textContent = '';

  const finish = () => {
    if (state.activeSlug !== null) return;       // reopened mid-transition
    ui.root.hidden = true;
    blankStageFrame(ui);                         // unload the tool; adds no history
    ui.fallback.hidden = true;
    ui.skel.hidden = false;
    setBackgroundInert(false);
    unlockScroll();
    restoreFocus(slug);
  };

  if (reduceMotion()) finish();
  else setTimeout(finish, 300);                  // matches the CSS transition
}

function restoreFocus(slug) {
  let target = state.lastFocus;
  state.lastFocus = null;
  if (!target || !target.isConnected) {
    target = slug ? document.querySelector(`[data-tool="${CSS.escape(slug)}"]`) : null;
  }
  if (target && typeof target.focus === 'function') {
    // preventScroll: the page has just been un-fixed; don't yank it again.
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  }
}

function onKeydown(ev) {
  if (ev.key === 'Escape' && state.activeSlug !== null) {
    ev.preventDefault();
    ev.stopPropagation();
    closeTool();
  }
}

/* -----------------------------------------------------------------------------
 * 8. Routing — the viewer has its own URL
 * -------------------------------------------------------------------------- */

/** Reconcile the viewer with whatever the address bar currently says. */
function syncFromLocation() {
  const slug = hashSlug();
  if (slug) {
    if (slug === state.activeSlug) return;
    // Arrived by history, so don't push another entry — but remember that the
    // entry exists so ✕ still rewinds correctly.
    const had = state.activeSlug !== null;
    openTool(slug, { history: false, source: 'hash' });
    // If the gate refused, nothing opened — don't claim an entry we don't own.
    if (state.activeSlug === slug) state.pushedHistory = had || state.pushedHistory;
  } else if (state.activeSlug !== null) {
    closeTool({ history: false });
  }
}

/* -----------------------------------------------------------------------------
 * 9. Delegated click handling for [data-tool]
 * -------------------------------------------------------------------------- */

function onDocumentClick(ev) {
  // Let modified clicks behave like normal browser clicks.
  if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

  const trigger = ev.target.closest && ev.target.closest('[data-tool]');
  if (!trigger) return;

  const slug = trigger.getAttribute('data-tool');
  if (!slug) return;

  // Anything inside the viewer itself is not a trigger.
  if (state.ui && state.ui.root.contains(trigger)) return;

  ev.preventDefault();
  openTool(slug, { trigger, source: 'click' });
}

/** Keyboard activation for non-native triggers (a div with data-tool). */
function onDocumentKeydown(ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
  const trigger = ev.target.closest && ev.target.closest('[data-tool]');
  if (!trigger || !trigger.hasAttribute('data-tool')) return;
  const tag = trigger.tagName;
  if (tag === 'A' || tag === 'BUTTON') return;      // browser already handles it
  if (state.ui && state.ui.root.contains(trigger)) return;
  ev.preventDefault();
  openTool(trigger.getAttribute('data-tool'), { trigger, source: 'click' });
}

/* -----------------------------------------------------------------------------
 * 10. initOverlay()
 * -------------------------------------------------------------------------- */

/**
 * Boot the tool viewer.
 *
 * @param {object}  [options]
 * @param {Array}   [options.tools]     tools array (as in data/tools.json). If
 *                                      omitted we look at window.CCC_TOOLS /
 *                                      window.CCC?.tools, then fetch toolsUrl.
 * @param {string}  [options.toolsUrl]  default 'data/tools.json'
 * @param {boolean} [options.deepLink]  honour #/tool/<slug> on load (default true)
 *
 * @param {(slug:string, tool:object) => boolean} [options.canOpen]
 *        Access gate. Return falsy to refuse. Called on EVERY path into the
 *        viewer — click, keyboard, deep link, hash sync, programmatic
 *        openTool() — and before the external_only shortcut, so a lock cannot
 *        be walked past with a URL. Re-evaluated on every open, so it should
 *        read live state (e.g. sessionStorage) rather than a captured boolean.
 *
 * @param {(slug:string, ctx:{tool:object, trigger:Element|null,
 *          source:'click'|'hash'|'api', retry:() => void}) => void} [options.onRefused]
 *        Called when canOpen refuses. Nothing opens, no history entry is made,
 *        and a refused deep-link hash is stripped from the address bar. Put
 *        your keypad up here, then call ctx.retry() once the user is through
 *        (or just call openTool(slug, { trigger }) again — canOpen re-runs and
 *        will now pass). The same payload is also dispatched on `document` as
 *        a bubbling `ccc:tool-refused` CustomEvent for listener-style wiring.
 *
 * @returns {{open:Function, close:Function, isOpen:Function, setGate:Function,
 *            registry:Map, ready:Promise}}
 *
 * @example  // assets/app.js — the freezer gate
 *   initOverlay({
 *     tools: data.tools,
 *     canOpen: (slug) => !gated.has(slug) || isFreezerUnlocked(),
 *     onRefused: (slug, { retry }) => openKeypad().then((ok) => { if (ok) retry(); })
 *   });
 */
export function initOverlay(options = {}) {
  const {
    tools = null,
    toolsUrl = 'data/tools.json',
    deepLink = true,
    canOpen = null,
    onRefused = null
  } = options;

  state.canOpen = typeof canOpen === 'function' ? canOpen : null;
  state.onRefused = typeof onRefused === 'function' ? onRefused : null;

  injectStyles();

  if (!state.initialised) {
    state.initialised = true;
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
  }

  const load = tools
    ? Promise.resolve(tools)
    : Promise.resolve(
        (window.CCC && window.CCC.tools) || window.CCC_TOOLS || null
      ).then((inline) => inline || fetch(toolsUrl, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))));

  const ready = load
    .then((data) => {
      const list = Array.isArray(data) ? data : (data && data.tools) || [];
      for (const tool of list) if (tool && tool.slug) state.registry.set(tool.slug, tool);
      markReady();
      if (deepLink) syncFromLocation();          // deep link opens straight in
      refreshScreenLabels();                     // screens waiting on titles
      return state.registry;
    })
    .catch((err) => {
      console.error('[overlay] could not load tools:', err);
      markReady();                               // unblock waiters regardless
      return state.registry;
    });

  return {
    open: (slug, opts) => openTool(slug, opts),
    close: (opts) => closeTool(opts),
    isOpen: () => state.activeSlug !== null,
    /** Install or replace the gate after init (pass nulls to remove it). */
    setGate: (nextCanOpen, nextOnRefused) => {
      state.canOpen = typeof nextCanOpen === 'function' ? nextCanOpen : null;
      state.onRefused = typeof nextOnRefused === 'function' ? nextOnRefused : null;
    },
    registry: state.registry,
    ready
  };
}

/* =============================================================================
 * 11. LIVE ROOM SCREENS
 *
 * The room plates are photographs with genuinely blank (black glass) TVs in
 * them. A host element has already been positioned and sized over each blank
 * rectangle by the room layout. We drop a real, live, scaled-down iframe into
 * that box.
 *
 * The trick that makes this look right: render the iframe at a true desktop
 * width (1280px) and CSS-scale it down to fit. Sizing the iframe to the tiny
 * host box instead would trip the dashboard's mobile breakpoints and you'd get
 * a cramped single-column phone layout on a wall-mounted TV — instantly fake.
 * ========================================================================== */

/** The three screens in this build, by slug (see data/tools.json). */
const SCREEN_SLUGS = ['wtw-chicago', 'wtw-big-south', 'daily-sales'];

/* -----------------------------------------------------------------------------
 * 11a. Perspective maths — fitting a flat rectangle onto a photographed wall
 *
 * The TVs in the plates are shot at an angle. An axis-aligned rectangle laid
 * over one of them visibly floats in front of the wall instead of sitting in
 * it. The fix is a 2D projective transform (a homography): the unique 8-DOF
 * map that sends our flat W x H iframe rectangle onto the four measured screen
 * corners in the photograph.
 *
 * Solve, then hand it to the compositor as a CSS matrix3d — the browser does
 * the per-pixel warp on the GPU, and hit-testing follows the transform, so the
 * button inside the plane stays clickable right up to a slanted corner.
 * -------------------------------------------------------------------------- */

/**
 * Solve A x = b by Gaussian elimination with partial pivoting.
 * Returns null for a singular / near-singular system rather than NaNs — a NaN
 * inside a transform blanks the element, which is a far worse failure than
 * quietly falling back to the axis-aligned box.
 *
 * @param {number[][]} A  n x n, mutated in place
 * @param {number[]}   b  length n, mutated in place
 * @returns {number[]|null}
 */
function solveLinearSystem(A, b) {
  const n = b.length;

  // Pivot tolerance has to be relative: the matrix mixes pixel coordinates
  // (~1e3) with products of them (~1e6), so a fixed epsilon is meaningless.
  let magnitude = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = Math.abs(A[r][c]);
    if (v > magnitude) magnitude = v;
  }
  const tol = 1e-12 * (magnitude || 1);

  for (let col = 0; col < n; col++) {
    // --- partial pivoting: swap in the largest available pivot -------------
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (!(Math.abs(A[pivot][col]) > tol)) return null;   // singular
    if (pivot !== col) {
      const rowTmp = A[pivot]; A[pivot] = A[col]; A[col] = rowTmp;
      const bTmp = b[pivot];   b[pivot] = b[col];  b[col] = bTmp;
    }
    // --- eliminate below ----------------------------------------------------
    const p = A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / p;
      if (!f) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }

  // --- back substitution ----------------------------------------------------
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum -= A[r][c] * x[c];
    x[r] = sum / A[r][r];
    if (!Number.isFinite(x[r])) return null;
  }
  return x;
}

/**
 * The 8-DOF projective solve.
 *
 * For each correspondence (x,y) -> (u,v), with h8 pinned to 1:
 *     u = (h0x + h1y + h2) / (h6x + h7y + 1)
 *     v = (h3x + h4y + h5) / (h6x + h7y + 1)
 * Cross-multiplied, that is two linear rows per point:
 *     h0x + h1y + h2                   - h6xu - h7yu = u
 *                     h3x + h4y + h5   - h6xv - h7yv = v
 * Four points give the 8x8 system.
 *
 * @param {Array<[number,number]>} src four source points
 * @param {Array<[number,number]>} dst four destination points
 * @returns {number[]|null} h0..h8 (h8 === 1), or null if degenerate
 */
function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solveLinearSystem(A, b);
  if (!h || h.some((n) => !Number.isFinite(n))) return null;
  h.push(1);                                   // h8
  return h;
}

/**
 * Lay a 3x3 homography into a CSS matrix3d.
 *
 * matrix3d is column-major 4x4. Our transform lives entirely in z=0, so the
 * third row/column is the identity and h6/h7 become the perspective terms in
 * the w row:  [h0,h3,0,h6,  h1,h4,0,h7,  0,0,1,0,  h2,h5,0,h8]
 *
 * Values are printed at 10 significant figures, NOT fixed decimals: h6/h7 are
 * on the order of 1e-4 and toFixed(6) would round the perspective away.
 */
function homographyToMatrix3d(h) {
  const m = [h[0], h[3], 0, h[6],
             h[1], h[4], 0, h[7],
             0,    0,    1, 0,
             h[2], h[5], 0, h[8]];
  if (m.some((n) => !Number.isFinite(n))) return null;
  return `matrix3d(${m.map((n) => Number(n.toPrecision(10))).join(',')})`;
}

/** Is this a usable quad: four finite points, convex, and non-degenerate area? */
function validQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) return false;
  return quad.every((pt) =>
    Array.isArray(pt) && pt.length >= 2 &&
    Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])));
}

/** Convexity + area check on the resolved pixel quad (catches collinear input). */
function isSaneQuad(pts) {
  let area = 0;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    area += a[0] * b[1] - b[0] * a[1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) return false;             // three points collinear
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;                    // bow-tie / concave
  }
  return Math.abs(area / 2) > 16;                         // at least 16 px^2
}

const dist2d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Parse `data-screen-quad` — eight numbers, TL,TR,BR,BL, in % of the plate:
 *   data-screen-quad="47,11.5, 84,5.6, 84,58.6, 47,57"
 * Also accepts a JSON array of pairs. Returns null when absent or malformed.
 */
function parseQuadAttr(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return validQuad(parsed) ? parsed : null;
    } catch { return null; }
  }
  const nums = text.split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length !== 8 || nums.some((n) => !Number.isFinite(n))) return null;
  return [[nums[0], nums[1]], [nums[2], nums[3]], [nums[4], nums[5]], [nums[6], nums[7]]];
}



/**
 * Mount a live screen onto a blank TV rectangle.
 *
 * Two geometries are supported:
 *
 *  · AXIS-ALIGNED (default) — `host` is positioned and sized directly over the
 *    screen rectangle. Right for near-frontal TVs, e.g. the two dining-room
 *    boards (Chicago at x 31.2 y 25.9 w 17.7 h 20.6, Big South at
 *    x 52.5 y 27.8 w 15.3 h 16.7).
 *
 *  · PERSPECTIVE — pass `quad`, four corners TL/TR/BR/BL in PERCENT of the
 *    plate, and the screen is warped onto the wall plane with a homography.
 *    Right for angled TVs, e.g. the host stand's Daily Sales Report at
 *    [[47.0,11.5],[84.0,5.6],[84.0,58.6],[47.0,57.0]].
 *    In this mode `host` is used only as the PERCENT REFERENCE BOX, so it
 *    should be a full-bleed layer over the plate (it is made click-through;
 *    only the warped plane is solid). Pass `quadRef` to measure the percentages
 *    against a different element instead.
 *
 * @param {object}  cfg
 * @param {Element} cfg.host        positioned element (screen box, or plate box with `quad`)
 * @param {string}  cfg.slug        tool slug (drives the click-through)
 * @param {Array<[number,number]>} [cfg.quad]  TL,TR,BR,BL in % of the reference box
 * @param {Element} [cfg.quadRef]   element the % are measured against (default: host)
 * @param {string}  [cfg.url]       defaults to the tool's url from tools.json
 * @param {string}  [cfg.title]     defaults to the tool's label
 * @param {number}  [cfg.width]     virtual render width, default 1280
 * @returns {{destroy:Function, refresh:Function, host:Element, slug:string}}
 */
export function mountScreen({
  host, slug, url, title, quad = null, quadRef = null, width = SCREEN_RENDER_WIDTH
} = {}) {
  if (!host || !host.nodeType) {
    console.warn('[overlay] mountScreen: no host element');
    return { destroy: noop, refresh: noop, host: null, slug };
  }
  injectStyles();

  // --- layers ---------------------------------------------------------------
  host.classList.add('ccc-screen');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const glass = el('div', { class: 'ccc-screen__glass' });
  const sheen = el('div', { class: 'ccc-screen__sheen', 'aria-hidden': 'true' });
  const bezel = el('div', { class: 'ccc-screen__bezel', 'aria-hidden': 'true' });

  // A real button, with a real accessible name. The decorative iframe below
  // is hidden from assistive tech entirely — this is the only thing AT sees.
  const label = el('span', { class: 'ccc-sr' });
  const hit = el('button', { class: 'ccc-screen__hit', type: 'button' }, [label]);
  hit.setAttribute('data-tool', slug);           // delegated handler picks it up

  // Everything visible goes inside ONE wrapper. In perspective mode that
  // wrapper carries the matrix3d, so glass, reflection, bezel and hit target
  // are warped together and stay locked to the screen plane. The hit button
  // lives inside it too, which means the browser's own hit-testing follows the
  // transform — a click on a slanted corner lands correctly, no clip-path
  // bookkeeping required.
  const plane = el('div', { class: 'ccc-screen__plane' }, [glass, sheen, bezel, hit]);
  host.append(plane);

  const rec = {
    host, slug, glass, hit, label, plane,
    quad: validQuad(quad) ? quad.map((pt) => [Number(pt[0]), Number(pt[1])]) : null,
    quadRef: quadRef && quadRef.nodeType ? quadRef : null,
    quadApplied: false,
    quadWarned: false,
    planeW: 0,
    planeH: 0,
    url: url || null,
    title: title || null,
    width,
    frame: null,
    mounted: false,
    wantsMount: false,
    destroyed: false,
    resizeObs: null,
    io: null
  };
  if (quad && !rec.quad) console.warn(`[overlay] screen "${slug}": malformed quad, using the host box`);
  state.screens.add(rec);
  applyGeometry(rec);                            // sizes the plane before any frame lands

  // Resolve url/title from the registry when it lands (may already be there).
  applyScreenMeta(rec);
  if (!state.ready) whenReady().then(() => applyScreenMeta(rec));

  // --- lazy mount gate -------------------------------------------------------
  // Only bring a screen to life when it is roughly within one-and-a-half
  // viewports. Anything further away is not worth a live iframe on an iPad.
  if ('IntersectionObserver' in window) {
    rec.io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        rec.wantsMount = entry.isIntersecting;
      }
      reconcileScreens();
    }, { root: null, rootMargin: '150% 0px 150% 0px', threshold: 0 });
    // Observe the PLANE, not the host: with a quad the host is a full-bleed
    // plate-sized box, so observing it would report the whole room.
    rec.io.observe(plane);
  } else {
    rec.wantsMount = true;
    reconcileScreens();
  }

  // Keep the scale honest through resizes / orientation changes.
  // The host is the size source (the quad is in % of it), so resize-watch that.
  if ('ResizeObserver' in window) {
    rec.resizeObs = new ResizeObserver(() => applyGeometry(rec));
    rec.resizeObs.observe(rec.quadRef || host);
    if ((rec.quadRef || host) !== host) rec.resizeObs.observe(host);
  }

  return {
    host, slug,
    refresh: () => applyGeometry(rec),
    destroy() {
      if (rec.destroyed) return;
      rec.destroyed = true;
      unmountScreen(rec);
      if (rec.io) rec.io.disconnect();
      if (rec.resizeObs) rec.resizeObs.disconnect();
      state.screens.delete(rec);
      plane.remove();
      host.classList.remove('ccc-screen', 'ccc-screen--quad', 'is-live');
    }
  };
}

/** Pull url/title off the registry once it exists. */
function applyScreenMeta(rec) {
  const tool = getTool(rec.slug);
  if (tool) {
    rec.url = rec.url || tool.url;
    rec.title = rec.title || tool.label;
  }
  const name = rec.title || rec.slug;
  rec.label.textContent = `Open ${name}`;
  rec.hit.setAttribute('aria-label', `Open ${name}`);
  if (rec.mounted && rec.frame && !rec.frame.src && rec.url) rec.frame.src = rec.url;
}

function refreshScreenLabels() {
  for (const rec of state.screens) applyScreenMeta(rec);
}

/**
 * Decide which screens are live right now.
 * Never more than MAX_LIVE_SCREENS iframes exist at once; when the budget is
 * tight, the screens nearest the viewport win.
 */
function reconcileScreens() {
  const all = Array.from(state.screens).filter((r) => !r.destroyed);

  // 1. Retire anything that has scrolled away.
  for (const rec of all) if (rec.mounted && !rec.wantsMount) unmountScreen(rec);

  // 2. Rank the candidates by distance from the viewport's centre.
  //    (A layout read, yes — but only in an IntersectionObserver callback,
  //    never inside the engine's rAF loop. SPEC rule respected.)
  const mid = window.innerHeight / 2;
  const dist = (rec) => {
    // The plane's rect is the warped bounding box in perspective mode, and
    // exactly the host box otherwise — right answer either way.
    const r = (rec.plane || rec.host).getBoundingClientRect();
    return Math.abs((r.top + r.height / 2) - mid);
  };

  let live = all.filter((r) => r.mounted);
  const waiting = all.filter((r) => r.wantsMount && !r.mounted)
    .map((r) => ({ rec: r, d: dist(r) }))
    .sort((a, b) => a.d - b.d);

  for (const cand of waiting) {
    if (live.length >= MAX_LIVE_SCREENS) {
      // Evict the furthest live screen, but only if it's genuinely further
      // away than the newcomer — otherwise thrashing.
      let worst = null, worstD = -1;
      for (const rec of live) { const d = dist(rec); if (d > worstD) { worstD = d; worst = rec; } }
      if (!worst || worstD <= cand.d) break;
      unmountScreen(worst);
      live = live.filter((r) => r !== worst);
    }
    mountFrame(cand.rec);
    live.push(cand.rec);
  }
}

/** Create the live iframe for a screen. */
function mountFrame(rec) {
  if (rec.mounted || rec.destroyed) return;

  const frame = el('iframe', {
    class: 'ccc-screen__frame',
    // Decorative. It is a picture of a TV, not content — AT must not see it.
    'aria-hidden': 'true',
    tabindex: '-1',
    loading: 'lazy',
    scrolling: 'no',
    title: '',
    referrerpolicy: 'no-referrer-when-downgrade'
  });
  frame.setAttribute('role', 'presentation');

  rec.frame = frame;
  rec.mounted = true;
  rec.glass.append(frame);
  applyGeometry(rec);

  frame.addEventListener('load', () => {
    if (rec.destroyed) return;
    // Fade the panel up as if it just woke from standby.
    rec.host.classList.add('is-live');
    applyGeometry(rec);
  }, { once: true });

  if (rec.url) frame.src = rec.url;              // else applyScreenMeta sets it
}

function unmountScreen(rec) {
  if (!rec.mounted) return;
  rec.mounted = false;
  rec.host.classList.remove('is-live');
  if (rec.frame) {
    // Just remove it. Removing an <iframe> destroys its nested browsing
    // context, which unloads the document and stops its timers and network on
    // the spot — and unlike navigating it to about:blank first (which is what
    // this used to do) it pushes NOTHING onto the session history. Same defect
    // class as the viewer frame: a screen unmounting on scroll was quietly
    // stacking entries that closeTool()'s history.back() would then unwind.
    rec.frame.remove();
    rec.frame = null;
  }
}

/**
 * Resolve the quad's percentages into host-local pixels.
 * Returns null if the reference box has no size yet, or if the resulting quad
 * is degenerate (collinear / bow-tie) — the caller then falls back cleanly.
 */
function resolveQuadPx(rec, hostRect) {
  const ref = rec.quadRef;
  let ox = 0, oy = 0, rw = hostRect.width, rh = hostRect.height;

  if (ref && ref !== rec.host) {
    const rb = ref.getBoundingClientRect();
    if (!rb.width || !rb.height) return null;
    ox = rb.left - hostRect.left;                // into the host's own frame
    oy = rb.top - hostRect.top;
    rw = rb.width; rh = rb.height;
  }
  if (!rw || !rh) return null;

  const pts = rec.quad.map(([x, y]) => [ox + (x / 100) * rw, oy + (y / 100) * rh]);
  return isSaneQuad(pts) ? pts : null;
}

/**
 * Position the screen plane, then fit the iframe inside it.
 *
 * PERSPECTIVE PATH: the plane is given a flat W x H pixel box (W and H taken
 * from the averaged edge lengths of the target quad, so the pre-warp render
 * resolution is close to the on-screen size and text stays crisp), then warped
 * onto the measured corners with a matrix3d. `transform-origin: 0 0` is what
 * makes the solve valid — the homography is derived for a source rectangle
 * whose top-left corner is the origin.
 *
 * If anything about the quad is degenerate we fall back to the axis-aligned
 * box rather than emit NaN into a transform (which blanks the element).
 */
function applyGeometry(rec) {
  if (rec.destroyed || !rec.plane) return;

  const hostRect = rec.host.getBoundingClientRect();
  if (!hostRect.width || !hostRect.height) return;   // not laid out yet

  let applied = false;

  if (rec.quad) {
    const dst = resolveQuadPx(rec, hostRect);
    if (dst) {
      // Averaged opposing edges: the best single flat size for this quad.
      const W = Math.max(8, Math.round((dist2d(dst[0], dst[1]) + dist2d(dst[3], dst[2])) / 2));
      const H = Math.max(8, Math.round((dist2d(dst[0], dst[3]) + dist2d(dst[1], dst[2])) / 2));
      const h = computeHomography([[0, 0], [W, 0], [W, H], [0, H]], dst);
      const matrix = h && homographyToMatrix3d(h);
      if (matrix) {
        rec.plane.style.width = `${W}px`;
        rec.plane.style.height = `${H}px`;
        rec.plane.style.transform = matrix;
        rec.planeW = W;
        rec.planeH = H;
        applied = true;
      }
    }
    if (!applied && !rec.quadWarned) {
      rec.quadWarned = true;
      console.warn(`[overlay] screen "${rec.slug}": degenerate quad, falling back to the host box`);
    }
  }

  if (!applied) {
    rec.plane.style.width = '';
    rec.plane.style.height = '';
    rec.plane.style.transform = '';
    rec.planeW = hostRect.width;
    rec.planeH = hostRect.height;
  }

  rec.quadApplied = applied;
  rec.host.classList.toggle('ccc-screen--quad', applied);
  fitFrame(rec);
}

/**
 * Scale the iframe so a 1280px-wide desktop render exactly fills the plane.
 * transform-origin:top left keeps the maths trivial: the frame's top-left is
 * the plane's top-left, and everything else falls out of one uniform scale.
 *
 * Note we use the plane's UNTRANSFORMED size (planeW/planeH), never a
 * getBoundingClientRect — under matrix3d that rect is the warped bounding box
 * and would feed the wrong number straight back into the scale.
 */
function fitFrame(rec) {
  if (!rec.frame || rec.destroyed) return;
  const w = rec.planeW, h = rec.planeH;
  if (!w || !h) return;

  const scale = w / rec.width;                   // uniform: no distortion
  const vh = Math.round(h / scale);              // virtual height that fills it

  rec.frame.style.width = `${rec.width}px`;
  rec.frame.style.height = `${vh}px`;
  rec.frame.style.transform = `scale(${scale.toFixed(5)})`;
}

/**
 * Convenience for the integrator: mount every `[data-screen="<slug>"]` box
 * found under `root`. In this build that is three elements —
 * `wtw-chicago` and `wtw-big-south` side by side in the dining room, and
 * `daily-sales` on the big screen at the host stand.
 *
 * @param {ParentNode} [root=document]
 * @returns {Array} screen handles
 */
export function mountRoomScreens(root = document) {
  const hosts = Array.from(root.querySelectorAll('[data-screen]'));
  return hosts
    .filter((host) => !host.classList.contains('ccc-screen'))
    .map((host) => mountScreen({
      host,
      slug: host.getAttribute('data-screen'),
      url: host.getAttribute('data-screen-url') || undefined,
      title: host.getAttribute('data-screen-title') || undefined,
      quad: parseQuadAttr(host.getAttribute('data-screen-quad')),
      width: Number(host.getAttribute('data-screen-width')) || SCREEN_RENDER_WIDTH
    }));
}

/* Re-rank screens after orientation changes (the iPad case). Cheap and rare. */
window.addEventListener('orientationchange', () => {
  setTimeout(() => { for (const rec of state.screens) applyGeometry(rec); reconcileScreens(); }, 200);
});

/** Exposed for the integrator / debugging. */
export const SCREENS = SCREEN_SLUGS;

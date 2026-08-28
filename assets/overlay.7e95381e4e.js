/* =============================================================================
 * Cook County Cooks — v3 "Cinema"
 * assets/overlay.js  ·  Agent B  ·  the full-screen tool viewer
 * -----------------------------------------------------------------------------
 * A tool should never feel like "a github.io link". It should feel like a thing
 * inside the restaurant that you walked up to and switched on.
 *
 *   initOverlay()  — the full-screen tool viewer. Clicking any
 *                    [data-tool="<slug>"] opens that tool in a framed,
 *                    chrome-wrapped, deep-linkable, modal viewer.
 *
 * The room screens used to live here too. They are assets/screens.js now; the
 * only thing that connects the two is `data-tool` on a screen's hit target,
 * which the delegated handler below picks up like any other trigger.
 *
 * Contract notes (see SPEC.md):
 *   · Plain ES module. No dependencies. No build step.
 *   · Only transform / opacity / filter are animated.
 *   · This module never writes the engine's stage vars and never sets
 *     `transform` on `.plate-wrap`. It owns its own layers only.
 *   · prefers-reduced-motion is honoured for every animation here.
 *
 * Exports:
 *   initOverlay(options)  -> { open, close, isOpen, setGate, registry, ready }
 *   openTool(slug), closeTool()
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * 0. Constants & tiny helpers
 * -------------------------------------------------------------------------- */

/** How long we wait for a framed tool before we assume it refused to frame. */
const FRAME_TIMEOUT_MS = 6000;

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
 *    custom property with a fallback, so assets/theme.afa48f2d91.css (Agent D) can
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
.ccc-ov__btn:focus-visible {
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

@media (prefers-reduced-motion: reduce) {
  .ccc-ov, .ccc-ov__panel, .ccc-ov__frame { transition: none; }
  .ccc-ov__skel::after { animation: none; }
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
/* ──────────────────────────────────────────────────────────────────────────
 * FRESH-LOAD CACHE BUSTING
 *
 * The client: "I have made changes to my repositories on the backend but the
 * changes aren't loading on the repositories we have baked into the website.
 * I want to ensure that new changes to the repositories would also be visible
 * ... essentially, it would be a fresh load every time we pull up the
 * repository."
 *
 * Every embedded tool is a GitHub Pages site, and Pages serves its HTML with a
 * cache lifetime of its own. A rep who opened a quote sheet an hour ago gets
 * that hour-old copy back from the browser's HTTP cache, so a fix pushed to the
 * repo in between is invisible inside the frame while the same URL opened in a
 * new tab is correct — exactly the mismatch he photographed.
 *
 * Appending a unique parameter makes each open a distinct URL, which no cache
 * can satisfy, so the frame always fetches the current build. We keep the
 * parameter namespaced (`_ccc`) and preserve any query string the tool already
 * carries. Only the document request is affected; the tool's own sub-resources
 * still cache normally, so this costs one small round trip, not a cold load.
 * ────────────────────────────────────────────────────────────────────────── */
export function freshUrl(url, bucketMs) {
  try {
    const u = new URL(url, location.href);
    // Same-origin pages on this site are content-hashed already; busting them
    // would defeat that and re-download our own assets on every open.
    if (u.origin === location.origin) return u.href;
    const stamp = bucketMs
      ? Math.floor(Date.now() / bucketMs)   // shared bucket: refresh, don't hammer
      : Date.now();                          // every open is its own fetch
    u.searchParams.set('_ccc', String(stamp));
    return u.href;
  } catch {
    return url;                              // never let this break a navigation
  }
}

function navigateStageFrame(ui, url) {
  const fresh = makeStageFrame();
  ui.frame.replaceWith(fresh);          // keeps its slot/order inside the stage
  ui.frame = fresh;
  fresh.src = freshUrl(url);            // initial navigation: replaces, no push
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
 * @param {Array}   [options.tools]     tools array (as in data/tools.ac8a24642f.json). If
 *                                      omitted we look at window.CCC_TOOLS /
 *                                      window.CCC?.tools, then fetch toolsUrl.
 * @param {string}  [options.toolsUrl]  default 'data/tools.ac8a24642f.json'
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
    toolsUrl = 'data/tools.ac8a24642f.json',
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
 * 11. THE SCREENS MOVED OUT
 * -----------------------------------------------------------------------------
 * mountScreen() / mountRoomScreens() used to live here, and the v3 header above
 * still describes them. They are now assets/screens.js, which renders four
 * different kinds of surface (title card, promo image, live data board, real
 * iframe) instead of the one kind this file knew how to make.
 *
 * The two modules still meet in exactly one place: every screen's hit target
 * carries `data-tool`, so onDocumentClick() below opens the tool. That means the
 * freezer gate, the deep-link router and the focus-return all keep working with
 * no knowledge of screens at all. Do not re-add a screen API here.
 * ========================================================================== */

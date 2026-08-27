/* =============================================================================
 * Cook County Cooks — v3 "Cinema"
 * assets/app.js  ·  THE INTEGRATOR
 * -----------------------------------------------------------------------------
 * The four feature modules (engine, overlay, chefwall, theme) know nothing about
 * each other. This file is the only place that does. Its whole job is:
 *
 *   1. turn rooms.js geometry + tools.json data into the DOM contract in SPEC.md
 *   2. hand each module the exact hooks its own doc comment asks for
 *   3. boot them in the one order that works
 *
 * WHAT THIS FILE MAY NOT DO — read this before editing:
 *   · It must never write --p, --plate-scale, --plate-x, --plate-y, --enter or
 *     --bloom. Those six numbers belong to engine.js alone (SPEC.md §"CSS custom
 *     properties"). Everything cinematic is composed in theme.css from them.
 *   · It must never set transform on .plate-wrap.
 *   · It must never introduce a CSS class theme.css does not already style, and
 *     it must never turn on `scroll-behavior: smooth` (see NOTE 1 below).
 *
 * NOTE 1 — the scroll-behavior land mine.
 *   theme.css §03 sets `html { scroll-behavior: smooth }`. engine.js implements
 *   scrollToRoom() as a per-frame `window.scrollTo(0, y)` tween inside its own
 *   rAF loop. With CSS smooth scrolling on, EVERY one of those ~60 writes starts
 *   its own native smooth animation, the two fight, and the top menu ends up
 *   crawling to the wrong place — the exact bug that broke v2's menu. We turn it
 *   off from here, on the element, at boot. This is the countermeasure, not a
 *   violation of the "never smooth" rule.
 *
 * NOTE 2 — why some hosts are full-bleed.
 *   theme.css §09 sizes every direct child of .hotspots from --x/--y/--w/--h
 *   (defaulting to 10% x 10%). chefwall.js and a perspective screen both want a
 *   host that is the WHOLE plate box, because their own percentages are measured
 *   in plate space. So those hosts are given --w:100%/--h:100% explicitly rather
 *   than being allowed to fall through to the 10% default.
 *
 * Plain ES module. No build step, no npm, no framework, no external JS.
 * ========================================================================== */

import { initEngine, scrollToRoom, onRoomChange } from './engine.js';
import { initOverlay, mountRoomScreens, openTool } from './overlay.js';
import { initChefWall } from './chefwall.js';
import { ROOM_ORDER, HOTSPOTS, CHEF_FRAMES } from '../rooms.js';


/* ─────────────────────────────────────────────────────────────────────────────
 * 0 · TINY DOM HELPERS
 * Deliberately minimal — this is not a framework, it is four functions.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Build an element in one breath.
 * `class`, `text` and `style` are special-cased; anything else becomes an
 * attribute, so data-* and aria-* work without ceremony. A `false`/`null` value
 * omits the attribute entirely, which keeps the callers below free of `if`s.
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/** Replace an element's children in one shot. */
function fill(node, children) {
  node.replaceChildren(...[].concat(children).filter(Boolean));
  return node;
}

const $ = (sel, root = document) => root.querySelector(sel);

/** Ordinal words for the course kickers. Seven rooms; no need to be clever. */
const COURSE = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** Is this URL somewhere other than our own origin? Drives target="_blank". */
function isExternal(url) {
  try { return new URL(url, document.baseURI).origin !== location.origin; }
  catch { return false; }
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 1 · DATA
 *
 * index.html inlines both JSON payloads on window.__CCC_INLINE__ because
 * fetch() against a file:// URL is CORS-blocked — the site has to open straight
 * off disk for local review. Every real deployment could fetch instead; we keep
 * the fetch path as a fallback so the module still works if the inline block is
 * ever dropped.
 * ────────────────────────────────────────────────────────────────────────── */

/** Per-room art direction: where the practical lights are, and how to crop.
 *  --focus-x / --focus-y / --glow-x / --glow-y are documented per-room overrides in
 *  theme.css §06. They are the only custom properties this file writes on a
 *  .room, and none of them belong to the engine. Values eyeballed off the
 *  actual renders (see all-rooms.png). */
const ROOM_ART = {
  hero:      { focus: '50% 45%', glowX: '50%', glowY: '20%' },
  pass:      { focus: '50% 58%', glowX: '50%', glowY: '28%' },
  host:      { focus: '52% 44%', glowX: '22%', glowY: '16%' },
  dining:    { focus: '50% 40%', glowX: '50%', glowY: '24%' },
  prep:      { focus: '46% 46%', glowX: '60%', glowY: '22%' },
  office:    { focus: '60% 50%', glowX: '50%', glowY: '16%' },
  breakroom: { focus: '46% 48%', glowX: '34%', glowY: '16%' },
  freezer:   { focus: '46% 50%', glowX: '66%', glowY: '14%' }
};

/**
 * The room's inline custom properties.
 *
 * `focus` stays authored as an object-position pair because that is how anyone
 * eyeballing a crop thinks about it, but theme.css §06 needs it as two unitless
 * fractions: .plate-wrap and .hotspots are both sized to the plate's COVER box
 * and offset by the crop, so the SAME numbers have to move both layers or the
 * hotspots come off their objects.
 */
function roomVars(art) {
  const [fx, fy] = String(art.focus || '50% 50%').trim().split(/\s+/);
  const frac = (v, fallback) => {
    const num = parseFloat(v);
    return Number.isFinite(num) ? (num / 100).toFixed(4) : fallback;
  };
  return `--focus-x:${frac(fx, '0.5')};--focus-y:${frac(fy, '0.5')};` +
         `--glow-x:${art.glowX || '62%'};--glow-y:${art.glowY || '30%'}`;
}

/** The generated plates are 2400x1340 (and 1400x781 for the @1400 cut). */
const PLATE_W = 2400;
const PLATE_H = 1340;

async function loadData() {
  const inline = window.__CCC_INLINE__;
  if (inline && inline.tools && inline.headchefs) return inline;

  // Fallback for a served deployment where the inline block was removed.
  const [tools, headchefs] = await Promise.all([
    fetch('data/tools.json').then((r) => r.json()),
    fetch('headchefs/headchefs.json').then((r) => r.json())
  ]);
  return { tools, headchefs };
}

/** Everything derived from tools.json, computed once. */
function indexTools(toolsDoc) {
  const rooms = toolsDoc.rooms || [];
  const tools = toolsDoc.tools || [];

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const bySlug = new Map(tools.map((t) => [t.slug, t]));

  // Room -> tools, in tools.json order. Every room key exists even if empty, so
  // callers never have to null-check.
  const byRoom = new Map(ROOM_ORDER.map((id) => [id, []]));
  for (const tool of tools) {
    if (!byRoom.has(tool.room)) byRoom.set(tool.room, []);
    byRoom.get(tool.room).push(tool);
  }

  return { rooms, tools, roomById, bySlug, byRoom };
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 2 · THE FREEZER GATE
 *
 * Carried over VERBATIM from the v2 bundle so a manager who unlocked yesterday
 * is not locked out by the rebuild. The contract, in full:
 *
 *   unlocked  ⇔  sessionStorage['c3f-unlocked'] === '1'  OR  a `c3f=` cookie
 *   unlock    ⇔  POST /api/freezer-unlock {"password": "..."}
 *                  2xx          -> unlocked
 *                  401 / 403    -> wrong code
 *                  404/405/501  -> UNLOCKED. The Cloudflare Worker does not
 *                                  exist yet; a site that hard-locks its own
 *                                  managers out until an endpoint ships is
 *                                  worse than a soft gate. This is deliberate.
 *                  anything else-> transient error, ask them to retry
 *                  network throw-> UNLOCKED, same reasoning as 404
 *
 * This is a courtesy gate, not a security boundary — it always was. Anything
 * that must actually be secret belongs behind auth on the tool itself.
 * ────────────────────────────────────────────────────────────────────────── */

const FREEZER_SESSION_KEY = 'c3f-unlocked';
const FREEZER_COOKIE = 'c3f=';
const FREEZER_ENDPOINT = '/api/freezer-unlock';

/** Subscribers re-render themselves when the door opens. */
const unlockListeners = [];

function isFreezerUnlocked() {
  try { if (sessionStorage.getItem(FREEZER_SESSION_KEY) === '1') return true; }
  catch { /* private mode / storage disabled — fall through to the cookie */ }
  return document.cookie.split('; ').some((c) => c.startsWith(FREEZER_COOKIE));
}

function onFreezerUnlock(cb) { unlockListeners.push(cb); }

function markFreezerUnlocked() {
  try { sessionStorage.setItem(FREEZER_SESSION_KEY, '1'); } catch { /* noop */ }
  unlockListeners.forEach((cb) => { try { cb(true); } catch (err) { console.error(err); } });
}

/** @returns {Promise<'ok'|'wrong'|'error'>} */
async function submitFreezerCode(code) {
  if (!code) return 'wrong';
  try {
    const res = await fetch(FREEZER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: code })
    });
    if (res.ok) { markFreezerUnlocked(); return 'ok'; }
    if (res.status === 401 || res.status === 403) return 'wrong';
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      markFreezerUnlocked();          // endpoint not deployed yet — see above
      return 'ok';
    }
    return 'error';
  } catch {
    markFreezerUnlocked();            // offline / file:// — see above
    return 'ok';
  }
}

/* ── The keypad dialog ────────────────────────────────────────────────────────
 * theme.css §15 now ships the `.keypad*` component — a cold-storage access
 * panel: brushed steel, a mint LCD readout, keys that travel, and an
 * `.is-wrong` state. All presentation lives there; this function only builds
 * the structure and owns the behaviour. It mounts into #modal-root, the
 * container index.html declares for it.
 *
 * The one class this file toggles is `.is-wrong` on the panel — added when the
 * lock rejects a code, removed on the next keystroke so the alert clears the
 * moment the user starts over.
 * ───────────────────────────────────────────────────────────────────────── */

/** Only ever one keypad on screen. Resolves true when the door opens. */
function openKeypad() {
  const root = $('#modal-root');
  if (!root || root.firstChild) return Promise.resolve(false);

  return new Promise((resolve) => {
    const returnFocus = document.activeElement;

    const input = el('input', {
      type: 'password', inputmode: 'text', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: 'false',
      'aria-label': 'Freezer code', class: 'keypad-readout'
    });
    const msg = el('p', { class: 'micro keypad-msg', role: 'alert', 'aria-live': 'assertive' });

    const keyBtn = (key, label) => el('button', {
      type: 'button', 'data-key': key, class: 'keypad-key', text: label
    });
    const grid = el('div', { class: 'keypad-keys' }, [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => keyBtn(String(n), String(n))),
      keyBtn('clear', 'CLR'),
      keyBtn('0', '0'),
      keyBtn('back', '⌫')
    ]);

    const cancel = el('button', { type: 'button', class: 'chip', 'data-act': 'cancel', text: 'Cancel' });
    const unlock = el('button', { type: 'button', class: 'btn', 'data-act': 'unlock', text: 'Unlock' });

    const panel = el('div', {
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'keypad-title',
      class: 'keypad'
    }, [
      el('h2', { class: 't-sub', id: 'keypad-title', text: 'Walk-In Freezer' }),
      el('p', { class: 'micro', text: 'Manager access. Enter the freezer code to open cold storage.' }),
      el('hr', { class: 'rule' }),
      input, grid, msg,
      el('div', { class: 'keypad-actions' }, [cancel, unlock])
    ]);

    const scrim = el('div', { class: 'keypad-scrim' }, [panel]);
    root.append(scrim);
    input.focus();

    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeydown, true);
      scrim.remove();
      if (returnFocus && returnFocus.focus) returnFocus.focus();
      resolve(ok);
    };

    // Re-arm the shake: removing and re-adding the class on the next frame is
    // what makes a second wrong code animate again rather than sit still.
    const flagWrong = () => {
      panel.classList.remove('is-wrong');
      void panel.offsetWidth;                 // one deliberate reflow, off-loop
      panel.classList.add('is-wrong');
    };

    const attempt = async () => {
      msg.textContent = '';
      panel.classList.remove('is-wrong');
      unlock.setAttribute('aria-disabled', 'true');
      const result = await submitFreezerCode(input.value.trim());
      unlock.removeAttribute('aria-disabled');
      if (result === 'ok') { finish(true); return; }
      flagWrong();
      msg.textContent = result === 'wrong'
        ? 'That code didn’t open the door. Try again.'
        : 'Couldn’t reach the lock. Try again in a moment.';
      input.select();
    };

    scrim.addEventListener('click', (ev) => {
      if (ev.target === scrim) { finish(false); return; }
      const key = ev.target.closest('[data-key]');
      if (key) {
        panel.classList.remove('is-wrong');
        const k = key.dataset.key;
        if (k === 'clear') input.value = '';
        else if (k === 'back') input.value = input.value.slice(0, -1);
        else input.value += k;
        input.focus();
        return;
      }
      const act = ev.target.closest('[data-act]');
      if (act && act.dataset.act === 'cancel') finish(false);
      if (act && act.dataset.act === 'unlock') attempt();
    });

    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') attempt(); });
    input.addEventListener('input', () => panel.classList.remove('is-wrong'));

    // Escape closes; Tab is trapped inside the panel so focus cannot wander out
    // to the page underneath while a modal dialog is up.
    function onKeydown(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); return; }
      if (ev.key !== 'Tab') return;
      const focusables = panel.querySelectorAll('button, input, [href]');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeydown, true);
  });
}

/* The gate is installed ON overlay.js in boot(), through its canOpen /
 * onRefused options. There used to be a capture-phase click interceptor here.
 * It is gone, because it only ever guarded CLICKS: a deep link to
 * `#/tool/punch-audit` went through overlay's own syncFromLocation() and opened
 * a manager tool with the door still shut and sessionStorage still empty. The
 * gate now sits inside openTool() itself, so every path reaches it — click,
 * keyboard, hash sync on load, and the openTool re-exported on window.CCC.
 */

/* ─────────────────────────────────────────────────────────────────────────────
 * 3 · ROOMS — the DOM contract from SPEC.md, built from rooms.js + tools.json
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The cinematic plate.
 *
 * ── WHY `sizes` IS NOT `100vw`, AND WHY THAT IS THE HONEST VALUE ──────────
 * The old comment here claimed an iPad would take the 1400w cut. It never did.
 * Two things were wrong with the reasoning:
 *
 *   1. DPR. Every shipping iPad is DPR 2, so `sizes: 100vw` asks for 2 device
 *      pixels per CSS pixel — 2048px in portrait, 2732px in landscape — and the
 *      2400w plate won every single time. Measured `currentSrc` at DPR 2, not
 *      DPR 1, confirms it: 154KB per plate instead of 68KB, and ~2.2x the raster
 *      area and layer memory, feeding straight into compositor cost.
 *   2. The cover box. theme.css §06 sizes .plate-wrap to
 *      `max(100cqw, 100svh * 1.79)`, so in a PORTRAIT viewport the plate is far
 *      wider than the viewport — 2446 CSS px on a 1024x1366 iPad. `100vw` was
 *      never the real box in the first place; it was under-declared already and
 *      simply saturated at the largest candidate.
 *
 * The mathematically-correct value would ask for ~4900 device pixels on an iPad
 * and there is no such plate.
 *
 * ── CORRECTED 2026-08-26 ──────────────────────────────────────────────────
 * The old value here was `(max-width: 1400px) 65vw, 100vw`, a deliberate
 * under-declaration that traded resolution for raster area. That trade was
 * sound when theme.css sized .plate-wrap to `inset: -5%` — a 110vw box. It is
 * not sound now: §06 sizes the wrap to the plate's COVER box, which on a
 * portrait viewport is `100svh * 1.79104`, i.e. 258vw on an iPad in portrait.
 * Declaring 65vw against a 258vw box asked the browser for a quarter of the
 * pixels the layout actually uses, and it correctly obliged: the 1400w cut,
 * upscaled 3.7x, was being painted into a 5186-device-pixel box. Rendered and
 * compared side by side against the 2400w cut at true device resolution, the
 * difference is not subtle — mushy lamp rims, no brick texture, smeared
 * speculars on the steel. Exactly the kind of soft photograph this client
 * rejects builds over.
 *
 * So `sizes` now describes the real box. Two branches, no calc() or max(),
 * because both have to work inside <link imagesizes> too:
 *
 *   viewport wider than the plate  -> the cover box is 100vw  -> 110vw
 *   viewport taller than the plate -> the cover box is 179.1vh -> 197vh
 *
 * (110 and 197 fold in theme.css's --overscan-k of 1.10.) Where that lands:
 *
 *   820x1180  DPR2 (iPad portrait)  -> 4649px -> 2400w
 *   1180x820  DPR2 (iPad landscape) -> 3230px -> 2400w
 *   1366x1024 DPR2 (iPad Pro land.) -> 4034px -> 2400w
 *   1440x900  DPR1 (store desktop)  -> 1773px -> 1800w
 *   2560x1440 DPR1                  -> 2837px -> 2400w
 *
 * iPad now takes the 2400 cut on both orientations, which is the honest answer:
 * a 16:9 plate cover-cropped into a portrait viewport genuinely needs its full
 * width. Cost is ~180KB per plate over the 1400 cut, on lazy images, on store
 * wifi. Verify any change to this line with `currentSrc` at
 * `deviceScaleFactor: 2`, and keep index.html's imagesizes identical.
 *
 * ── LOADING, WITH THE REAL NUMBERS ───────────────────────────────────────
 * Only the hero is eager. `pass` used to be too, but Chrome's lazy threshold is
 * generous enough that it — and `host`, the THIRD plate — are fetched at first
 * paint anyway at every viewport, so marking them eager only took bandwidth off
 * the hero, which is the LCP element. `lazy` does not stop that fetch; the
 * `fetchpriority: low` below is what keeps it from racing the hero.
 *
 * Measured cold load, not guessed (an earlier version of this comment claimed
 * ~230KB and was wrong by more than 2x, which is how the DPR bug above survived
 * so long — so these are `content-length` sums off a real navigation):
 *
 *   iPad portrait  1024x1366 DPR2   4 plates   370KB   (was 536KB / 3 plates)
 *   iPad landscape 1366x1024 DPR2   4 plates   546KB   (was 536KB / 3 plates)
 *   phone           390x844  DPR2   5 plates   462KB
 *   store desktop  2560x1440 DPR1   3 plates   536KB   (unchanged, correctly)
 *
 * Per plate is the number that moved and the number that matters for the
 * compositor: 68-92KB instead of 154-180KB, and roughly 0.45x the raster area.
 * The count of plates Chrome decides to pull at first paint is a function of the
 * room runway (--room-run, theme.css §02), not of anything this file controls.
 */
function buildPlate(room, index) {
  const eager = index === 0;              // the hero, and only the hero
  return el('img', {
    class: 'plate',
    src: `plates/${room}.webp`,
    srcset: `plates/${room}@1400.webp 1400w, `
          + `plates/${room}@1800.webp 1800w, `
          + `plates/${room}.webp 2400w`,
    sizes: '(min-aspect-ratio: 2400/1340) 110vw, 197vh',
    width: String(PLATE_W),
    height: String(PLATE_H),
    alt: '',                              // decorative: the rail names the room
    decoding: 'async',
    loading: eager ? 'eager' : 'lazy',
    // Chrome's lazy threshold still pulls three or four plates at first paint,
    // so `lazy` alone does not stop them competing with the hero. `low` does:
    // they are fetched when the network is otherwise idle instead of alongside
    // the LCP image, the stylesheet and the fonts.
    fetchpriority: eager ? 'high' : 'low'
  });
}

function buildPlateWrap(room, index) {
  return el('div', { class: 'plate-wrap' }, [
    buildPlate(room, index),
    el('div', { class: 'plate-glow', 'aria-hidden': 'true' }),
    el('div', { class: 'plate-vig', 'aria-hidden': 'true' })
  ]);
}

/** Percent geometry in the form theme.css §09 documents. */
function boxVars(x, y, w, h) {
  return `--x:${x}%;--y:${y}%;--w:${w}%;--h:${h}%`;
}

/** The whole plate box — used by hosts whose own percentages are plate-space. */
const FULL_BLEED = boxVars(0, 0, 100, 100);

/**
 * One hotspot. `kind` decides what it becomes:
 *
 *   'tool'   a real <button data-tool>. overlay.js's delegated click handler
 *            picks it up; the visible .hotspot-label is its accessible name.
 *   'screen' a bare host carrying overlay.js's data-screen-* attributes, which
 *            mountRoomScreens() reads. A quad screen's host must be FULL-BLEED
 *            because mountScreen() resolves quad percentages against the host
 *            box and mountRoomScreens() passes no quadRef.
 *   'chefs'  a full-bleed host for chefwall.js (mounted later, in boot()).
 *   'lock'   the freezer keypad. Styled as a .hotspot but carries no data-tool.
 */
function buildHotspot(spot, data) {
  if (spot.kind === 'chefs') {
    // Marked so boot() can find it without another selector convention.
    return el('div', { 'data-chefwall-host': '', style: FULL_BLEED });
  }

  if (spot.kind === 'screen') {
    const tool = data.bySlug.get(spot.slug);
    const host = el('div', {
      'data-screen': spot.slug,
      'data-screen-title': spot.label || (tool && tool.label) || '',
      'data-screen-quad': spot.quad ? JSON.stringify(spot.quad) : null,
      // position:absolute is forced INLINE and is not optional. overlay.js
      // injects `.ccc-screen { position: relative }` into a stylesheet appended
      // after theme.css, so at equal specificity it beats theme.css's
      // `.hotspots > * { position: absolute }`. A relative host offsets from its
      // NORMAL FLOW position, which stacks the second screen in a room below the
      // first — the Big South board rendered 172px under its bezel, hanging in
      // mid-air over the banquettes. Inline wins over both sheets. Absolute is
      // still a positioned ancestor, so mountScreen() is satisfied either way.
      style: (spot.quad
        ? FULL_BLEED
        // Axis-aligned screens are hit-tested through their own host, and
        // .hotspots is pointer-events:none, so the host has to opt back in.
        // (Quad screens must NOT: overlay's .ccc-screen--quad rule makes the
        // full-bleed reference box click-through on purpose.)
        : boxVars(spot.x, spot.y, spot.w, spot.h) + ';pointer-events:auto'
      ) + ';position:absolute'
    });
    return host;
  }

  if (spot.kind === 'lock') {
    return el('button', {
      type: 'button',
      class: 'hotspot',
      'data-freezer-lock': '',
      style: boxVars(spot.x, spot.y, spot.w, spot.h)
    }, [
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      el('span', { class: 'hotspot-label', text: spot.label || 'Manager access' })
    ]);
  }

  // kind: 'tool'
  const tool = data.bySlug.get(spot.slug);
  return el('button', {
    type: 'button',
    class: 'hotspot',
    'data-tool': spot.slug,
    'data-edge': spot.edge || null,        // theme.css flips the label inboard
    style: boxVars(spot.x, spot.y, spot.w, spot.h)
  }, [
    el('span', { class: 'dot', 'aria-hidden': 'true' }),
    el('span', { class: 'hotspot-label', text: spot.label || (tool && tool.label) || spot.slug })
  ]);
}

/**
 * The rail: kicker, title, rule, tagline, and a chip for EVERY tool in the room.
 *
 * The chip list is the client's hard requirement ("links must be easy to find"):
 * a tool with no hotspot — every one of the freezer's manager tools, the head
 * chef wall — is still one tap away here, and below 900px theme.css turns this
 * same list into the full-width drawer because hotspots are suppressed there.
 */
function buildRail(roomId, index, data) {
  const meta = data.roomById.get(roomId) || { label: roomId, tagline: '' };
  const tools = data.byRoom.get(roomId) || [];
  const titleId = `room-${roomId}-title`;
  // The freezer is the only gated room, and its chips have to LOOK gated.
  const gated = roomId === 'freezer' && !isFreezerUnlocked();

  const chips = el('nav', {
    class: 'rail-chips',
    // Room labels carry their own article ("The Pass"), so there is no "the"
    // here — with one it read "Tools in the The Pass".
    'aria-label': `Tools in ${meta.label}`,
    'data-room-chips': roomId
  }, tools.map((tool, i) => buildChip(tool, gated, i)));

  return el('div', { class: 'rail' }, [
    // The ticket rail numbers the seven rooms 01..07; `index` counts the hero as
    // 0, so the kicker has to step back one or the menu and the room contradict
    // each other by a whole course while both are on screen.
    el('p', { class: 'rail-kicker', text: `Course ${COURSE[index - 1] || index}` }),
    el('h2', { class: 'rail-title', id: titleId, text: meta.label }),
    el('hr', { class: 'rail-rule' }),
    el('p', { class: 'rail-tagline', text: meta.tagline || '' }),
    chips
  ]);
}

/* A small padlock, sized by attribute so it needs no stylesheet of its own.
   It sits alongside the chip's brass tick rather than replacing it: the tick is
   a ::before and only theme.css can swap that (see the report). */
const PADLOCK_SVG =
  '<svg width="10" height="12" viewBox="0 0 11 13" fill="currentColor" ' +
  'aria-hidden="true" focusable="false" style="flex:none"><rect x="0" y="5" ' +
  'width="11" height="8" rx="1.5"/><path d="M2.5 6V3.5a3 3 0 0 1 6 0V6" ' +
  'fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

/**
 * One rail chip.
 *
 * A gated chip has to announce itself BEFORE it is pressed — a chip identical to
 * every other chip that then produces an unexpected modal is a worse affordance
 * than a visibly locked one. So it carries a padlock, a dimmed ground, an
 * accessible name that says "locked", and `aria-haspopup="dialog"` so assistive
 * tech warns that a dialog is coming rather than a page.
 *
 * `data-locked` is the hook theme.css can style properly; the inline opacity is
 * a stopgap until it does, and it doubles as the transition the unlock beat
 * below animates.
 */
function buildChip(tool, gated, i) {
  const chip = el('button', {
    type: 'button',
    class: 'chip',
    'data-tool': tool.slug,
    'data-locked': gated ? '' : null,
    'aria-haspopup': gated ? 'dialog' : null,
    'aria-label': gated ? `${tool.label} — locked` : null,
    // The per-chip delay is what turns the unlock into a beat, not a flash.
    style: gated
      ? `opacity:.72;transition:opacity 420ms var(--ease-out) ${i * 30}ms`
      : null
  });
  if (gated) chip.insertAdjacentHTML('afterbegin', PADLOCK_SVG);
  chip.append(tool.label);
  return chip;
}

/**
 * The reward beat when the door opens.
 *
 * The chips are mutated IN PLACE rather than re-rendered, and that is the whole
 * point: re-rendering swaps the elements out, so there is nothing to transition
 * and the freezer just blinks. This way the padlocks drop out and fourteen chips
 * come up to full strength in a short left-to-right ripple — the room visibly
 * opening, using nothing but opacity.
 *
 * The keypad hotspot goes at the same time. It was the freezer's only hotspot
 * and, once unlocked, `if (isFreezerUnlocked()) return;` left it a dead object
 * sitting in the photograph. There is no honest thing to repoint it at — the
 * other fourteen tools have no measured geometry in rooms.js, and inventing a
 * box would hang a label on the wrong object — so the room hands over to its
 * rail, which is how the freezer was specified in the first place.
 */
function playUnlockBeat() {
  const rail = document.querySelector('[data-room-chips="freezer"]');
  if (rail) {
    for (const chip of rail.querySelectorAll('.chip[data-locked]')) {
      chip.style.opacity = '1';
      chip.removeAttribute('data-locked');
      chip.removeAttribute('aria-haspopup');
      chip.removeAttribute('aria-label');
      const lock = chip.querySelector('svg');
      if (lock) lock.remove();
    }
  }

  const keypad = document.querySelector('#room-freezer .hotspot[data-freezer-lock]');
  if (keypad) keypad.remove();

  announce('Cold storage open. Manager tools are unlocked.');
}

/** One polite live region for the whole page, created on first use. */
let liveRegion = null;
function announce(message) {
  if (!liveRegion) {
    liveRegion = el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
    document.body.append(liveRegion);
  }
  // Clearing first guarantees a re-announcement if the same text repeats.
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = message; }, 60);
}

/** One `.room` — the exact structure in SPEC.md's DOM contract. */
function buildRoom(roomId, index, data) {
  const art = ROOM_ART[roomId] || {};
  const spots = HOTSPOTS[roomId] || [];

  const hotspots = el('div', { class: 'hotspots' },
    spots.map((spot) => buildHotspot(spot, data)));

  return el('section', {
    class: 'room',
    id: `room-${roomId}`,
    'data-room': roomId,
    'aria-labelledby': `room-${roomId}-title`,
    style: roomVars(art)
  }, [
    el('div', { class: 'stage' }, [
      buildPlateWrap(roomId, index),
      hotspots,
      buildRail(roomId, index, data)
    ])
  ]);
}

/**
 * The hero.
 *
 * It carries BOTH `hero` and `room`. `hero` gets it theme.css §07's masthead
 * layout; `room` is what makes engine.js pick it up in collectRooms(), so the
 * storefront genuinely comes alive as you arrive — --enter lifts the stage out
 * of black, --bloom brings the Edison lights up, --plate-scale starts the dolly
 * before you have read the name. Jeff's brief, expressed entirely in the two
 * numbers the engine already publishes; not one line of extra animation code.
 *
 * The engine's own maths guarantees --enter === 1 for the first room at scrollY
 * 0, so this is a short fade up from black, never a blank first paint.
 *
 * No C³ logo here, by instruction. The restaurant is Cook County Cooks; the one
 * permitted C³ mark on the whole site is the fixed button in §5.
 */
function buildHero() {
  const art = ROOM_ART.hero;
  return el('section', {
    class: 'hero room',
    id: 'room-hero',
    'data-room': 'hero',
    'aria-labelledby': 'hero-title',
    style: roomVars(art)
  }, [
    el('div', { class: 'stage' }, [
      buildPlateWrap('hero', 0),
      el('div', { class: 'hero-inner' }, [
        // Three spans: theme.css §07 sets each on its own line, the second in
        // brass italic, the third heavier and further inset. A masthead.
        el('h1', { class: 'hero-title', id: 'hero-title' }, [
          el('span', { text: 'Cook' }),
          el('span', { text: 'County' }),
          el('span', { text: 'Cooks' })
        ]),
        el('p', { class: 'lede hero-lede', text: 'Every tool in the building — plated, lit, and one tap away.' }),
        el('a', { class: 'scroll-cue', href: '#room-pass' }, [
          el('span', { text: 'Walk the line' })
        ])
      ])
    ])
  ]);
}

/** Build the whole restaurant into #kitchen. */
function buildKitchen(data) {
  const kitchen = $('#kitchen');
  const sections = [buildHero()];
  ROOM_ORDER.forEach((roomId, i) => sections.push(buildRoom(roomId, i + 1, data)));
  fill(kitchen, sections);
  return kitchen;
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 4 · #ticket-rail — the always-visible room menu
 *
 * Fixed by theme.css §11, so it is reachable at any scroll position and nobody
 * is ever forced to scroll through rooms to get somewhere. The tickets are real
 * anchors (#room-pass), so they work with JS disabled and can be opened in a new
 * tab; when JS is alive we preventDefault and hand the jump to the engine, whose
 * tween is the thing that keeps the cinema in sync with the scroll position.
 * ────────────────────────────────────────────────────────────────────────── */

function buildTicketRail(data) {
  const header = $('#ticket-rail');

  const tickets = el('nav', { class: 'tickets', 'aria-label': 'Rooms' },
    ROOM_ORDER.map((roomId, i) => {
      const meta = data.roomById.get(roomId) || { short: roomId, label: roomId };
      return el('a', {
        class: 'ticket',
        href: `#room-${roomId}`,
        'data-goto': roomId,
        'aria-label': meta.label
      }, [
        el('span', { class: 'ticket-no', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }),
        el('span', { text: meta.short || meta.label })
      ]);
    }));

  fill(header, [
    el('a', { class: 'brand', href: '#room-hero', text: 'Cook County Cooks' }),
    tickets
  ]);

  // One delegated listener for the whole menu.
  header.addEventListener('click', (ev) => {
    // Let modified clicks behave like normal links (new tab, etc.).
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const link = ev.target.closest('[data-goto], .brand');
    if (!link) return;
    ev.preventDefault();
    const target = link.dataset.goto || 'hero';
    // offset 0 is correct here and is NOT an oversight: a room's runway starts
    // exactly where its sticky .stage pins to the top of the viewport, and the
    // rail inside that stage is already padded by var(--topbar-h) in theme.css
    // §08. Stopping short would push the title down, not clear the bar.
    scrollToRoom(target, { offset: 0 });
  });

  // Highlight follows the engine's own notion of the most-visible room, so the
  // menu is correct however the user got there — tween, flick, or Find-in-page.
  onRoomChange(({ name }) => {
    for (const t of tickets.children) {
      const active = t.dataset.goto === name;
      if (active) t.setAttribute('aria-current', 'true');
      else t.removeAttribute('aria-current');
    }
  });

  return header;
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 5 · BLUE FOX C³ — the fixed button and the repo quick menu
 *
 * The single approved exception to "no C³ logo inside the restaurant". It is
 * position:fixed (theme.css §12) and #ticket-rail reserves padding for it, so it
 * works at any scroll position, in any room, including inside the freezer.
 *
 * theme.css offers four open-state hooks; we use two of them together —
 * `.is-open` on the panel and aria-expanded on the button — because the button
 * and panel are siblings and the `[aria-expanded="true"] ~ #c3-menu` selector
 * then works as a free belt-and-braces even if a class write ever fails.
 * ────────────────────────────────────────────────────────────────────────── */

/** A blue fox, drawn small enough to read at 18px. Signage motif only. */
const FOX_SVG =
  '<svg class="c3-fox" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M3 3l3.6 3.2h10.8L21 3l-1 7.6a8 8 0 0 1-8 8 8 8 0 0 1-8-8z"/>' +
  '<path d="M9 11.2h.01M15 11.2h.01"/><path d="M12 14.2l-1.4 1.2h2.8z"/></svg>';

function buildC3Menu(data) {
  const button = el('button', {
    type: 'button', id: 'c3-button', 'aria-expanded': 'false',
    'aria-controls': 'c3-menu', 'aria-label': 'Blue Fox C³ — all repositories'
  });
  button.innerHTML = FOX_SVG + '<span class="c3-mark">C³</span>';

  const list = el('div', { class: 'c3-list' });
  const menu = el('div', {
    id: 'c3-menu', role: 'dialog', 'aria-modal': 'false',
    'aria-labelledby': 'c3-menu-title'
  }, [
    el('div', { id: 'c3-menu-head' }, [
      el('h2', { class: 't-sub', id: 'c3-menu-title', text: 'All repositories' }),
      el('span', { class: 'kicker', 'data-c3-count': '', text: `${data.tools.length} tools` })
    ]),
    el('hr', { class: 'rule' }),
    list
  ]);


  function renderList() {
    const unlocked = isFreezerUnlocked();
    const children = [];

    for (const roomId of ROOM_ORDER) {
      const meta = data.roomById.get(roomId) || { label: roomId };
      const tools = data.byRoom.get(roomId) || [];
      if (!tools.length) continue;

      children.push(el('p', { class: 'kicker', text: meta.label }));

      if (roomId === 'freezer' && !unlocked) {
        // Gated: one row that opens the keypad instead of 14 rows of URLs.
        children.push(el('button', {
          type: 'button', class: 'c3-item', 'data-freezer-lock': '',
          text: `Locked — ${tools.length} manager tools`
        }));
        continue;
      }

      for (const tool of tools) {
        children.push(el('a', {
          class: 'c3-item',
          href: tool.url,
          'data-tool': tool.slug,      // overlay.js frames it; href keeps it real
          target: tool.external_only || isExternal(tool.url) ? '_blank' : null,
          rel: tool.external_only || isExternal(tool.url) ? 'noopener noreferrer' : null,
          text: tool.label
        }));
      }
    }
    fill(list, children);
  }
  renderList();
  onFreezerUnlock(renderList);

  /* ── open / close ─────────────────────────────────────────────────────── */
  let open = false;
  const setOpen = (next) => {
    open = next;
    button.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
    if (open) {
      const first = menu.querySelector('.c3-item');
      if (first) first.focus();
    }
  };

  button.addEventListener('click', () => setOpen(!open));

  // Click-away and Escape. Both are scoped so they cost nothing when closed.
  document.addEventListener('click', (ev) => {
    if (!open) return;
    if (menu.contains(ev.target) || button.contains(ev.target)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (!open || ev.key !== 'Escape') return;
    setOpen(false);
    button.focus();
  });
  // Choosing a tool closes the menu; the overlay takes over from here.
  menu.addEventListener('click', (ev) => {
    if (ev.target.closest('.c3-item')) setOpen(false);
  });

  // Siblings, button first — that is what makes theme.css's
  // `#c3-button[aria-expanded="true"] ~ #c3-menu` fallback selector match.
  document.body.append(button, menu);
  return { button, menu };
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 6 · THE FOOTER — the plain index
 *
 * This is the "just give me the link" path: no hotspots, no cinema, no viewer.
 * Every entry is a real <a href> WITHOUT data-tool, so overlay.js does not
 * intercept it — middle-click, right-click "copy link", a screen reader's link
 * list and a printed page all behave exactly as a user expects. index.html also
 * carries a <noscript> copy of this index for the genuinely-no-JS case.
 *
 * theme.css §14 owns the look. It styles this structurally — `#site-footer > h2`,
 * `section > ul`, and so on — so the only class this function contributes is
 * `.footer-index` on the column grid. No inline layout.
 * ────────────────────────────────────────────────────────────────────────── */

function buildFooter(data) {
  const footer = $('#site-footer');
  footer.setAttribute('aria-labelledby', 'footer-title');

  const grid = el('div', { class: 'footer-index' });

  function renderGroups() {
    const unlocked = isFreezerUnlocked();
    const groups = [];

    for (const roomId of ROOM_ORDER) {
      const meta = data.roomById.get(roomId) || { label: roomId, tagline: '' };
      const tools = data.byRoom.get(roomId) || [];
      if (!tools.length) continue;

      const headingId = `footer-${roomId}`;
      const body = [];

      if (roomId === 'freezer' && !unlocked) {
        body.push(el('p', {
          class: 'micro',
          text: `${tools.length} manager tools are behind the keypad.`
        }));
        body.push(el('button', {
          type: 'button', class: 'chip', 'data-freezer-lock': '',
          text: 'Enter freezer code'
        }));
      } else {
        body.push(el('ul', {}, tools.map((tool) => {
          const external = tool.external_only || isExternal(tool.url);
          return el('li', {}, [
            el('a', {
              class: 'tool-row',
              href: tool.url,
              target: external ? '_blank' : null,
              rel: external ? 'noopener noreferrer' : null
            }, [
              // No blurb. At four columns theme.css line-clamps it to two lines
              // and half the entries read "…right at th…" — a section headed
              // "Every tool, in plain text" cannot amputate its own sentences.
              // A name and a room grouping is what an index owes you; the blurb
              // lives in the viewer, where there is room for it.
              el('span', { class: 'tool-row-name', text: tool.label })
            ])
          ]);
        })));
      }

      groups.push(el('section', { 'aria-labelledby': headingId }, [
        el('h3', { class: 'kicker', id: headingId, text: meta.label }),
        el('p', { class: 'micro', text: meta.tagline || '' }),
        ...body
      ]));
    }
    fill(grid, groups);
  }
  renderGroups();
  onFreezerUnlock(renderGroups);

  fill(footer, [
    el('h2', { class: 't-sub', id: 'footer-title', text: 'Every tool, in plain text' }),
    el('p', {
      class: 'micro',
      text: 'The whole index, grouped by room. Ordinary links — open them here, in a new tab, or copy them out.'
    }),
    el('hr', { class: 'rule' }),
    grid,
    el('hr', { class: 'rule' }),
    el('p', {
      class: 'micro',
      text: `Cook County Cooks · ${data.tools.length} tools across ${data.rooms.length} rooms · Blue Fox C³`
    })
  ]);

  return footer;
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 7 · BOOT
 *
 * Order matters and is not negotiable:
 *
 *   markup first    — every module measures or queries the DOM, so nothing can
 *                     run until #kitchen actually contains the rooms.
 *   initOverlay     — registers the delegated [data-tool] handler and populates
 *                     the registry the screens read their URLs from. Must come
 *                     BEFORE mountRoomScreens or the screens mount blank and
 *                     have to wait on whenReady().
 *   initEngine      — measures room geometry. Must come AFTER the markup, and
 *                     refresh() must be called after anything that changes the
 *                     document height afterwards (the footer, mainly).
 *   mountRoomScreens— needs laid-out hosts to solve its homography against.
 *   initChefWall    — last; it appends a modal to <body> and nothing waits on it.
 * ────────────────────────────────────────────────────────────────────────── */

async function boot() {
  /* NOTE 1, applied: kill the CSS smooth scroll before anything can scroll.
     See the header comment — this is what stops theme.css's
     `html { scroll-behavior: smooth }` from fighting the engine's tween. */
  document.documentElement.style.scrollBehavior = 'auto';

  let raw;
  try {
    raw = await loadData();
  } catch (err) {
    console.error('[app] could not load tools/headchefs:', err);
    return;
  }
  const data = indexTools(raw.tools);

  /* ---- 1. markup ---------------------------------------------------------- */
  buildKitchen(data);
  buildTicketRail(data);
  buildC3Menu(data);
  buildFooter(data);

  /* ---- 2. the freezer gate ------------------------------------------------ */
  // Every lock affordance — the keypad object in the photograph, the C³ menu's
  // locked row, the footer's button — is one delegated handler.
  document.addEventListener('click', (ev) => {
    const trigger = ev.target.closest && ev.target.closest('[data-freezer-lock]');
    if (!trigger) return;
    ev.preventDefault();
    if (isFreezerUnlocked()) return;
    openKeypad();
  });

  if (isFreezerUnlocked()) {
    // Already open from earlier in this session. The chips, the footer and the
    // C³ list all rendered unlocked because they read live state at render time,
    // so the only thing left over is the keypad object in the photograph. Clear
    // it WITHOUT the beat: nothing just happened, and announcing that it did
    // would be a lie to a screen reader.
    const keypad = $('#room-freezer .hotspot[data-freezer-lock]');
    if (keypad) keypad.remove();
  } else {
    onFreezerUnlock(playUnlockBeat);
  }

  /* ---- 3. the tool viewer ------------------------------------------------- */
  // THE GATE LIVES HERE, not on the click. overlay.js evaluates canOpen inside
  // openTool() itself, after the registry lookup and before any UI, so it covers
  // every route into a tool: a chip, a hotspot, a TV screen, the keyboard, the
  // C³ menu, the openTool re-exported on window.CCC — and, the one that was
  // actually broken, syncFromLocation() honouring a `#/tool/<slug>` deep link on
  // a cold load. canOpen is re-evaluated on every open and must be SYNCHRONOUS
  // (a returned Promise is truthy and would open the tool regardless), so it
  // reads live state and the keypad goes in onRefused.
  //
  // On refusal overlay.js opens nothing at all — no chrome, no scroll lock, no
  // history entry — and strips the refused hash itself, so a locked deep link
  // does not re-fire on reload.
  const gatedSlugs = new Set((data.byRoom.get('freezer') || []).map((t) => t.slug));
  initOverlay({
    // Passing the array straight in — no fetch, so a deep link resolves on the
    // first frame instead of after a network round-trip.
    tools: data.tools,
    canOpen: (slug) => !gatedSlugs.has(slug) || isFreezerUnlocked(),
    onRefused: (slug, { retry }) => { openKeypad().then((ok) => { if (ok) retry(); }); }
  });

  /* ---- 4. the cinema ------------------------------------------------------ */
  const engine = initEngine();

  /* ---- 5. the live screens ------------------------------------------------ */
  // The dining boards and the host stand's Daily Sales Report become real,
  // running iframes inside the photographs.
  mountRoomScreens();

  /* ---- 6. the head chef wall ---------------------------------------------- */
  const breakroom = $('#room-breakroom');
  const wallHost = breakroom && breakroom.querySelector('[data-chefwall-host]');
  if (wallHost) {
    initChefWall({
      host: wallHost,
      chefs: raw.headchefs.headchefs || [],
      frames: CHEF_FRAMES,
      // Below 900px theme.css hides .hotspots outright, so the wall's narrow
      // fallback strip has to live somewhere untransformed and still visible:
      // the break room's own rail. This is exactly the case chefwall.js's
      // `stripHost` option was added for.
      stripHost: breakroom.querySelector('.rail')
    });
  }

  /* ---- 7. re-measure ------------------------------------------------------ */
  // The footer, the chef wall's modal and the chef strip all changed the
  // document height after initEngine() cached its geometry. One refresh puts the
  // runway maths back in agreement with reality.
  engine.refresh();

  // The plates are lazy; a decode that lands late can change nothing about
  // layout (they are absolutely positioned with fixed intrinsic size) but the
  // fonts can. One refresh when the webfonts settle, then we are done.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => engine.refresh()).catch(() => {});
  }

  // Expose a tiny handle for debugging in a store — never for other modules.
  window.CCC = Object.assign(window.CCC || {}, { engine, data, openTool });
}

/* The module is loaded with type="module", which is deferred by definition, so
   the parser has finished by the time this runs. The readyState check is there
   only for the case where someone loads this file some other way. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

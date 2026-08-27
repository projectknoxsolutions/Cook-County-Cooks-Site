/* =============================================================================
 * Cook County Cooks — v4 "Alive"
 * assets/screens.js  ·  the room screens
 * -----------------------------------------------------------------------------
 * This module owns every screen, monitor, TV and tablet in the restaurant. It
 * takes that job over from the second half of overlay.js, which now owns only
 * the full-screen tool viewer (openTool / closeTool). The two still meet in one
 * place and one place only: every screen's hit target carries `data-tool`, so
 * overlay.js's delegated handler opens the tool — which means the freezer gate,
 * the deep-link router and the focus-return all keep working untouched.
 *
 * FOUR MODES. A screen declares one with `data-screen-mode`:
 *
 *   title  the three Pass tablets. Too small to render a web page at any zoom,
 *          so they render the ONE thing that matters — the tool's name, set in
 *          the site's display face and auto-fitted to the glass — plus a quiet
 *          "Tap to open". Live glass, not a label: glow, scanlines, a refresh
 *          shimmer and a CRT power-on that rides the engine.
 *
 *   image  the Host Stand TV. The daily promo card straight out of the Daily
 *          Sales Report's own data directory, cache-busted in the same 10-minute
 *          buckets the source app uses. Held frozen — no rotation. Fitted with a
 *          blurred same-image backdrop so a 1.40 card in a 1.52 screen goes edge
 *          to edge instead of sitting in two black bars.
 *
 *   feed   the Back Office monitor. `nps-detractor-streaks.json`, rendered as a
 *          rotating board, ONE DISTRICT PER SLIDE, big numerals, 30-day goal
 *          meters, and real celebration for a met goal or a new personal record.
 *
 *   live   the two Dining boards. Real iframes of the Win the Weekend decks,
 *          rendered at a virtual desktop width and scaled down — but at 960px,
 *          not 1280px, because the decks size their type in vw and a narrower
 *          virtual viewport makes the content itself come out ~33% larger.
 *
 * NARROW VIEWPORTS. Below `(max-width: 900px), (max-aspect-ratio: 8/7)` a 16:9
 * plate cover-cropped into a 3:4 viewport throws away a third of the frame, and
 * a screen mounted in the art stops being readable. So the screens LEAVE the
 * art: each room's panels relocate into a full-width band pinned under the top
 * bar (`.ccc-scr-layer`), sized so the whole set fits above the rail. Nothing
 * about the page layout is assumed — see `narrowHost` in mountRoomScreens() and
 * the class-hook list at the bottom of this file.
 *
 * CONTRACT NOTES (SPEC.md + SPEC-v4.md)
 *   · Plain ES module, no dependencies, no build step.
 *   · No second rAF loop. Every power-on, glow and dissolve is composed in CSS
 *     from the engine's own `--enter` / `--bloom` / `--p`.
 *   · Only transform / opacity / filter animate.
 *   · Never blocks first paint; both feeds fail soft to a branded holding card.
 *   · prefers-reduced-motion: no shimmer, no scanline travel, no slide
 *     animation — the feed still advances, plainly.
 *
 * EXPORTS
 *   mountScreen(cfg)            -> handle { destroy, refresh, host, slug, mode }
 *   mountRoomScreens(root, opt) -> handle[]
 *   registerTools(tools)        -> void         (url/label lookup)
 *   refreshScreens()            -> void         (re-measure everything)
 *   SCREEN_MODES, NARROW_MEDIA, PROMO_CARD_URL, STREAKS_URL
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * 0 · Constants
 * -------------------------------------------------------------------------- */

/** The two public, CORS-open data files behind the Host Stand and Back Office. */
export const PROMO_CARD_URL =
  'https://raw.githubusercontent.com/BlufoxMobile/Daily-Sales-Report/main/data/promo-card.jpg';
export const STREAKS_URL =
  'https://raw.githubusercontent.com/BlufoxMobile/Daily-Sales-Report/main/data/nps-detractor-streaks.json';

/** Ten-minute buckets — exactly what the source app does. */
const BUCKET_MS = 600000;

/** Virtual desktop width a `live` iframe renders at before it is scaled down.
 *  NOT 1280. The decks set type in vw against a 1400px content column, so a
 *  narrower virtual viewport makes the rendered text relatively bigger. 960
 *  clears the deck's own 900px "compact" breakpoint with room to spare. */
const LIVE_RENDER_WIDTH = 960;

/** Hard ceiling on simultaneous `live` iframes. iPads are real. Cheap modes
 *  (title / image / feed) are not counted — they cost a few DOM nodes. */
const MAX_LIVE_FRAMES = 2;

/** How long one district holds the Back Office board. Slow on purpose. */
const FEED_SLIDE_MS = 9000;

/** How long a SUCCESSFUL streaks fetch is reused. */
const FEED_TTL_MS = 10 * 60 * 1000;

/** How long a FAILED one is remembered before the next screen may try again.
 *  Long enough to stop a stampede when several panels arm at once, short enough
 *  that one blip does not cost the board the rest of the session. */
const FEED_RETRY_MS = 20 * 1000;

/** A request that never answers is a failure that never fail-softs. Both feeds
 *  get a deadline, after which the screen falls to its holding state and the
 *  retry clock starts. Without this the board sits on an EMPTY stage for as long
 *  as the socket stays open, which is the shape the live bug took. */
const FEED_TIMEOUT_MS = 10 * 1000;
const IMAGE_TIMEOUT_MS = 10 * 1000;

/** How often an on-screen panel that has never had data tries again, and how
 *  many times before it settles for the holding card. */
const RETRY_EVERY_MS = 20 * 1000;
const RETRY_LIMIT = 5;

/** The same two conditions theme.css uses for its portrait takeover. Exported
 *  so the layout owner can key off one string instead of a second copy. */
export const NARROW_MEDIA = '(max-width: 900px), (max-aspect-ratio: 8 / 7)';

/** Default mode per slug, used when the host carries no `data-screen-mode`. */
export const SCREEN_MODES = {
  'quote-6th-gen':  'title',
  'quote-upgrade':  'title',
  'quote-internet': 'title',
  'daily-sales':    'image',
  'wtw-chicago':    'live',
  'wtw-big-south':  'live'
};

const MODES = new Set(['title', 'image', 'feed', 'live']);

/** Aspect ratios (as plain numbers) the panels take in the narrow band. */
/** Aspect ratios (as plain numbers) the panels take in the narrow band.
 *  `feed` is deliberately taller than the 4/3 it used to be: the band's height
 *  budget is set by `--scr-band-h` and a single-screen room was leaving ~180px
 *  of it unused, while the board's own rows were the thing running out of space.
 *  `image` stays the promo card's own 2000x1429 — `object-fit: contain` means
 *  any other number just letterboxes it. */
const NARROW_AR = { title: 4, image: 2000 / 1429, feed: 6 / 5, live: 16 / 9 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* -----------------------------------------------------------------------------
 * 1 · Tiny helpers
 * -------------------------------------------------------------------------- */

const noop = () => {};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function reduceMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/** 'YYYY-MM-DD' -> 'Aug 26'. Parsed by hand: `new Date('2026-08-26')` is UTC
 *  midnight and prints as the 25th anywhere west of Greenwich. */
function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : '';
}

/**
 * Current cache-busted promo URL.
 *
 * `?t=` is the source app's own ten-minute bucket and nothing may change it —
 * inside one bucket the URL is byte-identical, which is the whole point.
 * `retry` is appended ONLY on a recovery attempt after a failed load, because
 * assigning an <img> the src string it already has is a no-op in every engine:
 * without a distinct URL a card that failed once could never be re-requested
 * until the bucket rolled, up to ten minutes later.
 */
function promoSrc(retry = 0) {
  const base = `${PROMO_CARD_URL}?t=${Math.floor(Date.now() / BUCKET_MS)}`;
  return retry > 0 ? `${base}&r=${retry}` : base;
}

/* -----------------------------------------------------------------------------
 * 2 · Tool registry
 *
 * Screens need a url and a label. app.js already has both, so it hands them
 * over; if it does not, we fall back to whatever `window.CCC.data` is holding
 * and finally to the slug itself. We never fetch tools.json ourselves — a
 * screen must never be the reason the page waits on the network.
 * -------------------------------------------------------------------------- */

const registry = new Map();

export function registerTools(tools) {
  const list = Array.isArray(tools) ? tools : (tools && tools.tools) || [];
  for (const tool of list) if (tool && tool.slug) registry.set(tool.slug, tool);
  for (const rec of records) applyMeta(rec);
}

function getTool(slug) {
  if (registry.has(slug)) return registry.get(slug);
  const inline = (window.CCC && window.CCC.data && window.CCC.data.bySlug) || null;
  if (inline && inline.get && inline.get(slug)) return inline.get(slug);
  return null;
}

/* -----------------------------------------------------------------------------
 * 3 · Stylesheet
 *
 * Injected once, prefixed `ccc-scr`, every colour and face read through a
 * `var(--ccc-…, fallback)` so assets/theme.css owns the look. Nothing here
 * animates anything but transform / opacity / filter.
 * -------------------------------------------------------------------------- */

const STYLES = `
/* ── the panel ───────────────────────────────────────────────────────────── */
.ccc-scr {
  position: absolute; inset: 0;
  pointer-events: none;
  -webkit-tap-highlight-color: transparent;

  /* THE POWER-ON. The engine publishes --enter on .stage (0 off-screen, 1 fully
     arrived, registered @property so it is 1 even if engine.js never loads).
     Everything below is a function of this one number: no timers, no second
     loop, and a screen that is cold and dark in a room's "before" state. */
  --scr-on: clamp(0, calc((var(--enter, 1) - 0.74) * 5.5), 1);
  --scr-ar: 1.7778;
}

.ccc-scr__plane {
  position: absolute; inset: 0;
  transform-origin: 0 0;          /* the homography is solved for this origin */
  overflow: visible;              /* the glow spills; the glass clips */
  pointer-events: none;
}
/* Perspective mode: JS writes width/height in px and a matrix3d here. */
.ccc-scr--quad .ccc-scr__plane { inset: auto; top: 0; left: 0; }

/* the halo the panel throws onto the wall behind it */
.ccc-scr__glow {
  position: absolute; inset: -18%;
  z-index: 0; pointer-events: none;
  border-radius: 40%;
  background: radial-gradient(58% 58% at 50% 50%,
    rgba(154,196,255,.46), rgba(120,158,255,.16) 46%, rgba(0,0,0,0) 72%);
  filter: blur(12px);
  opacity: calc(var(--scr-on) * (0.30 + 0.55 * var(--bloom, 0)));
}

/* the black glass itself */
.ccc-scr__glass {
  position: absolute; inset: 0;
  z-index: 1; overflow: hidden;
  pointer-events: none;
  background: linear-gradient(163deg, #0b0e14 0%, #04060a 55%, #080a10 100%);
  transform: translateZ(0);
  filter:
    brightness(calc(0.16 + 0.84 * var(--scr-on)))
    saturate(calc(0.30 + 0.70 * var(--scr-on)));
}

.ccc-scr__content {
  position: absolute; inset: 0;
  color: var(--ccc-scr-ink, var(--ccc-ov-ink, #f4efe6));
  font-family: var(--ccc-font-ui, system-ui, -apple-system, "Segoe UI", sans-serif);
  opacity: calc(0.06 + 0.94 * var(--scr-on));
}

/* ── the CRT power-on: a hairline that opens into a full panel ───────────── */
.ccc-scr__crt {
  position: absolute; inset: 0; z-index: 3; pointer-events: none;
  background: linear-gradient(180deg,
    rgba(0,0,0,0) 47.5%, rgba(232,244,255,.95) 50%, rgba(0,0,0,0) 52.5%);
  transform: scaleY(calc(0.05 + 0.95 * clamp(0, calc(var(--scr-on) * 2.4), 1)));
  opacity: calc(
    clamp(0, calc(var(--scr-on) * 9), 1) *
    clamp(0, calc((0.42 - var(--scr-on)) * 5), 1));
}

/* ── scanlines + the slow refresh bar ────────────────────────────────────── */
.ccc-scr__scan {
  position: absolute; inset: 0; z-index: 2; pointer-events: none;
  overflow: hidden;
  opacity: calc(0.34 * var(--scr-on));
  background: repeating-linear-gradient(0deg,
    rgba(0,0,0,.20) 0 1px, rgba(0,0,0,0) 1px 3px);
}
.ccc-scr__scan::after {
  content: ""; position: absolute; inset: -60% 0;
  background: linear-gradient(180deg,
    rgba(0,0,0,0) 0%, rgba(178,214,255,.13) 47%, rgba(0,0,0,0) 100%);
  animation: ccc-scr-refresh 7.5s linear infinite;
}
@keyframes ccc-scr-refresh {
  from { transform: translate3d(0, -34%, 0); }
  to   { transform: translate3d(0,  68%, 0); }
}

/* ── glass reflection + bezel ────────────────────────────────────────────── */
.ccc-scr__sheen {
  position: absolute; inset: 0; z-index: 4; pointer-events: none;
  opacity: calc(0.35 + 0.65 * var(--scr-on));
  background:
    linear-gradient(196deg, rgba(255,255,255,.12) 0%, rgba(255,255,255,.04) 17%, rgba(255,255,255,0) 41%),
    linear-gradient(12deg,  rgba(150,190,255,.06) 0%, rgba(255,255,255,0) 45%);
}
.ccc-scr__bezel {
  position: absolute; inset: 0; z-index: 5; pointer-events: none;
  box-shadow:
    inset 0 0 0 1px rgba(0,0,0,.62),
    inset 0 0 16px 5px rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.05);
}

/* ── the control ─────────────────────────────────────────────────────────── */
.ccc-scr__hit {
  position: absolute; inset: 0; z-index: 6;
  -webkit-appearance: none; appearance: none;
  border: 0; margin: 0; padding: 0;
  min-block-size: 44px;
  background: rgba(0,0,0,0); color: inherit;
  cursor: pointer;
  transition: box-shadow .25s var(--ccc-ov-ease, cubic-bezier(.22,.61,.36,1)),
              background-color .25s ease;
  pointer-events: auto;
}
.ccc-scr__hit:hover {
  background: rgba(255,255,255,.045);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.20),
              0 0 34px -6px rgba(180,210,255,.42);
}
.ccc-scr__hit:focus-visible {
  outline: 2px solid var(--ccc-focus, #ebce93);
  outline-offset: 2px;
  box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--ccc-focus, #ebce93) 55%, transparent);
}
.ccc-sr-only {
  position: absolute !important; inline-size: 1px; block-size: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* ══ MODE: title ═════════════════════════════════════════════════════════ */
.ccc-scr-title {
  position: absolute; inset: 0;
  display: grid; align-content: center; justify-items: start;
  gap: .32em;
  padding: 6% 7%;
  text-align: start;
  background:
    radial-gradient(120% 100% at 12% 0%,
      color-mix(in oklab, var(--ccc-accent, #c8973f) 16%, transparent), transparent 62%),
    linear-gradient(157deg, #10161f 0%, #070a10 62%, #0b0f16 100%);
}
.ccc-scr-title__name {
  margin: 0;
  font-family: var(--ccc-font-display, "Bodoni Moda", Didot, serif);
  font-weight: 600;
  font-size: var(--scr-title-fs, 20px);
  line-height: 1.02;
  letter-spacing: -0.018em;
  color: var(--ccc-scr-ink, #f6f2ea);
  text-wrap: balance;
  text-shadow: 0 1px 0 rgba(0,0,0,.6);
}
.ccc-scr-title__rule {
  inline-size: 34%; block-size: 1px; border: 0; margin: 0;
  background: linear-gradient(90deg,
    var(--ccc-accent, #c8973f), color-mix(in oklab, var(--ccc-accent, #c8973f) 10%, transparent));
  opacity: calc(0.35 + 0.65 * var(--scr-on));
}
.ccc-scr-title__cta {
  margin: 0;
  font-family: var(--ccc-font-ui, system-ui, sans-serif);
  font-size: max(9px, calc(var(--scr-title-fs, 20px) * 0.40));
  font-weight: 600;
  letter-spacing: .165em;
  text-transform: uppercase;
  color: var(--ccc-accent-hi, #ebce93);
}
/* the four-strip variant the narrow band uses: name left, cue right */
.ccc-scr--narrow.ccc-scr--title .ccc-scr-title {
  grid-template-columns: 1fr auto;
  align-items: center;
  justify-items: start;
  gap: 0 1em;
  padding: 4% 5%;
}
.ccc-scr--narrow.ccc-scr--title .ccc-scr-title__rule { display: none; }
.ccc-scr--narrow.ccc-scr--title .ccc-scr-title__cta { justify-self: end; text-align: end; }

/* ══ MODE: image ═════════════════════════════════════════════════════════ */
.ccc-scr-art { position: absolute; inset: 0; overflow: hidden; }
.ccc-scr-art__bg {
  position: absolute; inset: -8%;
  inline-size: 116%; block-size: 116%;
  object-fit: cover;
  filter: blur(22px) saturate(1.15) brightness(.62);
  opacity: .85;
}
.ccc-scr-art__fg {
  position: absolute; inset: 0;
  inline-size: 100%; block-size: 100%;
  object-fit: contain;
  object-position: 50% 50%;
}
.ccc-scr-art img { display: block; }

/* ══ MODE: live ══════════════════════════════════════════════════════════ */
.ccc-scr__frame {
  position: absolute; top: 0; left: 0;
  border: 0; display: block;
  transform-origin: top left;
  background: #0b0b0d;
  opacity: 0;
  transition: opacity .6s ease;
  pointer-events: none;
}
.ccc-scr.is-live .ccc-scr__frame { opacity: 1; }

/* ══ MODE: feed — the Back Office board ══════════════════════════════════ */
.ccc-scr-feed {
  position: absolute; inset: 0;
  font-size: var(--scr-u, 16px);   /* every size below is in em of this */
  background:
    radial-gradient(130% 90% at 82% 4%,
      color-mix(in oklab, var(--ccc-accent, #c8973f) 13%, transparent), transparent 58%),
    linear-gradient(162deg, #0d1219 0%, #05080d 58%, #0a0e15 100%);
}
.ccc-scr-feed__stage { position: absolute; inset: 0; }
.ccc-scr-feed__slide {
  position: absolute; inset: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: .5em;
  padding: .85em 1em .7em;
  min-block-size: 0;
  opacity: 0;
  transform: translate3d(0, .45em, 0);
  transition: opacity .62s var(--ccc-ov-ease, cubic-bezier(.22,.61,.36,1)),
              transform .62s var(--ccc-ov-ease, cubic-bezier(.22,.61,.36,1));
  pointer-events: none;
}
.ccc-scr-feed__slide.is-current { opacity: 1; transform: none; }

.ccc-scr-feed__head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: .2em .8em;
  border-block-end: 1px solid color-mix(in oklab, var(--ccc-accent, #c8973f) 34%, transparent);
  padding-block-end: .38em;
}
.ccc-scr-feed__eyebrow {
  grid-column: 1 / -1;
  margin: 0;
  font-size: .62em; font-weight: 700;
  letter-spacing: .2em; text-transform: uppercase;
  color: var(--ccc-accent-hi, #ebce93);
}
.ccc-scr-feed__district {
  margin: 0;
  font-family: var(--ccc-font-display, "Bodoni Moda", Didot, serif);
  font-weight: 600;
  font-size: 1.72em;
  line-height: 1;
  letter-spacing: -0.02em;
  color: #f6f2ea;
}
.ccc-scr-feed__goal {
  margin: 0;
  font-size: .64em; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase;
  color: #a9a094;
  white-space: nowrap;
}

.ccc-scr-feed__grid {
  display: grid;
  grid-template-columns: repeat(var(--scr-cols, 3), minmax(0, 1fr));
  /* minmax(0,1fr) is load-bearing: plain 1fr has an auto MINIMUM, so a third
     row of tiles pushes the footer off the glass instead of sharing the space
     the slide actually has. */
  grid-auto-rows: minmax(0, 1fr);
  gap: .5em;
  min-block-size: 0;
  overflow: hidden;
}
.ccc-scr-feed__store {
  position: relative;
  display: grid;
  grid-auto-rows: auto;
  align-content: center;
  justify-items: center;
  gap: .1em;
  padding: .3em .35em .4em;
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.012));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.07);
  min-inline-size: 0; min-block-size: 0;
  overflow: hidden;
}
.ccc-scr-feed__days {
  display: block;
  font-family: var(--ccc-font-display, "Bodoni Moda", Didot, serif);
  font-weight: 600;
  /* JS writes --scr-num from the row count: the numeral is as big as the board
     can carry and no bigger. */
  font-size: calc(var(--scr-num, 3.05) * 1em);
  line-height: .88;
  letter-spacing: -0.035em;
  color: #f7f3ec;
  font-variant-numeric: tabular-nums lining-nums;
}
.ccc-scr-feed__unit {
  font-size: .54em; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase;
  color: #8f877c;
}
.ccc-scr-feed__name {
  max-inline-size: 100%;
  font-size: .78em; font-weight: 600;
  letter-spacing: .012em;
  color: #ded6c9;
  text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ccc-scr-feed__meter {
  position: relative;
  inline-size: 76%; block-size: 2px;
  margin-block-start: .3em;
  border-radius: 2px;
  background: rgba(255,255,255,.12);
  overflow: hidden;
}
.ccc-scr-feed__meter i {
  position: absolute; inset-block: 0; inset-inline-start: 0;
  inline-size: 100%;
  transform-origin: 0 50%;
  transform: scaleX(var(--fill, 0));
  background: linear-gradient(90deg,
    color-mix(in oklab, var(--ccc-accent, #c8973f) 62%, transparent),
    var(--ccc-accent-hi, #ebce93));
}
.ccc-scr-feed__flag {
  position: absolute; inset-block-start: .25em; inset-inline-end: .3em;
  font-size: .46em; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase;
  color: var(--ccc-accent-ink, #05070a);
  background: var(--ccc-accent-hi, #ebce93);
  padding: .18em .4em;
  border-radius: 2px;
}
/* goal met — the whole tile lights */
.ccc-scr-feed__store.is-goal {
  background: linear-gradient(180deg,
    color-mix(in oklab, var(--ccc-accent, #c8973f) 30%, transparent),
    color-mix(in oklab, var(--ccc-accent, #c8973f) 8%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ccc-accent, #c8973f) 62%, transparent);
}
.ccc-scr-feed__store.is-goal .ccc-scr-feed__days { color: var(--ccc-accent-hi, #ebce93); }
.ccc-scr-feed__store.is-record .ccc-scr-feed__days { color: var(--ccc-accent-hi, #ebce93); }
.ccc-scr-feed__store.is-dark .ccc-scr-feed__days { color: #5d5850; }
.ccc-scr-feed__store.is-dark .ccc-scr-feed__unit { color: #5d5850; }

.ccc-scr-feed__foot {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: .6em;
  font-size: .6em; font-weight: 600;
  letter-spacing: .09em; text-transform: uppercase;
  color: #857d72;
}
.ccc-scr-feed__foot > :last-child { text-align: end; }
.ccc-scr-feed__dots { display: flex; gap: .5em; justify-content: center; }
.ccc-scr-feed__dots span {
  inline-size: .5em; block-size: .5em; border-radius: 50%;
  background: rgba(255,255,255,.22);
  transition: background-color .4s ease, transform .4s ease;
}
.ccc-scr-feed__dots span.is-current {
  background: var(--ccc-accent-hi, #ebce93);
  transform: scale(1.35);
}

/* ══ the calm holding card — every mode's failure state ══════════════════ */
.ccc-scr-holding {
  position: absolute; inset: 0;
  display: grid; align-content: center; justify-items: center;
  gap: .6em;
  padding: 8%;
  text-align: center;
  font-size: var(--scr-u, 16px);
  background:
    radial-gradient(120% 100% at 50% 0%,
      color-mix(in oklab, var(--ccc-accent, #c8973f) 10%, transparent), transparent 60%),
    linear-gradient(160deg, #0c1017 0%, #06080d 100%);
}
.ccc-scr-holding__mark {
  font-family: var(--ccc-font-ui, system-ui, sans-serif);
  font-size: .62em; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase;
  color: var(--ccc-accent, #c8973f);
}
.ccc-scr-holding__title {
  margin: 0;
  font-family: var(--ccc-font-display, "Bodoni Moda", Didot, serif);
  font-weight: 600; font-size: 1.5em; line-height: 1.05;
  color: #f2ece2;
}
.ccc-scr-holding__note {
  margin: 0;
  font-size: .72em; line-height: 1.4;
  color: #9d958a;
  max-inline-size: 26ch;
}

/* ══ the narrow band ═════════════════════════════════════════════════════ */
.ccc-scr-layer {
  position: absolute;
  z-index: 12;
  inset-inline: 0;
  inset-block-start: calc(var(--topbar-h, 60px) + var(--sp-3, .75rem));
  display: grid;
  justify-items: center;
  align-content: start;
  gap: var(--scr-gap, .75rem);
  padding-inline: var(--gut, 1.25rem);
  pointer-events: none;

  --scr-gap: var(--sp-3, .75rem);
  --scr-band-h: min(52svh, 560px);
  --scr-max-h: calc(
    (var(--scr-band-h) - (var(--scr-count, 1) - 1) * var(--scr-gap)) / var(--scr-count, 1));

  /* The same window .rail and .hotspots use, so a band never overlaps the
     next room's. Copied deliberately rather than shared: theme.css declares
     --e1 on .rail, and this layer is a sibling of it. */
  opacity: clamp(0, min((var(--enter, 1) - 0.745) * 33.333, (0.684 - var(--p, 0)) * 25), 1);
}
.ccc-scr-layer:empty { display: none; }

.ccc-scr--narrow {
  position: relative;
  inset: auto;
  inline-size: min(100%, calc(var(--scr-max-h, 40svh) * var(--scr-ar, 1.7778)));
  block-size: auto;
  aspect-ratio: var(--scr-ar, 1.7778);
  border-radius: 3px;
  filter: drop-shadow(0 14px 34px rgba(0,0,0,.55));
}
.ccc-scr--narrow .ccc-scr__plane { inset: 0; transform: none; }
.ccc-scr--narrow .ccc-scr__glow { inset: -14%; }

/* THE CAPTION RAIL. Only the narrow band has one, and a title card never does
   — it already IS its own caption.

   It is a RAIL, not an overlay. An overlay bar sat on top of the bottom eighth
   of the promo card and the bottom row of the streak board, which on the one
   presentation that exists to be readable is the worst place to put anything.
   So the glass and every layer that dresses it stop short of it. */
.ccc-scr__cap { display: none; }
.ccc-scr--narrow .ccc-scr__plane { --scr-cap-h: calc(var(--scr-u, 12px) * 2); }
.ccc-scr--narrow :is(.ccc-scr__glass, .ccc-scr__scan, .ccc-scr__crt,
                     .ccc-scr__sheen, .ccc-scr__bezel) {
  inset-block-end: var(--scr-cap-h);
}
.ccc-scr--narrow .ccc-scr__cap {
  position: absolute;
  inset-block-end: 0; inset-inline: 0;
  block-size: var(--scr-cap-h);
  z-index: 7;
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem;
  padding-inline: .55rem;
  font-family: var(--ccc-font-ui, system-ui, sans-serif);
  font-size: calc(var(--scr-u, 12px) * 0.86);
  font-weight: 600;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: #e8e1d5;
  background: linear-gradient(180deg, #0c1119, #070a0f);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--ccc-accent, #c8973f) 34%, transparent);
  pointer-events: none;
}
.ccc-scr--narrow.ccc-scr--title .ccc-scr__plane { --scr-cap-h: 0px; }
/* A title card is already its own caption — and a zero-height flex row does not
   hide its text, it spills it into the panel below. */
.ccc-scr--narrow.ccc-scr--title .ccc-scr__cap { display: none; }
.ccc-scr__cap b {
  font-weight: 600; min-inline-size: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ccc-scr__cap i {
  font-style: normal; flex: 0 0 auto;
  color: var(--ccc-accent-hi, #ebce93); white-space: nowrap;
}

/* ══ reduced motion ══════════════════════════════════════════════════════ */
@media (prefers-reduced-motion: reduce) {
  .ccc-scr__scan::after { animation: none; opacity: 0; }
  .ccc-scr__crt { display: none; }
  /* No power-on ramp, and no scroll-driven fade on the band — theme.css §18
     pins .hotspots to opacity 1 for exactly this reason and the band is that
     layer's narrow-viewport counterpart. */
  .ccc-scr { --scr-on: 1; }
  .ccc-scr-layer { opacity: 1; }
  .ccc-scr-feed__slide { transition: none; transform: none; }
  .ccc-scr__frame,
  .ccc-scr__hit,
  .ccc-scr-feed__dots span { transition: none; }
}

/* ══ forced colours ══════════════════════════════════════════════════════ */
@media (forced-colors: active) {
  .ccc-scr__glass { background: Canvas; forced-color-adjust: none; }
  .ccc-scr__hit:focus-visible { outline: 2px solid Highlight; }
}
`;

function injectStyles() {
  if (document.getElementById('ccc-screens-css')) return;
  document.head.append(el('style', { id: 'ccc-screens-css', text: STYLES }));
}

/* -----------------------------------------------------------------------------
 * 4 · Perspective maths
 *
 * Lifted, deliberately unchanged, from the version of this code that lived in
 * overlay.js: it is solved, reviewed and correct, and the Host Stand TV depends
 * on it. An 8-DOF projective transform maps our flat W x H panel onto the four
 * measured corners of a screen photographed at an angle, emitted as a CSS
 * matrix3d so the browser warps it on the GPU and hit-testing follows.
 * -------------------------------------------------------------------------- */

/** Gaussian elimination with partial pivoting. Returns null when singular —
 *  a NaN inside a transform blanks the element, which is far worse than a
 *  quiet fallback to the axis-aligned box. */
function solveLinearSystem(A, b) {
  const n = b.length;

  // Relative pivot tolerance: the matrix mixes pixels (~1e3) with their
  // products (~1e6), so a fixed epsilon is meaningless.
  let magnitude = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = Math.abs(A[r][c]);
    if (v > magnitude) magnitude = v;
  }
  const tol = 1e-12 * (magnitude || 1);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (!(Math.abs(A[pivot][col]) > tol)) return null;
    if (pivot !== col) {
      const rowTmp = A[pivot]; A[pivot] = A[col]; A[col] = rowTmp;
      const bTmp = b[pivot]; b[pivot] = b[col]; b[col] = bTmp;
    }
    const p = A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / p;
      if (!f) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }

  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum -= A[r][c] * x[c];
    x[r] = sum / A[r][r];
    if (!Number.isFinite(x[r])) return null;
  }
  return x;
}

/** Two linear rows per correspondence, h8 pinned to 1 → an 8x8 system. */
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
  h.push(1);
  return h;
}

/** matrix3d is column-major. The transform lives in z=0, so h6/h7 become the
 *  perspective terms in the w row. Ten significant figures, NOT toFixed(6):
 *  h6/h7 are around 1e-4 and would round away to nothing. */
function homographyToMatrix3d(h) {
  const m = [h[0], h[3], 0, h[6],
             h[1], h[4], 0, h[7],
             0,    0,    1, 0,
             h[2], h[5], 0, h[8]];
  if (m.some((n) => !Number.isFinite(n))) return null;
  return `matrix3d(${m.map((n) => Number(n.toPrecision(10))).join(',')})`;
}

function validQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) return false;
  return quad.every((pt) =>
    Array.isArray(pt) && pt.length >= 2 &&
    Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])));
}

/** Convexity + area, on the resolved pixel quad — catches collinear input. */
function isSaneQuad(pts) {
  let area = 0;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    area += a[0] * b[1] - b[0] * a[1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return Math.abs(area / 2) > 16;
}

const dist2d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** `data-screen-quad`: eight numbers TL,TR,BR,BL in % of the plate, or JSON. */
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

/* -----------------------------------------------------------------------------
 * 5 · The streaks feed — one fetch, shared by every feed screen
 * -------------------------------------------------------------------------- */

let feedCache = { at: 0, promise: null, data: null, failed: false, inflight: false };

/**
 * Fetch the streak board, at most once per window, shared by every feed screen.
 *
 * ⚠ THE BUG THIS FUNCTION EXISTS TO NOT HAVE, TWICE OVER.
 *
 * 1. THE MEMO USED TO CACHE THE FAILURE FOR THE FULL TTL. The resolved promise
 *    — `null`, from the catch — was stored in `feedCache.promise` under the same
 *    ten-minute guard as a success, and `feedCache.failed` was written but never
 *    read by anything. So the first failure poisoned every later attempt for ten
 *    minutes: a second feed panel arming, a tab returning to the foreground, a
 *    reconnected laptop, all got the memoised `null` back instantly without a
 *    request ever leaving the page. Nothing in the module called it with
 *    `force`, so in practice the board was dead for the life of the session.
 *    A SUCCESS is worth memoising for the TTL. A FAILURE is worth memoising only
 *    long enough to stop several panels stampeding the same dead URL.
 *
 * 2. THERE WAS NO DEADLINE. `fetch()` has no timeout of its own, so a connection
 *    that opened and then hung left this promise pending forever — and the feed
 *    renderer, which only paints when the promise settles, left the glass on an
 *    empty `.ccc-scr-feed__stage`: not the board, and not the holding card
 *    either. A fail-soft path that is never reached is not a fail-soft path.
 *
 * On failure this resolves to the LAST GOOD DATA when there is any, so a screen
 * that has been up all day keeps showing this morning's board through a blip
 * rather than dropping to a holding card, and only resolves `null` when there
 * has never been anything to show.
 */
function loadStreaks({ force = false } = {}) {
  const now = Date.now();

  if (!force && feedCache.promise) {
    const age = now - feedCache.at;
    const window_ = feedCache.inflight ? FEED_TIMEOUT_MS + 2000
                  : feedCache.failed   ? FEED_RETRY_MS
                                       : FEED_TTL_MS;
    if (age < window_) return feedCache.promise;
  }

  feedCache.at = now;
  feedCache.inflight = true;

  // AbortController is everywhere we ship, but a missing one must not throw.
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const deadline = ctrl
    ? window.setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS)
    : 0;

  feedCache.promise = fetch(`${STREAKS_URL}?t=${Math.floor(now / BUCKET_MS)}`, {
    credentials: 'omit',
    cache: 'no-store',
    signal: ctrl ? ctrl.signal : undefined
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((json) => {
      if (!json || !Array.isArray(json.stores)) throw new Error('unexpected shape');
      if (deadline) window.clearTimeout(deadline);
      feedCache.data = json;
      feedCache.failed = false;
      feedCache.inflight = false;
      return json;
    })
    .catch((err) => {
      if (deadline) window.clearTimeout(deadline);
      console.warn('[screens] detractor streaks unavailable:', err && err.message);
      feedCache.failed = true;
      feedCache.inflight = false;
      // Stale beats blank; null only when there has never been anything.
      return feedCache.data;
    });

  return feedCache.promise;
}

/**
 * Group the flat store list into one entry per district, in the order the feed
 * itself declares (`districts[]`), falling back to first-appearance order.
 * Stores sort best-first; a store with no surveys sinks to the bottom.
 */
function groupByDistrict(data) {
  const goal = num(data.goalDays) || 30;
  const meta = new Map();
  if (Array.isArray(data.districts)) {
    for (const d of data.districts) {
      if (d && (d.key || d.label)) meta.set(d.label || d.key, d);
    }
  }

  const order = [];
  const bucket = new Map();
  for (const store of data.stores) {
    if (!store) continue;
    const key = store.district || store.districtKey || 'Other';
    if (!bucket.has(key)) { bucket.set(key, []); order.push(key); }
    bucket.get(key).push(store);
  }

  // Prefer the feed's own district order when it covers what we found.
  const declared = Array.isArray(data.districts)
    ? data.districts.map((d) => d && (d.label || d.key)).filter((k) => bucket.has(k))
    : [];
  const keys = declared.length === order.length ? declared : order;

  return keys.map((key) => {
    const stores = bucket.get(key).slice().sort((a, b) => {
      const da = num(a.days), db = num(b.days);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });
    return { key, label: key, goal, meta: meta.get(key) || null, stores };
  });
}

/* -----------------------------------------------------------------------------
 * 6 · Mode renderers
 *
 * Every renderer returns a small controller:
 *   { node, resize(rec), activate(rec), deactivate(rec), destroy() }
 * `activate` runs when the screen comes within range, `deactivate` when it
 * leaves — that is where timers stop and iframes die.
 * -------------------------------------------------------------------------- */

/** The calm branded card every mode falls back to. Never a spinner, never a
 *  broken image, never a stack trace. */
function holdingCard(title, note) {
  return el('div', { class: 'ccc-scr-holding' }, [
    el('span', { class: 'ccc-scr-holding__mark', text: 'Cook County Cooks' }),
    el('p', { class: 'ccc-scr-holding__title', text: title || 'Board offline' }),
    el('p', { class: 'ccc-scr-holding__note', text: note || 'Live data is not reachable right now. Tap to open the full report.' })
  ]);
}

/* ── title ────────────────────────────────────────────────────────────────── */

function makeTitle(rec) {
  const name = el('h3', { class: 'ccc-scr-title__name', text: rec.headline });
  const node = el('div', { class: 'ccc-scr-title' }, [
    name,
    el('hr', { class: 'ccc-scr-title__rule', 'aria-hidden': 'true' }),
    el('p', { class: 'ccc-scr-title__cta', text: 'Tap to open' })
  ]);

  return {
    node,
    resize(r) {
      // Auto-fit: solve a font size from the glass area and the character
      // count, then cap it on both axes. A tablet 10% of frame width and a
      // full-width phone strip are the same problem with different numbers,
      // so there is one solve rather than a table of breakpoints.
      const w = r.planeW, h = r.planeH;
      if (!w || !h) return;
      const text = (rec.headline || '').replace(/\s+/g, ' ').trim();
      const chars = Math.max(8, text.length);
      const narrow = r.narrow;
      const bw = w * (narrow ? 0.66 : 0.86);
      const bh = h * (narrow ? 0.62 : 0.58);
      let fs = Math.sqrt((bw * bh * 0.42) / chars) * 1.42;
      fs = Math.min(fs, bh * 0.52, bw * 0.36);
      fs = Math.max(fs, 10);
      r.plane.style.setProperty('--scr-title-fs', `${fs.toFixed(2)}px`);
    },
    activate: noop,
    deactivate: noop,
    destroy: noop
  };
}

/* ── image ────────────────────────────────────────────────────────────────── */

function makeImage(rec) {
  const node = el('div', { class: 'ccc-scr-art' });
  let bucket = -1;
  let timer = 0;
  let deadline = 0;
  let retries = 0;
  let ok = false;
  let holding = null;

  // The blurred copy behind the fitted card is what takes a 1.40 promo card
  // edge to edge inside a 1.52 screen. Two black bars would read as a broken
  // mount; an ambient backdrop reads as a screen.
  const bg = el('img', { class: 'ccc-scr-art__bg', alt: '', 'aria-hidden': 'true', decoding: 'async' });
  const fg = el('img', { class: 'ccc-scr-art__fg', alt: '', 'aria-hidden': 'true', decoding: 'async' });

  const NOTE = 'Today\u2019s promo card has not landed yet. Tap to open the Daily Sales Report.';

  /* ⚠ THE HOLDING CARD GOES OVER THE IMAGES, NEVER INSTEAD OF THEM.
     It used to be `node.replaceChildren(holdingCard(...))`, which took both
     <img> elements out of the document. Every later load therefore succeeded
     against elements nothing could see, `.is-live` went on a panel with no
     picture in it, and the TV showed its holding card for the rest of the
     session however many good cards arrived afterwards. `.ccc-scr-holding` is
     `position:absolute; inset:0`, so it is already an overlay — use it as one. */
  function showHolding() {
    if (holding) return;
    holding = holdingCard(rec.title || 'Daily promo card', NOTE);
    node.append(holding);
    rec.panel.classList.remove('is-live');
  }

  function clearHolding() {
    if (!holding) return;
    holding.remove();
    holding = null;
  }

  function stopDeadline() {
    if (deadline) { window.clearTimeout(deadline); deadline = 0; }
  }

  /**
   * @param {boolean} force  re-request even inside the current bucket. Used by
   *                         the recovery path; a healthy card is HELD, not
   *                         re-fetched, until the ten-minute bucket rolls.
   */
  function load({ force = false } = {}) {
    const next = Math.floor(Date.now() / BUCKET_MS);
    if (!force && next === bucket && ok) return;
    if (force && !ok) retries++;
    if (next !== bucket) { bucket = next; retries = 0; }

    const src = promoSrc(ok ? 0 : retries);
    stopDeadline();
    // An <img> that never errors and never loads is the same dead screen as one
    // that 404s, and only this timer tells them apart.
    deadline = window.setTimeout(() => {
      deadline = 0;
      if (!ok) showHolding();
    }, IMAGE_TIMEOUT_MS);

    fg.src = src;
    bg.src = src;
  }

  fg.addEventListener('error', () => {
    stopDeadline();
    ok = false;
    showHolding();
  });
  fg.addEventListener('load', () => {
    stopDeadline();
    ok = true;
    retries = 0;
    clearHolding();
    rec.panel.classList.add('is-live');
  });

  node.append(bg, fg);

  return {
    node,
    resize: noop,
    activate() {
      load({ force: !ok });
      // Re-check on the 10-minute boundary, but only while the screen is in
      // range and the tab is visible. The card is HELD, not rotated — this is a
      // refresh, not a slideshow. While it has never arrived the same tick is
      // the retry, capped so a permanently dead URL is not polled forever.
      //
      // ⚠ This used to read `failed = false; load();` — and `load()` began with
      // `if (next === bucket && !failed) return;`, so clearing the flag one line
      // early guaranteed the early return and the retry never fired at all.
      // The intent is an explicit argument, not a flag mutated around the call.
      if (!timer) {
        timer = window.setInterval(() => {
          if (document.visibilityState === 'hidden') return;
          if (!ok && retries >= RETRY_LIMIT) return;
          load({ force: !ok });
        }, RETRY_EVERY_MS);
      }
    },
    deactivate() {
      stopDeadline();
      if (timer) { window.clearInterval(timer); timer = 0; }
    },
    /** A tab returning to the foreground gets a fresh card. */
    refresh() {
      retries = 0;
      load({ force: true });
    },
    destroy() {
      stopDeadline();
      if (timer) { window.clearInterval(timer); timer = 0; }
      fg.removeAttribute('src');
      bg.removeAttribute('src');
    }
  };
}

/* ── feed ─────────────────────────────────────────────────────────────────── */

function buildStoreTile(store, goal) {
  const days = num(store.days);
  const dark = store.status === 'no-data' || days === null;
  const capped = store.capped === true;
  const goalMet = store.goalMet === true || store.atGoal === true;
  const record = store.newRecord === true;

  const tile = el('div', {
    class: 'ccc-scr-feed__store' +
      (goalMet ? ' is-goal' : '') +
      (record ? ' is-record' : '') +
      (dark ? ' is-dark' : '')
  });

  const value = dark ? '—' : (capped ? `${days}+` : String(days));
  tile.append(
    el('span', { class: 'ccc-scr-feed__days', text: value }),
    el('span', {
      class: 'ccc-scr-feed__unit',
      text: dark ? 'no surveys' : (days === 1 ? 'day clean' : 'days clean')
    }),
    el('span', { class: 'ccc-scr-feed__name', text: store.store || store.storeFull || '' })
  );

  const fill = dark ? 0 : Math.max(0, Math.min(1, days / (goal || 30)));
  tile.append(el('span', { class: 'ccc-scr-feed__meter', 'aria-hidden': 'true' }, [
    el('i', { style: `--fill:${fill.toFixed(3)}` })
  ]));

  // The two things worth celebrating, in the source app's own terms.
  if (goalMet) tile.append(el('span', { class: 'ccc-scr-feed__flag', text: 'Goal met' }));
  else if (record) tile.append(el('span', { class: 'ccc-scr-feed__flag', text: 'Record' }));

  return tile;
}

function buildSlide(district, data, index, total) {
  const goal = district.goal;
  const best = district.stores.find((s) => num(s.days) !== null);
  const meta = district.meta || {};

  const head = el('div', { class: 'ccc-scr-feed__head' }, [
    el('p', { class: 'ccc-scr-feed__eyebrow', text: 'Days since last detractor' }),
    el('h3', { class: 'ccc-scr-feed__district', text: district.label }),
    el('p', { class: 'ccc-scr-feed__goal', text: `Goal ${goal} days` })
  ]);

  const grid = el('div', { class: 'ccc-scr-feed__grid' },
    district.stores.map((store) => buildStoreTile(store, goal)));

  const bestLabel = best
    ? `Leading: ${best.store} · ${best.capped ? `${best.days}+` : best.days}`
    : `${district.stores.length} stores`;
  const avg = num(meta.avgDays);
  const dots = el('div', { class: 'ccc-scr-feed__dots', 'aria-hidden': 'true' },
    Array.from({ length: total }, (_, i) =>
      el('span', { class: i === index ? 'is-current' : '' })));

  const foot = el('div', { class: 'ccc-scr-feed__foot' }, [
    el('span', { text: bestLabel }),
    dots,
    el('span', {
      text: avg !== null
        ? `District avg ${avg} · ${shortDate(data.asOf)}`
        : shortDate(data.asOf)
    })
  ]);

  return el('div', { class: 'ccc-scr-feed__slide' }, [head, grid, foot]);
}

function makeFeed(rec) {
  const node = el('div', { class: 'ccc-scr-feed' });
  const stage = el('div', { class: 'ccc-scr-feed__stage' });
  node.append(stage);

  let slides = [];
  let districts = [];
  let index = 0;
  let timer = 0;
  let retryTimer = 0;
  let retries = 0;
  let active = false;
  let loaded = false;
  let pending = false;

  const TITLE = () => rec.title || 'Days since last detractor';
  const WAITING = 'Bringing up the streak board\u2026 tap to open the Daily Sales Report.';
  const OFFLINE = 'The streak board is not reachable right now. Tap to open the Daily Sales Report.';

  /* ⚠ THE GLASS IS NEVER EMPTY. The board used to paint nothing at all until the
     fetch settled, so a slow or hanging request left a lit, correctly warped,
     completely blank `.ccc-scr-feed__stage` on the office wall — which is what
     the live site was showing. A screen with nothing on it is a broken screen
     whatever the network is doing, so the branded card is the RESTING state and
     the board replaces it, not the other way round. Never a spinner. */
  function showHolding(note) {
    node.replaceChildren(holdingCard(TITLE(), note));
    rec.panel.classList.remove('is-live');
  }

  function show(i) {
    if (!slides.length) return;
    index = ((i % slides.length) + slides.length) % slides.length;
    for (let s = 0; s < slides.length; s++) {
      slides[s].classList.toggle('is-current', s === index);
    }
    applyColumns();
  }

  function applyColumns() {
    // Column count is a function of how wide the glass actually is, not of the
    // viewport: the same board is 790px across on a wall and 350px on a phone.
    // Two rows is the target — a district is five or six stores, and two rows of
    // three carries a far bigger numeral than three rows of two.
    // Three columns wherever three fit: two rows of three carries a numeral
    // half again as big as three rows of two, and the store names still clear
    // an ellipsis at ~100px of tile. Below that a phone gets two columns.
    const wide = rec.planeW >= 320;
    for (let i = 0; i < slides.length; i++) {
      const grid = slides[i].querySelector('.ccc-scr-feed__grid');
      if (!grid) continue;
      const n = districts[i] ? districts[i].stores.length : grid.children.length;
      const cols = wide ? Math.min(3, Math.max(2, Math.ceil(n / 2))) : 2;
      const rows = Math.max(1, Math.ceil(n / cols));
      grid.style.setProperty('--scr-cols', String(cols));
      // Three rows in the same box means a smaller numeral, or it clips.
      grid.style.setProperty('--scr-num', rows >= 3 ? '2.15' : (rows === 2 ? '3.05' : '4.2'));
    }
  }

  function tick() {
    show(index + 1);
  }

  function startTimer() {
    if (timer || slides.length < 2 || !active) return;
    timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      tick();
    }, FEED_SLIDE_MS);
  }

  function stopTimer() {
    if (timer) { window.clearInterval(timer); timer = 0; }
  }

  function stopRetry() {
    if (retryTimer) { window.clearInterval(retryTimer); retryTimer = 0; }
  }

  /** Keep asking while the board is on screen and has still never had data. */
  function startRetry() {
    if (retryTimer || loaded || !active) return;
    retryTimer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (loaded || retries >= RETRY_LIMIT) { stopRetry(); return; }
      retries++;
      pull({ force: true });
    }, RETRY_EVERY_MS);
  }

  /**
   * One request, at most one in flight per panel.
   *
   * ⚠ This used to be a one-shot `started` latch around a single
   *   `loadStreaks().then(render)`. Between that latch and the memo in §5
   *   caching its own failure, ONE bad fetch — at any point in the session,
   *   including before the room had ever been looked at — permanently settled
   *   what this screen would show. There is now exactly one thing that can
   *   retire the retry: data actually arriving.
   */
  function pull({ force = false } = {}) {
    if (pending) return;
    pending = true;
    loadStreaks({ force }).then((data) => {
      pending = false;
      if (rec.destroyed) return;
      if (data) { loaded = true; stopRetry(); render(data); }
      else { showHolding(OFFLINE); startRetry(); }
    }).catch(() => {
      pending = false;
      if (rec.destroyed) return;
      if (!loaded) { showHolding(OFFLINE); startRetry(); }
    });
  }

  function render(data) {
    if (!data) { showHolding(OFFLINE); return; }
    districts = groupByDistrict(data);
    if (!districts.length) { showHolding(OFFLINE); return; }
    slides = districts.map((d, i) => buildSlide(d, data, i, districts.length));
    stage.replaceChildren(...slides);
    if (!node.contains(stage)) node.replaceChildren(stage);
    show(0);
    rec.panel.classList.add('is-live');
    startTimer();
  }

  // The resting state, in the DOM from the moment the panel mounts.
  showHolding(WAITING);

  return {
    node,
    resize: applyColumns,
    activate() {
      active = true;
      if (!loaded) { pull(); startRetry(); }
      else startTimer();
    },
    deactivate() {
      active = false;
      stopTimer();
      stopRetry();
    },
    /** A tab returning to the foreground gets a board no older than the TTL. */
    refresh() {
      retries = 0;
      pull({ force: !loaded });
      if (!loaded) startRetry();
    },
    destroy() {
      stopTimer();
      stopRetry();
      slides = [];
    }
  };
}

/* ── live ─────────────────────────────────────────────────────────────────── */

function makeLive(rec) {
  const node = el('div', { class: 'ccc-scr-live' });
  let frame = null;
  let watchdog = 0;

  function mount() {
    if (frame) return;
    const url = rec.url;
    if (!url) {
      node.replaceChildren(holdingCard(rec.title, 'Tap to open this board full screen.'));
      return;
    }
    frame = el('iframe', {
      class: 'ccc-scr__frame',
      // Decorative: it is a picture of a TV, not content. The button above it
      // is the only thing assistive tech ever sees.
      'aria-hidden': 'true',
      tabindex: '-1',
      scrolling: 'no',
      title: '',
      referrerpolicy: 'no-referrer-when-downgrade'
    });
    frame.setAttribute('role', 'presentation');
    frame.addEventListener('load', () => {
      if (rec.destroyed) return;
      window.clearTimeout(watchdog);
      rec.panel.classList.add('is-live');
    }, { once: true });
    node.replaceChildren(frame);
    fit();
    frame.src = url;

    // A deck that never loads must not leave black glass forever.
    watchdog = window.setTimeout(() => {
      if (rec.destroyed || rec.panel.classList.contains('is-live')) return;
      node.replaceChildren(holdingCard(rec.title,
        'This board is not reachable right now. Tap to open it full screen.'));
      frame = null;
      rec.panel.classList.add('is-live');
    }, 12000);
  }

  function unmount() {
    window.clearTimeout(watchdog);
    rec.panel.classList.remove('is-live');
    if (frame) {
      // Just remove it. Removing an <iframe> destroys its browsing context on
      // the spot AND pushes nothing onto session history — navigating it to
      // about:blank first would stack entries that closeTool()'s history.back()
      // then has to unwind.
      frame.remove();
      frame = null;
    }
    node.replaceChildren();
  }

  function fit() {
    if (!frame) return;
    const w = rec.planeW, h = rec.planeH;
    if (!w || !h) return;
    const scale = w / rec.renderWidth;          // uniform: no distortion
    frame.style.width = `${rec.renderWidth}px`;
    frame.style.height = `${Math.round(h / scale)}px`;
    frame.style.transform = `scale(${scale.toFixed(5)})`;
  }

  return {
    node,
    resize: fit,
    activate: mount,
    deactivate: unmount,
    destroy: unmount,
    get isLive() { return !!frame; }
  };
}

const RENDERERS = { title: makeTitle, image: makeImage, feed: makeFeed, live: makeLive };

/* -----------------------------------------------------------------------------
 * 7 · The record set + narrow-mode relocation
 * -------------------------------------------------------------------------- */

const records = new Set();
let narrowMQ = null;
let isNarrow = false;
let narrowHostResolver = null;

function initNarrowWatch() {
  if (narrowMQ) return;
  narrowMQ = window.matchMedia(NARROW_MEDIA);
  isNarrow = narrowMQ.matches;
  const onChange = () => {
    const next = narrowMQ.matches;
    if (next === isNarrow) return;
    isNarrow = next;
    for (const rec of records) relocate(rec);
    reconcile();
  };
  if (narrowMQ.addEventListener) narrowMQ.addEventListener('change', onChange);
  else if (narrowMQ.addListener) narrowMQ.addListener(onChange);
}

/** The room this host belongs to, and its stage. */
function roomOf(host) {
  const stage = host.closest ? host.closest('.stage') : null;
  const room = host.closest ? host.closest('[data-room]') : null;
  return {
    stage: stage || host.parentElement,
    room,
    roomId: room ? (room.getAttribute('data-room') || '') : ''
  };
}

/**
 * Where a panel goes when the viewport is too narrow for the art.
 *
 * Resolution order, most specific first:
 *   1. the `narrowHost` callback passed to mountRoomScreens / mountScreen
 *   2. an element the page provides:  [data-screens-narrow] inside the room
 *   3. our own band: `.ccc-scr-layer`, inserted into `.stage` before `.rail`
 *
 * 1 and 2 exist so the owner of the mobile page layout can put the screens
 * wherever the mobile composition wants them without editing this file.
 */
function narrowHostFor(rec) {
  const { stage, room, roomId } = roomOf(rec.host);
  if (typeof rec.narrowHostFn === 'function') {
    const supplied = rec.narrowHostFn({ slug: rec.slug, mode: rec.mode, room: roomId, host: rec.host });
    if (supplied && supplied.nodeType) return supplied;
  }
  const declared = (room || stage || document).querySelector('[data-screens-narrow]');
  if (declared) return declared;
  if (!stage) return null;

  let layer = stage.querySelector(':scope > .ccc-scr-layer');
  if (!layer) {
    layer = el('div', {
      class: `ccc-scr-layer ccc-scr-layer--${roomId || 'room'}`,
      'data-screens-layer': roomId || '',
      'aria-hidden': 'false'
    });
    const rail = stage.querySelector(':scope > .rail');
    stage.insertBefore(layer, rail || null);
  }
  return layer;
}

/** Move one panel between the art and the narrow band. */
function relocate(rec) {
  if (rec.destroyed) return;
  const wantNarrow = isNarrow;
  if (wantNarrow === rec.narrow && rec.panel.isConnected) return;

  rec.narrow = wantNarrow;
  rec.panel.classList.toggle('ccc-scr--narrow', wantNarrow);

  if (wantNarrow) {
    const band = narrowHostFor(rec);
    if (band) {
      band.append(rec.panel);
      rec.band = band;
      band.style.setProperty('--scr-count', String(band.children.length));
    }
    rec.panel.style.setProperty('--scr-ar', String(NARROW_AR[rec.mode] || 1.7778));
    // Drop the perspective: a warped panel in a flat band is nonsense.
    rec.plane.style.width = '';
    rec.plane.style.height = '';
    rec.plane.style.transform = '';
    rec.panel.classList.remove('ccc-scr--quad');
  } else {
    rec.host.append(rec.panel);
    if (rec.band) {
      const band = rec.band;
      rec.band = null;
      band.style.setProperty('--scr-count', String(Math.max(1, band.children.length)));
      if (!band.children.length && band.classList.contains('ccc-scr-layer')) band.remove();
    }
  }

  const stage = roomOf(rec.host).stage;
  if (stage) stage.setAttribute('data-ccc-screens', wantNarrow ? 'narrow' : 'wide');

  applyGeometry(rec);
}

/* -----------------------------------------------------------------------------
 * 8 · Geometry
 * -------------------------------------------------------------------------- */

/**
 * Resolve the quad's percentages into host-local, UNTRANSFORMED pixels.
 *
 * ⚠ THE BUG THIS FUNCTION EXISTS TO NOT HAVE. The host lives inside
 * `.hotspots`, which theme.css scales by `--plate-scale * --overscan-k` and
 * drifts with the parallax. `getBoundingClientRect()` reports that transformed
 * box — so resolving a percentage against it produces a LAYOUT offset that is
 * already ~10% too large, which the ancestor transform then scales a second
 * time. The error is proportional to distance from the layer's centre, so the
 * left tablet lands 39px right of its glass and the right one 121px: a screen
 * that is subtly, progressively wrong across the frame.
 *
 * offsetWidth / offsetHeight are the layout box, before any transform, which is
 * the coordinate space the plane is actually positioned in. Use them. `k` undoes
 * the ancestor scale for the one case that genuinely needs a rect — a `quadRef`
 * that is a different element from the host.
 */
function resolveQuadPx(rec, hostRect, k) {
  const ref = rec.quadRef;
  let ox = 0, oy = 0;
  let rw = rec.host.offsetWidth, rh = rec.host.offsetHeight;

  if (ref && ref !== rec.host) {
    const rb = ref.getBoundingClientRect();
    if (!rb.width || !rb.height) return null;
    ox = (rb.left - hostRect.left) * k;
    oy = (rb.top - hostRect.top) * k;
    rw = ref.offsetWidth; rh = ref.offsetHeight;
  }
  if (!rw || !rh) return null;

  const pts = rec.quad.map(([x, y]) => [ox + (x / 100) * rw, oy + (y / 100) * rh]);
  return isSaneQuad(pts) ? pts : null;
}

/**
 * Size the plane, warp it if it hangs at an angle, then tell the mode.
 *
 * The plane is given a flat W x H pixel box — W and H from the averaged
 * opposing edges of the target quad, so the pre-warp render resolution is close
 * to the on-screen size and text stays crisp — and then mapped onto the
 * measured corners. `transform-origin: 0 0` is what makes the solve valid.
 */
function applyGeometry(rec) {
  if (rec.destroyed || !rec.plane) return;

  let applied = false;
  let W = 0, H = 0;

  if (rec.narrow) {
    // The band is not inside the transformed plate layer, so the layout box is
    // the on-screen box.
    W = rec.panel.offsetWidth; H = rec.panel.offsetHeight;
  } else {
    const hostRect = rec.host.getBoundingClientRect();
    if (!hostRect.width || !hostRect.height) return;     // not laid out yet
    // The ancestor scale, as a number that undoes it. See resolveQuadPx().
    const k = rec.host.offsetWidth ? rec.host.offsetWidth / hostRect.width : 1;

    if (rec.quad) {
      const dst = resolveQuadPx(rec, hostRect, k);
      if (dst) {
        const w = Math.max(8, Math.round((dist2d(dst[0], dst[1]) + dist2d(dst[3], dst[2])) / 2));
        const h = Math.max(8, Math.round((dist2d(dst[0], dst[3]) + dist2d(dst[1], dst[2])) / 2));
        const hom = computeHomography([[0, 0], [w, 0], [w, h], [0, h]], dst);
        const matrix = hom && homographyToMatrix3d(hom);
        if (matrix) {
          rec.plane.style.width = `${w}px`;
          rec.plane.style.height = `${h}px`;
          rec.plane.style.transform = matrix;
          W = w; H = h;
          applied = true;
        }
      }
      if (!applied && !rec.quadWarned) {
        rec.quadWarned = true;
        console.warn(`[screens] "${rec.slug}": degenerate quad, falling back to the host box`);
      }
    }

    if (!applied) {
      rec.plane.style.width = '';
      rec.plane.style.height = '';
      rec.plane.style.transform = '';
      // Layout size again, not the rect: an axis-aligned screen's iframe scale
      // is computed from this, and inside a scaled layer the rect is ~10% wide.
      W = rec.host.offsetWidth; H = rec.host.offsetHeight;
    }
  }

  if (!W || !H) return;
  rec.planeW = W;
  rec.planeH = H;
  rec.panel.classList.toggle('ccc-scr--quad', applied);

  // The one number every mode's internal type scale is expressed in em of.
  // 1/40th of the glass width, floored so a tiny tablet is not sub-pixel.
  rec.plane.style.setProperty('--scr-w', W.toFixed(1));
  rec.plane.style.setProperty('--scr-h', H.toFixed(1));
  // The narrow band is read at arm's length on a small panel, the art at room
  // distance on a large one, so the unit is bigger relative to the box.
  //
  // W/27 rather than W/32: on a 390px phone the band panel is 346px of glass, and
  // at /32 the streak board's store names came out at 8.4 CSS px and its "days
  // clean" caption at 5.8 — smaller than any system text style, i.e. below the
  // client's one standing requirement for these screens ("large enough that we
  // can read them on a mobile device"). /27 puts the names at 10.2px and the
  // numerals at 39px with the grid still clearing its tiles; see NARROW_AR.feed,
  // which was opened up at the same time to give those rows the height back.
  rec.plane.style.setProperty('--scr-u', `${Math.max(9, W / (rec.narrow ? 27 : 40)).toFixed(2)}px`);

  if (rec.api && rec.api.resize) rec.api.resize(rec);
}

/* -----------------------------------------------------------------------------
 * 9 · Mount budget
 * -------------------------------------------------------------------------- */

function reconcile() {
  const all = Array.from(records).filter((r) => !r.destroyed);

  // 1. Everything cheap follows its observer exactly.
  for (const rec of all) {
    if (rec.mode === 'live') continue;
    if (rec.wantsMount && !rec.active) { rec.active = true; rec.api.activate(rec); }
    else if (!rec.wantsMount && rec.active) { rec.active = false; rec.api.deactivate(rec); }
  }

  // 2. Live iframes are rationed, nearest-to-the-viewport first.
  const live = all.filter((r) => r.mode === 'live');
  for (const rec of live) {
    if (!rec.wantsMount && rec.active) { rec.active = false; rec.api.deactivate(rec); }
  }

  const mid = window.innerHeight / 2;
  // A layout read, yes — but only ever inside an IntersectionObserver callback
  // or a media change, never inside the engine's rAF loop.
  const dist = (rec) => {
    const r = (rec.narrow ? rec.panel : rec.plane).getBoundingClientRect();
    return Math.abs((r.top + r.height / 2) - mid);
  };

  let running = live.filter((r) => r.active);
  const waiting = live.filter((r) => r.wantsMount && !r.active)
    .map((r) => ({ rec: r, d: dist(r) }))
    .sort((a, b) => a.d - b.d);

  for (const cand of waiting) {
    if (running.length >= MAX_LIVE_FRAMES) {
      let worst = null, worstD = -1;
      for (const rec of running) { const d = dist(rec); if (d > worstD) { worstD = d; worst = rec; } }
      if (!worst || worstD <= cand.d) break;
      worst.active = false;
      worst.api.deactivate(worst);
      running = running.filter((r) => r !== worst);
    }
    cand.rec.active = true;
    cand.rec.api.activate(cand.rec);
    running.push(cand.rec);
  }
}

/** Pull url/title off the registry once it exists. */
function applyMeta(rec) {
  const tool = getTool(rec.slug);
  if (tool) {
    if (!rec.url) rec.url = tool.url || null;
    if (!rec.title) rec.title = tool.label || null;
    if (!rec.headline) rec.headline = rec.title || rec.slug;
  }
  const name = rec.title || rec.headline || rec.slug;
  rec.label.textContent = `Open ${name}`;
  rec.hit.setAttribute('aria-label', `Open ${name}`);
  if (rec.capName) rec.capName.textContent = name;
  if (rec.mode === 'title') {
    const nameNode = rec.content && rec.content.querySelector('.ccc-scr-title__name');
    if (nameNode) nameNode.textContent = rec.headline || name;
    if (rec.api && rec.api.resize) rec.api.resize(rec);
  }
}

/* -----------------------------------------------------------------------------
 * 10 · mountScreen()
 * -------------------------------------------------------------------------- */

/**
 * Mount one screen.
 *
 * @param {object}  cfg
 * @param {Element} cfg.host        the positioned box the room layout produced.
 *                                  With `quad` it is the PERCENT REFERENCE BOX
 *                                  and should be full-bleed over the plate.
 * @param {string}  cfg.slug        tool slug — drives the click-through
 * @param {'title'|'image'|'feed'|'live'} [cfg.mode]  default: SCREEN_MODES[slug] or 'title'
 * @param {Array<[number,number]>}  [cfg.quad]  TL,TR,BR,BL in % of the reference box
 * @param {Element} [cfg.quadRef]   measure the % against this instead of host
 * @param {string}  [cfg.url]       default: the tool's url
 * @param {string}  [cfg.title]     default: the tool's label
 * @param {string}  [cfg.headline]  display name for `title` mode (default: title)
 * @param {number}  [cfg.width]     virtual render width for `live`
 * @param {Function}[cfg.narrowHost] ({slug,mode,room,host}) => Element
 * @returns {{destroy:Function, refresh:Function, host:Element, slug:string, mode:string}}
 */
export function mountScreen(cfg = {}) {
  const { host, slug } = cfg;
  if (!host || !host.nodeType) {
    console.warn('[screens] mountScreen: no host element');
    return { destroy: noop, refresh: noop, host: null, slug, mode: null };
  }
  injectStyles();
  initNarrowWatch();

  const mode = MODES.has(cfg.mode) ? cfg.mode : (SCREEN_MODES[slug] || 'title');

  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const glass = el('div', { class: 'ccc-scr__glass' });
  const label = el('span', { class: 'ccc-sr-only' });
  const hit = el('button', { class: 'ccc-scr__hit', type: 'button' }, [label]);
  hit.setAttribute('data-tool', slug);        // overlay.js's delegated handler

  // Everything visible lives inside ONE wrapper, so in perspective mode the
  // single matrix3d carries glass, glow, reflection, bezel AND the hit target
  // onto the wall plane together — the reflection stays welded to the screen,
  // and the browser's own hit-testing follows the transform, so a click on a
  // slanted corner lands where it looks like it should.
  const capName = el('b', { text: '' });
  const cap = el('div', { class: 'ccc-scr__cap', 'aria-hidden': 'true' }, [
    capName, el('i', { text: 'Tap to open' })
  ]);
  const plane = el('div', { class: 'ccc-scr__plane' }, [
    el('div', { class: 'ccc-scr__glow', 'aria-hidden': 'true' }),
    glass,
    el('div', { class: 'ccc-scr__scan', 'aria-hidden': 'true' }),
    el('div', { class: 'ccc-scr__crt', 'aria-hidden': 'true' }),
    el('div', { class: 'ccc-scr__sheen', 'aria-hidden': 'true' }),
    el('div', { class: 'ccc-scr__bezel', 'aria-hidden': 'true' }),
    cap,
    hit
  ]);
  const panel = el('div', { class: `ccc-scr ccc-scr--${mode}`, 'data-screen-panel': slug }, [plane]);

  const rec = {
    host, slug, mode, panel, plane, glass, hit, label, cap, capName,
    quad: validQuad(cfg.quad) ? cfg.quad.map((pt) => [Number(pt[0]), Number(pt[1])]) : null,
    quadRef: cfg.quadRef && cfg.quadRef.nodeType ? cfg.quadRef : null,
    quadWarned: false,
    narrowHostFn: typeof cfg.narrowHost === 'function' ? cfg.narrowHost : null,
    url: cfg.url || null,
    title: cfg.title || null,
    headline: cfg.headline || cfg.title || null,
    renderWidth: Number(cfg.width) > 0 ? Number(cfg.width) : LIVE_RENDER_WIDTH,
    planeW: 0, planeH: 0,
    narrow: null,
    band: null,
    active: false,
    wantsMount: false,
    destroyed: false,
    content: null,
    api: null,
    io: null,
    resizeObs: null,
    resizeRaf: 0
  };
  if (cfg.quad && !rec.quad) {
    console.warn(`[screens] "${slug}": malformed quad, using the host box`);
  }

  applyMeta(rec);                              // headline before the renderer
  rec.api = RENDERERS[mode](rec);
  rec.content = el('div', { class: 'ccc-scr__content' }, [rec.api.node]);
  glass.append(rec.content);

  host.append(panel);
  records.add(rec);

  relocate(rec);                               // places it and measures it
  applyMeta(rec);                              // and now the caption/label

  /* --- lazy gate -----------------------------------------------------------
     A screen comes to life about one and a half viewports out. Anything
     further away is not worth an iframe or a fetch on an iPad. */
  if ('IntersectionObserver' in window) {
    rec.io = new IntersectionObserver((entries) => {
      for (const entry of entries) rec.wantsMount = entry.isIntersecting;
      reconcile();
    }, { root: null, rootMargin: '150% 0px 150% 0px', threshold: 0 });
    rec.io.observe(panel);
  } else {
    rec.wantsMount = true;
    reconcile();
  }

  if ('ResizeObserver' in window) {
    rec.resizeObs = new ResizeObserver(() => {
      // Coalesce: a band resize fires for every panel in it.
      if (rec.resizeRaf) return;
      rec.resizeRaf = requestAnimationFrame(() => {
        rec.resizeRaf = 0;
        applyGeometry(rec);
      });
    });
    rec.resizeObs.observe(rec.quadRef || host);
    if ((rec.quadRef || host) !== host) rec.resizeObs.observe(host);
    rec.resizeObs.observe(panel);
  }

  return {
    host, slug, mode,
    refresh: () => applyGeometry(rec),
    destroy() {
      if (rec.destroyed) return;
      rec.destroyed = true;
      if (rec.active) { rec.active = false; rec.api.deactivate(rec); }
      rec.api.destroy();
      if (rec.io) rec.io.disconnect();
      if (rec.resizeObs) rec.resizeObs.disconnect();
      if (rec.resizeRaf) cancelAnimationFrame(rec.resizeRaf);
      records.delete(rec);
      const band = rec.band;
      panel.remove();
      if (band && !band.children.length && band.classList.contains('ccc-scr-layer')) band.remove();
    }
  };
}

/* -----------------------------------------------------------------------------
 * 11 · mountRoomScreens()
 * -------------------------------------------------------------------------- */

/**
 * Mount every `[data-screen="<slug>"]` box found under `root`.
 *
 * Attributes read off the host:
 *   data-screen        the tool slug (required)
 *   data-screen-mode   title | image | feed | live   (default: SCREEN_MODES)
 *   data-screen-title  accessible / caption name     (default: the tool label)
 *   data-screen-name   short display name for a title card
 *   data-screen-quad   TL,TR,BR,BL in % of the plate — eight numbers or JSON
 *   data-screen-url    override the tool url
 *   data-screen-width  virtual render width for a live iframe
 *
 * @param {ParentNode} [root=document]
 * @param {object}   [opts]
 * @param {Array}    [opts.tools]       tools.json rows, for url/label lookup
 * @param {Function} [opts.narrowHost]  see mountScreen
 */
export function mountRoomScreens(root = document, opts = {}) {
  if (opts.tools) registerTools(opts.tools);
  injectStyles();

  const hosts = Array.from(root.querySelectorAll('[data-screen]'));
  return hosts
    .filter((host) => !host.querySelector(':scope > .ccc-scr'))
    .map((host) => mountScreen({
      host,
      slug: host.getAttribute('data-screen'),
      mode: host.getAttribute('data-screen-mode') || undefined,
      url: host.getAttribute('data-screen-url') || undefined,
      title: host.getAttribute('data-screen-title') || undefined,
      headline: host.getAttribute('data-screen-name') || undefined,
      quad: parseQuadAttr(host.getAttribute('data-screen-quad')),
      width: Number(host.getAttribute('data-screen-width')) || undefined,
      narrowHost: opts.narrowHost
    }));
}

/** Re-measure every screen. Cheap and rare — call it after a layout change. */
export function refreshScreens() {
  for (const rec of records) applyGeometry(rec);
  reconcile();
}

/* Orientation changes on an iPad move every plane at once. */
window.addEventListener('orientationchange', () => {
  setTimeout(refreshScreens, 200);
});

/* A tab coming back from the background gets a fresh promo card and, if the
   streak data has aged past its TTL, a fresh board — without a second loop.
   The board half of that sentence used to be a comment and nothing else: only
   `image` was refreshed, and the tear-down/set-up pair it used dropped the
   image's own retry timer on the floor. Both modes now expose `refresh()` and
   this asks for it; every other mode is left alone. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  for (const rec of records) {
    if (rec.destroyed || !rec.active || !rec.api) continue;
    if (typeof rec.api.refresh === 'function') rec.api.refresh(rec);
  }
});

/* =============================================================================
 * CLASS HOOKS — the contract with assets/theme.css
 * -----------------------------------------------------------------------------
 * Structure (one per screen):
 *   .ccc-scr[data-screen-panel="<slug>"]      the panel
 *     .ccc-scr--title|--image|--feed|--live   its mode
 *     .ccc-scr--quad                          a solved perspective warp is on
 *     .ccc-scr--narrow                        it is in the narrow band
 *     .is-live                                its content has arrived
 *     .ccc-scr__plane   > __glow __glass __scan __crt __sheen __bezel __cap __hit
 *     .ccc-scr__content > one of:
 *         .ccc-scr-title  (__name __rule __cta)
 *         .ccc-scr-art    (__bg __fg)
 *         .ccc-scr-feed   (__stage __slide __head __eyebrow __district __goal
 *                          __grid __store __days __unit __name __meter __flag
 *                          __foot __dots)
 *         .ccc-scr-live
 *         .ccc-scr-holding (__mark __title __note)
 *
 * Narrow band:
 *   .ccc-scr-layer[data-screens-layer="<room>"]  one per room, inside .stage,
 *                                                inserted before .rail
 *   .ccc-scr-layer--<room>                       per-room hook
 *   --scr-count / --scr-gap / --scr-band-h       the band's sizing knobs
 *   .stage[data-ccc-screens="narrow|wide"]       page-level hook
 *   Supply `[data-screens-narrow]` inside a room, or pass `narrowHost`, and
 *   this module puts the panels there instead of building its own band.
 *
 * Custom properties JS writes on `.ccc-scr__plane`:
 *   --scr-w --scr-h      the glass size in px, PRE-warp (unitless numbers)
 *   --scr-u              the type unit: max(9px, width / 40), or / 32 when narrow.
 *                        Every size inside a feed or holding card is an em of it.
 *   --scr-title-fs       the solved title size for `title` mode
 * and on the panel: --scr-ar (narrow aspect ratio, a plain number).
 * CSS-side, `.ccc-scr--narrow .ccc-scr__plane` defines --scr-cap-h (the caption
 * rail's height); set it to 0px to reclaim that strip for the glass.
 * The feed's grid carries --scr-cols and --scr-num (the numeral's em size),
 * both solved from the glass width and the store count.
 *
 * Custom properties JS READS (all from the engine, all @property-registered):
 *   --enter --bloom --p
 * ========================================================================== */

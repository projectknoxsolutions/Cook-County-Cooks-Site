/**
 * Cook County Cooks — v3 "Cinema"
 * assets/engine.js — the scroll-driven cinematic engine.
 *
 * Contract (see SPEC.md):
 *   Each `.room` is a tall scroll runway. Inside it, `.stage` is `position: sticky`
 *   and `height: 100svh`, so the stage stays pinned for exactly
 *   (roomHeight - stageHeight) pixels of scrolling. This engine converts that
 *   pinned distance into a normalised progress `p` and publishes SIX numbers as
 *   CSS custom properties on the `.stage` element:
 *
 *      --p            0 → 1     progress through this room's runway
 *      --plate-scale  1 → 1.085 camera push-in
 *      --plate-x      number    parallax drift x  (see unit note below)
 *      --plate-y      number    parallax drift y  (see unit note below)
 *      --enter        0 → 1     dissolve-in / dissolve-out
 *      --bloom        0 → 1     lights-come-up bloom
 *
 *   UNIT NOTE — do not "fix" this: --plate-x / --plate-y are written as BARE
 *   NUMBERS, not percentages. theme.css registers them via
 *   `@property { syntax: "<number>" }` and applies the units itself, as
 *   `translate3d(calc(var(--plate-x) * 1cqw), calc(var(--plate-y) * 1svh), 0)`.
 *   Appending '%' here makes the registered property reject the value and fall
 *   back to its initial-value of 0, silently killing all parallax.
 *
 *   Everything else — the actual transforms, opacities, filters, hotspot
 *   mirroring — is expressed in theme.css from those six numbers. The engine
 *   NEVER touches any other style, never reads a computed style, and never
 *   reads layout inside the animation loop.
 *
 * Why the old version stuttered and this one cannot:
 *   v2.2 scrubbed a 350-frame image sequence. Every scroll event had to swap a
 *   decoded bitmap; a missed decode = a visibly missing frame. Here there are no
 *   frames. There is one shared rAF loop, all geometry is measured once and kept
 *   in flat typed arrays, and the per-frame work is ~30 floating point ops plus a
 *   handful of `setProperty` calls on at most two elements. The compositor does
 *   the rest on the GPU.
 *
 * Plain ES module. No dependencies. No build step.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Tunables — the whole "feel" of the film lives in this block.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Max push-in. 8.5% over a full room read as a slow dolly, not a zoom. */
const PUSH_IN_MAX = 0.085;

/** Parallax drift. Units are applied by theme.css (1cqw / 1svh per unit), so
 *  these are ~1.4 container-widths-percent and ~1.8 viewport-heights-percent.
 *  Deliberately tiny — this is a camera on a track, not a Ken Burns slideshow. */
const DRIFT_X_PCT = 1.4;
const DRIFT_Y_PCT = 1.8;

/** Time-constant (ms) for the cross-dissolve / bloom smoothing. Scale and
 *  position track scroll EXACTLY (anything else feels like input lag), but the
 *  light transitions get a short filmic lag so the rooms breathe into each other. */
const DISSOLVE_TAU = 90;

/** How long the shared loop keeps spinning after everything has settled before
 *  it parks itself. Parking saves battery on iPads; any input re-arms it. */
const IDLE_FRAMES_BEFORE_PARK = 45;

/** Debounce for expensive re-measures. Required by SPEC: 150ms. */
const RESIZE_DEBOUNCE_MS = 150;

/* ── The occluded-window fallback ────────────────────────────────────────────
 *
 * Chrome zeroes requestAnimationFrame in a hidden tab, and throttles it hard in
 * an occluded window, in a background window under Energy Saver, and on an
 * iPad whose app has been swiped away from. That is correct browser behaviour,
 * but this site runs on store desktops and iPads where exactly that is the
 * NORMAL state: the browser sits behind the POS window all day and a kiosk
 * panel can be composited on screen while the rAF scheduler considers the page
 * uninteresting. v2.2.3 already shipped a setInterval safety net for this same
 * class of bug on this same site; this is that idea, done properly.
 *
 * It is a FALLBACK, not a second engine, and three rules keep it that way:
 *
 *   1. It only exists while the loop is running. armFallback() is called from
 *      wake() and disarmFallback() from park(), so a parked engine has no timer
 *      at all — an idle iPad pays literally nothing.
 *   2. While it is armed it stands down unless rAF has failed to service a
 *      frame for RAF_STALE_MS. On a healthy page the callback is two boolean
 *      tests and a subtraction, five times a second, and never touches the DOM.
 *   3. When it does drive, it calls serviceFrame() — the SAME function tick()
 *      calls, with the same maths and the same write path. There is exactly one
 *      update path in this file, so rAF and the interval can never disagree.
 *
 * RAF_STALE_MS is deliberately well above the worst frame this page produces
 * under a 4x-CPU-throttled iPad Pro profile (517ms in the original gauntlet,
 * 650-720ms on the harness used for this fix), so a merely slow frame never
 * trips it — only a scheduler that has genuinely stopped. The cost of being
 * generous is at most ~1.2s before the fallback picks up a window nobody is
 * looking at; the cost of being tight would be firing during normal raster.
 */
const FALLBACK_INTERVAL_MS = 200;   // 5Hz — enough for a scroll to track, cheap enough to ignore
const RAF_STALE_MS         = 1000;  // no rAF frame for this long ⇒ the scheduler has stopped
const FALLBACK_DT_CAP      = 250;   // clamp the smoothing delta the fallback reports
const FALLBACK_IDLE_DRIVES = 12;    // ~2.4s of nothing to do ⇒ park (and disarm the timer)

/** Values closer than this are considered "arrived" / not worth re-writing. */
const EPS = 0.0005;

/** scrollToRoom tween shaping. */
const TWEEN_MIN_MS = 420;
const TWEEN_MAX_MS = 1100;
const TWEEN_PX_PER_MS = 2.6;

/** Takeover detection during a scrollToRoom flight. See onTakeoverWheel(). */
const TAKEOVER_GRACE_MS   = 280;  // envelope-priming window for an inherited wheel stream
const STREAM_NEW_MS       = 90;   // a wheel stream starting later than this cannot be inertia
const WHEEL_STREAM_GAP_MS = 160;  // silence longer than this ends the current wheel stream
const WHEEL_ENV_TAU       = 1600; // envelope decay (ms) — slower than any real momentum tail (swept)
const WHEEL_RISE_RATIO    = 1.3;  // a delta must beat the envelope by this much to count as a push
const WHEEL_MIN_DELTA     = 12;   // px; below this a wheel event is noise
const WHEEL_RISE_EVENTS   = 2;    // consecutive rising events needed while an envelope is standing

/** Perf self-check flag (see the bottom of this file). */
const PERF = (() => {
  try { return new URLSearchParams(location.search).has('perf'); }
  catch (_) { return false; }
})();

/* ────────────────────────────────────────────────────────────────────────────
 * Flat storage layout.
 *
 * Per-room data lives in two Float64Arrays rather than in objects, so the hot
 * path touches one contiguous buffer instead of chasing pointers across the
 * heap. Strides are named constants so the arithmetic stays readable.
 * ──────────────────────────────────────────────────────────────────────────── */

/* Geometry — written ONLY by measure(), read-only in the loop. */
const M_STRIDE  = 5;
const M_TOP     = 0; // absolute document offset of the room's top edge (px)
const M_HEIGHT  = 1; // full runway height of .room (px)
const M_STAGE_H = 2; // height of the pinned .stage (px) — this is the real 100svh
const M_RUNWAY  = 3; // HEIGHT - STAGE_H, i.e. how far the stage stays pinned
const M_DIR_X   = 4; // +1 / -1, alternates so adjacent rooms drift opposite ways

/* Live values — written by the loop. */
const V_STRIDE   = 8;
const V_P        = 0;
const V_SCALE    = 1;
const V_X        = 2;
const V_Y        = 3;
const V_ENTER    = 4; // smoothed
const V_BLOOM    = 5; // smoothed
const V_ENTER_T  = 6; // target, straight from scroll
const V_BLOOM_T  = 7; // target, straight from scroll

/* Last values actually pushed to the DOM, for write de-duplication. */
const W_STRIDE = 6;

/* ────────────────────────────────────────────────────────────────────────────
 * Easing.
 *
 * A linear push-in reads as mechanical — that is exactly the "cheap" feeling
 * Jeff objected to. easeInOutCubic accelerates and settles like a real dolly
 * with a human on the wheel; easeOutQuint gives the dissolve a soft landing.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Monotonic milliseconds, with a fallback for very old engines. */
function nowMs() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

/** Clamp to 0..1. */
function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/** Slow start, slow finish. Used for the camera push and the scrollToRoom tween. */
function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Fast, then a very long soft tail. Used for dissolve-in and bloom. */
function easeOutQuint(t) {
  return 1 - Math.pow(1 - t, 5);
}

/** Symmetrical S-curve with gentler shoulders than cubic. Used for parallax so
 *  the drift never "starts" or "stops" on a visible frame. */
function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Engine state (module singleton — there is one page, one loop).
 * ──────────────────────────────────────────────────────────────────────────── */

const state = {
  inited: false,
  destroyed: false,

  /** Per-room DOM handles. Index matches the typed-array stride index. */
  rooms: [],            // { id, name, el, stage, wrap, live, settled }
  byName: new Map(),    // 'pass'      → index
  byId: new Map(),      // 'room-pass' → index

  M: null,              // Float64Array geometry
  V: null,              // Float64Array live values
  W: null,              // Float64Array last-written values
  liveFlags: null,      // Uint8Array — 1 when the room is inside the IO margin

  // Loop bookkeeping
  rafId: 0,
  running: false,
  dirty: true,          // set by the passive scroll listener
  lastScrollY: -1,
  lastFrameTime: 0,
  idleFrames: 0,
  dissolveInFlight: false,

  // Occluded-window fallback (see FALLBACK_INTERVAL_MS above)
  fallbackTimer: 0,
  lastRafAt: 0,         // nowMs() of the last frame rAF actually serviced
  lastFallbackAt: 0,
  fallbackIdle: 0,

  // Diagnostics, exposed read-only on the public API. Plain integer bumps.
  rafFrames: 0,
  fallbackDrives: 0,
  settles: 0,
  repairs: 0,
  measures: 0,

  // Active-room tracking
  activeIndex: -1,
  roomChangeCbs: new Set(),

  // Layer promotion — indices of the (at most two) rooms currently carrying
  // will-change. Decoupled from the IO live set on purpose; see updatePromotions().
  promoA: -1,
  promoB: -1,

  // scrollToRoom tween
  tween: null,          // { from, to, start, dur, resolve, cancelled }

  // Environment
  reduceMotion: false,
  io: null,
  listeners: [],        // [target, type, fn, opts] for clean teardown
  resizeTimer: 0,
  lastGeomSig: '',
};

/* ────────────────────────────────────────────────────────────────────────────
 * Listener bookkeeping — every listener we add is recorded so destroy() can
 * remove all of them. A half-removed engine is how you get two rAF loops.
 * ──────────────────────────────────────────────────────────────────────────── */

function on(target, type, fn, opts) {
  if (!target || !target.addEventListener) return;
  target.addEventListener(type, fn, opts);
  state.listeners.push([target, type, fn, opts]);
}

function offAll() {
  for (const [target, type, fn, opts] of state.listeners) {
    try { target.removeEventListener(type, fn, opts); } catch (_) { /* noop */ }
  }
  state.listeners.length = 0;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Measurement.
 *
 * THE ONLY PLACE IN THIS FILE THAT READS LAYOUT.
 *
 * All reads happen back-to-back with zero interleaved writes, so the browser
 * performs at most one layout flush for the whole pass regardless of how many
 * rooms exist. Called on init, on debounced resize, on orientationchange, on
 * visualViewport resize, and when the page becomes visible again.
 * ──────────────────────────────────────────────────────────────────────────── */

function measure() {
  const rooms = state.rooms;
  const M = state.M;
  if (!rooms.length || !M) return;

  // One scroll read up front; getBoundingClientRect is viewport-relative and we
  // want absolute document offsets.
  const scrollY = window.scrollY || window.pageYOffset || 0;

  // --- READ PHASE (no writes below this line until the loop ends) ---
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    const roomRect = r.el.getBoundingClientRect();
    const stageRect = r.stage.getBoundingClientRect();

    const top = roomRect.top + scrollY;
    const height = roomRect.height;

    // The stage's own measured height IS the resolved 100svh. Deriving the
    // runway from it (instead of window.innerHeight) is what makes iOS Safari's
    // collapsing address bar a non-event: svh does not change when the chrome
    // hides, so neither does any number we cache here.
    const stageH = stageRect.height || height;

    const o = i * M_STRIDE;
    M[o + M_TOP] = top;
    M[o + M_HEIGHT] = height;
    M[o + M_STAGE_H] = stageH;
    // Guard against a room shorter than its stage (mis-authored CSS): a zero or
    // negative runway would produce Infinity/NaN progress.
    M[o + M_RUNWAY] = Math.max(1, height - stageH);
    M[o + M_DIR_X] = (i % 2 === 0) ? 1 : -1;
  }
  // --- END READ PHASE ---

  state.measures++;
  state.lastGeomSig = geometrySignature();
  state.dirty = true;
  wake();
}

/**
 * Cheap fingerprint of page geometry. visualViewport fires constantly while the
 * iOS address bar animates; if this string has not changed there is genuinely
 * nothing to re-measure and we can skip the layout flush entirely.
 */
function geometrySignature() {
  const de = document.documentElement;
  const vv = window.visualViewport;
  return de.clientWidth + 'x' + de.clientHeight + '/' + de.scrollHeight +
         '/' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : '-');
}

/* ────────────────────────────────────────────────────────────────────────────
 * The single shared rAF loop.
 *
 * One loop for the entire page — rooms, dissolves and the scrollToRoom tween all
 * step from here. There is never more than one rAF in flight.
 * ──────────────────────────────────────────────────────────────────────────── */

function wake() {
  if (state.reduceMotion || state.destroyed) return;
  state.idleFrames = 0;
  if (!state.running) {
    state.running = true;
    state.lastFrameTime = 0;
    state.rafId = requestAnimationFrame(tick);
    armFallback();
  }
}

function park() {
  state.running = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  disarmFallback();
}

function tick(now) {
  if (state.destroyed) { park(); return; }
  state.rafId = requestAnimationFrame(tick);

  // Frame delta, clamped so a backgrounded tab or a long GC pause cannot make
  // the dissolve jump on the next visible frame.
  const dt = state.lastFrameTime ? Math.min(64, now - state.lastFrameTime) : 16.7;
  state.lastFrameTime = now;

  // The fallback's only input. Stamped from nowMs() rather than from `now` so
  // both sides read the same clock even on an engine without performance.now().
  state.lastRafAt = nowMs();
  state.rafFrames++;

  if (PERF) perfSample(dt);

  if (serviceFrame(now, dt, false, false, false)) {
    state.idleFrames = 0;
    return;
  }

  // Nothing to compute. This is the cheapest possible frame.
  if (++state.idleFrames > IDLE_FRAMES_BEFORE_PARK) park();
}

/* ────────────────────────────────────────────────────────────────────────────
 * serviceFrame — THE single update path.
 *
 * tick() calls it, the occluded-window fallback calls it, the visibilitychange
 * repair calls it. One scroll read at the top, all arithmetic in the middle, all
 * DOM writes at the end; no caller can introduce a second way of updating a room
 * and therefore no caller can disagree with another about what a room looks like.
 *
 * @param {number}  now    ms on the nowMs() timeline
 * @param {number}  dt     frame delta for the dissolve smoothing
 * @param {boolean} snap   true ⇒ smoothing coefficient 1: land ON the targets for
 *                         this scroll position instead of easing toward them.
 * @param {boolean} resolve true ⇒ collapse the cross-dissolve to a coherent
 *                         composite (see resolveComposite).
 * @param {boolean} fromFallback true ⇒ rAF is not running, so IntersectionObserver
 *                         is not being delivered either; re-derive liveness.
 * @returns {boolean} whether there was anything to do.
 * ──────────────────────────────────────────────────────────────────────────── */
function serviceFrame(now, dt, snap, resolve, fromFallback) {
  // ---- 1. Advance the programmatic scroll tween, if any. ----
  // Doing it here rather than in a second rAF keeps the "one loop" guarantee.
  if (state.tween) stepTween(now);

  // ---- 2. Single scroll read for the whole frame. ----
  // Read once, at the top, before any write. Nothing below this line reads the
  // DOM, so this can never be a read-after-write layout thrash.
  const scrollY = window.scrollY || window.pageYOffset || 0;
  const scrolled = scrollY !== state.lastScrollY;

  // ---- 3. Early-out. ----
  if (!scrolled && !state.dirty && !state.dissolveInFlight && !state.tween) return false;

  // ---- 4. Liveness, when the observer cannot help. ----
  // IntersectionObserver callbacks are delivered from the same "update the
  // rendering" step that runs rAF callbacks — so in a window where rAF has
  // stopped, IO has stopped too, and a room scrolled into view would never be
  // marked live and never have its vars written. (That is precisely why `host`
  // came back with empty --p / --enter in the field report.) Re-derive it from
  // the cached geometry instead: pure float compares, zero layout reads, and
  // skipped entirely on the healthy rAF path.
  if (fromFallback && scrolled) primeLiveNeighbourhood(scrollY);

  state.lastScrollY = scrollY;
  state.dirty = false;

  computeFrame(scrollY, dt, snap);
  if (resolve) resolveComposite(scrollY);
  flushWrites();
  updatePromotions(scrollY);
  updateActiveRoom(scrollY);
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The occluded-window fallback. Armed by wake(), disarmed by park().
 * ──────────────────────────────────────────────────────────────────────────── */

function armFallback() {
  if (state.fallbackTimer || state.destroyed || state.reduceMotion) return;
  state.fallbackIdle = 0;
  state.lastFallbackAt = 0;
  state.fallbackTimer = setInterval(fallbackTick, FALLBACK_INTERVAL_MS);
}

function disarmFallback() {
  if (!state.fallbackTimer) return;
  clearInterval(state.fallbackTimer);
  state.fallbackTimer = 0;
}

function fallbackTick() {
  // Parked, torn down, or reduced-motion: the loop is not supposed to be
  // producing frames at all, so neither is this.
  if (state.destroyed || state.reduceMotion || !state.running) return;

  // THE STAND-DOWN TEST. rAF serviced a frame recently, so it is doing its job
  // and this must not touch anything. Two compares; no DOM, no allocation.
  const now = nowMs();
  if (now - state.lastRafAt < RAF_STALE_MS) return;

  const dt = state.lastFallbackAt
    ? Math.min(FALLBACK_DT_CAP, now - state.lastFallbackAt)
    : FALLBACK_INTERVAL_MS;
  state.lastFallbackAt = now;
  state.fallbackDrives++;

  // Re-arm the real loop. `running` means "a frame is wanted", and wake() is a
  // no-op while it is true — so if the request we are running on was swallowed
  // by a scheduler that has since come back (a tab shown again, a window
  // un-occluded, Energy Saver releasing the page), nothing would ever ask for
  // another frame and the whole site would stay on this 5Hz drip. Cancel first
  // so there is never more than one request in flight: the "one shared rAF
  // loop" guarantee has to survive the fallback, not be broken by it.
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(tick);

  // A page the compositor is not showing gets the settled composite rather than
  // a 5Hz cross-dissolve: nobody can see a dissolve at 5Hz, and a coherent room
  // is the only thing worth leaving on a screen we cannot repaint smoothly.
  const hidden = isHidden();

  if (serviceFrame(now, dt, hidden, hidden, true)) {
    state.fallbackIdle = 0;
  } else if (++state.fallbackIdle > FALLBACK_IDLE_DRIVES) {
    park();
  }
}

function isHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-frame math. Pure arithmetic over the cached typed arrays.
 * Not a single DOM access in this function.
 * ──────────────────────────────────────────────────────────────────────────── */

function computeFrame(scrollY, dt, snap) {
  const rooms = state.rooms;
  const M = state.M;
  const V = state.V;
  const live = state.liveFlags;

  // Exponential smoothing coefficient, derived from the real frame delta so the
  // dissolve takes the same wall-clock time at 60Hz, 120Hz or a dropped 30Hz.
  // snap ⇒ k = 1: used when we are repairing a page that has not been ticking,
  // where easing from a stale value would show the user half a second of the
  // very ghost we are there to remove.
  const k = snap ? 1 : (1 - Math.exp(-dt / DISSOLVE_TAU));

  let anyInFlight = false;

  for (let i = 0; i < rooms.length; i++) {
    if (!live[i]) continue; // dormant: vars stay exactly as last written (frozen)

    const o = i * M_STRIDE;
    const v = i * V_STRIDE;

    const top = M[o + M_TOP];
    const stageH = M[o + M_STAGE_H];
    const runway = M[o + M_RUNWAY];
    const dirX = M[o + M_DIR_X];

    // --- progress through the pinned runway ---
    const p = clamp01((scrollY - top) / runway);

    // --- camera push-in ---
    const pushEase = easeInOutCubic(p);
    const scale = 1 + PUSH_IN_MAX * pushEase;

    // --- parallax drift ---
    // Centred on 0 at p = 0.5 so the plate is never off-centre for long, and
    // eased so the direction change at the midpoint is invisible.
    const drift = (smootherstep(p) - 0.5) * 2;
    const x = drift * DRIFT_X_PCT * dirX;
    const y = -drift * DRIFT_Y_PCT;

    // --- enter / dissolve ---
    // Ramps 0→1 across the viewport-height of approach (room bottom edge rising
    // into view) and back 1→0 across the viewport-height of departure. Two rooms
    // are therefore mid-dissolve at once, which is exactly the cross-fade.
    const enterIn = clamp01((scrollY - (top - stageH)) / stageH);
    const enterOut = 1 - clamp01((scrollY - (top + runway)) / stageH);
    const enterTarget = easeOutQuint(Math.min(enterIn, enterOut));

    // --- bloom ---
    // Lights come up over the first ~55% of the room, then hold. Gated by enter
    // so an off-screen room never glows.
    const bloomTarget = easeOutQuint(clamp01(p / 0.55)) * enterTarget;

    // Smoothed toward target. Scale/x/y are NOT smoothed — they must be locked
    // to the finger or the whole thing feels like input lag.
    const prevEnter = V[v + V_ENTER];
    const prevBloom = V[v + V_BLOOM];
    const nextEnter = prevEnter + (enterTarget - prevEnter) * k;
    const nextBloom = prevBloom + (bloomTarget - prevBloom) * k;

    if (Math.abs(enterTarget - nextEnter) > EPS ||
        Math.abs(bloomTarget - nextBloom) > EPS) {
      anyInFlight = true;
    }

    V[v + V_P] = p;
    V[v + V_SCALE] = scale;
    V[v + V_X] = x;
    V[v + V_Y] = y;
    V[v + V_ENTER] = nextEnter;
    V[v + V_BLOOM] = nextBloom;
    V[v + V_ENTER_T] = enterTarget;
    V[v + V_BLOOM_T] = bloomTarget;
  }

  state.dissolveInFlight = anyInFlight;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Write phase. All DOM writes for the frame happen here, at the very end, in
 * one uninterrupted burst — no read can sneak between them.
 *
 * setProperty on a custom property invalidates style for that subtree but does
 * not force a synchronous layout. Combined with the de-dup below, a still frame
 * costs zero writes and a moving frame costs at most 12 (6 vars × 2 live rooms).
 * ──────────────────────────────────────────────────────────────────────────── */

function flushWrites() {
  const rooms = state.rooms;
  const V = state.V;
  const W = state.W;
  const live = state.liveFlags;

  for (let i = 0; i < rooms.length; i++) {
    if (!live[i]) continue;
    writeRoom(rooms[i].stage.style, V, W, i * V_STRIDE, i * W_STRIDE);
  }
}

/** Write the six vars for one room, skipping any that have not moved. */
function writeRoom(style, V, W, v, w) {
  const p     = round(V[v + V_P], 4);
  const scale = round(V[v + V_SCALE], 5);
  const x     = round(V[v + V_X], 3);
  const y     = round(V[v + V_Y], 3);
  const enter = round(V[v + V_ENTER], 3);
  const bloom = round(V[v + V_BLOOM], 3);

  if (W[w + 0] !== p)     { W[w + 0] = p;     style.setProperty('--p', p); }
  if (W[w + 1] !== scale) { W[w + 1] = scale; style.setProperty('--plate-scale', scale); }
  if (W[w + 2] !== x)     { W[w + 2] = x;     style.setProperty('--plate-x', x); }
  if (W[w + 3] !== y)     { W[w + 3] = y;     style.setProperty('--plate-y', y); }
  if (W[w + 4] !== enter) { W[w + 4] = enter; style.setProperty('--enter', enter); }
  if (W[w + 5] !== bloom) { W[w + 5] = bloom; style.setProperty('--bloom', bloom); }
}

/** Quantise. Rounding kills sub-perceptual churn, which kills wasted style work. */
function round(v, digits) {
  const f = digits === 3 ? 1e3 : (digits === 4 ? 1e4 : 1e5);
  return Math.round(v * f) / f;
}

/* ────────────────────────────────────────────────────────────────────────────
 * IntersectionObserver gating.
 *
 * rootMargin '100% 0px' = one full viewport of slack above and below. A room
 * becomes "live" a screen before it can possibly be seen, so its first painted
 * frame is already correct, and goes dormant a screen after it leaves.
 *
 * Liveness controls COMPUTATION only. Layer promotion is a separate, tighter
 * rule — see updatePromotions() — because the gauntlet measured four rooms
 * legitimately intersecting this band at iPad Pro portrait, and four promoted
 * 4K plates is precisely the GPU-memory pressure we are trying to avoid.
 *
 * The margin stays at one full viewport (SPEC: "a room more than one viewport
 * away is skipped entirely"). It must: a room goes live a full viewport before
 * its --enter ramp begins, which is the slack that absorbs IntersectionObserver's
 * async delivery on a fast flick. Tightening it would buy nothing — the extra
 * live rooms are entirely offscreen, so they are never rastered — while risking
 * a room reaching the viewport with its vars still frozen at enter = 0.
 * ──────────────────────────────────────────────────────────────────────────── */

function setupObserver() {
  if (typeof IntersectionObserver !== 'function') {
    // No IO (ancient browser): treat every room as live. Correct, just less lazy.
    state.liveFlags.fill(1);
    for (const r of state.rooms) r.live = true;
    return;
  }

  state.io = new IntersectionObserver((entries) => {
    let changed = false;

    for (const entry of entries) {
      const i = state.byId.get(entry.target.id);
      if (i === undefined) continue;

      const nowLive = entry.isIntersecting;
      const room = state.rooms[i];
      if (room.live === nowLive) continue;

      room.live = nowLive;
      state.liveFlags[i] = nowLive ? 1 : 0;
      changed = true;

      if (!nowLive) {
        // Settle the room to a clean end-state so a frozen plate is never left
        // stranded mid-push. This runs in the IO callback, NOT in the rAF loop,
        // so it costs the animation nothing. will-change is NOT touched here —
        // updatePromotions() is its single owner.
        settleDormant(i);
      }
    }

    if (changed) { state.dirty = true; wake(); }
  }, {
    root: null,
    rootMargin: '100% 0px',
    threshold: 0,
  });

  for (const r of state.rooms) state.io.observe(r.el);
}

/**
 * Snap a newly-dormant room to a defensible resting state: fully pushed-in if we
 * scrolled past it, fully wide if we scrolled back above it, dissolved out either
 * way. Written once, then frozen until the room goes live again.
 */
function settleDormant(i) {
  const M = state.M, V = state.V;
  const o = i * M_STRIDE, v = i * V_STRIDE;
  const scrollY = state.lastScrollY < 0 ? (window.scrollY || 0) : state.lastScrollY;
  const past = scrollY > M[o + M_TOP];

  const p = past ? 1 : 0;
  V[v + V_P] = p;
  V[v + V_SCALE] = 1 + PUSH_IN_MAX * easeInOutCubic(p);
  V[v + V_X] = (smootherstep(p) - 0.5) * 2 * DRIFT_X_PCT * M[o + M_DIR_X];
  V[v + V_Y] = -(smootherstep(p) - 0.5) * 2 * DRIFT_Y_PCT;
  V[v + V_ENTER] = 0;
  V[v + V_BLOOM] = 0;
  V[v + V_ENTER_T] = 0;
  V[v + V_BLOOM_T] = 0;

  writeRoom(state.rooms[i].stage.style, V, state.W, v, i * W_STRIDE);
}

/* ────────────────────────────────────────────────────────────────────────────
 * resolveComposite — never leave a half-dissolved frame.
 *
 * A cross-dissolve is only coherent while it is MOVING. Freeze one at its
 * midpoint and the page is not "a room fading into another room", it is two
 * translucent photographs stacked over the ink-950 matte: the field report's
 * hero at 0.39 opacity over black, no plate readable, and no amount of
 * scrolling changing it because the loop that drives it had stopped.
 *
 * So whenever ticking is about to stop — the tab is being hidden, or the engine
 * booted into a background tab where rAF will never run — we do not merely
 * freeze the numbers. We collapse the dissolve to a decision: ONE room is fully
 * present, every other live room is fully absent. That composite is a real
 * frame of the film. It is what the room would look like a few hundred
 * milliseconds either side of where we stopped, and it is stable.
 *
 * Which room wins: the one with the highest --enter TARGET, ties going to the
 * later room in DOM order (which is the incoming one, and paints above anyway,
 * so the resolution matches what the compositor was already heading toward).
 * If every live room targets 0 — the far tail of the last room's runway — we
 * fall back to the room with the most viewport overlap, because resolving to
 * "all absent" would be a black screen, which is the one outcome worse than a
 * ghost.
 *
 * Rooms outside the live set are deliberately untouched. theme.css registers
 * --enter with initial-value 1 (and --p 0, --plate-scale 1, --plate-x/y 0), so
 * a room this engine has never written renders as a lit, static, correctly
 * framed photograph — that is the documented no-JS design. Those rooms are all
 * more than a viewport away, so none of them is on screen to contradict the
 * room we just resolved.
 * ──────────────────────────────────────────────────────────────────────────── */

function resolveComposite(scrollY) {
  const rooms = state.rooms, M = state.M, V = state.V, live = state.liveFlags;

  let winner = -1, bestEnter = -1;
  let overlapWinner = -1, bestOverlap = 0;

  for (let i = 0; i < rooms.length; i++) {
    if (!live[i]) continue;

    // '>=' so a dead-even cross-dissolve resolves to the incoming room.
    const t = V[i * V_STRIDE + V_ENTER_T];
    if (t >= bestEnter) { bestEnter = t; winner = i; }

    const o = i * M_STRIDE;
    const top = M[o + M_TOP];
    const overlap = Math.min(top + M[o + M_HEIGHT], scrollY + M[o + M_STAGE_H]) -
                    Math.max(top, scrollY);
    if (overlap > bestOverlap) { bestOverlap = overlap; overlapWinner = i; }
  }

  if (bestEnter <= 0) winner = overlapWinner;   // never resolve to an all-black frame
  if (winner < 0) return;

  for (let i = 0; i < rooms.length; i++) {
    if (!live[i]) continue;
    const v = i * V_STRIDE;
    if (i === winner) {
      V[v + V_ENTER] = 1;
      // Bloom is normally gated by --enter; with enter forced to 1 the
      // consistent value is the ungated curve for this room's own progress.
      V[v + V_BLOOM] = easeOutQuint(clamp01(V[v + V_P] / 0.55));
    } else {
      V[v + V_ENTER] = 0;
      V[v + V_BLOOM] = 0;
    }
  }

  // Nothing is easing any more, so the loop is free to park.
  state.dissolveInFlight = false;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The two moments where ticking starts or stops.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * About to stop ticking (tab hidden, or booted hidden). Land on a coherent,
 * fully-presented room synchronously, before the compositor takes its last
 * snapshot of the page.
 */
function settleHidden() {
  cancelTween('cancelled');   // before the guards: a flight must never survive a hide
  if (state.reduceMotion || state.destroyed || !state.rooms.length) return;
  state.lastScrollY = -1;        // force a full recompute, not an early-out
  state.dirty = true;
  state.settles++;
  serviceFrame(nowMs(), FALLBACK_DT_CAP, true, true, true);
}

/**
 * Just became visible again. The page may have been hidden across a window
 * resize, a rotation, a font swap or a bfcache restore, so the cached geometry
 * is suspect — re-measure for real (not on the 150ms debounce) and then push a
 * full synchronous update BEFORE the next rAF, so the first frame the user sees
 * is already right. Waiting for rAF would show one stale frame; waiting for a
 * scroll event, as the old code effectively did, would show a stale page until
 * the user happened to touch it.
 */
function repairVisible() {
  if (state.destroyed || !state.rooms.length) return;

  state.lastFrameTime = 0;       // do not integrate the time the tab was hidden
  state.lastFallbackAt = 0;
  state.repairs++;

  measure();                     // full geometry re-measure, synchronous
  primeLiveNeighbourhood(window.scrollY || window.pageYOffset || 0);

  state.lastScrollY = -1;
  state.dirty = true;

  // snap: land exactly on this scroll position's values. resolve: NO — the tab
  // is on screen now, so the true cross-dissolve for where we are is the
  // correct picture, and it is what the very next rAF frame would compute.
  serviceFrame(nowMs(), 0, true, false, false);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Layer promotion — the hard cap on will-change.
 *
 * The gauntlet measured FOUR .plate-wrap elements carrying will-change at iPad
 * Pro portrait (1024x1366): rootMargin '100% 0px' genuinely keeps four rooms
 * intersecting at that aspect. Combined with ~300MB of composited layer memory
 * and dozens of >1MB layers, that is the precondition for iPad Safari tile
 * eviction — the exact stutter signature this engine exists to prevent.
 *
 * So promotion is decoupled from liveness. IO decides what gets COMPUTED (cheap
 * float math, and it needs the full viewport of lead time). This decides what
 * gets a COMPOSITOR LAYER: the two rooms nearest the viewport centre, never
 * more. Live-but-offscreen rooms get nothing — offscreen content is not
 * rastered, so a layer for it is pure cost.
 *
 * This function is the SINGLE OWNER of will-change for the whole page, across
 * all three animated layers of a room: .plate-wrap (transform), .plate-glow and
 * .plate-vig (opacity). theme.css deliberately declares none of them — a static
 * will-change rule cannot be scoped to the visible rooms, so it promoted all 16
 * light layers for the entire session (peak 18, 381MB, 47 layers over 1MB) and
 * did it under prefers-reduced-motion too, promoting sixteen layers to animate
 * nothing. Promotion is worth ~40% of frame time, so it stays — it just has to
 * be spent on the two rooms that can actually be seen. Budget: 3 x 2 = 6.
 *
 * Because rooms are 200vh runways, "nearest two by centre distance" flips at
 * each room's midpoint, which lands exactly right: during every cross-dissolve
 * the two rooms actually dissolving are the two that hold layers.
 *
 * Runs every frame, but it is two integer compares against the cached pair and
 * touches the DOM only when the pair changes — a handful of times per full-page
 * scroll. When the loop parks, the last pair keeps its layers on purpose:
 * re-promoting on scroll resume would throw away rasterised tiles for nothing.
 * ──────────────────────────────────────────────────────────────────────────── */

function setRoomPromotion(room, on) {
  // .plate-wrap animates transform; the glow and vignette animate opacity only.
  // Naming the right property matters — `will-change: transform` on a layer that
  // only ever changes opacity buys the cost of a layer without the benefit.
  room.wrap.style.willChange = on ? 'transform' : '';
  if (room.glow) room.glow.style.willChange = on ? 'opacity' : '';
  if (room.vig) room.vig.style.willChange = on ? 'opacity' : '';
}

function updatePromotions(scrollY) {
  const rooms = state.rooms;
  const M = state.M;

  // Nearest and second-nearest room centre to the viewport centre.
  let a = -1, b = -1, aDist = Infinity, bDist = Infinity;

  for (let i = 0; i < rooms.length; i++) {
    const o = i * M_STRIDE;
    const roomCentre = M[o + M_TOP] + M[o + M_HEIGHT] * 0.5;
    const viewCentre = scrollY + M[o + M_STAGE_H] * 0.5;
    const d = Math.abs(roomCentre - viewCentre);

    if (d < aDist)      { b = a; bDist = aDist; a = i; aDist = d; }
    else if (d < bDist) { b = i; bDist = d; }
  }

  if (a === state.promoA && b === state.promoB) return;  // steady state: no writes

  // Demote first, then promote, and skip any room that is in both the old and
  // new pair — churning will-change on a room that stayed selected would
  // discard and re-rasterise its tiles, which is the opposite of the point.
  const prevA = state.promoA, prevB = state.promoB;
  if (prevA >= 0 && prevA !== a && prevA !== b) setRoomPromotion(rooms[prevA], false);
  if (prevB >= 0 && prevB !== a && prevB !== b) setRoomPromotion(rooms[prevB], false);
  if (a >= 0 && a !== prevA && a !== prevB) setRoomPromotion(rooms[a], true);
  if (b >= 0 && b !== prevA && b !== prevB) setRoomPromotion(rooms[b], true);

  state.promoA = a;
  state.promoB = b;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Active-room tracking → onRoomChange.
 * Pure arithmetic over cached geometry; the top menu gets its highlight for free.
 * ──────────────────────────────────────────────────────────────────────────── */

function updateActiveRoom(scrollY) {
  const rooms = state.rooms;
  const M = state.M;

  let best = -1;
  let bestOverlap = 0;

  for (let i = 0; i < rooms.length; i++) {
    const o = i * M_STRIDE;
    const top = M[o + M_TOP];
    const bottom = top + M[o + M_HEIGHT];
    const viewTop = scrollY;
    const viewBottom = scrollY + M[o + M_STAGE_H];

    const overlap = Math.min(bottom, viewBottom) - Math.max(top, viewTop);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
  }

  if (best === -1 || best === state.activeIndex) return;
  state.activeIndex = best;

  const room = rooms[best];
  const payload = { id: room.id, name: room.name, index: best, el: room.el };

  for (const cb of state.roomChangeCbs) {
    // A throwing menu callback must never be able to kill the animation loop.
    try { cb(payload); }
    catch (err) { console.error('[engine] onRoomChange callback threw:', err); }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * prefers-reduced-motion.
 *
 * Reduce → write the static end-state once and never start the loop at all.
 * Not "start the loop and make it do nothing" — never start it.
 * ──────────────────────────────────────────────────────────────────────────── */

function applyReducedMotion() {
  park();
  state.dissolveInFlight = false;

  for (let i = 0; i < state.rooms.length; i++) {
    const r = state.rooms[i];
    const s = r.stage.style;
    s.setProperty('--p', 0);
    s.setProperty('--plate-scale', 1);
    s.setProperty('--plate-x', 0);
    s.setProperty('--plate-y', 0);
    s.setProperty('--enter', 1);
    s.setProperty('--bloom', 1);
    // Promote nothing: the loop never runs, so there is nothing to promote for.
    // The static rule this replaced promoted sixteen layers to animate nothing.
    setRoomPromotion(r, false);
    state.promoA = -1;
    state.promoB = -1;

    // Keep the write-cache in sync so a later motion-allowed switch does not
    // skip writes it thinks are already applied.
    const w = i * W_STRIDE;
    state.W[w + 0] = 0;
    state.W[w + 1] = 1;
    state.W[w + 2] = 0;
    state.W[w + 3] = 0;
    state.W[w + 4] = 1;
    state.W[w + 5] = 1;
  }

  // The menu still needs to know where we are.
  updateActiveRoom(window.scrollY || 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * scrollToRoom — our own rAF tween.
 *
 * CSS `scroll-behavior: smooth` is banned: the browser's own smooth scroll runs
 * on a separate timeline we cannot cancel or read, and in v2 it fought this
 * engine's scroll handling and left the menu in a wedged state. A hand-rolled
 * tween is cancellable, inspectable and stops dead the instant a human touches
 * the wheel, the trackpad, the screen or the keyboard.
 *
 * The tween is stepped from the SHARED loop (see tick()), so requirement 1 —
 * exactly one rAF for the whole page — still holds.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Input events that mean "the user may have taken over". */
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'mousedown', 'keydown'];

/** Keys that actually scroll. Tabbing or typing must not kill a jump. */
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar', 'Escape'];

function cancelTween(reason) {
  const t = state.tween;
  if (!t) return;
  state.tween = null;
  for (const type of TAKEOVER_EVENTS) {
    window.removeEventListener(type, onTakeover, { capture: true });
  }
  if (t.resolve) t.resolve(reason || 'cancelled');
}

/* ── Takeover detection ──────────────────────────────────────────────────────
 *
 * The v2 regression, reproduced 4/4 by the gauntlet: click a menu item while
 * trackpad momentum is still arriving, and the jump was cancelled by the very
 * first inertial wheel event — stranding the page thousands of pixels short with
 * aria-current stuck on the wrong room. Trackpad inertia runs ~1s past the
 * finger lift, so "zero wheel events after the click" is the unrealistic case.
 *
 * The question is not "did an input event arrive" but "is a HUMAN driving right
 * now". That splits the events into two classes with two different tests:
 *
 *   Discrete events — touchstart, touchmove, pointerdown, mousedown, nav keys.
 *     A finger landing on the glass or a key going down cannot be inertia:
 *     momentum scrolling fires no touch, pointer or key events on any platform.
 *     These cancel INSTANTLY, at any point in the flight, grace window included.
 *     That is what keeps a deliberate override feeling immediate.
 *
 *   Wheel events — the only ambiguous class. Inertia and a fresh two-finger push
 *     produce byte-identical events, and magnitude cannot separate them because
 *     inertia is LOUDEST immediately after the lift, which is exactly when the
 *     click lands. The one property inertia always has is that it only ever
 *     DECAYS. So we track a leaky energy envelope with a slower-decaying
 *     peak-hold and cancel when the incoming stream climbs back ABOVE its own
 *     envelope — something a decaying tail cannot do, and a hand returning to
 *     the trackpad does within one or two events (~30ms). The envelope decays on
 *     a slower time-constant than any real momentum tail, so the gap between the
 *     two only ever widens — that is what makes the guarantee hold for the full
 *     ~1s of inertia rather than just the first few frames. WHEEL_ENV_TAU was
 *     chosen by sweeping 126 synthetic momentum profiles (peak 40-450px, decay
 *     0.90-0.99 per event, 8/16/33ms cadences): 1600ms is the smallest value that
 *     false-cancels on none of them while still admitting a real push in under
 *     four events.
 *
 * Deliberately NOT used: a direction test ("cancel if the wheel opposes the
 * tween"). It is unsound here — whether the leftover inertia opposes the tween
 * depends only on whether the user clicked a room above or below where they were
 * scrolling, so an opposing sign is just as likely to be inertia as intent. It
 * would have swapped this bug for the same bug on upward jumps.
 */

/** Normalise a wheel event to pixels, whatever deltaMode it reports in. */
function wheelDeltaPx(e) {
  const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (e.deltaMode === 1) return raw * 16;                          // lines
  if (e.deltaMode === 2) return raw * (window.innerHeight || 800);  // pages
  return raw;                                                      // pixels
}

function onTakeover(e) {
  const t = state.tween;
  if (!t) return;

  if (e.type === 'wheel') { onTakeoverWheel(e, t); return; }

  if (e.type === 'keydown' && !NAV_KEYS.includes(e.key)) return;

  // Discrete, unambiguous human input — stop dead.
  cancelTween('interrupted');
  wake();
}

function onTakeoverWheel(e, t) {
  const now = nowMs();
  const d = Math.abs(wheelDeltaPx(e));
  const gap = now - t.lastWheelAt;

  // Silence long enough to end the stream means the gesture AND its inertia are
  // over. Drop the envelope so the next wheel event is judged on its own merits.
  if (gap > WHEEL_STREAM_GAP_MS) {
    t.wheelEnv = 0;
    t.risingRun = 0;
    t.streamStart = now;
  }
  t.lastWheelAt = now;

  // The envelope decays on a time-constant deliberately chosen to be SLOWER than
  // any plausible momentum tail. Two geometric decays, ours the slower: a real
  // inertia stream therefore slides further beneath the envelope every event and
  // can never climb back through it, no matter how long it runs.
  t.wheelEnv *= Math.exp(-Math.min(gap, 2000) / WHEEL_ENV_TAU);

  // Was this stream already running when the jump started? Inertia is continuous
  // with the gesture that preceded the click, so its first event lands within a
  // frame or two of t.start. A stream that begins later cannot be that inertia.
  const inherited = (t.streamStart - t.start) <= STREAM_NEW_MS;

  if (inherited && (now - t.start) < TAKEOVER_GRACE_MS) {
    // Priming. This is the only window in which the envelope is allowed to rise,
    // and the only window in which a wheel event can never cancel. Its sole job
    // is to record how loud the inherited stream was, so the rest of the flight
    // has something to measure against. Letting the envelope rise later would be
    // self-defeating: it would chase a sustained push upward and never be beaten.
    t.wheelEnv = Math.max(t.wheelEnv, d);
    t.risingRun = 0;
    return;
  }

  // With no envelope standing there is no inertia to be confused with, so one
  // event above the noise floor is enough — that is a mouse wheel notch, or a
  // gesture that began after a pause, and both are unambiguous intent. While an
  // envelope IS standing, require a short run so a single jittery momentum
  // sample cannot masquerade as a push.
  const needed = t.wheelEnv > 0 ? WHEEL_RISE_EVENTS : 1;

  if (d > Math.max(WHEEL_MIN_DELTA, t.wheelEnv * WHEEL_RISE_RATIO)) {
    if (++t.risingRun >= needed) {
      cancelTween('interrupted');
      wake();
    }
    return;
  }

  t.risingRun = 0;
}

function stepTween(now) {
  const t = state.tween;
  const k = clamp01((now - t.start) / t.dur);
  const y = t.from + (t.to - t.from) * easeInOutCubic(k);

  window.scrollTo(0, y);

  if (k >= 1) cancelTween('done');
}

/**
 * Animate the window to a room's start.
 *
 * @param {string|Element} target  room name ('pass'), element id ('room-pass'),
 *                                 or the `.room` element itself.
 * @param {object}   [opts]
 * @param {number}   [opts.offset=0]    px to stop short (e.g. a fixed header).
 * @param {number}   [opts.duration]    override the distance-derived duration.
 * @returns {Promise<'done'|'interrupted'|'cancelled'|'unknown-room'|'reduced-motion'>}
 */
export function scrollToRoom(target, opts) {
  const options = opts || {};
  const i = resolveRoomIndex(target);

  if (i === -1) {
    console.warn('[engine] scrollToRoom: unknown room', target);
    return Promise.resolve('unknown-room');
  }

  // Any in-flight jump is superseded.
  cancelTween('cancelled');

  const maxY = Math.max(0, document.documentElement.scrollHeight - (window.innerHeight || 0));
  const to = Math.max(0, Math.min(maxY, state.M[i * M_STRIDE + M_TOP] - (options.offset || 0)));
  const from = window.scrollY || window.pageYOffset || 0;

  // Reduced motion: teleport. An unrequested 900ms animation is exactly what the
  // user asked the OS to stop doing.
  if (state.reduceMotion) {
    window.scrollTo(0, to);
    updateActiveRoom(to);
    return Promise.resolve('reduced-motion');
  }

  const distance = Math.abs(to - from);
  if (distance < 2) {
    window.scrollTo(0, to);
    return Promise.resolve('done');
  }

  const dur = options.duration != null
    ? Math.max(1, options.duration)
    : Math.max(TWEEN_MIN_MS, Math.min(TWEEN_MAX_MS, distance / TWEEN_PX_PER_MS));

  return new Promise((resolve) => {
    state.tween = {
      from, to, dur,
      start: nowMs(),
      resolve,
      // Wheel-takeover envelope. lastWheelAt/streamStart start at 0 so a first
      // wheel event always reads as "new stream" until one actually arrives.
      wheelEnv: 0,
      risingRun: 0,
      lastWheelAt: 0,
      streamStart: 0,
    };
    // Capture-phase + passive: we only observe, we never preventDefault, so we
    // cannot interfere with the user's own scrolling.
    for (const type of TAKEOVER_EVENTS) {
      window.addEventListener(type, onTakeover, { capture: true, passive: true });
    }
    wake();
  });
}

function resolveRoomIndex(target) {
  if (!target) return -1;
  if (typeof target !== 'string') {
    // An element (or anything with an id / dataset.room).
    if (target.id && state.byId.has(target.id)) return state.byId.get(target.id);
    if (target.dataset && state.byName.has(target.dataset.room)) return state.byName.get(target.dataset.room);
    return -1;
  }
  const key = target.replace(/^#/, '');
  if (state.byName.has(key)) return state.byName.get(key);
  if (state.byId.has(key)) return state.byId.get(key);
  if (state.byName.has(key.replace(/^room-/, ''))) return state.byName.get(key.replace(/^room-/, ''));
  return -1;
}

/* ────────────────────────────────────────────────────────────────────────────
 * onRoomChange — public subscription for the top menu.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Subscribe to "the most-visible room changed".
 *
 * @param {(info: {id:string, name:string, index:number, el:Element}) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onRoomChange(cb) {
  if (typeof cb !== 'function') return () => {};
  state.roomChangeCbs.add(cb);

  // Fire immediately with the current room so callers do not need a separate
  // "what is active right now?" call at startup.
  if (state.activeIndex >= 0) {
    const room = state.rooms[state.activeIndex];
    try { cb({ id: room.id, name: room.name, index: state.activeIndex, el: room.el }); }
    catch (err) { console.error('[engine] onRoomChange callback threw:', err); }
  }

  return () => state.roomChangeCbs.delete(cb);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Event wiring.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The scroll listener does ONE thing: raise a flag. All math waits for rAF. */
function onScroll() {
  state.dirty = true;
  wake();
}

function scheduleRemeasure() {
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(() => {
    if (state.destroyed) return;
    measure();
    if (state.reduceMotion) applyReducedMotion();
  }, RESIZE_DEBOUNCE_MS);
}

/**
 * iOS Safari fires visualViewport 'resize' continuously while the address bar
 * animates. Because the layout is authored in svh, none of that changes our
 * cached geometry — so we fingerprint first and only pay for a re-measure when
 * something real moved. This is what stops the "address bar collapse jump".
 */
function onVisualViewportChange() {
  if (geometrySignature() === state.lastGeomSig) {
    // Nothing structural changed. Just make sure the next frame runs, because
    // scrollY may have shifted by the chrome height.
    state.dirty = true;
    wake();
    return;
  }
  scheduleRemeasure();
}

function onOrientationChange() {
  // Orientation change resolves asynchronously; measure now for responsiveness
  // and again after the debounce for correctness.
  requestAnimationFrame(() => { if (!state.destroyed) measure(); });
  scheduleRemeasure();
}

function onVisibilityChange() {
  if (!isHidden()) {
    if (state.reduceMotion) {
      // The loop never runs under reduce; just make sure the static end-state
      // still matches the geometry we may have missed while hidden.
      measure();
      applyReducedMotion();
      return;
    }
    // park() first: while the page was hidden, a resize or an IntersectionObserver
    // delivery may have called wake(), leaving `running` true on a rAF request
    // the hidden tab never serviced. Clearing it is what lets wake() below
    // actually issue a live request instead of short-circuiting.
    park();
    repairVisible();     // re-measure + synchronous correct frame, before any rAF
    scheduleRemeasure(); // and once more after the debounce, for late layout
    wake();
  } else {
    // Ticking is about to stop. Do not leave a mid-dissolve on the glass.
    settleHidden();
    park();
  }
}

function wireEvents() {
  // Passive: we never call preventDefault, so the browser can keep scrolling on
  // the compositor thread without waiting to see what this handler does. On iOS
  // this alone is the difference between smooth and not.
  on(window, 'scroll', onScroll, { passive: true });
  on(window, 'resize', scheduleRemeasure, { passive: true });
  on(window, 'orientationchange', onOrientationChange, { passive: true });
  on(window, 'pageshow', scheduleRemeasure, { passive: true });
  on(document, 'visibilitychange', onVisibilityChange);

  if (window.visualViewport) {
    on(window.visualViewport, 'resize', onVisualViewportChange, { passive: true });
    on(window.visualViewport, 'scroll', onScroll, { passive: true });
  }

  // Late-loading plates can change document height. One cheap re-measure when
  // the window fully loads catches that without polling.
  on(window, 'load', scheduleRemeasure, { passive: true });

  // Fonts settling can reflow the rails. Same idea, one shot.
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
    document.fonts.ready.then(() => { if (!state.destroyed) scheduleRemeasure(); }).catch(() => {});
  }
}

function wireReducedMotion() {
  if (typeof window.matchMedia !== 'function') return null;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  state.reduceMotion = !!mq.matches;

  const handler = () => {
    state.reduceMotion = !!mq.matches;
    if (state.reduceMotion) {
      cancelTween('cancelled');
      applyReducedMotion();
    } else {
      state.dirty = true;
      state.lastScrollY = -1;   // force a full recompute
      measure();
    }
  };

  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', handler);
    state.listeners.push([mq, 'change', handler, undefined]);
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(handler);   // Safari < 14
  }
  return mq;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Room collection.
 * ──────────────────────────────────────────────────────────────────────────── */

function collectRooms(root) {
  const scope = (root && typeof root.querySelectorAll === 'function') ? root : document;
  const nodes = scope.querySelectorAll('.room');
  const rooms = [];

  for (const el of nodes) {
    const stage = el.querySelector('.stage');
    const wrap = stage ? stage.querySelector('.plate-wrap') : null;

    // Defensive: a malformed room is skipped, never thrown on. One bad section
    // authored by another agent must not take the whole page down.
    if (!stage || !wrap) {
      console.warn(
        '[engine] skipping room "%s": missing %s',
        el.id || el.dataset.room || '(unnamed)',
        !stage ? '.stage' : '.plate-wrap'
      );
      continue;
    }

    const name = el.dataset.room || (el.id || '').replace(/^room-/, '');
    const id = el.id || ('room-' + name);
    if (!el.id) el.id = id;   // IO callback maps back by id

    // The two light layers. Queried from .stage rather than .plate-wrap so this
    // keeps working whichever of the two they hang off — theme.css re-anchors
    // them to the stage rect with insets, but they are still .plate-wrap's
    // children in the DOM, and either arrangement resolves here. Cached once:
    // updatePromotions() must never touch the DOM to find them.
    // They are decorative, so a missing one is skipped, not fatal — unlike
    // .stage / .plate-wrap, whose absence skips the whole room.
    const glow = stage.querySelector('.plate-glow');
    const vig = stage.querySelector('.plate-vig');

    rooms.push({ id, name, el, stage, wrap, glow, vig, live: false });
  }

  return rooms;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Public entry point.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Boot the engine.
 *
 * @param {Element|Document} [root=document] scope to search for `.room` sections.
 * @returns {{
 *   rooms: string[],
 *   scrollToRoom: typeof scrollToRoom,
 *   onRoomChange: typeof onRoomChange,
 *   refresh: () => void,
 *   destroy: () => void,
 *   get reducedMotion(): boolean
 * }}
 */
export function initEngine(root) {
  // Re-initialising must never leave a second loop or a second observer behind.
  if (state.inited) destroyEngine();

  state.destroyed = false;
  state.rooms = collectRooms(root || document);

  const n = state.rooms.length;
  state.M = new Float64Array(Math.max(1, n) * M_STRIDE);
  state.V = new Float64Array(Math.max(1, n) * V_STRIDE);
  // NaN-fill the write cache so the very first frame always writes every var.
  state.W = new Float64Array(Math.max(1, n) * W_STRIDE).fill(NaN);
  state.liveFlags = new Uint8Array(Math.max(1, n));

  state.byName.clear();
  state.byId.clear();
  for (let i = 0; i < n; i++) {
    state.byName.set(state.rooms[i].name, i);
    state.byId.set(state.rooms[i].id, i);
  }

  state.inited = true;
  state.activeIndex = -1;
  state.promoA = -1;
  state.promoB = -1;
  state.lastScrollY = -1;
  state.dirty = true;

  if (!n) {
    console.warn('[engine] no usable .room sections found — engine idle.');
    return publicApi();
  }

  wireReducedMotion();
  measure();
  wireEvents();

  if (state.reduceMotion) {
    // Requirement 7: never start the loop at all.
    applyReducedMotion();
    return publicApi();
  }

  setupObserver();

  // If IO has not fired yet (it is async), light up the rooms nearest the current
  // scroll position so the very first painted frame is already correct.
  primeLiveNeighbourhood();

  if (isHidden()) {
    // Booted straight into a background tab. requestAnimationFrame will not run
    // a single callback here, so starting the loop and hoping is how the page
    // ended up stranded on one frame's worth of half-written values in the
    // first place. Write a coherent, fully-presented room right now, then stay
    // parked — visibilitychange will re-measure and repair when the tab is
    // actually shown, and any scroll before then re-arms the loop (and with it
    // the interval fallback) through the normal onScroll path.
    settleHidden();
    park();
    return publicApi();
  }

  wake();
  return publicApi();
}

/**
 * Mark the room under a given scroll position, and its neighbours, live.
 *
 * Used at boot (IntersectionObserver delivery is async, and never happens at all
 * in a tab that loads hidden) and again whenever we are updating without rAF,
 * where IO is starved for exactly the same reason. Purely arithmetic over the
 * cached geometry — no layout reads — and additive only: it can promote a room
 * into the computed set but never drops one, so it can never race the observer
 * into un-ticking a room that is still on screen.
 */
function primeLiveNeighbourhood(atScrollY) {
  const scrollY = atScrollY == null ? (window.scrollY || window.pageYOffset || 0) : atScrollY;
  const M = state.M;
  for (let i = 0; i < state.rooms.length; i++) {
    const o = i * M_STRIDE;
    const top = M[o + M_TOP];
    const bottom = top + M[o + M_HEIGHT];
    const stageH = M[o + M_STAGE_H];
    const near = bottom > scrollY - stageH && top < scrollY + stageH * 2;
    if (near && !state.rooms[i].live) {
      state.rooms[i].live = true;
      state.liveFlags[i] = 1;
    }
  }
}

function publicApi() {
  return {
    get rooms() { return state.rooms.map((r) => r.name); },
    get reducedMotion() { return state.reduceMotion; },
    /**
     * Read-only counters. Cheap enough to leave in: a handful of integer bumps
     * per frame. `fallbackDrives` staying at 0 through a normal session is the
     * proof that the occluded-window fallback is costing nothing.
     */
    get diagnostics() {
      return {
        running: state.running,
        fallbackArmed: !!state.fallbackTimer,
        rafFrames: state.rafFrames,
        fallbackDrives: state.fallbackDrives,
        settles: state.settles,
        repairs: state.repairs,
        measures: state.measures,
        live: state.rooms.map((r, i) => !!state.liveFlags[i]),
      };
    },
    scrollToRoom,
    onRoomChange,
    /** Force a re-measure (call after injecting or removing content). */
    refresh() { measure(); },
    destroy: destroyEngine,
  };
}

/** Full teardown: loop, observer, listeners, timers, tween. */
export function destroyEngine() {
  state.destroyed = true;
  cancelTween('cancelled');
  park();                 // also disarms the fallback interval
  disarmFallback();       // belt and braces: park() is the only other caller
  clearTimeout(state.resizeTimer);
  if (state.io) { state.io.disconnect(); state.io = null; }
  offAll();
  for (const r of state.rooms) {
    try { setRoomPromotion(r, false); } catch (_) { /* noop */ }
  }
  state.rooms = [];
  state.byName.clear();
  state.byId.clear();
  state.roomChangeCbs.clear();
  state.inited = false;
  state.activeIndex = -1;
  state.promoA = -1;
  state.promoB = -1;
  state.dissolveInFlight = false;
}

export default { initEngine, scrollToRoom, onRoomChange, destroyEngine };

/* ────────────────────────────────────────────────────────────────────────────
 * Perf self-check — append ?perf to the URL.
 *
 * Counts frames whose delta exceeded 1.5× the device's own measured frame
 * budget. On a 60Hz iPad the budget resolves to ~16.7ms, on a 120Hz iPad Pro to
 * ~8.3ms, so the number means the same thing on both: "frames the user could
 * feel". Prints a rolling report every 2s and leaves the counters on
 * `window.__cccPerf` for a quick console poke during a store demo.
 * ──────────────────────────────────────────────────────────────────────────── */

let perf = null;

if (PERF) {
  perf = {
    frames: 0,
    dropped: 0,
    worstMs: 0,
    budgetMs: 16.7,   // refined from observed deltas below
    windowStart: 0,
    windowFrames: 0,
    windowDropped: 0,
  };
  window.__cccPerf = perf;
  console.info('[engine:perf] frame monitor active. window.__cccPerf holds the counters.');
}

function perfSample(dt) {
  const p = perf;
  p.frames++;

  // Learn the display's real cadence from the fastest deltas seen, so a 120Hz
  // panel is not scored against a 60Hz budget.
  if (dt > 4 && dt < p.budgetMs) p.budgetMs = p.budgetMs * 0.98 + dt * 0.02;

  if (dt > p.budgetMs * 1.5) { p.dropped++; p.windowDropped++; }
  if (dt > p.worstMs) p.worstMs = dt;

  p.windowFrames++;
  const now = state.lastFrameTime;
  if (!p.windowStart) p.windowStart = now;

  if (now - p.windowStart >= 2000) {
    const pct = (p.windowDropped / Math.max(1, p.windowFrames) * 100).toFixed(1);
    console.info(
      '[engine:perf] %d frames / 2s · %d late (%s%%) · worst %sms · budget %sms · total late %d',
      p.windowFrames, p.windowDropped, pct,
      p.worstMs.toFixed(1), p.budgetMs.toFixed(1), p.dropped
    );
    p.windowStart = now;
    p.windowFrames = 0;
    p.windowDropped = 0;
    p.worstMs = 0;
  }
}

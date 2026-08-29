/* =============================================================================
 * Cook County Cooks
 * assets/app.js  ·  THE ROUTER
 * -----------------------------------------------------------------------------
 * This file used to be the cinema integrator. It is now ~2 KB whose only job is
 * to answer one question — restaurant, or pocket list? — and load exactly one
 * of the two. The integrator moved to cinema.js, byte for byte.
 *
 * WHY A ROUTER AND NOT A BRANCH INSIDE THE INTEGRATOR
 *   The client, about the shipped site: "The mobile site just looks super rough,
 *   if I'm honest." Before that: "the site keeps crashing on my iPhone ... when
 *   I scroll down the site crashes and it turns into a blue screen" — WebKit
 *   killing the tab under memory pressure, with 35 MB of decoded plates and
 *   50 MB of compositor backing store resident (theme.css §17 carries the
 *   measurements).
 *
 *   A branch inside the integrator would not have helped, because a static
 *   `import` is fetched, parsed and evaluated whether or not the branch is
 *   taken. The cinema is engine + overlay + screens + chefwall + labels +
 *   wallprint + freezer: 660 KB raw, 213 KB gzipped, before a single plate. The
 *   ONLY way a phone does not pay for it is for the specifier never to be
 *   reached, which is what the dynamic import()s below are for.
 *
 *   Measured, 393x852 at DPR 3, scrolled to the walk-in:
 *     restaurant   25 requests · 1849 KB wire · 9 plates · 35.2 MB decoded
 *     pocket list   4 requests ·  343 KB wire · 0 plates ·  0.0 MB decoded
 *
 * THE DECISION IS NOT MADE HERE. It is made by the inline script in the <head>
 * of index.html, before first paint, and stamped on <html data-view>. It has to
 * be there and not here: this module is type="module", therefore deferred,
 * therefore it runs after the document has painted — a decision made here would
 * show the wrong site first and then swap it. Read that script for the
 * predicate and the reasoning; this file trusts the stamp and only recomputes
 * it if the stamp is missing (someone loading this module some other way).
 *
 * READING OLDER COMMENTS. Half this codebase says "app.js §2", "app.js's
 * PLATE_SIZES", "app.js builds the dialog". Those were all true of this file
 * and are now true of two others; rather than rewrite forty prose references
 * across seven modules, here is the single redirection:
 *      app.js §2 (the freezer gate + the keypad)  ->  coldgate.js
 *      everything else that was app.js            ->  cinema.js
 *      el() / fill() / $()                        ->  dom.js
 *      freshUrl()                                 ->  freshurl.js
 *      ROOM_ORDER                                 ->  roomorder.js (re-exported
 *                                                    by rooms.js, unchanged)
 *
 * NOTE ON THE import() FORMATTING BELOW — do not "tidy" it onto one line.
 * build/fingerprint.mjs anchors its import matcher at the start of a line
 * (`^[ \t]*import\s*\(`), deliberately, so that a static import quoted inside a
 * doc comment is not mistaken for a real dependency. A dynamic import written
 * as `const m = await import('./cinema.js')` would therefore never have its
 * specifier rewritten to the hashed filename, and the module would 404 in a
 * production build while working perfectly from a dev checkout.
 * ========================================================================== */

/* THE ONE COPY OF THE PREDICATE THAT IS NOT IN index.html. It is only ever used
 * when the inline stamp is absent, and for the "you are on a phone" test that
 * decides whether the cinema gets a quiet way back to the pocket list. The
 * authoritative copy, with the device table behind it, is in index.html. */
const POCKET_MQ =
  '(pointer: coarse) and ((max-width: 500px) or ((max-width: 1000px) and (max-height: 500px)))';

const VIEW_KEY = 'ccc-view';

/** localStorage throws outright in some Safari configurations (private mode
 *  with storage blocked, "Prevent cross-site tracking" in a framed context).
 *  Every read and write in this build goes through these two. */
export function readView() {
  try { const v = localStorage.getItem(VIEW_KEY); return v === 'full' || v === 'pocket' ? v : null; }
  catch { return null; }
}
export function rememberView(v) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage disabled: the
    ?view= parameter in the href still carries the choice for this visit */ }
}

function decide() {
  const stamped = document.documentElement.dataset.view;
  if (stamped === 'pocket' || stamped === 'full') return stamped;
  // No stamp: recompute rather than guess. Same order of precedence.
  let q = null;
  try { q = new URLSearchParams(location.search).get('view'); } catch { /* noop */ }
  if (q === 'full' || q === 'pocket') return q;
  const saved = readView();
  if (saved) return saved;
  try { return matchMedia(POCKET_MQ).matches ? 'pocket' : 'full'; } catch { return 'full'; }
}

/* The two front ends, each behind a specifier this file only reaches down one
 * branch. Written on their own indented lines for the fingerprinter — see the
 * note in the header. */
const load = {
  pocket: () =>
    import('./pocket.24637471d1.js'),
  cinema: () =>
    import('./cinema.6ae07eb1ec.js')
};

/**
 * THE WAY BACK, and the reason it is here rather than in cinema.js.
 *
 * A rep who taps "View the full restaurant" needs a way out of it again, and
 * the cinema has no room in its chrome for one. So the router appends a single
 * fixed link — but ONLY when this device would have been given the pocket list
 * on its own. On an iPad or a desktop the media query does not match, nothing
 * is appended, and the cinematic build is byte-identical to what it was.
 * (Verified: 0.000% pixel difference at 820x1180, 1180x820, 1440x900 and
 * 2560x1440, against a same-build A/A noise floor of 0.000%.)
 */
function addWayBack() {
  let phone = false;
  try { phone = matchMedia(POCKET_MQ).matches; } catch { /* noop */ }
  if (!phone) return;
  const a = document.createElement('a');
  a.className = 'pocket-return';
  a.href = '?view=pocket';
  a.textContent = 'Tool list';
  a.setAttribute('aria-label', 'Switch to the fast tool list');
  a.addEventListener('click', () => rememberView('pocket'));
  document.body.append(a);
}

/**
 * `?tool=<slug>` -> `#/tool/<slug>`.
 *
 * The site's deep-link shape has always been the hash (overlay.js §8 routes on
 * it, pushes it, and rewinds it). The query spelling is the one people actually
 * paste out of a chat, and it is what the brief for this build asked to keep
 * working in BOTH modes. Normalising it here — in the router, before either
 * front end boots — makes one shape reach both, and leaves overlay.js's routing
 * completely untouched. The parameter is stripped from the address bar so the
 * viewer's own history handling is not looking at two URLs that mean the same
 * thing; every other query parameter (?view=, anything the client adds) is
 * preserved.
 */
function normaliseToolParam() {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return; }
  const slug = params.get('tool');
  if (!slug) return;
  params.delete('tool');
  const q = params.toString();
  const url = location.pathname + (q ? `?${q}` : '') + `#/tool/${encodeURIComponent(slug)}`;
  try { history.replaceState(history.state, '', url); }
  catch { location.hash = `#/tool/${encodeURIComponent(slug)}`; }
}

async function start() {
  const view = decide();
  document.documentElement.dataset.view = view;
  normaliseToolParam();
  if (view === 'pocket') {
    const mod = await load.pocket();
    return mod.boot();
  }
  const mod = await load.cinema();
  addWayBack();
  return mod.boot();
}

/* type="module" is deferred by definition, so the parser has finished by the
   time this runs. The readyState check is there only for the case where someone
   loads this file some other way. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

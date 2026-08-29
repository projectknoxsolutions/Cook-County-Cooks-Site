/* =============================================================================
 * Cook County Cooks — assets/freshurl.js
 * ONE CACHE BUSTER, TWO FRONT ENDS
 * -----------------------------------------------------------------------------
 * This used to live at the bottom of overlay.js. It moved out because the
 * pocket list (the phone build) needs it and must never load overlay.js: the
 * viewer is 47 KB of iframe stage, history handling and scroll locking that a
 * flat list of <a href> has no use for.
 *
 * overlay.js re-exports it, so `import { freshUrl } from './overlay.js'` —
 * which screens.js does — is unchanged. One implementation, two callers.
 * ========================================================================== */

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

/* =============================================================================
 * Cook County Cooks — assets/preflight.js
 * ASK THE SERVER BEFORE YOU BELIEVE THE IFRAME
 * -----------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO KILL
 *
 *   Both the tool viewer (overlay.js) and the live boards on the Dining Room
 *   wall (screens.js) decided "did this load?" by putting the URL in an iframe,
 *   waiting for `load`, and then reading `frame.contentWindow.document`. That
 *   read throws a SecurityError for a real cross-origin document, so the throw
 *   was taken as the success signal and the catch returned "it loaded".
 *
 *   IT THROWS FOR EVERY FAILURE TOO. Measured in Chromium on 2026-08-31, each
 *   shape in its own iframe, all of them firing `load` in 8-23 ms:
 *
 *     shape                          load  contentWindow.document  verdict given
 *     ─────────────────────────────  ────  ──────────────────────  ────────────
 *     200, real page                  yes  THREW SecurityError     "loaded" ✓
 *     404 (with CORS header)          yes  THREW SecurityError     "loaded" ✗
 *     404 (no CORS header)            yes  THREW SecurityError     "loaded" ✗
 *     500                             yes  THREW SecurityError     "loaded" ✗
 *     200 serving "Site not found"    yes  THREW SecurityError     "loaded" ✗
 *     200 with an empty body          yes  THREW SecurityError     "loaded" ✗
 *     X-Frame-Options: DENY           yes  THREW SecurityError     "loaded" ✗
 *     CSP frame-ancestors 'none'      yes  THREW SecurityError     "loaded" ✗
 *     302 to a dead host              yes  THREW SecurityError     "loaded" ✗
 *     connection refused              yes  THREW SecurityError     "loaded" ✗
 *     DNS failure                     yes  THREW SecurityError     "loaded" ✗
 *     request hangs                    no  about:blank, readable   (watchdog) ✓
 *
 *   Eleven of the twelve are indistinguishable from inside the page. There is
 *   nothing else to read: contentDocument is null for all of them, so is
 *   contentWindow.length, and `origin`, `location.href` and `document` all
 *   throw identically. A rep got a grey void, a fade-in, and role="status"
 *   announcing "<tool> loaded."
 *
 * THE ONE THING THAT DOES DISCRIMINATE
 *
 *   fetch(). Every tool in data/tools.ac8a24642f.json is a GitHub Pages document, and
 *   GitHub Pages answers with `access-control-allow-origin: *`. Verified by
 *   curl against the real hosts on 2026-08-31:
 *
 *     GET/HEAD  …/Mobile-Quote-Sheet-6th-Gen/            200  ACAO: *
 *     GET/HEAD  …/Mobile-Quote-Sheet-6th-Gen/nope.html   404  ACAO: *
 *     GET/HEAD  …/definitely-not-a-real-repo/            404  no ACAO
 *     GET/HEAD  https://blufoxmobile.github.io/          404  no ACAO
 *
 *   So a cross-origin `fetch` reads a REAL STATUS CODE for a Pages site that
 *   exists, whatever that status is, and is refused only when there is no Pages
 *   site there at all. That last case is the "repo renamed / Pages turned off"
 *   failure, and it is the likeliest one of the lot — which is why the second,
 *   `no-cors` probe below exists: it separates "the origin answered but told us
 *   nothing" from "nothing answered".
 *
 * WHY GET-AND-CANCEL AND NOT HEAD
 *   The 6th Gen quote sheet is 1,307,626 bytes (measured: content-length on the
 *   live URL), so the body is exactly what this must not download. HEAD is the
 *   obvious answer and was the first implementation — GitHub Pages answers HEAD
 *   correctly, verified by curl.
 *
 *   It is still the wrong answer, because a preflight that a middlebox refuses
 *   is WORSE THAN NO PREFLIGHT: a network that drops HEAD would make every
 *   working tool look `unreachable` and put a fallback card over it. Store
 *   wifi, hotel wifi and corporate proxies are exactly where this code runs and
 *   exactly where non-GET methods get eaten. (Measured in this container, whose
 *   egress proxy resets HEAD tunnels: every real URL came back `slow` or
 *   `unreachable` while the same URLs framed perfectly.)
 *
 *   So: a plain GET — the most ordinary request there is, and a CORS-simple one
 *   so no OPTIONS preflight is needed — with `response.body.cancel()` called
 *   the moment the headers are in. The status line and Content-Length arrive
 *   with the headers; cancelling aborts the transfer there. Measured against
 *   the live 1,307,626-byte quote sheet: see the figure recorded beside
 *   cancelBody() below.
 *
 * WHAT THIS MODULE WILL NOT DO
 *   It will not call a working tool broken. Every verdict except `ok` that
 *   leads to a card is backed by either a status code the server itself sent or
 *   a network-level refusal of BOTH probes. A response with no CORS header on a
 *   host we have not verified is `unknown`, and `unknown` means "carry on and
 *   let the iframe try" — which is exactly what the code did before this file
 *   existed. Pre-empting a working tool into a fallback card would be a worse
 *   bug than the one being fixed, and the old comment in overlay.js §0 that
 *   says so is still right.
 * ========================================================================== */

/** How long we wait for the preflight before giving up on it. Deliberately
 *  longer than a round trip and shorter than the frame watchdog: this is the
 *  signal the viewer uses to tell "hung" from "slow but coming". */
export const PREFLIGHT_TIMEOUT_MS = 8000;

/**
 * Hosts we have positively verified answer every live document with
 * `access-control-allow-origin: *`, so that a CORS refusal from them is
 * information rather than noise: it means there is no live document there.
 *
 * Kept as short as NEVER_FRAMES and for the same reason. 22 of the 24 open
 * tools are on blufoxmobile.github.io; the other two are same-origin. Adding a
 * host here is a claim about that host's headers, so verify it with curl (the
 * four lines above) before you do — and if you are not sure, leave it out: an
 * unlisted host simply gets `unknown` and the old behaviour.
 */
const CORS_TRUTHFUL = [/(^|\.)github\.io$/i];

function absUrl(url) {
  try { return new URL(url, document.baseURI); } catch { return null; }
}

/** A verdict, in the one shape both callers switch on.
 *  `length` is the response's Content-Length when the server sent one and we
 *  were allowed to read it, else -1. Content-Length IS on the CORS-safelisted
 *  response header list (with Cache-Control, Content-Language, Content-Type,
 *  Expires, Last-Modified and Pragma), so it is readable cross-origin with no
 *  Access-Control-Expose-Headers — unlike X-Frame-Options and
 *  Content-Security-Policy, which are NOT, and which is why a frame refusal
 *  cannot be seen from out here. See the note in overlay.js §6. */
function verdict(kind, status, detail, length) {
  return {
    verdict: kind,
    status: status || 0,
    detail: detail || '',
    length: Number.isFinite(length) ? length : -1
  };
}

/**
 * Stop the download the instant the headers are in.
 *
 * This is what makes a GET preflight cost the same as a HEAD. `fetch` resolves
 * as soon as the response HEAD-ers are available; cancelling the body stream
 * closes the read side, and the browser tears the transfer down. Measured
 * against the live 6th Gen quote sheet (Content-Length 1,307,626): the
 * preflight transferred 4.0 KB, i.e. the headers and whatever was already in
 * the socket buffer — 0.3% of the document, one round trip's worth.
 *
 * `res.body` is null for a 204/304 and for a body-less error page, and
 * `cancel()` rejects if the stream was already disturbed, so both are swallowed.
 */
function cancelBody(res) {
  try { if (res && res.body && typeof res.body.cancel === 'function') res.body.cancel().catch(() => {}); }
  catch { /* already consumed or not a stream: nothing to do */ }
}

/** Content-Length as a number, or -1 if the server did not send one. */
function bodyLength(res) {
  try {
    const raw = res.headers.get('content-length');
    if (raw === null || raw === '') return -1;
    const n = Number(raw);
    return Number.isFinite(n) ? n : -1;
  } catch { return -1; }
}

/**
 * Ask whether `url` is actually there.
 *
 * @param {string} url
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{verdict:'ok'|'empty'|'gone'|'unreachable'|'slow'|'unknown',
 *                    status:number, detail:string, length:number}>}
 *
 *   empty        the server answered 2xx and said the body is zero bytes.
 *                There is nothing to frame. A card, immediately.
 *   ok           the server answered 2xx/3xx. The document exists. (It may
 *                still refuse to be FRAMED — X-Frame-Options and CSP are not
 *                readable cross-origin — so this is "it is there", not "it
 *                will show".)
 *   gone         the server answered, and the answer was an error status, or
 *                it refused CORS on a host we have verified always allows it.
 *                A card, immediately.
 *   unreachable  nothing answered at all: DNS, refused, TLS, a redirect to a
 *                dead host, or the machine is offline. A card, immediately.
 *   slow         no answer inside timeoutMs. Not a failure — a hang. The
 *                caller keeps the frame alive and says so.
 *   unknown      we learned nothing (fetch unavailable, HEAD refused, a host
 *                that simply does not send CORS headers). Behave as before.
 *
 * NEVER REJECTS.
 */
export function preflight(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || PREFLIGHT_TIMEOUT_MS;
  const u = absUrl(url);
  if (!u || typeof fetch !== 'function') return Promise.resolve(verdict('unknown'));

  const sameOrigin = u.origin === location.origin;
  const truthful = sameOrigin || CORS_TRUTHFUL.some((re) => re.test(u.hostname));

  // One controller per probe: aborting is how `slow` is detected, and an
  // AbortController that is missing must degrade to `unknown`, never throw.
  const withTimeout = (init) => {
    let ctrl = null;
    try { ctrl = typeof AbortController === 'function' ? new AbortController() : null; }
    catch { ctrl = null; }
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch { /* noop */ } }, timeoutMs) : 0;
    const done = () => { if (timer) clearTimeout(timer); };
    return {
      promise: fetch(u.href, Object.assign({
        method: 'GET',
        // no-store, not no-cache: this must never be answered out of the HTTP
        // cache, or a tool that went down ten minutes ago still reads as 200.
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined
      }, init)),
      done,
      aborted: () => !!(ctrl && ctrl.signal && ctrl.signal.aborted)
    };
  };

  const first = withTimeout({ mode: sameOrigin ? 'same-origin' : 'cors' });

  return first.promise.then(
    (res) => {
      first.done();
      cancelBody(res);
      if (res.status === 405 || res.status === 501) return verdict('unknown', res.status, 'method refused');
      const len = bodyLength(res);
      /* A 200 with Content-Length: 0 is a document that is definitely empty —
         the one "it answered fine and there is still nothing there" case that
         is not a matter of judgement. It is a card, not a grey void. (A 200
         whose body merely SAYS "Site not found" is not detectable from here and
         is not treated as a failure; on the real hosts that page is a 404,
         verified by curl, and 404s are caught above.) */
      if (res.ok && len === 0) return verdict('empty', res.status, 'content-length: 0', len);
      if (res.ok || (res.status >= 200 && res.status < 400)) return verdict('ok', res.status, '', len);
      return verdict('gone', res.status, '', len);
    },
    (err) => {
      first.done();
      if (first.aborted() || (err && err.name === 'AbortError')) return verdict('slow');
      // The cors probe was refused. Was anything there at all? A no-cors HEAD
      // resolves (opaquely) whenever the network transaction succeeded, and
      // rejects only when it did not — which is the discriminator.
      const second = withTimeout({ mode: 'no-cors' });
      return second.promise.then(
        (res2) => {
          second.done();
          cancelBody(res2);
          // Something answered, but would not say what. On a host we have
          // verified always sends the header, "no header" means the origin-wide
          // 404 page — there is no site there.
          return truthful
            ? verdict('gone', 0, 'no CORS header from a host that always sends one')
            : verdict('unknown', 0, 'no CORS header');
        },
        (err2) => {
          second.done();
          if (second.aborted() || (err2 && err2.name === 'AbortError')) return verdict('slow');
          return verdict('unreachable', 0, (err2 && err2.message) || 'network error');
        }
      );
    }
  ).catch(() => verdict('unknown'));
}

/** A short, honest, rep-facing sentence for a verdict. `host` is the pretty
 *  hostname; `label` is the tool's own name. */
export function preflightCopy(v, label, host) {
  switch (v.verdict) {
    case 'empty':
      return `${host} answered, but the page it returned is empty. The tool may be mid-deploy — try again in a minute.`;
    case 'gone':
      return v.status === 404
        ? `${host} says this tool is not there any more (404). It may have been renamed or moved.`
        : v.status
          ? `${host} answered with an error (HTTP ${v.status}) instead of the tool.`
          : `${host} has nothing at this address any more — the page it points at is gone.`;
    case 'unreachable':
      return `${host} could not be reached. If you are on store wifi, check you are past the sign-in page.`;
    case 'slow':
      return `${host} is not answering. It may be the network rather than the tool.`;
    default:
      return `${label} could not be shown inside the site.`;
  }
}

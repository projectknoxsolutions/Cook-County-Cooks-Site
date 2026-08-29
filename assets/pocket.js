/* =============================================================================
 * Cook County Cooks — assets/pocket.js
 * THE POCKET LIST  ·  what a phone gets instead of the restaurant
 * -----------------------------------------------------------------------------
 * The client, on the shipped site: "The mobile site just looks super rough, if
 * I'm honest." He asked about a separate m. subdomain and chose this instead:
 *
 *   "On a phone, serve a fast flat tool list. Same URL. Detected automatically."
 *   "the dropdown of the tools that people could access on their phone ...
 *    I don't necessarily need the extras."
 *
 * So: no rooms, no photography, no head-chef wall, no live boards. The tools,
 * and nothing else, on one scrolling page a rep opens on a shop floor to get to
 * a quote sheet in under two seconds.
 *
 * ── THE ONE RULE THIS FILE EXISTS UNDER ─────────────────────────────────────
 * THERE IS EXACTLY ONE TOOL LIST IN THIS CODEBASE, AND IT IS data/tools.json.
 * The reason we are not building an m-dot site is that the client edits that
 * file weekly and a second list would silently go stale. So nothing below names
 * a tool, a URL or a room: this module reads the same inline __CCC_INLINE__
 * bootstrap the cinema reads, through the same fallback fetch of the same file,
 * groups by the same ROOM_ORDER, and opens the same sealed envelope through the
 * same coldgate.js. Adding a tool to data/tools.json and rebuilding puts it on
 * the phone with no other edit. If you find yourself typing a tool's name into
 * this file, stop — you are about to build the thing we decided not to build.
 *
 * ── WHAT IT DELIBERATELY DOES NOT SHOW, AND WHY ─────────────────────────────
 *   the room taglines   The client already had these taken off the rooms: "I
 *                       want those types of descriptions to be removed on every
 *                       page" (see the note over buildRail() in cinema.js). A
 *                       room here is a grouping label, not a place. Seven
 *                       taglines would wrap to two lines each on a 393px phone
 *                       and push the first tool 250px down the page.
 *   the blurbs, at rest 24 tools with two-line blurbs is 2,400px of scrolling;
 *                       24 names is 1,350px. The names are self-describing
 *                       ("Internet Quote Sheet"), so the blurb is dead weight
 *                       until you are searching — at which point it is the
 *                       opposite, because it is half of what the search matched
 *                       against and it is what explains a non-obvious hit. So
 *                       blurbs appear ON MATCHES ONLY. Same data, shown where
 *                       it earns its line.
 *
 * ── WHY THE ROWS ARE PLAIN LINKS IN THE SAME TAB ────────────────────────────
 * Every row is a real <a href> with a real URL, so long-press, "copy link",
 * "open in new tab" and a screen reader's link list all behave. There is no
 * target="_blank": on a phone a new tab is a tab the rep then has to find their
 * way out of, whereas a same-tab navigation makes the system Back gesture the
 * way back to the list — and iOS restores the page, search text and all, from
 * the back/forward cache. The C³ menu on the desktop build opens externals in a
 * new tab; that is the right call there and the wrong one here.
 * ========================================================================== */

import { el, fill, $ } from './dom.js';
import { freshUrl } from './freshurl.js';
import { ROOM_ORDER } from './roomorder.js';
import {
  initColdGate, setAdopt, coldTools, isFreezerUnlocked, sealedCount,
  onFreezerUnlock, openKeypad
} from './coldgate.js';


/* ─────────────────────────────────────────────────────────────────────────────
 * 1 · DATA — the same two paths the cinema uses, and no third one
 * ────────────────────────────────────────────────────────────────────────── */

/** index.html inlines tools.json on window.__CCC_INLINE__ because fetch()
 *  against a file:// URL is CORS-blocked and the client reviews builds straight
 *  off a USB stick. The fetch is the fallback for a served deployment whose
 *  inline block was removed. NOTE: the pocket list does NOT read
 *  __CCC_INLINE__.headchefs — there is no chef wall here, so the 13 KB of head
 *  chef data and the three photographs are never touched. */
async function loadTools() {
  const inline = window.__CCC_INLINE__;
  if (inline && inline.tools) return inline.tools;
  const res = await fetch('data/tools.json');
  return res.json();
}

/**
 * Group the tools by room.
 *
 * ROOM_ORDER is the spine because it is the order of the restaurant and the
 * order every other surface on this site uses. But it is NOT the room registry
 * — data/tools.json is — so any room that appears there and not in ROOM_ORDER
 * is appended in file order rather than dropped. That matters for the one rule
 * above: a new room added to tools.json must reach the phone without a second
 * edit, even before anyone updates the walk-through's geometry.
 */
function indexTools(doc) {
  const rooms = doc.rooms || [];
  const tools = doc.tools || [];
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const bySlug = new Map(tools.map((t) => [t.slug, t]));

  const order = [...ROOM_ORDER];
  for (const r of rooms) if (!order.includes(r.id)) order.push(r.id);
  for (const t of tools) if (!order.includes(t.room)) order.push(t.room);

  const byRoom = new Map(order.map((id) => [id, []]));
  for (const tool of tools) byRoom.get(tool.room).push(tool);

  return { rooms, tools, roomById, bySlug, order, byRoom };
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 2 · SEARCH
 *
 * 24 tools is more than anyone wants to scan on a phone, and this is the one
 * thing the pocket list has that the desktop C³ panel does not.
 *
 * Matching is a case- and diacritic-folded substring test over the tool's LABEL
 * and its BLURB, per query token. Tokens are ANDed — every word has to appear
 * somewhere in label+blurb — which is what makes a second word narrow the
 * result rather than widen it ("win weekend" finds the two boards; "weekend"
 * alone finds them plus anything whose blurb says weekend).
 *
 * The blurb is in the haystack on purpose, and it is why blurbs are shown on
 * matches: it is the half of the index that finds a tool by what it DOES rather
 * than what it is called. "trade-in" is in no tool's name and in two blurbs.
 * ────────────────────────────────────────────────────────────────────────── */

/** Fold case and accents once, at index time, so keystrokes stay cheap. */
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function haystack(tool) {
  return fold(`${tool.label} ${tool.blurb || ''}`);
}

function tokens(query) {
  return fold(query).split(/\s+/).filter(Boolean);
}

function matches(tool, toks) {
  if (!toks.length) return true;
  const hay = tool._hay || (tool._hay = haystack(tool));
  return toks.every((t) => hay.includes(t));
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 3 · MARKUP
 * ────────────────────────────────────────────────────────────────────────── */

/* The C³ mark, copied from cinema.js so the two headers wear the same fox.
   It is a path, not a tool, not a URL and not a room — the one-list rule is
   about data/tools.json. */
const FOX_SVG =
  '<svg class="c3-fox" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M3 3l3.6 3.2h10.8L21 3l-1 7.6a8 8 0 0 1-8 8 8 8 0 0 1-8-8z"/>' +
  '<path d="M9 11.2h.01M15 11.2h.01"/><path d="M12 14.2l-1.4 1.2h2.8z"/></svg>';

/**
 * One row.
 *
 * The href carries the cache-busting stamp the rest of the site uses, because
 * the client's complaint was specifically that a rep opens a quote sheet and
 * gets an hour-old copy of it: "essentially, it would be a fresh load every
 * time we pull up the repository." The stamp is written into the ATTRIBUTE, not
 * bolted on at click time, so the URL a rep long-presses and sends to someone
 * else is the same URL the row opens. It is re-stamped whenever the page comes
 * back to the foreground — see restamp() — so a list left open on a locked
 * phone for an hour does not hand out an hour-old stamp.
 */
function toolRow(tool) {
  const a = el('a', {
    class: 'tool-row pocket-row',
    href: freshUrl(tool.url),
    'data-slug': tool.slug,
    'data-url': tool.url,
    // AN EXPLICIT NAME, because the computed one was wrong. The name and the
    // blurb are two sibling <span>s with no text node between them, and the
    // accessible-name algorithm concatenates element children with NO
    // separator: VoiceOver read "6th Gen Mobile Quote SheetBuild a full
    // Xfinity Mobile quote" — one run-on word at the join. Putting a text node
    // between them would make it a third grid item and add a row to the layout.
    // An aria-label fixes the join, is unaffected by the blurb being display:
    // none at rest (so the description is announced whether or not it is on
    // screen), and still contains the visible label verbatim, which is what
    // WCAG 2.5.3 Label in Name asks for.
    'aria-label': tool.blurb ? `${tool.label}. ${tool.blurb}` : tool.label
  }, [
    el('span', { class: 'tool-row-name', text: tool.label }),
    // Rendered always, hidden by CSS unless the list is searching (theme.css
    // §19), so a match does not have to rebuild the row.
    tool.blurb ? el('span', { class: 'tool-row-blurb', text: tool.blurb }) : null
  ]);
  return el('li', {}, [a]);
}

/** The walk-in's one row while it is shut. It names a COUNT and nothing else:
 *  the thirteen labels are ciphertext until a code decrypts them, and this row
 *  is rendered from the envelope's public `count` field exactly as the C³
 *  menu's locked row is. */
function lockRow(count) {
  return el('li', {}, [
    el('button', {
      type: 'button', class: 'tool-row pocket-row pocket-lock',
      'data-freezer-lock': '',
      // Same reason as the tool rows above: two sibling spans, no separator.
      'aria-label': `Locked — ${count} manager tools. Keypad access.`
    }, [
      el('span', { class: 'tool-row-name', text: `Locked — ${count} manager tools` }),
      el('span', { class: 'micro', text: 'Keypad access' })
    ])
  ]);
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 4 · BOOT
 * ────────────────────────────────────────────────────────────────────────── */

export async function boot() {
  const doc = await loadTools();
  const data = indexTools(doc);

  const root = $('#kitchen');
  const rail = $('#ticket-rail');
  const footer = $('#site-footer');
  // The cinema's mount points stay in the document — the <noscript> index
  // inside #site-footer is the genuinely-no-JS path and must not be removed —
  // but nothing in the pocket build renders into them.
  if (rail) rail.hidden = true;
  if (footer) footer.hidden = true;

  /* ---- the cold-storage gate, before any markup -------------------------
   * Same order as the cinema, for the same reason: every surface below asks
   * isFreezerUnlocked() and sealedCount() as it renders. */
  setAdopt((tools) => {
    const room = data.byRoom.get('freezer') || [];
    for (const tool of tools) {
      if (data.bySlug.has(tool.slug)) continue;
      data.tools.push(tool);
      data.bySlug.set(tool.slug, tool);
      room.push(tool);
    }
    data.byRoom.set('freezer', room);
  });
  await initColdGate();

  /* ---- the header ------------------------------------------------------- */
  const search = el('input', {
    type: 'search', id: 'pocket-q', class: 'pocket-input',
    placeholder: 'Search tools',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    // enterkeyhint over `search`: there is nothing to submit, the list is
    // already filtered by the time the key is pressed, so the key should
    // dismiss the keyboard rather than promise a round trip.
    enterkeyhint: 'done',
    'aria-describedby': 'pocket-count'
  });
  const count = el('p', { class: 'pocket-count micro', id: 'pocket-count', role: 'status' });
  const clear = el('button', {
    type: 'button', class: 'pocket-clear', 'aria-label': 'Clear the search', hidden: true
  });
  clear.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6L6 18"/></svg>';

  const head = el('header', { class: 'pocket-head' }, [
    el('div', { class: 'pocket-brand' }, [
      el('h1', { class: 'pocket-wordmark', text: 'Cook County Cooks' }),
      el('span', { class: 'pocket-mark', 'aria-hidden': 'true' })
    ])
  ]);
  head.querySelector('.pocket-mark').innerHTML = FOX_SVG + '<span class="c3-mark">C³</span>';

  /* THE SEARCH BAR IS A SIBLING OF THE HEADER, NOT A CHILD OF IT, and that is
     load-bearing rather than tidy. `position: sticky` sticks within its nearest
     scrolling ancestor BUT ONLY FOR AS LONG AS ITS CONTAINING BLOCK IS ON
     SCREEN. Nested inside .pocket-head it stuck to the top of the header and
     then left with it — which looked right for the first 200px and then the
     field was simply gone for the remaining two screens of list. Verified on a
     phone in landscape (852x393), where the header is most of the viewport and
     the bug is impossible to miss. As a direct child of .pocket its containing
     block is the whole list, so it stays. */
  const bar = el('div', { class: 'pocket-bar' }, [
    el('label', { class: 'visually-hidden', for: 'pocket-q', text: 'Search tools by name or description' }),
    el('div', { class: 'pocket-field' }, [search, clear]),
    count
  ]);

  const results = el('div', { class: 'pocket-results', id: 'pocket-list', tabindex: '-1' });
  const empty = el('div', { class: 'pocket-empty', hidden: true });

  const foot = el('footer', { class: 'pocket-foot' }, [
    el('hr', { class: 'rule' }),
    // THE ESCAPE HATCH. A real link with a real href, so it works with JS half
    // dead and can be sent to someone; the click handler only adds the memory.
    el('a', { class: 'pocket-escape', href: '?view=full' }, [
      el('span', { text: 'View the full restaurant' }),
      el('span', { class: 'micro', text: 'The photographed walk-through. Heavier — best on wifi.' })
    ]),
    el('p', { class: 'micro pocket-colophon' })
  ]);
  foot.querySelector('.pocket-escape').addEventListener('click', () => {
    try { localStorage.setItem('ccc-view', 'full'); } catch { /* storage disabled:
      the ?view=full in the href still carries the choice for this visit */ }
  });

  fill(root, [el('div', { class: 'pocket' }, [head, bar, results, empty, foot])]);

  /* THE SKIP LINK. index.html ships "Skip to the kitchen" -> #kitchen, which is
     right for the walk-through and useless here: the header it would skip is
     INSIDE #kitchen, so the link skips nothing at all. Re-point it at the list
     and rename it. Done from JS rather than by editing index.html because the
     markup there belongs to the cinema and a phone is the only reader of this
     version. */
  const skip = $('.skip-link');
  if (skip) { skip.setAttribute('href', '#pocket-list'); skip.textContent = 'Skip to the tool list'; }

  document.documentElement.dataset.pocketReady = '1';

  /* ---- rendering -------------------------------------------------------- */
  let query = '';

  function render() {
    const toks = tokens(query);
    const searching = toks.length > 0;
    const groups = [];
    let shown = 0;

    for (const roomId of data.order) {
      const meta = data.roomById.get(roomId) || { label: roomId };
      const tools = (data.byRoom.get(roomId) || []).filter((t) => matches(t, toks));
      const locked = roomId === 'freezer' && !isFreezerUnlocked() && sealedCount() > 0;

      // While the walk-in is shut its array is EMPTY — the thirteen are
      // ciphertext — so it cannot be skipped for being empty or the locked row
      // disappears with them. Under a search, the locked row is matched against
      // its own visible words and its room label ONLY. It never says anything
      // about what is inside: a query that happens to name a manager tool
      // behaves exactly like a query that names nothing.
      const lockVisible = locked &&
        (!searching || toks.every((t) => fold(`${meta.label} locked manager tools keypad`).includes(t)));

      if (!tools.length && !lockVisible) continue;

      const headingId = `pocket-room-${roomId}`;
      const items = tools.map(toolRow);
      if (lockVisible) items.push(lockRow(sealedCount()));
      shown += tools.length + (lockVisible ? 1 : 0);

      groups.push(el('section', { class: 'pocket-group', 'aria-labelledby': headingId }, [
        el('h2', { class: 'kicker', id: headingId, text: meta.label }),
        el('ul', {}, items)
      ]));
    }

    fill(results, groups);
    results.classList.toggle('is-searching', searching);

    const open = data.tools.length;
    const sealed = isFreezerUnlocked() ? 0 : sealedCount();
    if (searching) {
      count.textContent = shown === 0
        ? `No matches for “${query.trim()}”`
        : `${shown} ${shown === 1 ? 'match' : 'matches'} for “${query.trim()}”`;
    } else {
      count.textContent = sealed
        ? `${open} tools · ${sealed} in the walk-in`
        : `${open} tools`;
    }

    const none = searching && shown === 0;
    empty.hidden = !none;
    if (none) {
      fill(empty, [
        el('p', { class: 'pocket-empty-line', text: `Nothing here is called “${query.trim()}”.` }),
        sealed
          ? el('p', { class: 'micro', text: `${sealed} manager tools are still in the walk-in — open it to search them too.` })
          : null,
        el('button', { type: 'button', class: 'chip', 'data-act': 'clear', text: 'Clear search' })
      ]);
    }
    clear.hidden = !query;
    foot.querySelector('.pocket-colophon').textContent =
      `Cook County Cooks · ${open + sealed} tools across ${data.rooms.length} rooms · Blue Fox C³`;
  }

  render();

  /* ---- interaction ------------------------------------------------------ */
  search.addEventListener('input', () => { query = search.value; render(); });
  clear.addEventListener('click', () => {
    query = ''; search.value = ''; render(); search.focus();
  });
  empty.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-act="clear"]')) return;
    query = ''; search.value = ''; render(); search.focus();
  });
  // A search field's own clear affordance fires `search`, not `input`, in
  // WebKit when it is dismissed with the keyboard.
  search.addEventListener('search', () => { query = search.value; render(); });

  // Every lock affordance is one delegated handler, exactly as in the cinema.
  document.addEventListener('click', (ev) => {
    const trigger = ev.target.closest && ev.target.closest('[data-freezer-lock]');
    if (!trigger) return;
    ev.preventDefault();
    if (isFreezerUnlocked()) return;
    openKeypad();
  });
  onFreezerUnlock(() => render());

  /* ---- keeping the links fresh ------------------------------------------
   * The stamp in every href is fixed at render time. A phone that has had this
   * list open in a background tab since this morning would hand out this
   * morning's stamp, which is the exact staleness the client reported. Re-stamp
   * on the two events that mean "the rep is looking at this again": the tab
   * coming to the foreground, and a restore out of the back/forward cache —
   * which is what iOS does every time someone taps Back out of a tool. */
  function restamp() {
    for (const a of results.querySelectorAll('a[data-url]')) {
      a.href = freshUrl(a.dataset.url);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') restamp();
  });
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) restamp(); });

  /* ---- deep links -------------------------------------------------------
   * The site's own shape is `#/tool/<slug>` (overlay.js §8); `?tool=<slug>` is
   * normalised into it by the router before either front end boots, so both
   * spellings arrive here as a hash. There is no framed viewer on a phone, so
   * "open the tool" means go to the tool — with the same cache-busting stamp a
   * tapped row would carry.
   *
   * A slug this build has never heard of, while the walk-in is shut, is treated
   * exactly as the cinema treats it (see watchSealedDeepLink in cinema.js): the
   * keypad is offered, and it NEVER confirms whether the slug was one of the
   * thirteen. A wrong slug and a real one behave identically right up until the
   * code decrypts. */
  function followDeepLink() {
    const m = /^#\/tool\/([^/?#]+)/.exec(location.hash || '');
    if (!m) return;
    let slug;
    try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
    const go = () => {
      const tool = data.bySlug.get(slug);
      if (!tool) return false;
      location.replace(freshUrl(tool.url));   // replace: Back returns to the list
      return true;
    };
    if (go()) return;
    if (isFreezerUnlocked()) return;          // genuinely unknown; say nothing
    try { history.replaceState(null, '', location.pathname + location.search); }
    catch { /* noop */ }
    openKeypad().then((ok) => { if (ok) go(); });
  }
  window.addEventListener('hashchange', followDeepLink);
  followDeepLink();

  // A tiny handle for debugging in a store, matching the cinema's window.CCC.
  window.CCC = Object.assign(window.CCC || {}, { view: 'pocket', data, render });
}

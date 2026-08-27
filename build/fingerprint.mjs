#!/usr/bin/env node
/* =============================================================================
 * Cook County Cooks — build/fingerprint.mjs
 * CONTENT-HASHED ASSET FILENAMES
 * -----------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO KILL
 *   New HTML and CSS composited over stale cached IMAGES from a previous build:
 *   every hotspot lands beside its object instead of on it, because the plate
 *   under the percentages is last week's. The plates are served with
 *   `cache-control: max-age=14400`, so for four hours after any art update every
 *   employee in the district can be looking at a different mixture of old and
 *   new. No amount of "hard refresh" instruction survives contact with a store.
 *
 * THE FIX
 *   Make a changed file a changed URL. Every plate, every module, the stylesheet
 *   and the door sound get the first ten hex digits of the SHA-256 of their own
 *   final bytes folded into the filename:
 *
 *       plates/office.webp        ->  plates/office.4d1f0a9c33.webp
 *       plates/office@1400.webp   ->  plates/office@1400.7be2c05118.webp
 *       assets/app.js             ->  assets/app.9f2c81e4a0.js
 *       assets/theme.css          ->  assets/theme.b30ac7d915.css
 *
 *   A four-hour cache on a URL that only ever holds one version of one file is
 *   not a hazard, it is the ideal. Nothing has to be revalidated and nothing can
 *   go stale: the HTML is the only document whose URL does not move, and the
 *   HTML is the thing that names all the new URLs.
 *
 * WHAT THIS IS NOT
 *   Not a bundler and not a serve-time step. It runs HERE, its output is
 *   committed, and the deployed tree stays plain static files. Nothing about the
 *   shipped page changes: same ES modules, same relative paths, no npm.
 *
 * THE SOURCE FILENAMES STAY. `plates/office.webp` is still there, still named
 *   for a human, and still what you edit. The hashed file is a COPY beside it.
 *   That is deliberate on a live site: the un-hashed URLs are already in the
 *   wild (the og:image, printed handouts, whatever a manager bookmarked), and a
 *   reference this script fails to rewrite must degrade to "correct but
 *   uncached", never to a 404.
 *
 * HOW THE REWRITE WORKS — and why it is safe
 *   One pass of longest-key-first literal substitution over every text file that
 *   can name an asset. A key is a repo-relative path ("plates/office.webp"); an
 *   occurrence is rewritten in place, keeping whatever "../" prefix it was
 *   written with, so `../assets/theme.css` inside tools/printouts/index.html
 *   works the same as `assets/theme.css` inside index.html. Longest-first is
 *   what stops "plates/hero.webp" from eating the front of
 *   "plates/hero@1400.webp" — the @-suffixed key is matched first.
 *
 *   Because the keys are LOCAL paths, no absolute URL to another origin can
 *   match one. screens.js's two live feeds —
 *   raw.githubusercontent.com/.../promo-card.jpg and
 *   .../nps-detractor-streaks.json — are checked explicitly at the end of the
 *   run and the build FAILS if either has been touched.
 *
 * ORDER MATTERS, so the run is staged:
 *   1. leaves            plates, the mp3, brand art, data JSON — nothing inside
 *                        them names another asset, so they hash immediately.
 *   2. CSS               theme.css names dark plates in an image-set(). Rewrite
 *                        those first, THEN hash the rewritten bytes.
 *   3. JS, in dependency order   a module's hash depends on its own imports'
 *                        hashes, so rooms.js is hashed before labels.js, which
 *                        is hashed before app.js. Import specifiers and asset
 *                        literals are both rewritten before hashing.
 *   4. HTML              rewritten in place, never hashed — it is the one URL
 *                        the browser has to re-check, and GitHub Pages already
 *                        serves it with a short cache.
 *
 * assets/theme.css IS OWNED BY ANOTHER AGENT. This script never hand-edits it —
 *   it reads it, rewrites the url() references mechanically into a hashed COPY,
 *   and leaves the source file byte-for-byte alone. Re-run the build after any
 *   theme.css edit and the copy catches up. Nobody has to type a hash.
 *
 * Usage:  node build/fingerprint.mjs [--clean]
 *         --clean  removes previously-emitted *.<hash>.* files first, so old
 *                  builds do not accumulate in the repo.
 * ========================================================================== */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLEAN = process.argv.includes('--clean');

/** 10 hex digits of SHA-256. 40 bits: collision-free for a few thousand files
 *  by any measure that matters, and short enough to read in a network tab. */
const HASH_LEN = 10;
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, HASH_LEN);

/** Already-fingerprinted? `office.4d1f0a9c33.webp` / `app.9f2c81e4a0.js` */
const HASHED_RE = new RegExp(`\\.[0-9a-f]{${HASH_LEN}}\\.[A-Za-z0-9]+$`);

const p = (...s) => resolve(ROOT, ...s);
const rel = (abs) => relative(ROOT, abs).split('\\').join('/');

function listDir(dir, exts) {
  let names = [];
  try { names = readdirSync(p(dir)); } catch { return []; }
  return names
    .filter((n) => exts.includes(extname(n).toLowerCase()))
    .filter((n) => !HASHED_RE.test(n))
    .map((n) => `${dir}/${n}`)
    .filter((f) => { try { return statSync(p(f)).isFile(); } catch { return false; } })
    .sort();
}

/* ── what gets fingerprinted ───────────────────────────────────────────────
 * plates            the whole point of the exercise
 * assets/*.js|css   the modules and the stylesheet
 * assets/*.mp3      the door sound
 * brand/*.png       the C³ mark
 * data/*.json       app.js's no-inline fallback; freezer.sealed.json changes
 *                   on every seal, so it must not be cached against an old one
 *
 * NOT fingerprinted, on purpose:
 *   headchefs/photos/*   named by headchefs.json, which is regenerated weekly
 *                        from the Win-The-Weekend decks by a different pipeline.
 *                        Hashing them means that pipeline has to know about this
 *                        one. They are small, they change with their own data
 *                        file, and they are not what threw the hotspots off.
 *   printouts/manifest.json, tools/**   the sub-apps own their own assets.
 * ──────────────────────────────────────────────────────────────────────── */
const LEAF_ASSETS = [
  ...listDir('plates', ['.webp', '.jpg', '.png', '.avif']),
  ...listDir('assets', ['.mp3', '.wav', '.woff2', '.woff']),
  ...listDir('brand',  ['.png', '.svg', '.jpg', '.webp']),
  ...listDir('data',   ['.json'])
];
const CSS_ASSETS = listDir('assets', ['.css']);
const JS_ASSETS  = [...listDir('assets', ['.js']), 'rooms.js'].filter((f) => {
  try { return statSync(p(f)).isFile(); } catch { return false; }
});

/** Every text file that may NAME an asset. HTML is rewritten, never hashed. */
const HTML_FILES = ['index.html', ...listDir('tools/printouts', ['.html']),
  ...listDir('tools/employee-of-week', ['.html']), ...listDir('tools/porting-guide', ['.html'])];

/* ── the rewriter ─────────────────────────────────────────────────────────── */

/** src -> hashed src. Filled as we go, so later stages see earlier hashes. */
const MAP = new Map();

/** `plates/office.webp` -> `plates/office.4d1f0a9c33.webp` */
function hashedName(srcPath, h) {
  const dir = dirname(srcPath);
  const ext = extname(srcPath);
  const stem = basename(srcPath, ext);
  const name = `${stem}.${h}${ext}`;
  return dir === '.' ? name : `${dir}/${name}`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrite every reference in `text`, longest key first.
 *
 * The `(?:\.\.\/)*` prefix is preserved verbatim, so a relative reference stays
 * relative to whatever file it is written in. `(?<![\w@/-])` stops a key from
 * matching in the middle of a longer path segment.
 */
/**
 * Module filenames are NOT rewritten by this pass.
 *
 * Every .js file in this build is reached one of two ways: as an import
 * specifier (rewritten by the dependency stage, which resolves relative to the
 * importing file) or as index.html's one `<script type="module" src>`. Nothing
 * loads a module by matching a bare path string. Leaving them out of the prose
 * pass keeps the build from rewriting the dozens of places the source comments
 * say "see rooms.js" — which produced a large, meaningless diff on every run.
 */
const PROSE_SKIP = new Set();

function rewrite(text) {
  const keys = [...MAP.keys()]
    .filter((k) => !PROSE_SKIP.has(k))
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const key of keys) {
    const re = new RegExp(`(?<![\\w@.-])((?:\\.\\./)*)${escapeRe(key)}(?![\\w@.-])`, 'g');
    out = out.replace(re, (_m, up) => up + MAP.get(key));
  }
  return out;
}

/**
 * Undo a previous run's rewrite, so the build is REPEATABLE.
 *
 * index.html is rewritten in place, which means the second run would find
 * `assets/app.4c1f….js` and no longer recognise `assets/app.js`. Every file is
 * therefore normalised back to source filenames before it is rewritten. Only
 * names that resolve to a file this build actually fingerprints are touched, so
 * an unrelated `something.0123456789.js` in a sub-app is left alone.
 */
const SOURCE_PATHS = new Set();
function unhash(text) {
  return text.replace(
    new RegExp(`([A-Za-z0-9@_-]+)\\.[0-9a-f]{${HASH_LEN}}(\\.[A-Za-z0-9]+)`, 'g'),
    (whole, stem, ext, offset, full) => {
      // Rebuild the candidate source path from whatever directory prefix the
      // reference was written with, and only accept a known one.
      const before = full.slice(Math.max(0, offset - 64), offset);
      const dir = (/([A-Za-z0-9@._-]*\/)*$/.exec(before) || [''])[0];
      const candidate = (dir + stem + ext).replace(/^(\.\.\/)+/, '');
      return SOURCE_PATHS.has(candidate) ? stem + ext : whole;
    }
  );
}

/** Emit a hashed copy and record the mapping. Returns the hashed path. */
function emit(srcPath, buf) {
  const h = hash(buf);
  const outPath = hashedName(srcPath, h);
  writeFileSync(p(outPath), buf);
  MAP.set(srcPath, outPath);
  return outPath;
}

for (const f of [...LEAF_ASSETS, ...CSS_ASSETS, ...JS_ASSETS]) SOURCE_PATHS.add(f);
for (const f of JS_ASSETS) if (f !== 'assets/app.js') PROSE_SKIP.add(f);

/* ── --clean ──────────────────────────────────────────────────────────────── */
if (CLEAN) {
  let removed = 0;
  for (const dir of ['plates', 'assets', 'brand', 'data', '.']) {
    let names = [];
    try { names = readdirSync(p(dir)); } catch { continue; }
    for (const n of names) {
      if (!HASHED_RE.test(n)) continue;
      const f = dir === '.' ? n : `${dir}/${n}`;
      try { statSync(p(f)).isFile() && (unlinkSync(p(f)), removed++); } catch { /* noop */ }
    }
  }
  console.log(`fingerprint: --clean removed ${removed} previously emitted files`);
}

/* ── 1 · leaves ───────────────────────────────────────────────────────────── */
for (const f of LEAF_ASSETS) emit(f, readFileSync(p(f)));

/* ── 2 · CSS ──────────────────────────────────────────────────────────────── *
 * theme.css belongs to another agent. It is read, rewritten into a hashed copy,
 * and left untouched on disk.                                                 */
for (const f of CSS_ASSETS) {
  const src = unhash(readFileSync(p(f), 'utf8'));
  emit(f, Buffer.from(rewrite(src), 'utf8'));
}

/* ── 3 · JS, in dependency order ──────────────────────────────────────────── *
 * A module's bytes contain its imports' filenames, so its hash depends on
 * theirs. Topological order, leaves first. A cycle would be a bug in the source
 * (there are none today); it is reported rather than silently mis-hashed.      */
// Anchored at the start of a line. A static import/export IS a top-level
// statement, so this loses nothing real — and it stops the module's own doc
// comment ("import { initChefWall } from './chefwall.js';" as usage example)
// from registering as a self-import and reading as a dependency cycle.
const IMPORT_RE = /^[ \t]*(?:import|export)\s[^'"()]*?from\s*['"]([^'"]+)['"]|^[ \t]*import\s*\(\s*['"]([^'"]+)['"]\s*\)|^[ \t]*import\s*['"]([^'"]+)['"]/gm;

function importsOf(file) {
  const src = unhash(readFileSync(p(file), 'utf8'));
  const here = dirname(file);
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec || !spec.startsWith('.')) continue;              // bare/URL: not ours
    const resolved = rel(resolve(p(here), spec));
    if (JS_ASSETS.includes(resolved)) out.push(resolved);
  }
  return out;
}

const jsOrder = [];
const seen = new Map();                                        // file -> 'busy'|'done'
function order(file, stack) {
  const st = seen.get(file);
  if (st === 'done') return;
  if (st === 'busy') {
    console.error(`fingerprint: import cycle: ${[...stack, file].join(' -> ')}`);
    process.exit(1);
  }
  seen.set(file, 'busy');
  for (const dep of importsOf(file)) order(dep, [...stack, file]);
  seen.set(file, 'done');
  jsOrder.push(file);
}
for (const f of JS_ASSETS) order(f, []);

for (const f of jsOrder) {
  const src = unhash(readFileSync(p(f), 'utf8'));
  const here = dirname(f);
  // Import specifiers are relative to the IMPORTING file, so they are rewritten
  // separately from the repo-relative asset literals rewrite() handles.
  let out = src.replace(IMPORT_RE, (whole, a, b, c) => {
    const spec = a || b || c;
    if (!spec || !spec.startsWith('.')) return whole;
    const resolved = rel(resolve(p(here), spec));
    const hashedTarget = MAP.get(resolved);
    if (!hashedTarget) return whole;
    const nextSpec = './' + relative(here, hashedTarget).split('\\').join('/');
    return whole.replace(spec, nextSpec.replace(/^\.\/\.\.\//, '../'));
  });
  out = rewrite(out);
  emit(f, Buffer.from(out, 'utf8'));
}

/* ── 4 · HTML — rewritten in place, never hashed ──────────────────────────── */
for (const f of HTML_FILES) {
  const src = readFileSync(p(f), 'utf8');
  const out = rewrite(unhash(src));
  if (out !== src) writeFileSync(p(f), out);
}

/* ── 5 · verify ───────────────────────────────────────────────────────────── *
 * Two things the build is not allowed to get wrong.                           */
const FEEDS = [
  'https://raw.githubusercontent.com/BlufoxMobile/Daily-Sales-Report/main/data/promo-card.jpg',
  'https://raw.githubusercontent.com/BlufoxMobile/Daily-Sales-Report/main/data/nps-detractor-streaks.json'
];
const screens = MAP.get('assets/screens.js');
if (screens) {
  const built = readFileSync(p(screens), 'utf8');
  for (const feed of FEEDS) {
    if (!built.includes(feed)) {
      console.error(`fingerprint: the live feed was rewritten and must not be:\n  ${feed}`);
      process.exit(1);
    }
  }
}

// index.html must end up pointing at hashed entry points, or the whole exercise
// silently did nothing.
const html = readFileSync(p('index.html'), 'utf8');
for (const entry of ['assets/app.js', 'assets/theme.css']) {
  const hashed = MAP.get(entry);
  if (!hashed || !html.includes(hashed)) {
    console.error(`fingerprint: index.html does not reference ${hashed || entry}`);
    process.exit(1);
  }
  if (new RegExp(`(?<![\\w.-])${escapeRe(entry)}(?![\\w.-])`).test(html.replace(/<!--[\s\S]*?-->/g, ''))) {
    console.error(`fingerprint: index.html still references the un-hashed ${entry}`);
    process.exit(1);
  }
}

/* ── 6 · prune ────────────────────────────────────────────────────────────── *
 * Exactly one hashed copy per source file. Yesterday's `office.9a1c….webp` is
 * referenced by nothing after this run, and leaving it in the repo is how a
 * static site quietly grows to a gigabyte.                                    */
const CURRENT = new Set([...MAP.values()].map((v) => basename(v)));
let pruned = 0;
for (const dir of new Set([...MAP.keys()].map((k) => dirname(k)))) {
  let names = [];
  try { names = readdirSync(p(dir)); } catch { continue; }
  for (const n of names) {
    if (!HASHED_RE.test(n) || CURRENT.has(n)) continue;
    // Only prune something whose un-hashed twin is a source file we own.
    const stripped = n.replace(new RegExp(`\\.[0-9a-f]{${HASH_LEN}}(\\.[A-Za-z0-9]+)$`), '$1');
    const twin = dir === '.' ? stripped : `${dir}/${stripped}`;
    if (!SOURCE_PATHS.has(twin)) continue;
    try { unlinkSync(p(dir === '.' ? n : `${dir}/${n}`)); pruned++; } catch { /* noop */ }
  }
}

console.log(`fingerprint: ${MAP.size} assets hashed${pruned ? `, ${pruned} stale removed` : ''}`);
console.log(`  ${LEAF_ASSETS.length} media/data · ${CSS_ASSETS.length} css · ${jsOrder.length} js`);
console.log(`  entry: ${MAP.get('assets/app.js')}`);
console.log(`  theme: ${MAP.get('assets/theme.css')}  (source file untouched)`);

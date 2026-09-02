#!/usr/bin/env node
/* =============================================================================
 * Cook County Cooks — build/porting-guide-css.mjs
 * THE PORTING GUIDE'S STYLESHEET, COMPILED INSTEAD OF FETCHED
 * -----------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO KILL
 *   tools/porting-guide/index.html was styled by <script src=
 *   "https://cdn.tailwindcss.com"> — the Tailwind PLAY CDN, a 400 KB script
 *   that scans the DOM at runtime and generates the page's CSS on the fly. It
 *   has to be parser-blocking to do that (`defer` and `async` were both tried
 *   on 2026-08-31 and both rendered the guide completely unstyled), and a
 *   parser-blocking script from a third party is a page that a store's guest
 *   wifi can hold blank for ever: measured with that host HUNG — accepted, never
 *   answered — document.body was still missing at 15 s. A rep mid-port with the
 *   old carrier on speakerphone got a white screen.
 *
 * THE FIX
 *   The page uses 180-odd utilities. This script compiles exactly those with
 *   the Tailwind CLI into ONE same-origin stylesheet, assets/porting-guide.css,
 *   which build/fingerprint.mjs then hashes and rewrites into the page like
 *   every other asset, and which sw.js therefore caches for offline. Nothing
 *   in the shipped page can hang on a third party any more: the only remote
 *   request left is the Inter font, which already loads non-blocking.
 *
 * WHY 3.4.17, PINNED
 *   That is the version cdn.tailwindcss.com redirected to on 2026-09-02 (it
 *   302s to /3.4.17), so it is the generator the live page was being styled
 *   by. Rule-for-rule, the CLI's output for this page is the play CDN's output
 *   (checked by parsing both: the CDN's 186 rules, same order, same
 *   declarations once the minifier's spelling is normalised) plus the vendor
 *   prefixes the CDN skips (-moz-placeholder twins, -o-object-fit,
 *   -o-tab-size). Rendered, the two are identical: 0 differing pixels at
 *   390x844, 820x1180, 1180x820 and 1440x900, full page, and again with a
 *   filter pill active, a details open, a search typed and a card hovered.
 *   Bumping the version changes preflight and is a visual change — re-run the
 *   A/B in the scratch notes before doing it.
 *
 * WHAT IS SCANNED, AND THE BLOCKLIST
 *   The CLI treats every word in its content as a candidate class name. Fed
 *   the raw file it read the prose too: the first cut of this script produced
 *   `.fixed` and `.inline` from the sentences "the font was fixed first" and
 *   "the inline <style>" in the <head> comment. So the page is handed over
 *   with its HTML comments and JS block comments stripped — a comment can
 *   never change the stylesheet — and the six words that survive in CODE but
 *   are not on any element are blocklisted: `visible` (the carrier), `filter`
 *   (activeFilter), `static`, `block`, `transform`, `transition` (the inline
 *   <style>'s property names). The play CDN scans only class attributes, so
 *   it never emitted any of them; with both measures the compiled sheet IS
 *   the CDN's rule set, not a superset. If the page ever starts using one of
 *   the six on an element, remove it from the list below.
 *
 * WHERE THE <link> GOES, AND WHY IT IS NOT AN OVERSIGHT
 *   The play CDN APPENDED its <style> to <head>, i.e. after the page's own
 *   inline <style>, so on equal specificity Tailwind won: a .carrier-card
 *   carries both `border-slate-100` and the inline rule's `border: 1px solid
 *   #e2e8f0`, and it is the utility's #f1f5f9 that the page has always shown.
 *   The <link> is therefore placed AFTER the inline <style>, where the CDN's
 *   sheet used to land. Move it above and the card borders change colour.
 *
 * HOW TO RUN
 *   node build/porting-guide-css.mjs
 *   then node build/fingerprint.mjs, as after any change under assets/.
 *   Needs node + npm and, the first time, the network: npx fetches the pinned
 *   CLI into npm's cache. Nothing is installed into the repo — there is no
 *   package.json here on purpose, the deployed tree stays plain static files.
 * ========================================================================== */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '3.4.17';
const PAGE = resolve(ROOT, 'tools/porting-guide/index.html');
const OUT = resolve(ROOT, 'assets/porting-guide.css');

const work = mkdtempSync(join(tmpdir(), 'ccc-portpro-'));
try {
  // comments out, so prose can never add a rule — see the header
  const page = readFileSync(PAGE, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  writeFileSync(join(work, 'page.html'), page);
  writeFileSync(join(work, 'tailwind.config.cjs'), `
    /* The play CDN's defaults: no theme extension, no plugins, no dark mode
       selector. Anything added here changes the page. */
    module.exports = {
      content: [${JSON.stringify(join(work, 'page.html'))}],
      blocklist: ['visible', 'static', 'block', 'transform', 'filter', 'transition']
    };
  `);
  writeFileSync(join(work, 'in.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');

  execFileSync('npx', ['--yes', `tailwindcss@${VERSION}`,
    '-c', join(work, 'tailwind.config.cjs'), '-i', join(work, 'in.css'), '-o', join(work, 'out.css'), '--minify'],
    { stdio: ['ignore', 'inherit', 'inherit'], cwd: work });

  const css = readFileSync(join(work, 'out.css'), 'utf8');
  const header =
    `/* GENERATED by build/porting-guide-css.mjs — tailwindcss ${VERSION}, compiled from the\n` +
    `   classes tools/porting-guide/index.html actually uses. Do not hand-edit: edit the\n` +
    `   page, re-run the script, then build/fingerprint.mjs. Read the script for why. */\n`;
  writeFileSync(OUT, header + css);
  const rules = (css.match(/\{/g) || []).length;
  console.log(`porting-guide-css: wrote assets/porting-guide.css  ${css.length} bytes, ${rules} blocks, tailwindcss ${VERSION}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

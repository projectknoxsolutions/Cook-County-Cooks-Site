#!/usr/bin/env node
/* =============================================================================
 * Cook County Cooks — build/sync-inline-tools.mjs
 *
 * index.html carries an inline copy of data/tools.json on window.__CCC_INLINE__
 * so the page boots over file:// — a fetch() to a file:// URL is CORS-blocked,
 * and Jeff and the district managers review builds straight off a USB stick.
 *
 * app.js PREFERS that inline copy over the network fetch. So when the two drift,
 * the site silently renders the STALE one and every symptom points somewhere
 * else. It has now bitten twice: most recently when two tools swapped rooms and
 * the rail, the ink labels and the C³ menu all kept showing the old assignment
 * while data/tools.json was already correct.
 *
 * This step rewrites the inline block from the file on every build. Nobody
 * hand-edits it, and the two cannot diverge.
 * ========================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(ROOT, 'index.html');

// Compact for the same reason the head-chef block below is compacted: this is
// spliced into a one-key-per-line object literal in index.html.
const tools = JSON.stringify(JSON.parse(readFileSync(resolve(ROOT, 'data', 'tools.json'), 'utf8')));

let html = readFileSync(htmlPath, 'utf8');

/* ---------------------------------------------------------------------------
 * REWRITE THE WHOLE BOOTSTRAP OBJECT, NOT ONE VALUE.
 *
 * The earlier version spliced `tools:` by index and `headchefs:` up to the next
 * newline. That is only safe while every value is a single line — and the
 * moment build/pull-headchefs.mjs started writing headchefs.json pretty-printed,
 * the splice left the tail of the old value stranded in the file as loose JSON.
 * The page died with "Unexpected string" and the chef wall rendered from a
 * truncated object, which is exactly the class of silent drift this script was
 * written to end. So: find the object, brace-match its end, and emit it whole.
 *
 * Three keys, ONE LINE EACH, `freezer:` above `headchefs:` — build/seal-freezer.mjs
 * anchors on /^\s*freezer:/ and /^\s*headchefs:/ to place the sealed envelope,
 * and flattening these onto one line breaks the seal. Every value is
 * re-serialised compact, whatever its file looks like on disk.
 * ------------------------------------------------------------------------- */
const OPEN = 'window.__CCC_INLINE__ = {';
const objStart = html.indexOf(OPEN);
if (objStart < 0) {
  console.error('sync-inline-tools: could not find the inline bootstrap in index.html');
  process.exit(1);
}
let depth = 0, objEnd = -1;
for (let k = objStart + OPEN.length - 1; k < html.length; k++) {
  const ch = html[k];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { objEnd = k + 1; break; } }
}
if (objEnd < 0) {
  console.error('sync-inline-tools: the inline bootstrap object is unterminated.');
  process.exit(1);
}

/* Carry the sealed envelope through untouched. This script runs BEFORE
 * seal-freezer in build.mjs, which will rewrite the line anyway — but running
 * this script on its own must not silently drop the freezer. */
const freezerLine = (html.slice(objStart, objEnd).match(/^[ \t]*freezer:[ \t]*(\{.*?\})\s*,?\s*$/m) || [])[1] || null;

const indent = (html.slice(0, objStart).match(/\n([ \t]*)$/) || [, '    '])[1];
const pad = indent + '  ';

const chefsPath = resolve(ROOT, 'headchefs', 'headchefs.json');
let chefCount = null, chefsJson = null;
if (existsSync(chefsPath)) {
  const parsed = JSON.parse(readFileSync(chefsPath, 'utf8'));  // fail loudly on malformed JSON
  chefsJson = JSON.stringify(parsed);
  chefCount = Array.isArray(parsed.headchefs) ? parsed.headchefs.length : 0;
} else {
  // Keep whatever is already inline rather than emitting a bootstrap with no chefs.
  chefsJson = (html.slice(objStart, objEnd).match(/^[ \t]*headchefs:[ \t]*(\{.*?\})\s*,?\s*$/m) || [])[1] || null;
}

const lines = [`${pad}tools: ${tools}`];
if (freezerLine) lines.push(`${pad}freezer: ${freezerLine}`);
if (chefsJson)   lines.push(`${pad}headchefs: ${chefsJson}`);

const rebuilt = `${OPEN}\n${lines.join(',\n')}\n${indent}}`;
const next = html.slice(0, objStart) + rebuilt + html.slice(objEnd);
if (next !== html) writeFileSync(htmlPath, next);

const n = JSON.parse(tools).tools.length;
console.log(`inline bootstrap: ${n} tools synced from data/tools.json${next === html ? ' (already current)' : ''}`);
if (chefCount !== null) console.log(`inline bootstrap: ${chefCount} head chefs synced from headchefs/headchefs.json`);

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

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(ROOT, 'index.html');

const tools = readFileSync(resolve(ROOT, 'data', 'tools.json'), 'utf8').trim();
JSON.parse(tools);                       // fail loudly on malformed JSON

let html = readFileSync(htmlPath, 'utf8');
const start = html.indexOf('tools: ');
const end = html.indexOf('headchefs:', start);
if (start < 0 || end < 0) {
  console.error('sync-inline-tools: could not find the inline bootstrap in index.html');
  process.exit(1);
}

// Keep `headchefs:` (and the `freezer:` line the seal step writes above it) at
// the start of their own lines — seal-freezer.mjs anchors on `^\s*headchefs:`
// and `^\s*freezer:`, so flattening this object onto one line breaks the seal.
const indent = (html.slice(0, end).match(/\n([ \t]*)$/) || [, '      '])[1];
const next = html.slice(0, start + 7) + tools + ',\n' + indent + html.slice(end);
if (next !== html) writeFileSync(htmlPath, next);

const n = JSON.parse(tools).tools.length;
console.log(`inline bootstrap: ${n} tools synced from data/tools.json${next === html ? ' (already current)' : ''}`);

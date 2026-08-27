#!/usr/bin/env node
/* =============================================================================
 * Cook County Cooks — build/build.mjs
 * THE WHOLE BUILD, IN ORDER
 * -----------------------------------------------------------------------------
 *   FREEZER_PASSWORD='…' node build/build.mjs [--clean]
 *
 * Two steps, and the order is not optional:
 *
 *   1. seal-freezer.mjs   encrypts the manager tools and writes
 *                         data/freezer.sealed.json plus the inline copy in
 *                         index.html.
 *   2. fingerprint.mjs    hashes every plate, module, stylesheet, sound and data
 *                         file, and rewrites every reference to them — INCLUDING
 *                         the freshly written freezer.sealed.json, which is why
 *                         it runs second.
 *
 * Nothing here runs at serve time. The output is committed and GitHub Pages
 * serves it as plain static files.
 *
 * Run this after ANY change to: the manager tool list, assets/*, rooms.js,
 * plates/*, data/* — and after any edit to assets/theme.css, which this build
 * rewrites mechanically so nobody has to hand-type a content hash into it.
 * ========================================================================== */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const pass = process.argv.slice(2);

function step(script, args = []) {
  const r = spawnSync(process.execPath, [resolve(HERE, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

step('seal-freezer.mjs');
step('fingerprint.mjs', pass);

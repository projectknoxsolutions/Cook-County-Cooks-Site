#!/usr/bin/env node
/* =============================================================================
 * Cook County Cooks — build/seal-freezer.mjs
 * SEAL THE WALK-IN
 * -----------------------------------------------------------------------------
 * The fourteen manager tools are not "hidden" in the deployed tree. They are not
 * in it. This script is the only thing that knows them: it reads the plaintext
 * from a file that lives OUTSIDE the repository, encrypts it, and writes the
 * ciphertext into data/freezer.sealed.json (and into index.html's inline
 * bootstrap, so the site still opens off a USB stick with no network).
 *
 * WHERE THE PLAINTEXT LIVES
 *   Default: ../ccc-build/secret/freezer-tools.json — i.e. a sibling of the
 *   repo, never inside it. Override with --in. Shape:
 *
 *     { "tools": [ { slug, label, url, room:"freezer", object, audience,
 *                    blurb, external_only? }, ... ] }
 *
 *   That is exactly the shape data/tools.json uses, so moving a tool in or out
 *   of the freezer is a cut-and-paste between the two files plus a rebuild.
 *
 * HOW TO REBUILD WHEN THE TOOL LIST CHANGES
 *
 *     FREEZER_PASSWORD='…' node build/seal-freezer.mjs
 *     node build/fingerprint.mjs          # ALWAYS re-run this after sealing
 *
 *   or just `FREEZER_PASSWORD='…' node build/build.mjs`, which does both.
 *
 * THE CRYPTO, AND WHY EACH PARAMETER
 *   KDF        PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte salt drawn from
 *              the CSPRNG on every build. PBKDF2 is not the strongest KDF in
 *              existence — Argon2id is — but WebCrypto ships PBKDF2 and nothing
 *              else, and the shipped page is allowed no npm and no WASM. 600k is
 *              the current OWASP figure for PBKDF2-HMAC-SHA256. The salt is
 *              per-build rather than fixed so two builds of the same tool list
 *              produce unrelated ciphertext and no rainbow table can be reused.
 *   CIPHER     AES-256-GCM, 12-byte IV from the CSPRNG, 128-bit tag. GCM is
 *              authenticated, which is the whole point: a wrong password fails
 *              the tag check and yields NOTHING — not a partial decrypt, not a
 *              length, not a hint. There is no separate password hash anywhere
 *              in the tree to compare against or to attack offline; the only
 *              oracle is the AEAD tag.
 *   AAD        'ccc-freezer/v1|<salt b64>|<iterations>' — the envelope's own
 *              KDF header, authenticated. Downgrading the iteration count in a
 *              served copy of the JSON therefore breaks decryption instead of
 *              silently making the derivation cheap.
 *
 * WHAT IS PUBLIC IN THE ENVELOPE, ON PURPOSE
 *   The version, the algorithm names, the salt, the IV, the iteration count and
 *   `count` (how many tools are inside). All six are either required to decrypt
 *   or trivially recoverable from the ciphertext's length; `count` is what lets
 *   the locked page say "14 manager tools" instead of lying about the number.
 *   Nothing else — no slugs, no labels, no URLs, no lengths per entry.
 *
 * ========================================================================== */

import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BITS = 128;
const VERSION = 1;
const ALG = 'PBKDF2-SHA256/AES-256-GCM';

/* ---- args ---------------------------------------------------------------- */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const IN   = resolve(ROOT, arg('in', '../ccc-build/secret/freezer-tools.json'));
const OUT  = resolve(ROOT, arg('out', 'data/freezer.sealed.json'));
const HTML = resolve(ROOT, arg('html', 'index.html'));
const PASSWORD = process.env.FREEZER_PASSWORD || arg('password', '');

if (!PASSWORD) {
  console.error('seal-freezer: no password. Set FREEZER_PASSWORD, or pass --password.');
  process.exit(1);
}

/* ---- read the plaintext -------------------------------------------------- */
let doc;
try {
  doc = JSON.parse(readFileSync(IN, 'utf8'));
} catch (err) {
  console.error(`seal-freezer: could not read the plaintext at ${IN}\n  ${err.message}`);
  process.exit(1);
}

const tools = Array.isArray(doc) ? doc : (doc.tools || []);
if (!tools.length) {
  console.error('seal-freezer: the plaintext has no tools.');
  process.exit(1);
}

// Only the fields the page actually renders travel. `_note` and anything else
// the source file carries for humans stays out of the ciphertext.
const FIELDS = ['slug', 'label', 'url', 'room', 'object', 'audience', 'external_only', 'blurb'];
const payload = {
  tools: tools.map((t) => {
    const out = {};
    for (const k of FIELDS) if (t[k] !== undefined) out[k] = t[k];
    out.room = 'freezer';
    if (!out.slug || !out.label || !out.url) {
      throw new Error(`seal-freezer: a tool is missing slug/label/url: ${JSON.stringify(t).slice(0, 120)}`);
    }
    return out;
  })
};

/* ---- seal ---------------------------------------------------------------- */
const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64');

const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
const iv   = crypto.getRandomValues(new Uint8Array(IV_BYTES));
const saltB64 = b64(salt);
const aad = enc.encode(`ccc-freezer/v1|${saltB64}|${ITERATIONS}`);

const material = await crypto.subtle.importKey('raw', enc.encode(PASSWORD), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  material,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);
const ct = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv, tagLength: TAG_BITS, additionalData: aad },
  key,
  enc.encode(JSON.stringify(payload))
);

const envelope = {
  v: VERSION,
  alg: ALG,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: saltB64 },
  iv: b64(iv),
  tagBits: TAG_BITS,
  count: payload.tools.length,
  ct: b64(ct)
};

writeFileSync(OUT, JSON.stringify(envelope) + '\n');

/* ---- inline it into index.html ------------------------------------------- *
 * app.js prefers window.__CCC_INLINE__.freezer and falls back to fetching
 * data/freezer.sealed.json. The inline copy is what makes the keypad work when
 * the page is opened straight off disk, where fetch() is CORS-blocked.        */
const html = readFileSync(HTML, 'utf8');
const line = `      freezer: ${JSON.stringify(envelope)}`;
let next;
if (/^\s*freezer:\s*\{.*$/m.test(html)) {
  next = html.replace(/^\s*freezer:\s*\{.*$/m, line + ',');
} else if (/^(\s*)headchefs:\s/m.test(html)) {
  // First seal: insert above `headchefs:` inside the bootstrap object.
  next = html.replace(/^(\s*)headchefs:\s/m, `${line},\n$1headchefs: `);
} else {
  console.error('seal-freezer: could not find the __CCC_INLINE__ bootstrap in index.html.');
  process.exit(1);
}
// Keep the trailing comma correct whichever branch ran.
next = next.replace(/^(\s*freezer:\s*\{.*\}),,\s*$/m, '$1,');
writeFileSync(HTML, next);

/* ---- verify: the plaintext must not survive anywhere --------------------- */
const needles = payload.tools.flatMap((t) => [t.url, t.label, t.slug]);
const built = readFileSync(OUT, 'utf8') + readFileSync(HTML, 'utf8');
const leaked = needles.filter((n) => built.includes(n));
if (leaked.length) {
  console.error('seal-freezer: PLAINTEXT LEAKED into the built output:', leaked);
  process.exit(1);
}

console.log(`seal-freezer: ${payload.tools.length} tools sealed`);
console.log(`  PBKDF2-SHA256 x${ITERATIONS.toLocaleString('en-US')} -> AES-256-GCM`);
console.log(`  salt ${saltB64}  iv ${envelope.iv}  ciphertext ${Buffer.from(ct).length} bytes`);
console.log(`  -> ${OUT}`);
console.log(`  -> ${HTML} (window.__CCC_INLINE__.freezer)`);

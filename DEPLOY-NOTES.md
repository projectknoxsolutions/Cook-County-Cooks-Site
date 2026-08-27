# Deploy notes — Cook County Cooks

**GitHub Pages is an interim host.** The site's permanent home is Cloudflare.
Live (interim): https://blufoxmobile.github.io/Cook-County-Cooks-Site/

## What this repo is
The static preview build of the "walk through the restaurant" one-page site:
seven rooms (Pass → Host → Dining → Prep → Office → Breakroom → Freezer),
a pinned top menu, and tools that open as full-screen overlays. All paths are
relative and there is no build step — the repo root is served as-is.
`.nojekyll` is present so the `assets/` folder is not Jekyll-processed.

## Known-and-intended, not bugs
- **The freezer is sealed, not gated.** The fourteen manager tools are not in
  this repo at all. `data/freezer.sealed.json` (and the identical copy inlined
  in `index.html`) is AES-256-GCM ciphertext; the key is PBKDF2-HMAC-SHA256 over
  the manager password, 600,000 iterations, random per-build salt. A wrong code
  fails the AEAD tag and produces nothing. The plaintext lives OUTSIDE this repo
  at `../ccc-build/secret/freezer-tools.json`; `build/seal-freezer.mjs` is the
  only thing that reads it. Re-seal after any change to the manager tool list.
  NOTE: earlier commits in this repo's history still contain the plaintext
  fourteen. If the repo is public, treat those URLs as already disclosed until
  the history is rewritten.
- **No cinematic room-to-room walk yet.** Frame sequences render on the Mac GPU
  later; the site auto-upgrades via the frames manifest once they exist.
- **Print Outs section has no content yet.**

## Still to do (handled in the other session, with Jeff present)
- Move hosting to Cloudflare; point cookcountycooks.com at it (currently still
  serving the old GoDaddy site).
- (done, differently) The freezer no longer needs a server: it is encrypted at
  rest in the deployed tree. `/api/freezer-unlock` is gone.
- Employee-of-the-Week auto-sync from the Win-The-Weekend decks
  (Big South + Chicago).
- cookcountycaptains.com redirect into the freezer.

## Build steps (run here, commit the output; nothing runs at serve time)
- `FREEZER_PASSWORD='…' node build/build.mjs` — seals the freezer AND
  fingerprints every plate/JS/CSS asset. Run it after ANY edit to
  `assets/*`, `rooms.js`, `plates/*` or the manager tool list. That includes
  edits to `assets/theme.css`: the script rewrites it mechanically, so nobody
  has to hand-edit hashed URLs into it.

## Do not
- Add a C³ logo. The brand mark on this site is the full name "Cook County Cooks".
- Commit the freezer password, or any hash of it, to this public repo.

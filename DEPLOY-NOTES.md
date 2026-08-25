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
- **The freezer gate is open.** The keypad currently accepts any code. The real
  password check is a Cloudflare Worker that arrives with the migration.
  Nothing behind the freezer should be treated as private while on Pages.
- **No cinematic room-to-room walk yet.** Frame sequences render on the Mac GPU
  later; the site auto-upgrades via the frames manifest once they exist.
- **Print Outs section has no content yet.**

## Still to do (handled in the other session, with Jeff present)
- Move hosting to Cloudflare; point cookcountycooks.com at it (currently still
  serving the old GoDaddy site).
- Freezer password enforced by a Cloudflare Worker secret.
- Employee-of-the-Week auto-sync from the Win-The-Weekend decks
  (Big South + Chicago).
- cookcountycaptains.com redirect into the freezer.

## Do not
- Add a C³ logo. The brand mark on this site is the full name "Cook County Cooks".
- Commit the freezer password, or any hash of it, to this public repo.

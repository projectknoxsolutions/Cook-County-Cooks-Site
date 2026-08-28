/* =============================================================================
 * Cook County Cooks — v3 "Cinema"
 * assets/chefwall.js — the Break Room "Head Chef of the Week" wall of fame
 * -----------------------------------------------------------------------------
 * WHAT THIS IS
 * The break-room plate (plates/breakroom.a8710561ee.webp) is a photograph of a real room.
 * Painted into that photograph, in one horizontal row, are FIVE identical black
 * picture frames, each holding an empty grey mat. This module composites the five
 * real employee photographs into those five mats so the faces are visible on the
 * wall immediately — no click required ("the real deal so they are recognized").
 *
 * Clicking a framed photo opens that chef's full Win-the-Weekend slide in a modal.
 *
 * HARD CONSTRAINTS FROM THE CLIENT (Jeff)
 *   1. EXACTLY FIVE chefs. Not nine. Not a grid. Five, in the five painted frames.
 *   2. The photos must sit EXACTLY inside the painted frames. In v2 they floated
 *      offset and it read as broken. That is why placement is data-driven: the
 *      lead measures the actual generated plate and hands us `frames`.
 *   3. Faces visible without interaction.
 *
 * PUBLIC API
 *   import { initChefWall, DEFAULT_FRAMES } from './chefwall.js';
 *   const wall = initChefWall({ host, chefs, frames, photoBase });
 *   wall.open(i) / wall.close() / wall.update({chefs, frames}) / wall.destroy()
 *
 * DEPENDENCIES: none. No build step. Plain ES module. Styles are self-injected
 * once into <head> and only ever read theme.css tokens through var(--x, fallback),
 * so this file is correct even if theme.css has not loaded yet.
 *
 * PERFORMANCE CONTRACT (SPEC.md "Performance rules")
 *   - No requestAnimationFrame loop here. The wall is static geometry; the engine's
 *     single page rAF loop already drives the plate.
 *   - The wall does NOT set `transform` on `.plate-wrap` and does NOT apply the
 *     `--plate-scale/--plate-x/--plate-y` transform itself. Per SPEC.md, hotspot
 *     layers live OUTSIDE `.plate-wrap` and inherit the identical transform from
 *     theme.css. `host` is expected to be (or to live inside) that hotspot layer,
 *     so the wall tracks the camera push-in for free. If we transformed here we
 *     would double-apply it and the frames would drift — exactly the v2 bug.
 *   - Only `transform`, `opacity` and `filter` are ever animated (hover lift, glass
 *     sweep, cast shadow opacity). Never top/left/width/height.
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 * 1. CONSTANTS
 * ------------------------------------------------------------------------ */

/** Jeff's number. The wall renders at most this many frames, ever. */
export const WALL_SIZE = 5;

/**
 * PLACEHOLDER GEOMETRY — the lead MUST replace this by measuring the real plate.
 *
 * Shape of one entry (see the `frames` docs on initChefWall for the full contract):
 *   x      left edge of the MAT OPENING, as a % of plate WIDTH
 *   y      top edge of the MAT OPENING, as a % of plate HEIGHT
 *   w      width of the mat opening, as a % of plate WIDTH
 *   h      height of the mat opening, as a % of plate HEIGHT
 *   rotate degrees clockwise, rotated about the box's own centre
 *
 * These five boxes are a plausible evenly-spaced row so the wall is never empty
 * during development. They are NOT measured and will not line up with the art.
 */
export const DEFAULT_FRAMES = [
  { x: 12.0, y: 30.0, w: 12.0, h: 16.0, rotate: 0 },
  { x: 27.0, y: 29.4, w: 12.0, h: 16.0, rotate: 0 },
  { x: 42.0, y: 29.0, w: 12.0, h: 16.0, rotate: 0 },
  { x: 57.0, y: 29.4, w: 12.0, h: 16.0, rotate: 0 },
  { x: 72.0, y: 30.0, w: 12.0, h: 16.0, rotate: 0 }
];

/**
 * THE NARROW CONDITION — one string, used by both the injected CSS and by
 * matchMedia below, so the two can never drift apart.
 *
 * It must stay byte-for-byte equivalent to theme.css §16, which suppresses the
 * `.hotspots` layer at `(max-width: 900px), (max-aspect-ratio: 8/7)`. The
 * aspect half matters: a 16:9 plate under object-fit:cover in a portrait
 * viewport crops the sides away, so stage-space hotspots would point at pixels
 * that are not on screen. `.cw-wall` lives inside `.hotspots` and goes down
 * with it, so the strip MUST take over on exactly the same condition —
 * otherwise iPad Pro portrait (1024x1366, aspect 0.75) hides the wall via the
 * aspect test while a 1024px-wide viewport keeps the strip hidden, and nothing
 * renders at all.
 *
 * Note there is deliberately NO inverse `(min-width:900px) and
 * (min-aspect-ratio:8/7)` query. The wall is visible by DEFAULT and this one
 * query hides it; an inverse query would both match at exactly 8/7 and show
 * wall and strip at once. One query, one owner, no boundary ambiguity.
 */
export const NARROW_MEDIA = '(max-width: 899.98px), (max-aspect-ratio: 8/7)';

/** Bullet glyphs PowerPoint authors actually paste. Note: no space required. */
const BULLET_RE = /^[-‐-―•·*▪●⁃]\s*/;

/** Unique-id counter so two instances on one page never collide. */
let instanceSeq = 0;

/* ---------------------------------------------------------------------------
 * 2. STYLES — injected once, idempotent.
 *    Everything here is namespaced under .ccc-chefwall / .ccc-chefmodal.
 * ------------------------------------------------------------------------ */

const STYLE_ID = 'ccc-chefwall-styles';

const CSS = `
/* ---- tokens ------------------------------------------------------------
   Two families, because this module paints two different materials.

   PAPER  (--cw-paper / --cw-ink / --cw-mat): the monogram plate and the mats.
          These are prints on stock, so they read through theme.css §13's
          deliberately inverted --ccc-paper / --ccc-ink bridge tokens.

   ROOM   (--cw-surface / --cw-fg / --cw-line / --cw-brass*): the modal chrome.
          The modal is a piece of the room, NOT a light card floating on a dark
          page, so it reads theme.css's own semantic tokens directly. Every one
          has a literal fallback so the file still stands alone with no theme.

   Radii come from theme's ramp on purpose: --r-xs 2px / --r-sm 3px / --r-md 6px.
   Brass and steel hardware has a 1-3px break, not a marshmallow edge. Nothing
   in here may invent a 12px or 999px corner. */
.ccc-chefwall, .ccc-chefmodal{
  /* paper */
  --cw-ink:        var(--ccc-ink, #16120d);
  --cw-paper:      var(--ccc-paper, #f4efe6);
  --cw-mat:        var(--bone-2, #dcd5c8);          /* the ONE mat colour */
  --cw-muted:      var(--ccc-muted, #6b6154);

  /* room chrome */
  --cw-surface:    var(--surface, #171e26);
  --cw-fg:         var(--fg, #f4efe6);
  --cw-fg-muted:   var(--fg-muted, #dcd5c8);
  --cw-dim:        var(--bone-3, #b4aba0);
  --cw-line:       var(--line, rgb(200 151 63 / .30));
  --cw-shade:      var(--shade, 3 5 9);
  --cw-walnut:     var(--walnut, #4b3526);

  /* the one accent */
  --cw-accent:     var(--ccc-accent, var(--brass, #c8973f));
  --cw-accent-lit: var(--ccc-accent-hi, var(--brass-300, #ebce93));
  --cw-accent-mid: var(--brass-400, #ddb463);
  --cw-accent-deep:var(--accent-deep, var(--brass-700, #8a6323));
  --cw-focus:      var(--ccc-focus, #ebce93);

  /* type + curve */
  --cw-serif:      var(--ccc-font-display, "Bodoni Moda", Georgia, serif);
  --cw-sans:       var(--ccc-font-ui, Archivo, system-ui, -apple-system, sans-serif);
  --cw-r-xs:       var(--r-xs, 2px);
  --cw-r-sm:       var(--r-sm, 3px);
  --cw-r-md:       var(--r-md, 6px);
  --cw-shadow-3:   var(--shadow-3, 0 30px 90px -18px rgb(3 5 9 / .8), 0 4px 18px -6px rgb(3 5 9 / .6));
  --cw-ease:       var(--ease-cine, cubic-bezier(.2,.7,.2,1));
}
.ccc-chefmodal *{ box-sizing:border-box; }

/* ---- root -------------------------------------------------------------- */
/* Fills the host exactly. NO transform here: the host (a .hotspots layer) is
   already carrying the plate transform from theme.css. See header comment. */
.ccc-chefwall{
  position:absolute; inset:0;
  pointer-events:none;              /* only the buttons are hit-testable */
  font-family:var(--cw-sans);
}
.ccc-chefwall *{ box-sizing:border-box; }

/* =========================================================================
   A. THE WALL (>= 900px) — five buttons pinned into the painted frames
   ====================================================================== */
.cw-wall{ position:absolute; inset:0; }

/* One framed photo. Percent geometry maps 1:1 onto the measured mat opening.
   The rotate lives on THIS element so the hover lift (on .cw-lift) can be a
   clean translate/scale without fighting the rotation. */
.cw-frame{
  position:absolute;
  margin:0; padding:0; border:0; background:none; color:inherit;
  -webkit-appearance:none; appearance:none;
  cursor:pointer;
  pointer-events:auto;
  transform-origin:50% 50%;
  /* the button box IS the mat opening; outline therefore traces the frame,
     and because outline is painted on the (rotated) border box it stays
     square to the frame rather than to the screen. */
  border-radius:var(--cw-r-xs);
  -webkit-tap-highlight-color:transparent;
}
.cw-frame:focus{ outline:none; }
.cw-frame:focus-visible{
  outline:2px solid var(--cw-focus);
  outline-offset:3px;
  box-shadow:0 0 0 5px rgb(var(--cw-shade) / .55);  /* legible on any plate */
}

/* The moving part.
   NOTE ON will-change: it is declared ONLY on :hover, ONLY inside
   @media (hover:hover). A static declaration here promoted all five frames to
   their own compositor layers for the whole session — on iPad, where :hover can
   never fire, that bought five permanent layers for an effect that cannot run,
   cost ~30% of median frame time, and quietly defeated the engine's
   add-on-live / remove-on-dormant discipline. Promote on the pointer that can
   actually trigger the animation, and only while it is over the frame. */
.cw-lift{
  position:absolute; inset:0;
  transform:translate3d(0,0,0);
  transition:transform 420ms var(--cw-ease);
}
@media (hover:hover){
  .cw-frame:hover .cw-lift{
    will-change:transform;
    transform:translate3d(0,-3px,0) scale(1.015);
  }
}
.cw-frame:focus-visible .cw-lift{ transform:translate3d(0,-3px,0) scale(1.015); }

/* Cast shadow under the lifted frame. Opacity-only animation (perf rule). */
.cw-cast{
  position:absolute; inset:0;
  border-radius:var(--cw-r-xs);
  box-shadow:0 14px 26px -8px rgb(var(--cw-shade) / .7);
  opacity:0;
  transition:opacity 420ms var(--cw-ease);
  pointer-events:none;
}
@media (hover:hover){ .cw-frame:hover .cw-cast{ opacity:1; } }
.cw-frame:focus-visible .cw-cast{ opacity:1; }

/* ---- the mat ------------------------------------------------------------
   The painted mats in the plate photograph are not consistent (frame 1 reads
   greenish-cream, 2-5 pink-white). So we do not rely on them: we paint our OWN
   mat over the whole measured opening in the single --bone-2 mat colour and
   inset the print 6% inside it. Five identical mats, five identical borders,
   whatever the underlying art does. */
.cw-mat{
  position:absolute; inset:0;
  background:var(--cw-mat);
  border-radius:var(--cw-r-xs);
  box-shadow:
    inset 0 0 0 1px rgb(var(--cw-shade) / .35),
    inset 0 1px 0 rgb(255 255 255 / .45);
}
/* THE one inset. Both the print and its recess shadow sit at exactly 6%. */
.cw-mat > .cw-photo,
.cw-mat > .cw-inset{ inset:6%; }

/* Brass rim on hover/focus — the cue that this is a control, not decoration. */
.cw-mat::after{
  content:""; position:absolute; inset:0;
  border-radius:var(--cw-r-xs);
  box-shadow:
    0 0 0 1px var(--cw-accent),
    0 0 0 3px rgb(var(--cw-shade) / .45);
  opacity:0;
  transition:opacity 240ms var(--cw-ease);
  pointer-events:none;
}
@media (hover:hover){ .cw-frame:hover .cw-mat::after{ opacity:1; } }
.cw-frame:focus-visible .cw-mat::after{ opacity:1; }

/* The printed photograph itself. */
.cw-photo{
  position:absolute; inset:0;
  overflow:hidden;
  background:var(--cw-walnut);        /* never flashes white while decoding */
  border-radius:1px;
}
/* THE single object-fit declaration in this file. The wall frame, the modal
   portrait and the narrow-strip card all resolve here, so a portrait can never
   be letterboxed in one place and filled in another. 50% 28% puts a head at a
   consistent height across five crops. */
.cw-photo img{
  display:block; width:100%; height:100%;
  object-fit:cover;
  object-position:var(--cw-focus-pos, 50% 28%);
  /* A seat, not a stamp. The client owns the image now — whatever is on the
     slide IS the picture — so this must flatter a good headshot rather than
     process it, while still seating an anime still or a photo of a store into
     the same room. Dialled back from .84/1.06: enough to take the edge off a
     phone-camera oversaturation, not enough to be visible on a well-lit
     portrait. The walnut wash below does the actual unifying. */
  filter:saturate(.94) contrast(1.02);
}
/* The unifying wash: multiply pulls every source toward the room's warm
   shadow, which is what makes unrelated photos read as one wall. At 10% it
   was visibly muddying the shadows of a well-lit portrait; 6% still seats a
   cold phone photo in the room without greying a good one. */
.cw-grade{
  position:absolute; inset:0;
  background:var(--cw-walnut);
  mix-blend-mode:multiply;
  opacity:.06;
  pointer-events:none;
}

/* Paper-behind-glass: a tight inset shadow so the print reads as recessed
   inside the mat rather than pasted on top of the photograph. */
.cw-inset{
  position:absolute; inset:0;
  pointer-events:none;
  border-radius:1px;
  box-shadow:
    inset 0 0 0 1px rgb(var(--cw-shade) / .55),
    inset 0 2px 6px rgb(var(--cw-shade) / .45),
    inset 0 -1px 3px rgb(var(--cw-shade) / .30),
    inset 2px 0 5px rgb(var(--cw-shade) / .22);
}

/* Glass, over the whole frame opening (mat included). The room's key light
   comes from ABOVE-LEFT, so the standing specular is brightest at the top-left
   corner and falls off down-right. */
.cw-glass{
  position:absolute; inset:0;
  pointer-events:none; overflow:hidden;
  border-radius:var(--cw-r-xs);
  background:linear-gradient(
      118deg,
      rgba(255,255,255,.26) 0%,
      rgba(255,255,255,.10) 26%,
      rgba(255,255,255,.02) 44%,
      rgba(255,255,255,0)   62%);
  mix-blend-mode:screen;
}
/* The travelling highlight — a narrow angled band that sweeps left→right on
   hover/focus, as if the viewer leaned in. Same 118deg as the standing gloss. */
.cw-sweep{
  position:absolute; top:-60%; bottom:-60%; left:-140%; width:80%;
  background:linear-gradient(
      to right,
      rgba(255,255,255,0) 0%,
      rgba(255,255,255,.30) 45%,
      rgba(255,255,255,.42) 55%,
      rgba(255,255,255,0) 100%);
  transform:rotate(28deg) translate3d(0,0,0);
  transition:none;
  pointer-events:none;
}
@media (hover:hover){
  .cw-frame:hover .cw-sweep{
    transform:rotate(28deg) translate3d(340%,0,0);
    transition:transform 900ms var(--cw-ease);
  }
}
.cw-frame:focus-visible .cw-sweep{
  transform:rotate(28deg) translate3d(340%,0,0);
  transition:transform 900ms var(--cw-ease);
}

/* ---- the name, revealed beneath the frame ------------------------------
   The wall is the room's headline feature and was its least discoverable
   control: no lift, no name, no cue. The lift + brass rim above answer the
   first two; this answers "who is that?" without a click. Decorative only —
   the button's aria-label already carries the full name. */
.cw-nametag{
  position:absolute; left:50%; top:100%; margin-top:.5rem;
  transform:translate3d(-50%,-4px,0);
  opacity:0;
  padding:.28em .6em;
  font-family:var(--cw-sans);
  font-size:clamp(10px, .72vw, 14px);
  font-weight:600; letter-spacing:.14em; text-transform:uppercase;
  white-space:nowrap; pointer-events:none;
  color:var(--cw-accent-lit);
  background:rgb(var(--cw-shade) / .74);
  -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
  border-radius:var(--cw-r-xs);
  box-shadow:inset 0 0 0 1px var(--cw-line), 0 2px 10px rgb(var(--cw-shade) / .5);
  transition:opacity 240ms var(--cw-ease), transform 240ms var(--cw-ease);
}
@media (hover:hover){
  .cw-frame:hover .cw-nametag{ opacity:1; transform:translate3d(-50%,0,0); }
}
.cw-frame:focus-visible .cw-nametag{ opacity:1; transform:translate3d(-50%,0,0); }

/* ---- no photo this week: an empty mat ----------------------------------
   The client owns the image: whatever is on the slide is the picture, and if
   the slide is blank the frame is blank. So "no photo" is NOT an error and
   gets no substitute artwork — it gets the same --bone-2 mat, the same 6%
   recess, the same frame shadow and the same glass specular as its four
   neighbours, with nothing in it. A framed blank waiting for this week's
   photo, which is a normal thing to see on a real wall of fame.

   Deliberately no engraved caption in the mat. Beside four photographs, type
   in the one empty frame is the loudest thing on the wall and turns a quiet
   gap into an announcement. The name is still there on demand: the button
   carries the full accessible name, and .cw-nametag reveals it on hover and
   focus exactly as it does for a frame with a picture in it. */
.cw-photo.cw-blank{
  /* one shade off the mat so the recess still reads, but no visible "hole" */
  background:
    linear-gradient(158deg,
      color-mix(in oklab, var(--cw-mat) 94%, #fff) 0%,
      var(--cw-mat) 44%,
      color-mix(in oklab, var(--cw-mat) 90%, var(--cw-walnut)) 100%);
}

/* ---- a vacant slot -----------------------------------------------------
   The five frames are painted into the photograph; the data is regenerated
   weekly from the decks and may arrive with fewer than five slides. A slot
   with no chef behind it has nothing to open, so it is not a button and not
   in the tab order — just the empty mat, in frame order. */
.cw-frame--vacant{
  cursor:default;
  pointer-events:none;
}

/* ---- monogram — now the ERROR state only -------------------------------
   Demoted. A file that was supposed to load and 404'd is a genuine fault and
   must not look identical to "no photo on the slide this week": one is a
   broken deploy, the other is Tuesday. So the blank mat means blank, and the
   monogram means something went wrong fetching a picture that exists. */
.cw-mono{
  position:absolute; inset:0;
  display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  gap:.35em;
  background:
    radial-gradient(120% 90% at 28% 18%, #fbf6ec 0%, #ece2d0 52%, #d9cbb4 100%);
  color:#4a3f2e;
  border-radius:1px;
  overflow:hidden;
}
.cw-mono::before,.cw-mono::after{
  content:""; position:absolute; left:14%; right:14%; height:1px;
  background:linear-gradient(to right,transparent,var(--cw-accent),transparent);
  opacity:.75;
}
.cw-mono::before{ top:18%; }
.cw-mono::after{ bottom:18%; }
.cw-mono b{
  font-family:var(--cw-serif);
  font-weight:600;
  font-size:min(3.4vw, 2.6em);
  line-height:1;
  letter-spacing:.06em;
  /* engraved: light from above-left => dark above, light below */
  text-shadow:0 -1px 0 rgba(0,0,0,.22), 0 1px 0 rgba(255,255,255,.85);
}
.cw-mono i{
  font-style:normal;
  font-size:min(.95vw,.62em);
  letter-spacing:.22em;
  text-transform:uppercase;
  color:#8a7a5f;
}

/* ---- Xfinity rosette ----------------------------------------------------
   A different award, so it keeps a distinct mark — but a milled brass rosette
   pinned to the frame, not a saturated cornflower disc. The old badge was the
   only saturated blue on the site and read as a social-media verification
   sticker; brass is the room's one accent and the material the rest of the
   hardware is cut from. */
.cw-badge{
  position:absolute;
  top:-7%; right:-7%;
  width:26%; max-width:2.4em; aspect-ratio:1;
  display:grid; place-items:center;
  border-radius:50%;
  background:radial-gradient(circle at 34% 28%,
      var(--cw-accent-lit) 0%, var(--cw-accent) 45%, var(--cw-accent-deep) 100%);
  color:var(--cw-accent-deep);
  box-shadow:
    0 .16em .4em rgb(var(--cw-shade) / .6),
    inset 0 0 0 1px color-mix(in oklab, var(--cw-accent-lit) 72%, transparent),
    inset 0 -.09em .18em rgb(var(--cw-shade) / .32);
  font-size:min(1.4vw,1em);
  line-height:1;
  pointer-events:none;
}
/* The milled edge. Masked to a ring so the disc reads through; where mask is
   unsupported it degrades to a plain brass rosette, never to a broken shape. */
.cw-badge::before{
  content:""; position:absolute; inset:-9%;
  border-radius:50%;
  background:repeating-conic-gradient(from 0deg,
      var(--cw-accent-deep) 0deg 6deg, var(--cw-accent-mid) 6deg 12deg);
  -webkit-mask:radial-gradient(circle, transparent 0 62%, #000 63% 100%);
  mask:radial-gradient(circle, transparent 0 62%, #000 63% 100%);
}
/* Engraved, not printed: shadow above, catchlight below. */
.cw-badge svg{
  position:relative; width:60%; height:60%; display:block;
  filter:drop-shadow(0 1px 0 color-mix(in oklab, var(--cw-accent-lit) 85%, transparent));
}

/* =========================================================================
   B. NARROW / PORTRAIT FALLBACK — clean horizontal card strip.
   Condition is interpolated from NARROW_MEDIA; see its doc comment.
   ====================================================================== */
.cw-strip{ display:none; }
/* A detached strip host is a normal flow element at every width. */
.ccc-chefwall.cw-detached{ position:relative; inset:auto; pointer-events:auto; }
.ccc-chefwall.cw-detached .cw-wall{ display:none; }

@media ${NARROW_MEDIA}{
  /* Either the viewport is too narrow, or the plate is cropped side-to-side by
     a portrait viewport. Both mean there are no frames left to sit in, and both
     are exactly when theme.css §16 hides .hotspots (and therefore .cw-wall).
     Pass stripHost at init so the strip lives OUTSIDE that hidden, transformed
     layer — e.g. the room's .rail. If it was not passed, initChefWall relocates
     the strip itself; see ensureStripMount(). */
  .ccc-chefwall{ inset:auto 0 0 0; pointer-events:auto; }
  .ccc-chefwall.cw-detached{ position:relative; inset:auto; }
  .cw-wall{ display:none; }
  .cw-strip{
    display:flex; gap:.75rem;
    overflow-x:auto; overscroll-behavior-x:contain;
    scroll-snap-type:x mandatory;
    -webkit-overflow-scrolling:touch;
    padding:.75rem 1rem 1rem;
    margin:0; list-style:none;
    scrollbar-width:thin;
  }
  .cw-card{
    scroll-snap-align:start;
    flex:0 0 clamp(9.5rem, 44vw, 12.5rem);
    min-height:44px;                 /* tap-target floor */
    display:flex; flex-direction:column; gap:.55rem;
    padding:.6rem .6rem .7rem;
    border:1px solid var(--cw-line);
    border-radius:var(--cw-r-sm);
    background:rgb(var(--cw-shade) / .55);
    -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
    color:var(--cw-fg);
    text-align:left; cursor:pointer;
    -webkit-appearance:none; appearance:none;
    -webkit-tap-highlight-color:transparent;
    transition:transform 240ms var(--cw-ease);
  }
  .cw-card:active{ transform:scale(.985); }
  .cw-card:focus-visible{ outline:2px solid var(--cw-focus); outline-offset:2px; }
  .cw-card .cw-cardart{
    position:relative;
    width:100%; aspect-ratio:4/5;
    border-radius:var(--cw-r-xs); overflow:hidden;
    background:var(--cw-walnut);
    box-shadow:inset 0 0 0 1px rgb(var(--cw-shade) / .5);
  }
  /* object-fit / object-position are NOT repeated here: .cw-photo img is the
     single declaration, so the card crop matches the wall and modal exactly. */
  .cw-card .cw-mono b{ font-size:1.6rem; }
  .cw-card .cw-mono i{ font-size:.5rem; }
  .cw-card .cw-badge{ font-size:.7rem; width:1.5rem; max-width:1.5rem; top:.35rem; right:.35rem; }
  .cw-cardname{
    font-family:var(--cw-serif); font-size:1rem; line-height:1.15; font-weight:600;
  }
  .cw-cardrole{
    font-size:.72rem; line-height:1.3; color:var(--cw-dim);
  }
}

/* =========================================================================
   C. MODAL — full slide write-up
   ====================================================================== */
.ccc-chefmodal{
  position:fixed; inset:0; z-index:9000;
  display:none;
  font-family:var(--cw-sans);
}
.ccc-chefmodal[data-open="true"]{ display:block; }

.cw-backdrop{
  position:absolute; inset:0;
  /* Matches the freezer keypad's scrim, the site's best modal. Deliberately
     NOT near-opaque: this is a dialog ABOUT the wall of fame, so the break-room
     set stays legible behind it instead of disappearing. */
  background:rgb(var(--cw-shade) / .72);
  -webkit-backdrop-filter:blur(18px) saturate(.92);
  backdrop-filter:blur(18px) saturate(.92);
  opacity:0;
  transition:opacity 260ms var(--cw-ease);
}
.ccc-chefmodal[data-shown="true"] .cw-backdrop{ opacity:1; }

.cw-dialog{
  position:absolute; inset:0;
  display:flex; align-items:center; justify-content:center;
  padding:clamp(.75rem, 3vw, 2.5rem);
  pointer-events:none;               /* the panel re-enables it */
}
/* The panel is a piece of the room: the same surface, the same brass hairline
   and the same 6px break as every other panel on the site. It was a cream card
   on a near-black page — the one light object anywhere — with a 12px corner. */
.cw-panel{
  pointer-events:auto;
  position:relative;
  width:min(46rem, 100%);
  max-height:min(88svh, 54rem);
  overflow:auto; overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;
  background:var(--cw-surface);
  color:var(--cw-fg);
  border-radius:var(--cw-r-md);
  box-shadow:var(--cw-shadow-3), inset 0 0 0 1px var(--cw-line);
  opacity:0; transform:translate3d(0,10px,0) scale(.985);
  transition:opacity 260ms var(--cw-ease), transform 260ms var(--cw-ease);
}
.ccc-chefmodal[data-shown="true"] .cw-panel{
  opacity:1; transform:translate3d(0,0,0) scale(1);
}

/* Hardware, not a marshmallow: 40x40 at --r-sm with a brass hairline and a
   brass glyph. The ::after pushes the HIT area out to 44px in every direction
   so the target still clears the touch floor while the visible key stays 40. */
.cw-close{
  position:absolute; top:.6rem; right:.6rem;
  width:40px; height:40px;
  display:grid; place-items:center;
  border:0; border-radius:var(--cw-r-sm);
  background:rgb(var(--cw-shade) / .45);
  box-shadow:inset 0 0 0 1px var(--cw-line);
  color:var(--cw-accent);
  cursor:pointer; font-size:1rem; line-height:1;
  -webkit-appearance:none; appearance:none;
  transition:background 180ms var(--cw-ease), color 180ms var(--cw-ease),
             box-shadow 180ms var(--cw-ease);
  z-index:2;
}
.cw-close::after{
  content:""; position:absolute; inset:-2px;   /* 44x44 hit area */
}
.cw-close:hover{
  background:color-mix(in oklab, var(--cw-accent) 16%, transparent);
  color:var(--cw-accent-lit);
  box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--cw-accent) 62%, transparent);
}
.cw-close:focus-visible{ outline:2px solid var(--cw-focus); outline-offset:2px; }

/* ---- header -------------------------------------------------------------
   One column with the portrait floated left, so the text wraps around and
   under it. The old two-column grid left column 2 empty on short records —
   ~330x220px of void on the Linda Weeks card. A float cannot produce that. */
.cw-head{
  padding:clamp(1.1rem,3vw,1.8rem);
  padding-right:3.8rem;
  border-bottom:1px solid var(--cw-line);
}
.cw-head::after{ content:""; display:table; clear:both; }
.cw-portrait{
  float:left;
  width:clamp(7rem, 22%, 9rem);
  margin:.15rem clamp(1rem,3vw,1.4rem) .6rem 0;
  aspect-ratio:4/5;
  position:relative;
  border-radius:var(--cw-r-xs); overflow:hidden;
  background:var(--cw-walnut);
  box-shadow:
    0 .5rem 1.4rem rgb(var(--cw-shade) / .5),
    inset 0 0 0 1px var(--cw-line);
}
/* No object-fit here on purpose — .cw-photo img owns it for all three surfaces. */
.cw-portrait .cw-mono b{ font-size:2.4rem; }
.cw-portrait .cw-mono i{ font-size:.55rem; }

/* 46ch measure on the identity block, so a long store/role line breaks at a
   readable width instead of running the full 46rem panel. */
.cw-id{ max-width:46ch; }

.cw-eyebrow{
  margin:0 0 .5rem;
  font-size:.68rem; font-weight:700;
  letter-spacing:.19em; text-transform:uppercase;
  color:var(--cw-dim);
  display:flex; align-items:center; gap:.4rem;
}
.cw-eyebrow[data-xfinity="true"]{ color:var(--cw-accent-lit); }
.cw-name{
  margin:0 0 .35rem;
  font-family:var(--cw-serif);
  font-size:clamp(1.5rem, 4.2vw, 2.1rem);
  line-height:1.06; font-weight:600; letter-spacing:-.01em;
  color:var(--cw-fg);
}
.cw-role{
  margin:0; font-size:.9rem; line-height:1.4; color:var(--cw-fg-muted);
}

/* ---- stats --------------------------------------------------------------
   A real grid, not a wrapping flex row. Hammond has eight figures: as flex
   they wrapped 6+2 and the dividers desynced — a rule between every pair on
   row 1, then one stray rule and a 340px gap on row 2. A fixed 4-up grid means
   row 2 lands under row 1 and the "no rule on the first cell of a row" test is
   simply :nth-child(4n+1). (auto-fit was the brief, but its resolved column
   count drifts with panel width and would desync from 4n+1 all over again —
   the fixed track count is what actually makes the dividers correct.) */
.cw-stats{
  display:grid;
  grid-template-columns:repeat(2, minmax(0,1fr));
  row-gap:1rem;
  margin:0; padding:clamp(.95rem,2.4vw,1.2rem) clamp(1.1rem,3vw,1.8rem);
  border-bottom:1px solid var(--cw-line);
  background:rgb(var(--cw-shade) / .32);
}
.cw-stat{
  min-width:0;
  padding:0 .85rem;
  display:flex; flex-direction:column-reverse;   /* value paints above label */
  border-inline-start:1px solid var(--cw-line);
}
.cw-stat:nth-child(2n+1){ border-inline-start:0; padding-inline-start:0; }
@media (min-width:34rem){
  .cw-stats{ grid-template-columns:repeat(4, minmax(0,1fr)); }
  .cw-stat:nth-child(2n+1){ border-inline-start:1px solid var(--cw-line); padding-inline-start:.85rem; }
  .cw-stat:nth-child(4n+1){ border-inline-start:0; padding-inline-start:0; }
}
.cw-stat dd{ margin:0; }
.cw-statv{
  display:block;
  font-family:var(--cw-serif);
  font-size:clamp(1.05rem,2.8vw,1.35rem);
  line-height:1.1; font-weight:600;
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
  color:var(--cw-accent-lit);        /* brass earns its keep beyond the dots */
}
.cw-statl{
  display:block; margin-top:.18rem;
  font-size:.63rem; letter-spacing:.13em; text-transform:uppercase;
  color:var(--cw-dim);
}

.cw-body{
  padding:clamp(1.1rem,3vw,1.8rem);
  max-width:68ch;                    /* a measure, not the full panel */
  color:var(--cw-fg-muted);
}
.cw-body p{ margin:0 0 .85rem; font-size:.98rem; line-height:1.62; }
.cw-body p:last-child{ margin-bottom:0; }
.cw-body ul{ margin:0; padding:0; list-style:none; }
.cw-body li{
  position:relative;
  margin:0 0 .6rem; padding-left:1.15rem;
  font-size:.98rem; line-height:1.55;
}
.cw-body li:last-child{ margin-bottom:0; }
.cw-body li::before{
  content:""; position:absolute; left:.15rem; top:.62em;
  width:.34rem; height:.34rem; border-radius:50%;
  background:var(--cw-accent);
}

@media (max-width:32rem){
  .cw-portrait{ float:none; width:8rem; margin:0 0 1rem; }
}

/* screen-reader-only text */
.cw-sr{
  position:absolute!important; width:1px; height:1px;
  padding:0; margin:-1px; overflow:hidden;
  clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; border:0;
}

/* =========================================================================
   D. REDUCED MOTION — SPEC.md: snap, do not animate.
   ====================================================================== */
@media (prefers-reduced-motion:reduce){
  .ccc-chefwall *, .ccc-chefmodal *{
    transition-duration:1ms!important;
    animation-duration:1ms!important;
  }
  .cw-frame:hover .cw-lift,
  .cw-frame:focus-visible .cw-lift{ transform:none; will-change:auto; }
  .cw-frame:hover .cw-sweep,
  .cw-frame:focus-visible .cw-sweep{ transform:rotate(28deg); }
  .cw-panel{ transform:none; }
}
`;

/**
 * Inject the stylesheet exactly once per document.
 * Never throws — a CSP-blocked <style> just means an unstyled (but working) wall.
 */
function ensureStyles(doc) {
  try {
    if (doc.getElementById(STYLE_ID)) return;
    const el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    doc.head.appendChild(el);
  } catch (_) { /* non-fatal by design */ }
}

/* ---------------------------------------------------------------------------
 * 3. TEXT UTILITIES
 *    The write-ups are raw text pasted out of PowerPoint. They contain literal
 *    newlines, leading hyphens used as bullets (sometimes with no space after
 *    the hyphen: "-200 T charts"), doubled spaces, and occasionally a first line
 *    that just repeats the chef's own name. We normalise rather than dump.
 * ------------------------------------------------------------------------ */

/** Collapse whitespace runs and trim. Non-breaking spaces count as spaces. */
function squish(s) {
  return String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();
}

/**
 * Turn one raw PowerPoint write-up into a small render tree.
 * @returns {{kind:'list'|'paras', items:string[]}}
 */
export function normaliseWriteup(raw, chefName) {
  const name = squish(chefName).toLowerCase();

  // 1. Split on any newline flavour; normalise each line; drop empties.
  let lines = String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(squish)
    .filter(Boolean);

  // 2. Did the author use explicit bullet glyphs anywhere?
  const hadBullets = lines.some((l) => BULLET_RE.test(l));

  // 3. Strip the bullet glyph; re-squish because "-  foo" leaves a gap.
  lines = lines.map((l) => squish(l.replace(BULLET_RE, '')));

  // 4. Drop a leading line that is just the chef's name repeated — the modal
  //    already shows the name as an <h2>, so repeating it reads as a mistake.
  if (lines.length > 1 && lines[0].toLowerCase() === name) lines.shift();

  // 5. Drop anything that became empty after stripping.
  lines = lines.filter(Boolean);
  if (!lines.length) return { kind: 'paras', items: [] };

  // 6. Decide list vs prose.
  //    - explicit bullets  -> list
  //    - several short lines (each a fragment, no terminal punctuation run-on)
  //      -> the author was writing a list without glyphs -> list
  //    - otherwise -> paragraphs
  const shortish = lines.every((l) => l.length <= 140);
  const kind = (hadBullets || (lines.length >= 2 && shortish)) ? 'list' : 'paras';

  // 7. Sentence-case the leading character of a bullet only when the author
  //    clearly wrote fragments in lower case. (Cosmetic, never destructive.)
  const items = lines.map((l) => (kind === 'list' ? l.replace(/^([a-z])/, (m) => m.toUpperCase()) : l));

  return { kind, items };
}

/**
 * Initials for the monogram fallback.
 *  "Linda Weeks" -> "LW"   |   "Hammond" -> "H"   |   "" -> "•"
 */
export function initialsFor(name) {
  const parts = squish(name).split(' ').filter(Boolean);
  if (!parts.length) return '•';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** Segments of "Glenview • Assistant Manager" -> ["Glenview","Assistant Manager"]. */
function roleSegments(storeRole) {
  return squish(storeRole).split(/\s*[•|]\s*/).filter(Boolean);
}

/**
 * Accessible name, e.g.
 *   "Head Chef of the Week: Antonio Carradine, Burbank"
 *   "Xfinity Head Chef of the Week: Alexis Bell, Greater Chicago"
 * For the standard award the place is the FIRST segment (the store); for the
 * Xfinity award the first segment is the award title itself, so we take the last.
 */
function accessibleName(chef) {
  const award = chef.is_xfinity ? 'Xfinity Head Chef of the Week' : 'Head Chef of the Week';
  const segs = roleSegments(chef.store_role);
  const place = chef.is_xfinity ? segs[segs.length - 1] : segs[0];
  const who = squish(chef.name) || 'Head Chef';
  return place ? `${award}: ${who}, ${place}` : `${award}: ${who}`;
}

/**
 * Resolve a chef's photo URL against the data root.
 * `photo_file` in headchefs.json is relative to the headchefs/ folder.
 */
function photoUrl(chef, base) {
  const f = chef && chef.photo_file;
  if (!f) return null;
  if (/^([a-z]+:)?\/\//i.test(f) || f.charAt(0) === '/' || f.startsWith('data:')) return f;
  const b = base == null ? '' : String(base);
  return b && !b.endsWith('/') ? `${b}/${f}` : `${b}${f}`;
}

/* ---------------------------------------------------------------------------
 * 4. SMALL DOM HELPERS
 * ------------------------------------------------------------------------ */

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The Xfinity star, inline so there is no extra request. */
function starSvg(doc) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS(NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M12 2.6l2.7 5.9 6.4.7-4.8 4.4 1.3 6.3L12 16.7 6.4 19.9l1.3-6.3L2.9 9.2l6.4-.7z');
  svg.appendChild(path);
  return svg;
}

/**
 * Build the picture surface for one chef. Three states, deliberately distinct:
 *
 *   photo on the slide  -> the photo, unconditionally. No curation, no
 *                          judgement about whether it looks like a headshot.
 *   no photo            -> an empty mat (.cw-blank). Not an error.
 *   photo 404s          -> the monogram plate. This IS an error and is meant
 *                          to look different from an empty mat.
 *
 * NEVER throws and NEVER leaves a broken image.
 */
function buildSurface(doc, chef, base, monoCaption) {
  const wrap = el(doc, 'span', 'cw-photo');

  // Per-chef focal point support (optional field, e.g. "50% 22%").
  if (chef.photo_focus) wrap.style.setProperty('--cw-focus-pos', String(chef.photo_focus));

  const src = chef.has_photo === false ? null : photoUrl(chef, base);

  // Nothing on the slide this week -> leave it blank. The mat, the recess and
  // the glass all still render; there is simply no print in the frame.
  if (!src) {
    wrap.className = 'cw-photo cw-blank';
    return wrap;
  }

  const img = doc.createElement('img');
  img.alt = '';                       // the button carries the accessible name
  img.decoding = 'async';
  img.loading = 'lazy';               // breakroom is room 6 (SPEC lazy rule)
  img.draggable = false;
  // A file that was supposed to load and did not is a FAULT, so it gets the
  // monogram rather than the blank mat — an empty frame must keep meaning
  // "no photo on the slide", not "the deploy is missing a file". Bound before
  // src is set so a cached error still fires against a live handler.
  img.addEventListener('error', function onErr() {
    img.removeEventListener('error', onErr);
    try {
      wrap.replaceChildren(buildMonogram(doc, chef, monoCaption));
    } catch (_) {
      // replaceChildren is very widely supported; fall back just in case.
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(buildMonogram(doc, chef, monoCaption));
    }
  }, { once: true });
  img.src = src;
  wrap.appendChild(img);
  // The walnut multiply that unifies five differently-graded sources. Added
  // only alongside a real photo — the monogram plate is already one look, and
  // the fallback path replaces the whole surface, taking this with it.
  const grade = el(doc, 'span', 'cw-grade');
  grade.setAttribute('aria-hidden', 'true');
  wrap.appendChild(grade);
  return wrap;
}

/** The monogram plate: engraved initials on ivory, brass hairlines. */
function buildMonogram(doc, chef, caption) {
  const mono = el(doc, 'span', 'cw-mono');
  mono.setAttribute('aria-hidden', 'true');   // name is on the button already
  mono.appendChild(el(doc, 'b', null, initialsFor(chef.name)));
  if (caption !== false) {
    const segs = roleSegments(chef.store_role);
    mono.appendChild(el(doc, 'i', null, segs[0] || 'Head Chef'));
  }
  return mono;
}

/** The circular Xfinity badge, or null. */
function buildBadge(doc, chef) {
  if (!chef.is_xfinity) return null;
  const b = el(doc, 'span', 'cw-badge');
  b.appendChild(starSvg(doc));
  return b;
}

/* ---------------------------------------------------------------------------
 * 5. SCROLL LOCK — iOS-correct.
 *    iOS Safari ignores `overflow:hidden` on <body>, so we pin the body with
 *    position:fixed and a negative top offset, then restore the exact scroll
 *    position afterwards. We snapshot the previous INLINE values so we hand the
 *    page back byte-for-byte (the cinema engine reads scroll position and must
 *    not be left at 0).
 * ------------------------------------------------------------------------ */

function createScrollLock(win) {
  const doc = win.document;
  let locked = false;
  let saved = null;

  return {
    lock() {
      if (locked) return;
      locked = true;
      const body = doc.body;
      const root = doc.documentElement;
      const y = win.scrollY || root.scrollTop || 0;
      saved = {
        y,
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
        rootBehavior: root.style.scrollBehavior
      };
      body.style.position = 'fixed';
      body.style.top = `-${y}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    },
    unlock() {
      if (!locked || !saved) return;
      locked = false;
      const body = doc.body;
      const root = doc.documentElement;
      body.style.position = saved.position;
      body.style.top = saved.top;
      body.style.left = saved.left;
      body.style.right = saved.right;
      body.style.width = saved.width;
      body.style.overflow = saved.overflow;
      // Kill smooth scrolling for the restore so the page does not visibly fly.
      root.style.scrollBehavior = 'auto';
      win.scrollTo(0, saved.y);
      root.style.scrollBehavior = saved.rootBehavior;
      saved = null;
    },
    get isLocked() { return locked; }
  };
}

/* ---------------------------------------------------------------------------
 * 6. MODAL
 * ------------------------------------------------------------------------ */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function createModal(win, uid, photoBase) {
  const doc = win.document;
  const lock = createScrollLock(win);

  const rootEl = el(doc, 'div', 'ccc-chefmodal');
  rootEl.id = `cw-modal-${uid}`;
  rootEl.setAttribute('data-open', 'false');

  const backdrop = el(doc, 'div', 'cw-backdrop');
  backdrop.setAttribute('aria-hidden', 'true');

  const dialog = el(doc, 'div', 'cw-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `cw-modal-title-${uid}`);
  dialog.setAttribute('tabindex', '-1');

  const panel = el(doc, 'div', 'cw-panel');

  const closeBtn = el(doc, 'button', 'cw-close');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '<span aria-hidden="true">✕</span>';
  closeBtn.appendChild(el(doc, 'span', 'cw-sr', 'Close'));

  const content = el(doc, 'div', 'cw-content');

  panel.appendChild(closeBtn);
  panel.appendChild(content);
  dialog.appendChild(panel);
  rootEl.appendChild(backdrop);
  rootEl.appendChild(dialog);

  let lastFocus = null;
  let open = false;
  let inerted = [];

  const supportsInert = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;

  /** Mark everything outside the modal inert so AT cannot reach it. */
  function setOutsideInert(on) {
    if (!supportsInert) return;
    if (on) {
      inerted = [];
      Array.prototype.forEach.call(doc.body.children, (child) => {
        if (child === rootEl || child.inert) return;
        child.inert = true;
        inerted.push(child);
      });
    } else {
      inerted.forEach((n) => { n.inert = false; });
      inerted = [];
    }
  }

  function focusables() {
    return Array.prototype.filter.call(
      panel.querySelectorAll(FOCUSABLE),
      (n) => n.offsetParent !== null || n === doc.activeElement
    );
  }

  /** Focus trap + Escape. */
  function onKeydown(e) {
    if (!open) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      api.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) { e.preventDefault(); dialog.focus(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const active = doc.activeElement;
    if (e.shiftKey) {
      if (active === first || active === dialog || !panel.contains(active)) {
        e.preventDefault(); last.focus();
      }
    } else if (active === last) {
      e.preventDefault(); first.focus();
    }
  }

  /** Click on the backdrop (or the dialog padding) dismisses. */
  function onPointerDown(e) {
    if (!open) return;
    if (!panel.contains(e.target)) api.close();
  }

  closeBtn.addEventListener('click', () => api.close());
  rootEl.addEventListener('mousedown', onPointerDown);
  doc.addEventListener('keydown', onKeydown, true);

  /** Render one chef's slide into the panel. */
  function render(chef) {
    const frag = doc.createDocumentFragment();

    /* ---- head: portrait + identity ---- */
    const head = el(doc, 'div', 'cw-head');

    const portrait = el(doc, 'div', 'cw-portrait');
    // Reuse the exact same surface builder so the modal portrait and the wall
    // photo can never disagree about which fallback a chef gets.
    portrait.appendChild(buildSurface(doc, chef, photoBase, true));
    if (chef.photo_focus) portrait.style.setProperty('--cw-focus-pos', String(chef.photo_focus));

    const idBox = el(doc, 'div', 'cw-id');

    const eyebrow = el(doc, 'p', 'cw-eyebrow');
    eyebrow.setAttribute('data-xfinity', chef.is_xfinity ? 'true' : 'false');
    if (chef.is_xfinity) {
      const s = starSvg(doc);
      s.setAttribute('width', '12'); s.setAttribute('height', '12');
      eyebrow.appendChild(s);
    }
    eyebrow.appendChild(
      doc.createTextNode(chef.is_xfinity
        ? 'Xfinity Head Chef of the Week'
        : 'Head Chef of the Week')
    );

    const h2 = el(doc, 'h2', 'cw-name', squish(chef.name) || 'Head Chef');
    h2.id = `cw-modal-title-${uid}`;

    const role = el(doc, 'p', 'cw-role', roleSegments(chef.store_role).join(' • '));

    idBox.appendChild(eyebrow);
    idBox.appendChild(h2);
    if (role.textContent) idBox.appendChild(role);

    head.appendChild(portrait);
    head.appendChild(idBox);
    frag.appendChild(head);

    /* ---- stats: a clean row of figures (omitted entirely when empty) ---- */
    const stats = Array.isArray(chef.stats) ? chef.stats.filter((s) => s && (s.value || s.label)) : [];
    if (stats.length) {
      const dl = el(doc, 'dl', 'cw-stats');
      stats.forEach((s) => {
        const cell = el(doc, 'div', 'cw-stat');
        const dt = el(doc, 'dt', 'cw-statl', squish(s.label));
        const dd = el(doc, 'dd', 'cw-statv', squish(s.value));
        // DOM order stays semantic (label <dt> then value <dd>) for screen
        // readers; CSS column-reverse paints the big figure above the label.
        cell.appendChild(dt);
        cell.appendChild(dd);
        dl.appendChild(cell);
      });
      frag.appendChild(dl);
    }

    /* ---- body: normalised write-up ---- */
    const body = el(doc, 'div', 'cw-body');
    const { kind, items } = normaliseWriteup(chef.writeup, chef.name);
    if (items.length) {
      if (kind === 'list') {
        const ul = el(doc, 'ul');
        items.forEach((t) => ul.appendChild(el(doc, 'li', null, t)));
        body.appendChild(ul);
      } else {
        items.forEach((t) => body.appendChild(el(doc, 'p', null, t)));
      }
    } else {
      body.appendChild(el(doc, 'p', null, 'Write-up coming from the deck.'));
    }
    frag.appendChild(body);

    content.replaceChildren(frag);
  }

  const api = {
    el: rootEl,
    get isOpen() { return open; },

    show(chef, returnFocusTo) {
      if (open) return;
      try { render(chef); } catch (_) { /* never let a bad record break the site */ }
      lastFocus = returnFocusTo || doc.activeElement;
      open = true;
      lock.lock();
      rootEl.setAttribute('data-open', 'true');
      setOutsideInert(true);
      // Next frame so the opacity/transform transition actually runs.
      win.requestAnimationFrame(() => {
        rootEl.setAttribute('data-shown', 'true');
        panel.scrollTop = 0;
        // Focus the dialog itself: the heading is announced via aria-labelledby.
        dialog.focus({ preventScroll: true });
      });
    },

    close() {
      if (!open) return;
      open = false;
      rootEl.setAttribute('data-shown', 'false');
      setOutsideInert(false);

      const finish = () => {
        rootEl.setAttribute('data-open', 'false');
        lock.unlock();                       // restores iOS scroll position
        if (lastFocus && doc.contains(lastFocus)) {
          try { lastFocus.focus({ preventScroll: true }); } catch (_) {}
        }
        lastFocus = null;
      };

      // Wait out the fade, but never hang if transitionend does not fire.
      let done = false;
      const once = () => { if (done) return; done = true; finish(); };
      panel.addEventListener('transitionend', once, { once: true });
      win.setTimeout(once, 320);
    },

    destroy() {
      doc.removeEventListener('keydown', onKeydown, true);
      rootEl.removeEventListener('mousedown', onPointerDown);
      setOutsideInert(false);
      lock.unlock();
      if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    }
  };

  return api;
}

/* ---------------------------------------------------------------------------
 * 7. PUBLIC ENTRY POINT
 * ------------------------------------------------------------------------ */

/**
 * Mount the Head Chef wall.
 *
 * @param {Object}  opts
 * @param {Element|string} opts.host
 *        The container the wall fills. On the break-room section this is the
 *        `.hotspots` layer (which already carries the plate transform from
 *        theme.css). Must be `position:relative|absolute` — we set `absolute;
 *        inset:0` on our own root. A CSS selector string is also accepted.
 *
 * @param {Array<Object>} opts.chefs
 *        The `headchefs` array from headchefs.json, regenerated weekly from
 *        the decks. Any length is safe: the first five fill the five painted
 *        frames in order and any leftover frames render as empty mats; more
 *        than five takes the first five and warns. A chef with no photo gets
 *        an empty mat too — whatever is on the slide is the picture.
 *        Fields used: name, store_role, stats[{value,label}], writeup,
 *        is_xfinity, has_photo, photo_file, and the optional extra
 *        `photo_focus` (any CSS object-position, default "50% 28%").
 *
 * @param {Array<{x:number,y:number,w:number,h:number,rotate?:number}>} opts.frames
 *        FIVE boxes, measured off the generated break-room plate, in PERCENT.
 *        frames[i] receives chefs[i] — index order is the contract.
 *          x       left edge of the MAT OPENING as % of plate WIDTH   (0..100)
 *          y       top  edge of the MAT OPENING as % of plate HEIGHT  (0..100)
 *          w       mat opening width  as % of plate WIDTH
 *          h       mat opening height as % of plate HEIGHT
 *          rotate  optional, degrees clockwise about the box centre (default 0)
 *        Measure the INNER grey mat, not the outer black moulding — the photo
 *        fills this box edge to edge with object-fit:cover.
 *
 * @param {string} [opts.photoBase='headchefs/']
 *        Prefix for `photo_file` (which is relative to the headchefs/ folder).
 *
 * @param {Element|string} [opts.stripHost]
 *        Optional separate mount point for the narrow/portrait card-strip
 *        fallback (the NARROW_MEDIA condition, matching theme.css §16).
 *        STRONGLY recommended when `host` is the .hotspots layer: theme.css §16
 *        sets that layer to display:none on exactly this condition, which would
 *        hide the strip along with it, and it is also transform-scaled by the
 *        plate. Pass the room's `.rail` (or any untransformed, always-visible
 *        container). If omitted, the strip is relocated automatically when the
 *        host is found hidden, with a console warning.
 *
 * @param {Document} [opts.document] / @param {Window} [opts.window]  test seams.
 *
 * @returns {{open:Function, close:Function, update:Function, destroy:Function,
 *            root:Element|null, buttons:Element[]}}
 *          Always returns a usable controller — this function never throws.
 */
export function initChefWall(opts) {
  const o = opts || {};
  const win = o.window || (typeof window !== 'undefined' ? window : null);
  const doc = o.document || (win && win.document) || null;

  // -- no-op controller, returned whenever we cannot mount. Never throw. -----
  const noop = {
    root: null, buttons: [],
    open() {}, close() {}, update() {}, destroy() {}
  };
  if (!doc || !win) return noop;

  const host = typeof o.host === 'string' ? doc.querySelector(o.host) : o.host;
  if (!host || !host.appendChild) {
    if (win.console) win.console.warn('[chefwall] host element not found; wall not mounted.');
    return noop;
  }

  ensureStyles(doc);

  const uid = ++instanceSeq;
  const photoBase = o.photoBase == null ? 'headchefs/' : o.photoBase;

  let chefs = [];
  let frames = [];
  let buttons = [];

  const root = el(doc, 'div', 'ccc-chefwall');
  root.setAttribute('data-chefwall', String(uid));

  const wall = el(doc, 'div', 'cw-wall');   // wide + landscape : framed photos
  const strip = el(doc, 'ul', 'cw-strip');  // narrow or portrait : card strip
  strip.setAttribute('role', 'list');

  root.appendChild(wall);
  host.appendChild(root);

  // The narrow-viewport card strip normally lives inside the same root. If the
  // integrator passes `stripHost` (recommended when `host` is the transformed
  // .hotspots layer) the strip is mounted there instead, in its own token
  // scope, so it is not scaled/parallaxed along with the plate.
  const stripHost = typeof o.stripHost === 'string' ? doc.querySelector(o.stripHost) : o.stripHost;
  let detachedRoot = null;
  let warnedAboutStripHost = false;

  /** Move the strip into its own root under `target`, out of `root`. */
  function detachStripTo(target) {
    detachedRoot = el(doc, 'div', 'ccc-chefwall cw-detached');
    detachedRoot.appendChild(strip);          // appendChild MOVES the node
    target.appendChild(detachedRoot);
  }

  if (stripHost && stripHost.appendChild && stripHost !== host) {
    detachStripTo(stripHost);
  } else {
    root.appendChild(strip);
  }

  /**
   * SAFETY NET for the integration bug that took the wall down on iPad Pro
   * portrait. When no `stripHost` was supplied the strip sits inside `root`,
   * which lives inside `host` (.hotspots) — and theme.css §16 sets that host to
   * display:none on exactly the narrow/portrait condition where the strip is
   * supposed to take over. A hidden parent hides the strip too, so nothing
   * renders. If we detect that state we relocate the strip beside the host
   * (preferring the room's .rail) and warn once.
   */
  const narrowMQ = typeof win.matchMedia === 'function' ? win.matchMedia(NARROW_MEDIA) : null;

  function hostIsHidden() {
    try { return win.getComputedStyle(host).display === 'none'; } catch (_) { return false; }
  }

  function ensureStripMount() {
    if (detachedRoot) return;                 // already outside the host
    if (!narrowMQ || !narrowMQ.matches) return;
    if (!hostIsHidden()) return;
    const stage = host.parentElement;
    const target = (stage && stage.querySelector('.rail')) || stage || host.parentNode;
    if (!target || target === host || host.contains(target)) return;
    detachStripTo(target);
    if (!warnedAboutStripHost && win.console) {
      warnedAboutStripHost = true;
      win.console.warn(
        '[chefwall] host is display:none under ' + NARROW_MEDIA + ' (theme.css §16) ' +
        'so the card strip was relocated to keep it visible. Pass stripHost ' +
        '(e.g. the room .rail) at init to control where it lands.'
      );
    }
  }

  // Re-check on every breakpoint/orientation flip. addEventListener on a
  // MediaQueryList is the modern API; addListener is the Safari <14 fallback.
  const onNarrowChange = () => ensureStripMount();
  if (narrowMQ) {
    if (narrowMQ.addEventListener) narrowMQ.addEventListener('change', onNarrowChange);
    else if (narrowMQ.addListener) narrowMQ.addListener(onNarrowChange);
  }
  ensureStripMount();

  const modal = createModal(win, uid, photoBase);
  doc.body.appendChild(modal.el);

  /** Percent geometry -> exact mat placement. Shared by real and vacant slots. */
  function placeFrame(node, box) {
    node.style.left = `${box.x}%`;
    node.style.top = `${box.y}%`;
    node.style.width = `${box.w}%`;
    node.style.height = `${box.h}%`;
    if (box.rotate) node.style.transform = `rotate(${box.rotate}deg)`;
  }

  /* -- a frame with no chef behind it -------------------------------------
     The five frames are fixed by the painted art; the deck data is not. When
     headchefs.json arrives with fewer than five slides the leftover frames are
     filled in order with an empty mat — inert, unfocusable, and hidden from
     assistive tech, because there is nothing to announce and nothing to open. */
  function buildVacantFrame(box, i) {
    const slot = el(doc, 'span', 'cw-frame cw-frame--vacant');
    slot.setAttribute('aria-hidden', 'true');
    slot.dataset.chefIndex = String(i);
    placeFrame(slot, box);

    const lift = el(doc, 'span', 'cw-lift');
    const mat = el(doc, 'span', 'cw-mat');
    mat.appendChild(el(doc, 'span', 'cw-photo cw-blank'));
    mat.appendChild(el(doc, 'span', 'cw-inset'));
    lift.appendChild(mat);

    const glass = el(doc, 'span', 'cw-glass');
    glass.appendChild(el(doc, 'span', 'cw-sweep'));
    lift.appendChild(glass);

    slot.appendChild(lift);
    return slot;
  }

  /* -- one framed photo ---------------------------------------------------- */
  function buildFrame(chef, box, i) {
    const btn = el(doc, 'button', 'cw-frame');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-label', accessibleName(chef));
    btn.dataset.chefIndex = String(i);

    // Static layout, never animated.
    placeFrame(btn, box);

    const cast = el(doc, 'span', 'cw-cast');
    cast.setAttribute('aria-hidden', 'true');

    const lift = el(doc, 'span', 'cw-lift');

    // Our own mat, painted over the measured opening in the one mat colour,
    // with the print and its recess shadow both inset 6% (CSS owns the 6%).
    // The plate's painted mats vary in hue frame to frame; ours do not.
    const mat = el(doc, 'span', 'cw-mat');
    mat.appendChild(buildSurface(doc, chef, photoBase, true));

    const inset = el(doc, 'span', 'cw-inset');
    inset.setAttribute('aria-hidden', 'true');
    mat.appendChild(inset);
    lift.appendChild(mat);

    const glass = el(doc, 'span', 'cw-glass');
    glass.setAttribute('aria-hidden', 'true');
    glass.appendChild(el(doc, 'span', 'cw-sweep'));
    lift.appendChild(glass);

    const badge = buildBadge(doc, chef);
    if (badge) { badge.setAttribute('aria-hidden', 'true'); lift.appendChild(badge); }

    // Name revealed beneath the frame on hover/focus. Decorative: the button's
    // aria-label already carries "Head Chef of the Week: <name>, <store>".
    const nametag = el(doc, 'span', 'cw-nametag', squish(chef.name));
    nametag.setAttribute('aria-hidden', 'true');
    lift.appendChild(nametag);

    btn.appendChild(cast);
    btn.appendChild(lift);
    btn.addEventListener('click', () => modal.show(chef, btn));
    return btn;
  }

  /* -- one narrow-viewport card -------------------------------------------- */
  function buildCard(chef, i) {
    const li = el(doc, 'li');
    const btn = el(doc, 'button', 'cw-card');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-label', accessibleName(chef));
    btn.dataset.chefIndex = String(i);

    const art = el(doc, 'span', 'cw-cardart');
    art.appendChild(buildSurface(doc, chef, photoBase, false));
    const badge = buildBadge(doc, chef);
    if (badge) { badge.setAttribute('aria-hidden', 'true'); art.appendChild(badge); }

    const name = el(doc, 'span', 'cw-cardname', squish(chef.name));
    const role = el(doc, 'span', 'cw-cardrole', roleSegments(chef.store_role).join(' • '));
    // aria-label already carries the full name; hide the visual text duplicates.
    name.setAttribute('aria-hidden', 'true');
    role.setAttribute('aria-hidden', 'true');

    btn.appendChild(art);
    btn.appendChild(name);
    if (role.textContent) btn.appendChild(role);
    btn.addEventListener('click', () => modal.show(chef, btn));

    li.appendChild(btn);
    return li;
  }

  /* -- (re)build both renderings ------------------------------------------- */
  /**
   * Render the wall.
   *
   * THE SLOT COUNT COMES FROM THE ART, NOT THE DATA. There are five frames
   * painted into the photograph, so we always lay out `frames.length` (capped
   * at WALL_SIZE) slots and fill them in order:
   *
   *   slot i has a chef  -> a real button
   *   slot i has no chef -> an empty mat, inert and aria-hidden
   *
   * headchefs.json is regenerated weekly from the Win the Weekend decks, so
   * three slides one week and seven the next are both normal. Three fills
   * three frames and leaves two blank; seven fills five and drops the rest.
   */
  function build(nextChefs, nextFrames) {
    chefs = (Array.isArray(nextChefs) ? nextChefs : []).filter(Boolean);
    frames = Array.isArray(nextFrames) && nextFrames.length ? nextFrames : DEFAULT_FRAMES;

    // More slides than frames is the only genuinely lossy case: say what was
    // dropped. Fewer is routine and silent — that is what the blanks are for.
    if (chefs.length > WALL_SIZE && win.console) {
      win.console.warn(
        `[chefwall] ${chefs.length} head chefs in the data; the room has ${WALL_SIZE} painted ` +
        `frames. Showing the first ${WALL_SIZE}: ` +
        chefs.slice(0, WALL_SIZE).map((c) => squish(c && c.name)).join(', ') + '.'
      );
    }
    if (frames.length < WALL_SIZE && win.console) {
      win.console.warn(`[chefwall] only ${frames.length} frame boxes supplied; expected ${WALL_SIZE}.`);
    }

    const slots = Math.min(frames.length, WALL_SIZE);
    const wallFrag = doc.createDocumentFragment();
    const stripFrag = doc.createDocumentFragment();
    // Indexed BY SLOT, so buttons[i] always lines up with chefs[i]. A vacant
    // slot holds null rather than shifting everything after it along by one.
    buttons = [];

    for (let i = 0; i < slots; i++) {
      const chef = chefs[i];
      const raw = frames[i] || {};
      const box = {
        x: Number(raw.x) || 0,
        y: Number(raw.y) || 0,
        w: Number(raw.w) || 0,
        h: Number(raw.h) || 0,
        rotate: Number(raw.rotate) || 0
      };

      // No slide for this frame -> a blank mat, and no card in the strip
      // (a card with no name and no write-up would just be a dead tile).
      if (!chef) {
        try { wallFrag.appendChild(buildVacantFrame(box, i)); } catch (_) {}
        buttons[i] = null;
        continue;
      }

      try {
        const btn = buildFrame(chef, box, i);
        wallFrag.appendChild(btn);
        stripFrag.appendChild(buildCard(chef, i));
        buttons[i] = btn;
      } catch (err) {
        // A malformed record must never take the room down: fall back to the
        // blank mat so the wall still reads as five frames.
        if (win.console) win.console.warn('[chefwall] slot', i, 'failed; left blank.', err);
        try { wallFrag.appendChild(buildVacantFrame(box, i)); } catch (_) {}
        buttons[i] = null;
      }
    }

    wall.replaceChildren(wallFrag);
    strip.replaceChildren(stripFrag);
  }

  build(o.chefs, o.frames);

  /* -- controller ---------------------------------------------------------- */
  return {
    root,

    /**
     * The frame buttons, indexed BY SLOT so buttons[i] pairs with chefs[i].
     * A slot with no chef behind it holds `null` — check before using one.
     */
    get buttons() { return buttons.slice(); },

    /** True when the card strip is the active rendering (narrow OR portrait). */
    get isNarrow() { return !!(narrowMQ && narrowMQ.matches); },

    /** Programmatically open chef i's slide (used by deep links / the rail). */
    open(i) {
      const chef = chefs[i];
      if (!chef) return;
      modal.show(chef, buttons[i] || null);
    },

    close() { modal.close(); },

    /**
     * Re-measure or re-sync. Pass either key; the other is kept.
     * @param {{chefs?:Array, frames?:Array}} next
     */
    update(next) {
      const n = next || {};
      build(n.chefs || chefs, n.frames || frames);
    },

    destroy() {
      if (narrowMQ) {
        if (narrowMQ.removeEventListener) narrowMQ.removeEventListener('change', onNarrowChange);
        else if (narrowMQ.removeListener) narrowMQ.removeListener(onNarrowChange);
      }
      modal.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
      if (detachedRoot && detachedRoot.parentNode) detachedRoot.parentNode.removeChild(detachedRoot);
      buttons = [];
      chefs = [];
    }
  };
}

export default initChefWall;

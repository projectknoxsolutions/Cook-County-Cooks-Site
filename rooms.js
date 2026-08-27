/* ============================================================================
   rooms.js — room composition + hotspot geometry
   ----------------------------------------------------------------------------
   Every box is expressed in PERCENT OF THE PLATE (x, y = top-left corner;
   w, h = size).  These numbers were measured off the actual 5504x3072 renders
   with a percentage grid, not guessed — see /root/ccc-build/grid.py.

   kind:
     'tool'   -> a clickable object that opens the tool full-screen
     'screen' -> a screen surface owned by assets/screens.js
     'chefs'  -> the head chef wall (owned by chefwall.js)
     'lock'   -> the freezer keypad
   `quad` (TL, TR, BR, BL in plate %) is supplied where the object sits on a
   wall at an angle, so the mounted screen is warped to the screen's plane
   instead of floating in front of it.

   `mode` (screens only) picks what screens.js renders on the glass:
     'title'  a title card — the tool's name, auto-fitted. For surfaces too
              small to render a readable web page at any zoom (the tablets).
     'image'  the daily promo card straight from the Daily Sales Report repo.
     'feed'   the detractor-streak board, one district per slide.
     'live'   a real iframe of the tool, rendered wide and scaled down.
   ========================================================================== */

export const ROOM_ORDER = ['pass','host','dining','prep','office','breakroom','freezer'];

export const HOTSPOTS = {
  pass: [
    /* The three counter tablets, RE-MEASURED against the v4 `pass.webp` (the
       one with the much larger tablets across the lower third). Each glass was
       found by thresholding the plate and tracing the run of near-black pixels
       column by column, not eyeballed: all three come out axis-aligned to
       within a pixel and share a top edge at plate-Y 57.3% and a bottom at
       73.9%, so none of them carries a quad any more — the old tilt quads were
       fitted to the previous, smaller art and would now shear a flat screen.
       That shared 57.3% top edge is also the line theme.css §08a hangs the
       room's title card off (--rail-foot: 53).
       They render TITLE CARDS, not live pages: 14.8% of frame width still
       cannot show a readable web page, and the client's ask is that people can
       see what to click. */
    { slug:'quote-6th-gen',  kind:'screen', mode:'title',
      x:20.9, y:57.3, w:14.8, h:16.6, label:'6th Gen Quote Sheet' },
    { slug:'quote-upgrade',  kind:'screen', mode:'title',
      x:43.0, y:57.3, w:14.9, h:16.6, label:'Upgrade Quote Sheet' },
    { slug:'quote-internet', kind:'screen', mode:'title',
      x:63.9, y:57.3, w:14.5, h:16.6, label:'Internet Quote Sheet' },
    { slug:'tsheet-submissions', kind:'tool', x:76.0, y:76.0, w:14.5, h: 8.0, label:'T-Sheet Submissions', edge:'right bottom' },
  ],
  host: [
    /* The Host Stand TV hangs at an angle — this is the quad the homography in
       screens.js is solved against. It shows the daily promo card, held frozen. */
    { slug:'daily-sales', kind:'screen', mode:'image', x:47.0, y:5.6, w:37.0, h:53.0,
      label:'Daily Sales Report', name:'Daily Promo Card',
      quad:[[47.6,21.4],[82.0,11.2],[82.0,57.8],[47.3,55.8]] },
    { slug:'discount-close',        kind:'tool', x:26.0, y:55.5, w: 7.5, h:13.0, label:'The Mobile Discount Close' },
    { slug:'commission-payouts',    kind:'tool', x:44.0, y:61.0, w: 6.5, h:14.0, label:'Commission Payouts 2026' },
    { slug:'yesterdays-conversion', kind:'tool', x:14.0, y:68.0, w:24.0, h:14.0, label:"Yesterday's Conversion", edge:'bottom' },
  ],
  dining: [
    /* The two menu boards are near-frontal, so no quad. RE-MEASURED against the
       v4 `dining.webp`, where both boards are roughly twice the size they were:
       each glass is now 21.6% of the plate wide (was 15.8 / 14.4) and both sit
       on a shared top edge at plate-Y 24.33% and a shared bottom at 46.19%,
       which is the line theme.css §08a hangs the title card under.
       `width` is the VIRTUAL viewport the deck is rendered at before being
       scaled into the glass: the decks size their type in vw against a 1400px
       column, so 960 makes the content itself come out about a third larger
       than the old 1280 did, while still clearing the deck's own 900px compact
       breakpoint. */
    { slug:'wtw-chicago',   kind:'screen', mode:'live', width:960,
      x:26.96, y:24.33, w:21.66, h:21.86, label:'Win the Weekend — Chicago' },
    { slug:'wtw-big-south', kind:'screen', mode:'live', width:960,
      x:51.38, y:24.33, w:21.58, h:21.86, label:'Win the Weekend — Big South' },
    { slug:'nps',           kind:'tool',   x:77.5, y:25.5, w:18.5, h:25.0, label:'NPS Report', edge:'right' },
  ],
  prep: [
    { slug:'porting-guide', kind:'tool', x:24.0, y:33.5, w:9.0, h:12.0, label:'PortPro — Porting Guide' },
    { slug:'credit-limit',  kind:'tool', x:35.0, y:33.5, w:7.5, h:11.0, label:'Credit Limit Increase' },
    { slug:'bapis',         kind:'tool', x:43.5, y:34.5, w:6.5, h:10.0, label:'Online Order Processing' },
    { slug:'bp-access',     kind:'tool', x:51.0, y:35.0, w:5.0, h: 9.0, label:'Report BP Access Issues' },
  ],
  office: [
    /* THE BACK OFFICE MONITOR — days since the last detractor, one district per
       slide, from the Daily Sales Report's own nps-detractor-streaks.json.

       ── RE-SHOT 2026-08-27, THIRD COMPOSITION ────────────────────────────
       The client: "I love the TV screen but it's crooked. Also, it's still
       kind of small. I would love for it to be larger if possible since the
       information is important."

       Both were true and both were in the photograph, not the code. The room
       is now shot in symmetrical one-point perspective with the camera square
       to the back wall, so the display is a genuine rectangle:
         glass  x 35.50 → 64.46,  y 22.39 → 51.79
         left edge 29.10 tall, right edge 29.03  →  0.3% skew (was 23.3%)
         area 8.51% of frame (was 7.2%) — 18% bigger, 29% wider
       At 0.3% there is nothing to correct, so `quad` is GONE and this is a
       plain box. That matters: screens.js only applies its homography when a
       quad is present, so a flat panel now renders flat instead of being
       warped onto a plane it doesn't need. Inset ~0.5% off the traced glass so
       the mount sits inside the bezel. */
    { slug:'daily-sales', kind:'screen', mode:'feed',
      x:36.0, y:22.9, w:28.0, h:28.4,
      label:'Days Since Last Detractor' },

    /* The right-hand brick wall was re-measured against the same new plate.
       Its objects are larger and closer than in the previous composition,
       which is what keeps their printed labels legible — see labels.js. */
    { slug:'printouts',        kind:'tool', x:78.1, y:35.0, w:7.9, h:17.2, label:'Print Outs', edge:'right' },
    { slug:'exception-report', kind:'tool', x:85.6, y:36.8, w:4.4, h:20.0, label:'Exception Report', edge:'right' },
    { slug:'fall-off',         kind:'tool', x:91.5, y:34.4, w:6.0, h:24.2, label:'Fall-Off Summary', edge:'right' },
  ],
  breakroom: [
    { kind:'chefs' },
    { slug:'training-xfinity',      kind:'tool', x:19.3, y:40.5, w:3.9, h:31.0, label:'Xfinity Product Mastery' },
    { slug:'training-straight-line',kind:'tool', x:23.4, y:40.5, w:3.9, h:31.0, label:'Sales Process 101' },
    { slug:'training-tsheet',       kind:'tool', x:27.5, y:40.5, w:3.9, h:31.0, label:'The Plus-First Playbook' },
    /* The locker bank has FOUR doors, not three — seams traced at plate-x
       17.1 / 21.5 / 25.2 / 28.5 / 32.9. The fourth was empty until the client
       asked for one more training piece, so it gets the same inset and width
       as its neighbours rather than a box invented to fit. */
    { slug:'training-pos',          kind:'tool', x:29.4, y:40.5, w:3.9, h:31.0, label:'Celestial Point of Sale' },
    { slug:'fox-run',               kind:'tool', x:88.0, y:33.0, w:12.0, h:60.0, label:'C³ FOX RUN', edge:'right' },
  ],
  freezer: [
    { kind:'lock', x:34.3, y:47.0, w:2.6, h:8.0, label:'Manager access' },
  ],
};

/* The five picture-frame mat openings on the break-room wall, measured off the
   render.  chefwall.js drops chefs[i] into frames[i] — order is the contract. */
export const CHEF_FRAMES = [
  { x:33.53, y:41.72, w:4.09, h:11.11, rotate:0 },
  { x:40.80, y:41.72, w:4.09, h:11.11, rotate:0 },
  { x:48.07, y:41.72, w:4.09, h:11.11, rotate:0 },
  { x:55.34, y:41.72, w:4.09, h:11.11, rotate:0 },
  { x:62.61, y:41.72, w:4.09, h:11.11, rotate:0 },
];


/* ═══════════════════════════════════════════════════════════════════════════
   THE WALK-IN DOOR  ·  geometry for assets/freezer.js
   ═══════════════════════════════════════════════════════════════════════════
   `plates/freezer-door.webp` is the CLOSED state of the freezer room: the
   insulated door head-on, frost around the seal, cold vapour at the floor, an
   industrial keypad on the wall to its right.  `plates/freezer.webp` (the room
   plate above) is the interior it opens onto.

   Every box below is PERCENT OF THE DOOR PLATE, exactly like HOTSPOTS — x/y is
   the top-left corner, w/h the size.  freezer.js reads nothing else; there is
   not one pixel value in that module.

     leaf     the swinging slab.  Its own box, not the frame's.
     opening  the aperture behind the leaf — the hole you see the freezer
              through.  Normally the leaf inset by the jamb reveal.
     keypad   the industrial keypad on the wall.  Becomes the tap target, so it
              is padded out to 44px by freezer.js if the art draws it smaller.
     handle   the lever, in plate % — the latch beat plays here.
     hinge    'left' | 'right' — which edge the leaf pivots on.
     swing    degrees of rotateY at full open.  NEGATIVE swings the leading
              edge TOWARD the camera on a left hinge (a walk-in door pulls
              out); flip the sign for a door that opens away.
     thickness the insulated slab's depth, in plate % of WIDTH.  Drawn as the
              leaf's side face once it is off the jamb.
     vanish   where the camera's optical centre sits in the plate, in plate %.
              Drives perspective-origin so the leaf rotates about the right
              vanishing point instead of about its own middle.
     fitPad   extra plate % around (leaf ∪ keypad) that the portrait/narrow
              presentation keeps in frame.  See freezer.js §"THE NARROW FIT".
     fitY     0..1 — where the vertical centre of that region sits in the
              stage on narrow viewports.  0.38 lifts the door clear of the
              chip drawer theme.css §17 puts across the bottom.

   ── MEASURED AGAINST THE FINAL ART ────────────────────────────────────────
   `plates/freezer-door.webp` (2400x1340) is the real generated plate now, not
   the stand-in, and every number below was traced off its pixels rather than
   eyeballed. Method: for each candidate seam, walk the plate row by row (or
   column by column) and take the position of the strongest luminance gradient
   inside a +/-14px window, then take the mean of the run and reject outliers.
   The four leaf edges came out with a standard deviation of 0.8-2.4px across
   100+ samples each, i.e. better than 0.1% of the plate:

     leaf left seam    923.2px  38.47%   (sd 2.4 - the hinge straps nudge it)
     leaf right seam  1478.9px  61.62%   (sd 0.8)
     leaf top           144.0px 10.75%   (sd 1.7)
     leaf bottom       1250.1px 93.29%   (sd 2.3)
     frame outer L/R   28.10% / 71.52%   jamb stop L/R  35.35% / 64.65%

   THE HINGE IS ON THE LEFT, and this is observation, not inheritance: there
   are two chrome strap hinges on the leaf's left edge, at plate-Y 15% and 82%,
   each with its barrel sitting on the jamb at x 36.9-37.9% and its strap
   bolted across the leaf. The long chrome pull runs down the leaf's RIGHT side
   at x 59.2-59.8%, and the latch lever's keeper is bolted to the jamb strip at
   x 61.6-64.7% — hardware on the right, pivot on the left. So `hinge: 'left'`
   with a NEGATIVE swing stands: the leading edge is the latch edge and it
   comes out at the camera, which is what a walk-in door does.

   THE PLATE IS FRONTAL AND THE DOOR IS DEAD CENTRE, so `vanish` is the plate's
   own optical centre. The evidence: the leaf's midline is 50.05%, the jamb
   stops straddle 50.00%, the frame's outer edges straddle 49.81%, and the two
   jamb reveals either side of the leaf are 3.12% and 3.03% wide — equal to
   within a pixel and a half, which puts the camera axis at x 50.2%. Every
   horizontal in the shot (the brick band's foot at 54.9%, the floor line at
   97.0%) is flat to within 0.1% right across the frame, so there is no
   vertical convergence to read and no reason to offset the centre either way.
   vanish is therefore (50, 50) — the middle of the picture — where it used to
   be pulled to (50, 46) against a stand-in whose door sat left of centre.

   THE MAGNIFICATION STILL LANDS. `vanish` aims the projection; the SIZE of the
   leading edge at full travel is set by the leaf's width against the
   leafwrap's `perspective: 74cqw`. At swing -78 the leading edge ends up at
   z = leaf.w * sin(78) = 0.978 * leaf.w, so it magnifies by d / (d - z):

     1440x900   plate 1611.9px   leaf 374.1px   z 365.9   d 1065.6   x1.52
     1280x800   plate 1432.8px   leaf 332.6px   z 325.3   d  947.2   x1.52
     1920x1080  plate 1934.3px   leaf 448.9px   z 439.1   d 1420.8   x1.45

   which is the ~1.5x the swing curve and the through-the-doorway beat were
   authored around. The stand-in's 26%-wide leaf gave 1.63x, so the new,
   correctly narrower leaf brings it back rather than pushing it off; `swing`
   does not need re-tuning and is left at -78.

   `thickness` is the one number the art cannot show, because the slab's edge
   is hidden while the door is shut. It is derived instead: the leaf is 82.55%
   of a 1340px plate, and a walk-in leaf is about 1.98m tall, which puts the
   whole plate at 2.40m x 4.30m — and independently makes the leaf 1.00m wide,
   a standard 39" walk-in door, so the scale is consistent. A 4" insulated
   slab is 0.102m, i.e. 2.4% of the plate's width. freezer.js applies this in
   cqw rather than plate %, which at a desktop viewport is within ~10% of the
   same thing, so 2.3 is the value that draws a believable 3.5-4" edge.
   ⚠ `handle` is measured (the latch lever's centre, where the bolt lets go)
   but nothing reads it today — freezer.js drives the latch beat off the leaf
   as a whole. It is kept because it is the right place for that beat to land
   if the strain is ever localised, and because it documents the art.
   ═══════════════════════════════════════════════════════════════════════════ */
export const FREEZER_DOOR = {
  plate:     'plates/freezer-door.webp',
  srcset:    'plates/freezer-door@1400.webp 1400w, '
           + 'plates/freezer-door@1800.webp 1800w, '
           + 'plates/freezer-door.webp 2400w',
  /* the slab: 38.45 -> 61.65 across, 10.75 -> 93.30 down */
  leaf:      { x: 38.45, y: 10.75, w: 23.20, h: 82.55 },
  /* the leaf inset by the jamb reveal, so it stays hidden behind the slab */
  opening:   { x: 39.55, y: 11.85, w: 21.00, h: 80.35 },
  /* the industrial keypad on the frame pilaster, chest height, right of the
     door: housing 65.30 -> 68.75 across, 39.20 -> 47.15 down */
  keypad:    { x: 65.30, y: 39.20, w:  3.45, h:  7.95 },
  /* the latch lever, where it meets its keeper */
  handle:    { x: 60.90, y: 52.80 },
  hinge:     'left',
  swing:     -78,
  thickness: 2.3,
  vanish:    { x: 50.0, y: 50.0 },
  fitPad:    3.5,
  fitY:      0.38
};

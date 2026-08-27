/* ============================================================================
   rooms.js — room composition + hotspot geometry
   ----------------------------------------------------------------------------
   Every box is expressed in PERCENT OF THE PLATE (x, y = top-left corner;
   w, h = size).  These numbers were measured off the actual 5504x3072 renders
   with a percentage grid, not guessed — see /root/ccc-build/grid.py.

   kind:
     'tool'   -> a clickable object that opens the tool full-screen
     'screen' -> a live dashboard mounted onto a blank TV in the photograph
     'chefs'  -> the head chef wall (owned by chefwall.js)
     'lock'   -> the freezer keypad
   `quad` (TL, TR, BR, BL in plate %) is supplied where the object sits on a
   wall at an angle, so the mounted iframe is warped to the screen's plane
   instead of floating in front of it.
   ========================================================================== */

export const ROOM_ORDER = ['pass','host','dining','prep','office','breakroom','freezer'];

export const HOTSPOTS = {
  pass: [
    { slug:'quote-6th-gen',   kind:'tool', x:21.0, y:61.5, w:11.0, h:12.0, label:'6th Gen Quote Sheet' },
    { slug:'quote-upgrade',   kind:'tool', x:45.0, y:61.5, w: 9.5, h:11.5, label:'Upgrade Quote Sheet' },
    { slug:'quote-internet',  kind:'tool', x:67.5, y:61.5, w:10.0, h:11.5, label:'Internet Quote Sheet' },
    { slug:'discount-close',  kind:'tool', x:76.0, y:76.0, w:14.5, h: 8.0, label:'The Mobile Discount Close', edge:'right bottom' },
  ],
  host: [
    { slug:'daily-sales', kind:'screen', x:47.0, y:5.6, w:37.0, h:53.0, label:'Daily Sales Report',
      quad:[[47.6,21.4],[82.0,11.2],[82.0,57.8],[47.3,55.8]] },
    { slug:'tsheet-submissions',    kind:'tool', x:26.0, y:55.5, w: 7.5, h:13.0, label:'T-Sheet Submissions' },
    { slug:'commission-payouts',    kind:'tool', x:44.0, y:61.0, w: 6.5, h:14.0, label:'Commission Payouts 2026' },
    { slug:'yesterdays-conversion', kind:'tool', x:14.0, y:68.0, w:24.0, h:14.0, label:"Yesterday's Conversion", edge:'bottom' },
  ],
  dining: [
    { slug:'wtw-chicago',   kind:'screen', x:32.0, y:27.6, w:15.8, h:17.2, label:'Win the Weekend — Chicago' },
    { slug:'wtw-big-south', kind:'screen', x:52.5, y:27.7, w:14.4, h:15.0, label:'Win the Weekend — Big South' },
    { slug:'nps',           kind:'tool',   x:77.5, y:25.5, w:18.5, h:25.0, label:'NPS Report', edge:'right' },
  ],
  prep: [
    { slug:'porting-guide', kind:'tool', x:24.0, y:33.5, w:9.0, h:12.0, label:'PortPro — Porting Guide' },
    { slug:'credit-limit',  kind:'tool', x:35.0, y:33.5, w:7.5, h:11.0, label:'Credit Limit Increase' },
    { slug:'bapis',         kind:'tool', x:43.5, y:34.5, w:6.5, h:10.0, label:'Online Order Processing' },
    { slug:'bp-access',     kind:'tool', x:51.0, y:35.0, w:5.0, h: 9.0, label:'Report BP Access Issues' },
  ],
  office: [
    { slug:'printouts',        kind:'tool', x:70.0, y:55.0, w:18.5, h:24.0, label:'Print Outs', edge:'right' },
    { slug:'exception-report', kind:'tool', x:78.0, y:20.5, w: 8.5, h:22.5, label:'Exception Report', edge:'right' },
    { slug:'fall-off',         kind:'tool', x:87.0, y:18.5, w: 8.5, h:22.5, label:'Fall-Off Summary', edge:'right' },
  ],
  breakroom: [
    { kind:'chefs' },
    { slug:'training-xfinity',      kind:'tool', x:19.3, y:40.5, w:3.9, h:31.0, label:'Xfinity Product Mastery' },
    { slug:'training-straight-line',kind:'tool', x:23.4, y:40.5, w:3.9, h:31.0, label:'Sales Process 101' },
    { slug:'training-tsheet',       kind:'tool', x:27.5, y:40.5, w:3.9, h:31.0, label:'The Plus-First Playbook' },
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

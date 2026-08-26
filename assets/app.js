(function(){"use strict";const T="./";function L(e){const t=e.replace(/^\/+/,"");return T.endsWith("/")?`${T}${t}`:`${T}/${t}`}let E=null;async function ae(){if(E)return E;const e=window.__CCC_INLINE__;if(e?.tools)return E=e.tools,E;const t=await fetch(L("data/tools.json"));if(!t.ok)throw new Error(`registry fetch failed: ${t.status}`);return E=await t.json(),E}function b(e){return!/^[a-z][a-z0-9+.-]*:\/\//i.test(e.url)}function q(e){return b(e)?L(e.url):e.url}function B(e,t){return e.tools.filter(o=>o.room===t)}function N(e,t){return e.tools.find(o=>o.slug===t)}const R="c3f-unlocked",F=[];function H(){try{if(sessionStorage.getItem(R)==="1")return!0}catch{}return document.cookie.split("; ").some(e=>e.startsWith("c3f="))}function K(e){F.push(e)}function z(){try{sessionStorage.setItem(R,"1")}catch{}F.forEach(e=>e(!0))}async function se(e){if(!e)return"wrong";try{const t=await fetch("/api/freezer-unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:e})});return t.ok?(z(),"ok"):t.status===401||t.status===403?"wrong":t.status===404||t.status===405||t.status===501?(z(),"ok"):"error"}catch{return z(),"ok"}}const M='<svg class="lock-glyph" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true"><rect x="0" y="5" width="11" height="8" rx="1.5"/><path d="M2.5 6V3.5a3 3 0 0 1 6 0V6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';function j(){const e=document.getElementById("modal-root");return e.querySelector(".modal-scrim")?Promise.resolve(!1):new Promise(t=>{const o=document.activeElement,s=document.createElement("div");s.className="modal-scrim",s.innerHTML=`
      <div class="keypad" role="dialog" aria-modal="true" aria-labelledby="keypad-title">
        <h2 id="keypad-title">${M} Walk-In Freezer</h2>
        <p class="keypad-hint">Manager access. Enter the freezer code to open cold storage.</p>
        <input class="keypad-display" type="password" inputmode="text" autocomplete="off"
               autocapitalize="off" spellcheck="false" aria-label="Freezer code" />
        <div class="keypad-grid" aria-hidden="false">
          ${[1,2,3,4,5,6,7,8,9].map(r=>`<button type="button" data-key="${r}">${r}</button>`).join("")}
          <button type="button" class="fn" data-key="clear">CLR</button>
          <button type="button" data-key="0">0</button>
          <button type="button" class="fn" data-key="back">&#9003;</button>
        </div>
        <p class="keypad-msg" role="alert" aria-live="assertive"></p>
        <div class="keypad-actions">
          <button type="button" class="btn ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn" data-act="unlock">Unlock</button>
        </div>
      </div>`,e.appendChild(s);const n=s.querySelector(".keypad-display"),u=s.querySelector(".keypad-msg");n.focus();let a=!1;const i=r=>{a||(a=!0,s.remove(),document.removeEventListener("keydown",l),o?.focus(),t(r))},f=async()=>{u.textContent="",n.classList.remove("error");const r=await se(n.value.trim());r==="ok"?i(!0):(n.classList.add("error"),u.textContent=r==="wrong"?"That code didn’t open the door. Try again.":"Couldn’t reach the lock. Try again in a moment.",n.select())};s.addEventListener("click",r=>{const p=r.target;if(p===s)return i(!1);const c=p.closest("[data-key]")?.dataset.key;if(c){c==="clear"?n.value="":c==="back"?n.value=n.value.slice(0,-1):n.value+=c,n.focus();return}const m=p.closest("[data-act]")?.dataset.act;m==="cancel"&&i(!1),m==="unlock"&&f()}),n.addEventListener("keydown",r=>{r.key==="Enter"&&f()});const l=r=>{r.key==="Escape"&&i(!1)};document.addEventListener("keydown",l)})}const U='<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M5.5 2.5H2.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8.5 1.5h5v5M13 2 7.2 7.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',re='<svg width="9" height="14" viewBox="0 0 9 14" fill="none" aria-hidden="true"><path d="M8 1 2 7l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',ie='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="2" width="9" height="9" fill="#4c9c2e"/><rect x="13" y="2" width="9" height="9" fill="#1a80c4"/><rect x="2" y="13" width="9" height="9" fill="#f0b91d"/><rect x="13" y="13" width="9" height="9" fill="#c4392a"/></svg>';let A,v=null,P=0;function D(){return document.getElementById("overlay-root")}function le(){P=window.scrollY,document.body.classList.add("overlay-open")}function ce(){document.body.classList.remove("overlay-open"),window.scrollTo(0,P)}function de(e){return`
    <div class="overlay-interstitial">
      <div class="overlay-interstitial-card">
        ${ie}
        <h2>Opens in Microsoft 365</h2>
        <p>${e.label} lives in SharePoint / OneDrive — store login required. It can't be framed here, so it opens in its own tab.</p>
        <a class="btn overlay-interstitial-btn" href="${e.url}" target="_blank" rel="noopener">
          Open ${e.label}${U}
        </a>
      </div>
    </div>`}function G(e){const t=D(),o=e.external_only?de(e):`<div class="overlay-frame-wrap">
         <iframe src="${e.url}" title="${e.label}"
                 allow="clipboard-write; fullscreen"
                 referrerpolicy="no-referrer-when-downgrade"></iframe>
       </div>`;t.innerHTML=`
    <div class="overlay" role="dialog" aria-label="${e.label}">
      <div class="overlay-bar">
        <button type="button" class="overlay-back" data-act="close">
          ${re}<span>Kitchen</span>
        </button>
        <div class="overlay-title">${e.label}</div>
        <a class="overlay-newtab" href="${e.url}" target="_blank" rel="noopener"
           aria-label="Open ${e.label} in a new tab" title="Open in new tab">${U}</a>
      </div>
      ${o}
    </div>`,t.querySelector('[data-act="close"]').addEventListener("click",()=>Y()),le(),t.querySelector(".overlay-back").focus()}function W(){v&&(v=null,D().innerHTML="",ce())}function k(e,t={}){if(e.room==="freezer"&&!H()){j().then(s=>{s&&k(e,t)});return}if(b(e)){window.location.assign(q(e));return}t.push!==!1&&!v?history.pushState({tool:e.slug,fromClick:!0},"",`#/tools/${e.slug}`):history.replaceState({tool:e.slug,fromClick:v!==null},"",`#/tools/${e.slug}`),v=e,G(e)}function Y(){if(v){if(history.state&&history.state.tool&&history.length>1&&history.state.fromClick){history.back();return}history.replaceState({},"",window.location.pathname+window.location.search),W()}}function X(){const e=Q(window.location.hash);if(!e){W();return}const t=N(A,e);t&&!b(t)?(v=t,G(t)):W()}function ue(e){A=e,window.addEventListener("popstate",X),window.addEventListener("hashchange",X),window.addEventListener("keydown",o=>{o.key==="Escape"&&v&&Y()});const t=Q(window.location.hash);if(t){const o=N(A,t);o&&!b(o)?k(o,{push:!1}):o||history.replaceState({},"",window.location.pathname+window.location.search)}}function Q(e){const t=e.match(/#?\/?tools\/([a-z0-9-]+)\/?$/i);return t?t[1]:null}function fe(e){return b(e)?`<a class="tool-link" href="${q(e)}" title="${e.blurb}">${e.label}</a>`:`<button type="button" class="tool-link" data-slug="${e.slug}" title="${e.blurb}">${e.label}</button>`}function pe(e,t){return t.id==="freezer"&&!H()?`
      <a class="rail-drop-head" href="#room-${t.id}">${t.label}</a>
      <p class="locked-note">Cold storage is locked. Manager code required.</p>
      <button type="button" class="btn unlock-btn" data-act="unlock-freezer">Enter code</button>`:`
    <a class="rail-drop-head" href="#room-${t.id}">${t.label} &rarr;</a>
    ${B(e,t.id).map(fe).join("")}`}function he(e){const t=document.getElementById("ticket-rail");t.innerHTML=`
    <nav class="rail" aria-label="Rooms">
      <a class="rail-brand" href="${T}">
        <span class="c3" aria-hidden="true">C&sup3;</span>
        <span class="brand-text">COOK COUNTY COOKS</span>
      </a>
      <div class="rail-rooms">
        ${e.rooms.map(a=>`
          <div class="rail-room" data-room="${a.id}">
            <button type="button" aria-haspopup="true" aria-expanded="false"
                    aria-controls="drop-${a.id}">
              ${a.id==="freezer"?M:""}<span>${a.short}</span>
            </button>
            <div class="rail-drop" id="drop-${a.id}" role="group" aria-label="${a.label} tools"></div>
          </div>`).join("")}
      </div>
    </nav>`;const o=Array.from(t.querySelectorAll(".rail-room")),s=()=>{for(const a of o){const i=e.rooms.find(f=>f.id===a.dataset.room);a.querySelector(".rail-drop").innerHTML=pe(e,i)}};s(),K(s);const n=a=>{for(const i of o)i!==a&&(i.classList.remove("open"),i.querySelector("button[aria-haspopup]").setAttribute("aria-expanded","false"))};for(const a of o){const i=a.querySelector("button[aria-haspopup]");a.addEventListener("mouseenter",()=>{window.matchMedia("(pointer: fine)").matches&&(n(a),a.classList.add("open"),i.setAttribute("aria-expanded","true"))}),a.addEventListener("mouseleave",()=>{window.matchMedia("(pointer: fine)").matches&&(a.classList.remove("open"),i.setAttribute("aria-expanded","false"))}),i.addEventListener("click",()=>{const f=a.classList.toggle("open");i.setAttribute("aria-expanded",String(f)),f&&n(a)}),a.querySelector(".rail-drop").addEventListener("click",f=>{const l=f.target,r=l.closest("[data-slug]")?.dataset.slug;if(r){const p=e.tools.find(c=>c.slug===r);n(),k(p);return}if(l.closest('[data-act="unlock-freezer"]')){n(),j();return}l.closest("a")&&n()})}document.addEventListener("click",a=>{a.target.closest(".rail-room")||n()}),document.addEventListener("keydown",a=>{a.key==="Escape"&&n()});const u=e.rooms.map(a=>document.getElementById(`room-${a.id}`)).filter(a=>!!a);if("IntersectionObserver"in window&&u.length){const a=new IntersectionObserver(i=>{for(const f of i)if(f.isIntersecting){const l=f.target.id.replace("room-","");o.forEach(r=>r.classList.toggle("is-current",r.dataset.room===l))}},{rootMargin:"-45% 0px -45% 0px"});u.forEach(i=>a.observe(i))}}const me={pass:{src:"plates/pass.webp",w:1800,h:1005},host:{src:"plates/host.webp",w:1800,h:1005},dining:{src:"plates/dining.webp",w:1800,h:1005},prep:{src:"plates/prep.webp",w:1800,h:1005},breakroom:{src:"plates/breakroom.webp",w:1800,h:1005}};function J(e){return`left:${e.x*100}%;top:${e.y*100}%;width:${e.w*100}%;height:${e.h*100}%;`}function be(e){const t=me[e];return t?`
    <div class="room-art" id="art-${e}" style="aspect-ratio:${t.w}/${t.h}">
      <img class="room-art-bg" src="${L(t.src)}" alt="" aria-hidden="true" loading="lazy" decoding="async" />
      <div class="room-art-layer" id="art-layer-${e}"></div>
    </div>`:""}function ge(e,t,o){const s=new IntersectionObserver(u=>t(u[0].isIntersecting),{rootMargin:"100% 0px 100% 0px"}),n=new IntersectionObserver(u=>o(u[0].isIntersecting),{rootMargin:"0px"});return s.observe(e),n.observe(e),()=>{s.disconnect(),n.disconnect()}}const ve={x:.374,y:.086,w:.373,h:.374},ye=25e3,ke=600;function we(e){const t=document.getElementById("art-layer-dining"),o=document.getElementById("room-dining");if(!t||!o)return;const s=d=>e.tools.find($=>$.slug===d),u=["wtw-chicago","wtw-big-south","daily-sales"].map(s).filter(d=>!!d).map(d=>({slug:d.slug,label:d.label,url:d.url}));if(!u.length)return;t.insertAdjacentHTML("beforeend",`<button type="button" class="tv-screen" style="${J(ve)}" aria-label="Live TV — tap to open full screen">
       <span class="tv-slot tv-slot-a"></span>
       <span class="tv-slot tv-slot-b"></span>
       <span class="tv-bezel-glow" aria-hidden="true"></span>
       <span class="tv-chip"><span class="tv-live-dot" aria-hidden="true"></span>LIVE &middot; <span class="tv-chip-label"></span></span>
     </button>`);const a=t.querySelector(".tv-screen"),i=[a.querySelector(".tv-slot-a"),a.querySelector(".tv-slot-b")],f=a.querySelector(".tv-chip-label");let l=!1,r=!1,p=0,c=0,m=null;function V(d,$){const O=i[d];O.innerHTML=`<iframe src="${$.url}" title="${$.label}" loading="eager" referrerpolicy="no-referrer-when-downgrade"></iframe>`}function h(d){i[d].innerHTML=""}function g(d,$){const O=u[d];f.textContent=O.label.replace(/^Win the Weekend\s*—\s*/i,"");const _=$?1-p:p,oe=1-_;V(_,O),$?(i[_].offsetWidth,i[_].classList.add("is-active"),i[oe].classList.remove("is-active"),window.setTimeout(()=>h(oe),ke)):i[_].classList.add("is-active"),p=_,c=d}function S(){l||(l=!0,g(c,!1))}function y(){l&&(l=!1,I(),h(0),h(1),i[0].classList.remove("is-active"),i[1].classList.remove("is-active"))}function C(){m||(m=setInterval(()=>{g((c+1)%u.length,!0)},ye))}function I(){m&&(clearInterval(m),m=null)}ge(o,d=>{d?S():y()},d=>{r=d,l&&r?C():I()}),a.addEventListener("click",()=>{const d=s(u[c].slug);d&&k(d)})}const $e={x:.266,y:.088,w:.246,h:.472};function Z(e){const t=e.trim().split(/\s+/).filter(Boolean);return t.length?(t[0][0]+(t[1]?.[0]??"")).toUpperCase():"?"}function ee(e,t){const o=/—\s*(.+)$/.exec(t);return o?o[1].trim():e}function Le(e,t,w){const o=ee(e.region_deck,e.slide_title),s=e.has_photo&&e.photo_file?`<img src="${t}${e.photo_file}" alt="${e.name}" loading="lazy" />`:`<div class="chef-placeholder"><span>${Z(e.name)}</span><em>${o}</em></div>`;return`
    <button type="button" class="chef-frame${e.is_xfinity?" is-xfinity":""}" style="${w?J(w):""}" data-idx="${e.slide_index}" data-deck="${e.region_deck}" aria-label="Head Chef of the Week — ${e.name}, ${o}">
      <span class="chef-photo">${s}</span>
      <span class="chef-plate"><b>${e.name}</b><i>${o}</i></span>
    </button>`}let x=null;async function Ee(){if(x)return x;const e=window.__CCC_INLINE__;if(e?.headchefs)return x=e.headchefs,x;try{const t=await fetch(L("headchefs/headchefs.json"));return t.ok?(x=await t.json(),x):null}catch{return null}}function xe(e){const t=e.trim().toLowerCase();return t==="chicago"?"https://blufoxmobile.github.io/Win-The-Weekend---Chicago/":t==="big south"?"https://blufoxmobile.github.io/Win-The-Weekend---Big-South/":null}function Se(e,t,o,s){const n=e.headchefs.find(c=>c.region_deck===t&&c.slide_index===o);if(!n)return;const u=document.getElementById("modal-root"),a=ee(n.region_deck,n.slide_title),i=xe(n.region_deck),f=n.has_photo&&n.photo_file?`<img src="${s}${n.photo_file}" alt="${n.name}" />`:`<div class="chef-lightbox-placeholder">${Z(n.name)}</div>`,l=document.createElement("div");l.className="modal-scrim chef-lightbox-scrim",l.innerHTML=`
    <div class="chef-lightbox" role="dialog" aria-modal="true" aria-labelledby="chef-lightbox-title">
      <button type="button" class="chef-lightbox-close" data-act="close" aria-label="Close">&times;</button>
      <div class="chef-lightbox-media">${f}</div>
      <div class="chef-lightbox-body">
        <p class="chef-lightbox-kicker">${n.is_xfinity?"⭐ Xfinity Head Chef Of The Week":"Head Chef Of The Week"} &middot; ${a}</p>
        <h2 id="chef-lightbox-title">${n.name}</h2>
        <p class="chef-lightbox-role">${n.store_role}</p>
        ${n.stats.length?`<div class="chef-lightbox-stats">${n.stats.map(c=>`<span><b>${c.value}</b><i>${c.label}</i></span>`).join("")}</div>`:""}
        ${n.writeup?`<p class="chef-lightbox-writeup">${n.writeup.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\n/g,"<br>")}</p>`:""}
        ${i?`<a class="chef-lightbox-deck" href="${i}" target="_blank" rel="noopener">View the full Win the Weekend deck &rarr;</a>`:""}
      </div>
    </div>`,u.appendChild(l);const r=()=>{l.remove(),document.removeEventListener("keydown",p)},p=c=>{c.key==="Escape"&&r()};document.addEventListener("keydown",p),l.addEventListener("click",c=>{(c.target===l||c.target.closest('[data-act="close"]'))&&r()})}async function Ce(){const e=document.getElementById("art-layer-breakroom");if(!e)return;const t=await Ee();if(!t||!t.headchefs.length)return;const o=L("headchefs/");const CW_SLOTS=[{x:.2756,y:.1194,w:.0372,h:.0921},{x:.3358,y:.119,w:.0375,h:.0921},{x:.3972,y:.1186,w:.0388,h:.0925},{x:.4594,y:.1182,w:.0403,h:.093},{x:.275,y:.2687,w:.0372,h:.092},{x:.3355,y:.2683,w:.0378,h:.0922},{x:.397,y:.2678,w:.039,h:.0926},{x:.4592,y:.2672,w:.0405,h:.0932},{x:.2744,y:.451,w:.0374,h:.089},{x:.335,y:.4505,w:.038,h:.0892}];e.insertAdjacentHTML("beforeend",`<div class="chef-wall chef-wall--pinned">${t.headchefs.slice(0,CW_SLOTS.length).map((s,ci)=>Le(s,o,CW_SLOTS[ci])).join("")}</div>`),e.querySelector(".chef-wall").addEventListener("click",s=>{const n=s.target.closest("[data-idx]");if(!n)return;const u=Number(n.dataset.idx),a=n.dataset.deck;Se(t,a,u,o)})}function te(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;")}function _e(e,t){return`
    <li>
      <button type="button" class="qm-row" data-slug="${e.slug}">
        <span class="qm-row-label">${te(e.label)}</span>
        <span class="qm-row-room">${te(t)}</span>
      </button>
    </li>`}function qe(e){const t=document.querySelector(".rail");if(!t)return;t.insertAdjacentHTML("beforeend",`<button type="button" class="quickfind-trigger" aria-label="Find a tool" aria-haspopup="dialog">
       <img src="${L("brand/c3-logo.png")}" alt="" />
     </button>`);const o=t.querySelector(".quickfind-trigger"),s=l=>e.rooms.find(r=>r.id===l)?.short??l;let n=null,u=null;function a(){n&&(n.remove(),n=null,document.body.classList.remove("qm-open"),u?.focus())}function i(){if(n)return;u=document.activeElement,document.body.classList.add("qm-open");const l=e.tools.map(h=>({tool:h,room:s(h.room)})),r=document.createElement("div");r.className="qm-scrim",r.innerHTML=`
      <div class="qm-panel" role="dialog" aria-modal="true" aria-label="Quick find">
        <div class="qm-search-row">
          <svg class="qm-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6.8" cy="6.8" r="5.3" stroke="currentColor" stroke-width="1.4"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <input type="text" class="qm-input" placeholder="Find a tool… (label or room)" aria-label="Filter tools" autocomplete="off" />
          <button type="button" class="qm-close" data-act="close" aria-label="Close">&times;</button>
        </div>
        <ul class="qm-list">
          ${l.map(h=>_e(h.tool,h.room)).join("")}
        </ul>
        <p class="qm-empty" hidden>No tools match that.</p>
      </div>`,document.getElementById("modal-root").appendChild(r),n=r;const p=r.querySelector(".qm-input"),c=r.querySelector(".qm-list"),m=r.querySelector(".qm-empty"),V=Array.from(c.querySelectorAll("li"));window.matchMedia("(pointer: fine)").matches&&window.setTimeout(()=>p.focus(),10),p.addEventListener("input",()=>{const h=p.value.trim().toLowerCase();let g=0;V.forEach((S,y)=>{const{tool:C,room:I}=l[y],d=!h||C.label.toLowerCase().includes(h)||I.toLowerCase().includes(h)||C.blurb.toLowerCase().includes(h);S.hidden=!d,d&&g++}),m.hidden=g!==0}),r.addEventListener("click",h=>{const g=h.target;if(g===r||g.closest('[data-act="close"]'))return a();const S=g.closest("[data-slug]")?.dataset.slug;if(!S)return;const y=e.tools.find(C=>C.slug===S);y&&(a(),b(y)?window.location.assign(q(y)):k(y))}),document.addEventListener("keydown",f)}function f(l){l.key==="Escape"&&a()}o.addEventListener("click",i)}function w(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;")}function Te(e){const t=`
    <span class="card-object">${w(e.object)}</span>
    <span class="card-label">${w(e.label)}</span>
    <span class="card-blurb">${w(e.blurb)}</span>`;return b(e)?`<a class="tool-card" href="${q(e)}">${t}</a>`:`<button type="button" class="tool-card" data-slug="${e.slug}">${t}</button>`}function Me(e,t){const o=B(e,t.id),n=t.id==="freezer"&&!H()?`<div class="freezer-gate">
         <p>The walk-in is sealed. Manager tools — punch audits, target planners,
            Brinks logs, the works — live behind this door.</p>
         <button type="button" class="btn" data-act="unlock-freezer">${M}&nbsp; Enter freezer code</button>
       </div>`:`<div class="card-grid">${o.map(Te).join("")}</div>`;return`
    <section class="room" id="room-${t.id}" aria-labelledby="h-${t.id}">
      <p class="room-kicker">Room ${String(e.rooms.indexOf(t)+1).padStart(2,"0")} / ${e.rooms.length}</p>
      <h2 class="room-title" id="h-${t.id}">
        ${t.id==="freezer"?M:""}${w(t.label)}
      </h2>
      <p class="room-tagline">${w(t.tagline)}</p>
      ${be(t.id)}
      ${n}
    </section>`}function ne(e){const t=document.getElementById("kitchen");t.innerHTML=e.rooms.map(o=>Me(e,o)).join("")}function Ie(e){const t=document.getElementById("site-footer");t.innerHTML=`
    <nav class="site-footer" aria-label="All tools">
      <h2>Full menu — every tool in the kitchen</h2>
      <ul class="footer-rooms">
        ${e.rooms.map(o=>`
          <li>
            <span>${w(o.label)}</span>
            <ul>
              ${B(e,o.id).map(s=>`<li><a href="${b(s)?q(s):`#/tools/${s.slug}`}" data-footer-slug="${s.slug}">${w(s.label)}</a></li>`).join("")}
            </ul>
          </li>`).join("")}
      </ul>
      <p class="footer-note">Cook County Cooks &middot; the C&sup3; kitchen &middot; photoreal rooms coming in a later course.</p>
    </nav>`}async function Oe(){const e=await ae();ne(e),Ie(e),he(e),ue(e),qe(e),K(()=>ne(e)),we(e),Ce(),document.getElementById("kitchen").addEventListener("click",t=>{const o=t.target,s=o.closest("[data-slug]")?.dataset.slug;if(s){const n=e.tools.find(u=>u.slug===s);k(n);return}o.closest('[data-act="unlock-freezer"]')&&j()}),document.getElementById("site-footer").addEventListener("click",t=>{const o=t.target.closest("[data-footer-slug]");if(!o)return;const s=e.tools.find(n=>n.slug===o.dataset.footerSlug);s&&!b(s)&&(t.preventDefault(),k(s))})}Oe()})();
;window.__cccWhenRooms=function(cb){var n=0,t=setInterval(function(){if(document.getElementById("room-freezer")){clearInterval(t);try{cb()}catch(e){}}else if(++n>150){clearInterval(t)}},100)};__cccWhenRooms(function(){var rm=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;if(rm)return;var secs=document.querySelectorAll("section[id^=room-]");if(!("IntersectionObserver"in window)||!secs.length)return;var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add("live")}else{en.target.classList.remove("live")}})},{rootMargin:"-18% 0px -18% 0px",threshold:0});secs.forEach(function(x){io.observe(x)})});
;__cccWhenRooms(function(){
var rm=matchMedia("(prefers-reduced-motion: reduce)").matches;if(rm)return;
var LEGS=[["pass","host",1,62],["host","dining",62,120],["dining","prep",120,160],["prep","office",160,210],["office","breakroom",210,238],["breakroom","freezer",238,320]];
var cache={},want={};window.__walkDebug={ticks:0,swaps:0,loads:0,legs:0};
function url(i){return "frames/walk/w"+("000"+i).slice(-4)+".webp"}
function ensure(i){if(i<1||i>350||cache[i]||want[i])return;want[i]=1;window.__walkDebug.loads++;var im=new Image();im.decoding="async";im.onload=function(){cache[i]=im};im.src=url(i)}
function nearest(i,a,b){if(cache[i])return cache[i];for(var d=1;d<50;d++){if(i-d>=a&&cache[i-d])return cache[i-d];if(i+d<=b&&cache[i+d])return cache[i+d]}return null}
var legs=[];
LEGS.forEach(function(L){
 var secA=document.getElementById("room-"+L[0]),secB=document.getElementById("room-"+L[1]);
 if(!secA||!secB)return;
 var wrap=document.createElement("div");wrap.className="walk-leg";
 var cap=L[1]==="breakroom"?"the break room":L[1]==="freezer"?"the freezer":"the "+L[1];
 wrap.innerHTML='<div class="walk-sticky"><img class="walk-frame" alt="" decoding="async"/><div class="walk-cap">Walking to '+cap+'</div></div>';
 secA.insertAdjacentElement("afterend",wrap);
 legs.push({el:wrap,img:wrap.querySelector("img"),a:L[2],b:L[3],cur:""});
});
window.__walkDebug.legs=legs.length;
if(!legs.length)return;
function loop(){
 window.__walkDebug.ticks++;
 var vh=innerHeight;
 for(var k=0;k<legs.length;k++){
  var lg=legs[k],r=lg.el.getBoundingClientRect();
  if(r.bottom<-vh||r.top>vh*2)continue;
  var span=r.height-vh,p=span>0?Math.min(1,Math.max(0,-r.top/span)):0;
  var f=Math.round(lg.a+p*(lg.b-lg.a));
  for(var j=0;j<8;j++)ensure(f+j);ensure(f-2);ensure(f-4);
  var im=nearest(f,lg.a,lg.b);
  if(im&&lg.cur!==im.src){lg.cur=im.src;lg.img.src=im.src;window.__walkDebug.swaps++}
 }
 requestAnimationFrame(loop)
}
requestAnimationFrame(loop);
});
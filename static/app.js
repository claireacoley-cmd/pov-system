// ═══════════════════════════════════════
// POV SYSTEM — app.js
// ═══════════════════════════════════════

// ─── CONSTANTS ───
const DOMAINS = ["Strategy","Brand","Content","Experience","Culture","Business"];
const FUNCS   = ["belief","proof","craft","teaching"];
const SRC_TYPES = ["lived","their-story","example","perspective","pattern","data"];

const domainKeywords = {
  Strategy:   ["strategy","positioning","competitive","differentiation","market","niche","approach","plan","distinct"],
  Brand:      ["brand","voice","identity","visual","tone","logo","design","aesthetic","look"],
  Content:    ["content","post","write","article","newsletter","carousel","format","hook","headline","copy","social"],
  Experience: ["experience","space","atmosphere","physical","restaurant","bar","hotel","event","retail","touch"],
  Culture:    ["culture","taste","reference","influence","inspiration","art","music","film","vintage"],
  Business:   ["business","model","revenue","pricing","sales","go-to-market","operations","growth","direct","mail"]
};

const srcLabels = {
  "lived":      "My Story",
  "their-story":"Their Story",
  "example":    "Example",
  "perspective":"Perspective",
  "pattern":    "Pattern",
  "data":       "Data"
};

// ─── STATE ───
let S = { view:"all", belief:null, search:"", funcF:null, domF:null, srcF:null, layout:"list" };

let items   = [];
let inboxItems   = [];
let contentItems = [];
let loaded  = false;

let cap = { funcs:[], doms:[], beliefs:[], srcType:null, imageData:null, suggested:{funcs:[],doms:[],beliefs:{}} };
let capStatus = "exploring";
let think = { source:"Own thinking" };
let debounceTimer = null;

// ─── API HELPERS ───
const API = {
  items:   "/api/items",
  inbox:   "/api/inbox",
  content: "/api/content"
};

async function apiFetch(url, opts={}) {
  const res = await fetch(url, { headers:{"Content-Type":"application/json"}, ...opts });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err}`);
  }
  return res.json();
}

async function loadAll() {
  try {
    const [its, inb, cont] = await Promise.all([
      apiFetch(API.items),
      apiFetch(API.inbox),
      apiFetch(API.content)
    ]);
    items        = its  || [];
    inboxItems   = inb  || [];
    contentItems = cont || [];
    loaded = true;
    render();
  } catch(e) {
    console.error("Load error:", e);
    loaded = true; // allow render to proceed with empty data
    render();
  }
}

async function saveNewItem(item) {
  const res = await apiFetch(API.items, { method:"POST", body:JSON.stringify(item) });
  items.push(item);
  return res;
}

async function updateItem(item) {
  await apiFetch(API.items, { method:"PUT", body:JSON.stringify(item) });
  const idx = items.findIndex(i => i.id === item.id);
  if (idx >= 0) items[idx] = item;
}

async function deleteItem(id, type) {
  await apiFetch(`${API.items}?id=${id}&type=${type}`, { method:"DELETE" });
  items = items.filter(i => i.id !== id);
}

async function saveNewInbox(item) {
  await apiFetch(API.inbox, { method:"POST", body:JSON.stringify(item) });
  inboxItems.push(item);
}

async function updateInboxItem(item) {
  await apiFetch(API.inbox, { method:"PUT", body:JSON.stringify(item) });
  const idx = inboxItems.findIndex(i => i.id === item.id);
  if (idx >= 0) inboxItems[idx] = item;
}

async function deleteInboxItem(id) {
  await apiFetch(`${API.inbox}?id=${id}`, { method:"DELETE" });
  inboxItems = inboxItems.filter(i => i.id !== id);
}

async function saveNewContent(item) {
  await apiFetch(API.content, { method:"POST", body:JSON.stringify(item) });
  contentItems.push(item);
}

async function updateContentItem(item) {
  await apiFetch(API.content, { method:"PUT", body:JSON.stringify(item) });
  const idx = contentItems.findIndex(i => i.id === item.id);
  if (idx >= 0) contentItems[idx] = item;
}

// ─── HELPERS ───
const genId = (prefix) => `${prefix}${Date.now()}`;
const get   = id => items.find(i => i.id === id);
const byF   = f  => items.filter(i => i.functions.includes(f));
const bels  = () => items.filter(i => i.functions.includes("belief"));

function linked(item) {
  if (item.linkedIds && item.linkedIds.length) return item.linkedIds.map(get).filter(Boolean);
  const r = [];
  (item.supportsBelief||[]).forEach(id => { const b=get(id); if(b) r.push(b); });
  (item.relatedBelief||[]).forEach(id  => { const b=get(id); if(b) r.push(b); });
  return r;
}

function filt() {
  let f = [...items];
  if (S.belief) {
    const b = get(S.belief);
    if (b) {
      // Don't include the belief itself — it's shown in the focused belief header
      const linked_ids = new Set([...(b.linkedIds||[])]);
      items.filter(i => (i.supportsBelief||[]).includes(S.belief) || (i.relatedBelief||[]).includes(S.belief))
           .forEach(i => linked_ids.add(i.id));
      f = items.filter(i => linked_ids.has(i.id) && i.id !== S.belief);
    }
  }
  if (S.view !== "all" && !S.belief) f = f.filter(i => i.functions.includes(S.view));
  if (S.funcF) f = f.filter(i => i.functions.includes(S.funcF));
  if (S.srcF)  f = f.filter(i => i.sourceType === S.srcF);
  if (S.domF)  f = f.filter(i => (i.domains||[]).includes(S.domF));
  if (S.search) {
    const q = S.search.toLowerCase();
    f = f.filter(i => (i.title||"").toLowerCase().includes(q) || (i.body||"").toLowerCase().includes(q) || (i.whySaved||"").toLowerCase().includes(q));
  }
  return f;
}

// ─── SUGGESTION ENGINE ───
function scoreMatch(text, keywords) {
  if (!text) return 0;
  const t = text.toLowerCase();
  let score = 0;
  keywords.forEach(k => { if (t.includes(k.toLowerCase())) score++; });
  return score;
}

function runSuggestions() {
  const title    = (document.getElementById("cap-title").value||"").trim();
  const notes    = (document.getElementById("cap-notes").value||"").trim();
  const why      = (document.getElementById("cap-why").value||"").trim();
  const combined = title + " " + notes + " " + why;
  if (combined.trim().length < 8) { cap.suggested = {funcs:[],doms:[],beliefs:{}}; renderCapAll(); return; }

  // Suggest domains
  const sugDoms = [];
  DOMAINS.forEach(d => { if (scoreMatch(combined, domainKeywords[d]) >= 1) sugDoms.push(d); });

  // Suggest beliefs
  const sugBeliefs = {};
  bels().forEach(b => {
    const kw = b.keywords || [];
    const titleWords = b.title.toLowerCase().split(/\s+/);
    const allKw = [...kw, ...titleWords.filter(w => w.length > 3)];
    const s = scoreMatch(combined, allKw);
    if (s >= 1) {
      const matchedKw = allKw.filter(k => combined.toLowerCase().includes(k.toLowerCase()));
      sugBeliefs[b.id] = { score:s, reason: matchedKw.length ? `matches: ${matchedKw.slice(0,2).join(", ")}` : "" };
    }
  });

  // Suggest function
  const sugFuncs = [];
  const personalWords = ["my ","i ","i'm","we ","our ","myself"];
  const storyWords    = ["story","experience","happened","remember","built","made","created"];
  const craftWords    = ["design","visual","format","layout","carousel","screenshot","aesthetic"];
  const beliefWords   = ["believe","think","opinion","should","must","always","never","wrong","right"];
  const proofWords    = ["example","proves","shows","evidence","because","demonstrates","case study"];

  if (scoreMatch(combined, beliefWords) >= 1) sugFuncs.push("belief");
  if (scoreMatch(combined, proofWords) >= 1 || scoreMatch(combined, storyWords) >= 1 || Object.keys(sugBeliefs).length > 0) sugFuncs.push("proof");
  if (scoreMatch(combined, craftWords) >= 1) sugFuncs.push("craft");
  if (sugFuncs.length === 0 && Object.keys(sugBeliefs).length > 0) sugFuncs.push("proof");

  // Suggest source type
  let sugSrc = null;
  if (sugFuncs.includes("proof")) {
    if (scoreMatch(combined, personalWords) >= 1) sugSrc = "lived";
    else if (scoreMatch(combined, ["she said","he said","they said","told me","in an interview","podcast","their experience","founder said","ceo said"]) >= 1) sugSrc = "their-story";
    else if (scoreMatch(combined, ["data","numbers","percent","study","research","survey","stats"]) >= 1) sugSrc = "data";
    else if (scoreMatch(combined, ["noticed","pattern","seems","trend","keep seeing","every time","always"]) >= 1) sugSrc = "pattern";
    else if (scoreMatch(combined, ["says","thinks","argues","believes","wrote","quote","opinion","principle","framework","according"]) >= 1) sugSrc = "perspective";
    else sugSrc = "example";
  }

  cap.suggested = { funcs:sugFuncs, doms:sugDoms, beliefs:sugBeliefs, srcType:sugSrc };

  // Auto-select suggestions
  sugFuncs.forEach(f => { if (!cap.funcs.includes(f)) cap.funcs.push(f); });
  sugDoms.forEach(d  => { if (!cap.doms.includes(d))  cap.doms.push(d); });
  Object.keys(sugBeliefs).forEach(id => { if (!cap.beliefs.includes(id)) cap.beliefs.push(id); });
  if (sugSrc && !cap.srcType) cap.srcType = sugSrc;

  // Banner
  const numSug = sugFuncs.length + sugDoms.length + Object.keys(sugBeliefs).length;
  const banner = document.getElementById("sug-banner");
  if (numSug > 0) {
    banner.classList.remove("hidden");
    document.getElementById("sug-text").textContent = `Auto-selected ${numSug} suggestion${numSug > 1 ? "s" : ""} based on your input. Review below and adjust anything that's off.`;
  } else {
    banner.classList.add("hidden");
  }
  renderCapAll();
}

function debounceRun() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSuggestions, 400);
}

// ─── RENDER ───
function render() {
  rDash();
  rSidebar();
  rFilters();
  rContent();
}

function rDash() {
  const bc = byF("belief").length;
  const pc = byF("proof").length;
  const cc = byF("craft").length;
  const ic = inboxItems.length;

  document.getElementById("dash").innerHTML = `
    <div class="dash-hero">
      <div class="dash-hero-img"></div>
      <div class="dash-hero-overlay"></div>
      <div class="dash-hero-flash"></div>
      <div class="dash-hero-title">
        <h2>POV System</h2>
        <p>Beliefs · Proof · Craft</p>
      </div>
    </div>
`;
}

function rSidebar() {
  const NAV_ICONS = {
    all:    `<svg width="13" height="13" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="14" stroke="currentColor" stroke-width="1.2"/><line x1="24" y1="4" x2="24" y2="16" stroke="currentColor" stroke-width="1.2"/><line x1="24" y1="32" x2="24" y2="44" stroke="currentColor" stroke-width="1.2"/><line x1="4" y1="24" x2="16" y2="24" stroke="currentColor" stroke-width="1.2"/><line x1="32" y1="24" x2="44" y2="24" stroke="currentColor" stroke-width="1.2"/></svg>`,
    belief: `<svg width="13" height="13" viewBox="0 0 48 48" fill="none"><line x1="24" y1="3" x2="24" y2="45" stroke="currentColor" stroke-width="1.2"/><ellipse cx="24" cy="10" rx="8.5" ry="3.5" stroke="currentColor" stroke-width="1.2" fill="none"/><ellipse cx="24" cy="19" rx="10" ry="4" stroke="currentColor" stroke-width="1.2" fill="none"/><ellipse cx="24" cy="28" rx="10" ry="4" stroke="currentColor" stroke-width="1.2" fill="none"/><ellipse cx="24" cy="37" rx="8.5" ry="3.5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`,
    proof:  `<svg width="13" height="13" viewBox="0 0 48 48" fill="none"><path d="M8 8 L24 28 L40 8" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M8 8 Q24 16 40 8" stroke="currentColor" stroke-width="1.2" fill="none"/><line x1="24" y1="28" x2="24" y2="40" stroke="currentColor" stroke-width="1.2"/><line x1="20" y1="40" x2="28" y2="40" stroke="currentColor" stroke-width="1.2"/></svg>`,
    craft:  `<svg width="13" height="13" viewBox="0 0 48 48" fill="none"><line x1="24" y1="4" x2="24" y2="20" stroke="currentColor" stroke-width="1.2"/><path d="M24 20 Q24 26 18 32 Q14 36 10 42" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M24 20 Q24 28 24 34 Q24 38 24 44" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M24 20 Q24 26 30 32 Q34 36 38 42" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`,
    inbox:  `<svg width="13" height="13" viewBox="0 0 48 48" fill="none"><polyline points="2,24 10,24 13,22 15,24 17,24 19,24 21,30 23,10 25,34 27,18 29,24 32,24 35,21 38,24 46,24" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
    content:`<svg width="13" height="13" viewBox="0 0 48 48" fill="none"><path d="M36 4 Q28 12 24 24 Q22 30 20 38" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M36 4 Q32 8 36 12" stroke="currentColor" stroke-width="0.8" fill="none"/><path d="M34 8 Q30 12 34 16" stroke="currentColor" stroke-width="0.8" fill="none"/><path d="M20 38 L18 44" stroke="currentColor" stroke-width="1.2"/><path d="M20 38 L22 44" stroke="currentColor" stroke-width="1.2"/></svg>`,
    teaching:`<svg width="13" height="13" viewBox="0 0 48 48" fill="none"><line x1="8" y1="12" x2="40" y2="12" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="12" x2="8" y2="36" stroke="currentColor" stroke-width="1.2"/><line x1="40" y1="12" x2="40" y2="36" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="36" x2="40" y2="36" stroke="currentColor" stroke-width="1.2"/><line x1="24" y1="36" x2="24" y2="44" stroke="currentColor" stroke-width="1.2"/><line x1="16" y1="44" x2="32" y2="44" stroke="currentColor" stroke-width="1.2"/><line x1="14" y1="22" x2="34" y2="22" stroke="currentColor" stroke-width="1"/><line x1="14" y1="28" x2="28" y2="28" stroke="currentColor" stroke-width="1"/></svg>`
  };

  const navItems = [
    { k:"all",      l:"All" },
    { k:"belief",   l:"Beliefs" },
    { k:"proof",    l:"Proof" },
    { k:"craft",    l:"Craft" },
    { k:"teaching", l:"Teaching" },
    { k:"inbox",    l:"Inbox" },
    { k:"content",  l:"Content" }
  ];

  const counts = {
    all:      items.length,
    belief:   byF("belief").length,
    proof:    byF("proof").length,
    craft:    byF("craft").length,
    teaching: byF("teaching").length,
    inbox:    inboxItems.length,
    content:  contentItems.length
  };

  document.getElementById("snav").innerHTML = navItems.map(t =>
    `<button class="nav-btn ${S.view===t.k?'active':''}" onclick="setView('${t.k}')">
      <span class="nav-icon">${NAV_ICONS[t.k]||""}</span>
      ${t.l}
      <span class="nav-cnt">${counts[t.k]}</span>
    </button>`
  ).join("");

  // Beliefs list in sidebar
  document.getElementById("slist").innerHTML =
    `<h3>Your Beliefs</h3>` +
    bels().map(b => {
      const proofCount = (b.linkedIds||[]).filter(id => {
        const it = get(id);
        return it && it.functions.includes("proof");
      }).length;
      return `<button class="b-btn ${S.belief===b.id?'active':''}" onclick="focusBelief('${b.id}')">
        ${escHtml(b.title)}<br>
        <span class="b-status ${b.status||'exploring'}">${b.status||'exploring'}</span>
        <span class="b-cnt">${proofCount} proof</span>
      </button>`;
    }).join("");
}

function rFilters() {
  const topbar = document.getElementById("topbar");
  if (!topbar) return;

  if (S.view === "inbox" || S.view === "content") {
    topbar.style.display = "none";
    return;
  }
  topbar.style.display = "";

  const srcTips = {
    "lived":       "Something I experienced first-hand",
    "their-story": "Someone else's first-hand account",
    "example":     "A brand or case study I'm analysing",
    "perspective": "Someone's stated position or framework",
    "pattern":     "Something I keep noticing",
    "data":        "Numbers, research, or stats"
  };

  let ffHtml = FUNCS.map(f =>
    `<button class="ft ${S.funcF===f?'active':''}" onclick="toggleFunc('${f}')">${f}</button>`
  ).join("");

  if (S.funcF === "proof") {
    ffHtml += `<span class="ft-divider" style="display:inline-block;width:1px;height:20px;background:var(--rule-dk);margin:0 4px;vertical-align:middle"></span>`;
    ffHtml += SRC_TYPES.map(s =>
      `<button class="ft-sub ${S.srcF===s?'active':''}" onclick="toggleSrc('${s}')" title="${srcTips[s]}">${srcLabels[s]}</button>`
    ).join("");
  }

  document.getElementById("ff").innerHTML = ffHtml;
  document.getElementById("df").innerHTML = DOMAINS.map(d =>
    `<button class="ft ${S.domF===d?'active':''}" onclick="toggleDom('${d}')">${d}</button>`
  ).join("");
}

function rContent() {
  const root = document.getElementById("view-root");

  if (S.view === "inbox") {
    renderInbox(root);
    return;
  }

  if (S.view === "content") {
    renderContentPipeline(root);
    return;
  }

  if (!loaded) {
    root.innerHTML = `<div class="loading-state">Loading...</div>`;
    return;
  }

  const f = filt();
  let title, sub;

  if (S.belief) {
    const b = get(S.belief);
    title = b ? escHtml(b.title) : "Belief";
    sub   = `${f.length} connected items`;
  } else if (S.view === "all") {
    title = "All Items";
    sub   = `${f.length} items`;
  } else {
    title = { belief:"Beliefs", proof:"Proof", craft:"Craft", teaching:"Teaching" }[S.view] || S.view;
    sub   = `${f.length} items`;
  }
  if (S.search) sub = `${f.length} results for "${S.search}"`;

  let beliefFocusHtml = "";
  if (S.belief) {
    const b = get(S.belief);
    if (b) {
      beliefFocusHtml = `
        <div class="belief-focus">
          <h3>Focused Belief</h3>
          <h2>${escHtml(b.title)}</h2>
          <div class="belief-focus-meta">
            <span class="sp ${b.status||'exploring'}">${b.status||'exploring'}</span>
            ${(b.domains||[]).map(d => `<span class="card-domain">${d}</span>`).join("")}
          </div>
        </div>`;
    }
  }

  const gridClass = `card-grid`;

  root.innerHTML = `
    <div class="content">
      <div class="view-hdr">
        <h2>${title}</h2>
        <p>${sub}</p>
      </div>
      ${beliefFocusHtml}
      ${f.length
        ? `<div class="${gridClass}">${f.map(rCard).join("")}</div>`
        : `<div class="empty-state"><p>No items match</p></div>`}
    </div>`;
}

function rCard(item) {
  const lk = linked(item);
  const isVisual = S.layout === "visual";

  let imgHtml = "";
  if (item.image) {
    imgHtml = `<img class="card-img" src="${item.image}" alt="">`;
  } else if (isVisual) {
    const initials = (item.functions||["?"]).map(f => f[0].toUpperCase()).join("");
    imgHtml = `<div class="card-img-ph">${initials}</div>`;
  }

  const srcBadge = item.sourceType
    ? `<span class="src-badge">${(srcLabels[item.sourceType]||item.sourceType).replace("-"," ")}</span>`
    : "";

  const funcsHtml = (item.functions||[]).map(f =>
    `<span class="card-func">${f}</span>`
  ).join("");

  const domainsHtml = (item.domains||[]).map(d =>
    `<span class="card-domain">${d}</span>`
  ).join("");

  const statusHtml = item.status
    ? `<span class="sp ${item.status}">${item.status}</span>`
    : "";

  const linkedHtml = lk.length
    ? `<div class="card-links">${lk.slice(0,2).map(l => `<span class="card-link">↗ ${escHtml(l.title)}</span>`).join("")}${lk.length>2?`<span class="card-link" style="color:var(--faint)">+${lk.length-2} more</span>`:""}</div>`
    : "";

  const whyHtml = item.whySaved
    ? `<div class="card-why"><strong>Why:</strong> ${escHtml(item.whySaved)}</div>`
    : "";

  return `
    <div class="card" onclick="openD('${item.id}')">
      <div class="card-bar"></div>
      ${imgHtml}
      <div class="card-content">
        <div class="card-funcs">${funcsHtml}${srcBadge}</div>
        <div class="card-title">${escHtml(item.title)}</div>
        ${item.body && item.body !== item.title ? `<div class="card-body">${escHtml(item.body)}</div>` : ""}
        ${whyHtml}
        <div class="card-meta">${domainsHtml}${statusHtml}</div>
        ${linkedHtml}
      </div>
    </div>`;
}

// ─── DETAIL PANEL ───
function openD(id) {
  const item = get(id);
  if (!item) return;
  const lk = linked(item);

  const funcsHtml = (item.functions||[]).map(f =>
    `<span class="card-func">${f}</span>`
  ).join("");

  const domainsHtml = (item.domains||[]).map(d =>
    `<span class="card-domain">${d}</span>`
  ).join("");

  let s = `<div class="panel-body">`;

  if (item.image) s += `<img class="panel-img" src="${item.image}" alt="">`;

  s += `<div class="panel-funcs">${funcsHtml}</div>`;
  s += `<h2>${escHtml(item.title)}</h2>`;

  if (item.created) s += `<span class="panel-date">${item.created}</span>`;
  if (item.status)  s += `<div class="panel-section"><div class="panel-section-label">Status</div><span class="sp ${item.status}">${item.status}</span></div>`;

  if (item.body && item.body !== item.title) {
    s += `<div class="panel-section"><div class="panel-section-label">Notes</div><p>${escHtml(item.body)}</p></div>`;
  }

  if (item.whySaved) {
    s += `<div class="panel-why"><p>${escHtml(item.whySaved)}</p></div>`;
  }

  if (item.principle) {
    s += `<div class="panel-section"><div class="panel-section-label">Craft Principle</div><p>${escHtml(item.principle)}</p></div>`;
  }

  if (item.sourceType || item.source) {
    s += `<div class="panel-section"><div class="panel-section-label">Source</div>`;
    if (item.sourceType) s += `<span class="src-badge" style="font-size:11px;padding:3px 8px;display:inline-block;margin-bottom:6px">${(srcLabels[item.sourceType]||item.sourceType).replace("-"," ")}</span><br>`;
    if (item.source) s += `<p style="font-size:11px;word-break:break-all">${escHtml(item.source)}</p>`;
    s += `</div>`;
  }

  if (item.domains && item.domains.length) {
    s += `<div class="panel-section"><div class="panel-section-label">Domains</div><div class="card-meta">${domainsHtml}</div></div>`;
  }

  if (lk.length) {
    s += `<div class="panel-section"><div class="panel-section-label">Linked Items</div>
      <div class="panel-linked">${lk.map(l => `<button class="panel-linked-item" onclick="closePanel();openD('${l.id}')">${escHtml(l.title)}</button>`).join("")}</div>
    </div>`;
  }

  s += `<div class="panel-actions">
    <button class="panel-action-btn" onclick="editItem('${id}')">Edit</button>
    <button class="panel-action-btn danger" onclick="confirmDeleteItem('${id}','${(item.functions||["proof"])[0]}')">Delete</button>
  </div>`;

  s += `</div>`;

  document.getElementById("panel").innerHTML = `
    <div class="panel-close"><button onclick="closePanel()">Close</button></div>
    ${s}`;
  document.getElementById("overlay").classList.add("open");
}

function closePanel() {
  document.getElementById("overlay").classList.remove("open");
}

async function confirmDeleteItem(id, type) {
  if (!confirm("Delete this item? This cannot be undone.")) return;
  closePanel();
  try {
    await deleteItem(id, type);
    render();
    showToast("Item deleted");
  } catch(e) {
    showToast("Error deleting item");
    console.error(e);
  }
}

// ─── CAPTURE MODAL ───
function openCapture(prefill) {
  cap = { funcs:[], doms:[], beliefs:[], srcType:null, imageData:null, suggested:{funcs:[],doms:[],beliefs:{}} };
  capStatus = "exploring";
  document.getElementById("cap-title").value    = (prefill && prefill.title)    || "";
  document.getElementById("cap-notes").value    = (prefill && prefill.notes)    || "";
  document.getElementById("cap-why").value      = (prefill && prefill.why)      || "";
  document.getElementById("cap-url").value      = "";
  document.getElementById("cap-preview").style.display = "none";
  document.getElementById("dropzone").style.display    = "block";
  document.getElementById("file-input").value   = "";
  document.getElementById("sug-banner").classList.add("hidden");
  if (prefill && prefill.funcs) cap.funcs = prefill.funcs;
  if (prefill && prefill.sourceInboxId) cap.sourceInboxId = prefill.sourceInboxId;
  renderCapAll();
  document.getElementById("cap-overlay").classList.add("open");
}

function closeCapture() {
  document.getElementById("cap-overlay").classList.remove("open");
}

function renderCapAll() {
  renderCapFuncs();
  renderCapSrcType();
  renderCapDoms();
  renderCapBeliefs();
}

function renderCapFuncs() {
  document.getElementById("cap-funcs").innerHTML = FUNCS.map(f => {
    const active    = cap.funcs.includes(f);
    const suggested = !active && cap.suggested.funcs && cap.suggested.funcs.includes(f);
    return `<button class="cap-chip ${active?"selected":""}" onclick="toggleCapFunc('${f}')">${f}</button>`;
  }).join("");
  document.getElementById("src-type-section").style.display =
    cap.funcs.includes("proof") ? "block" : "none";
  document.getElementById("cap-beliefs-section").style.display =
    (cap.funcs.includes("proof") || cap.funcs.includes("craft")) ? "block" : "none";
  const statusSec = document.getElementById("cap-status-section");
  if (statusSec) {
    statusSec.style.display = cap.funcs.includes("belief") ? "block" : "none";
    if (cap.funcs.includes("belief")) {
      document.querySelectorAll("#cap-status-chips .cap-chip").forEach(c =>
        c.classList.toggle("selected", c.dataset.s === capStatus));
    }
  }
}

function renderCapSrcType() {
  document.querySelectorAll("#cap-src-types .cap-src").forEach(el => {
    const s = el.dataset.s;
    el.classList.toggle("selected", cap.srcType === s);
    el.classList.toggle("suggested", cap.suggested.srcType === s && cap.srcType !== s);
  });
}

function renderCapDoms() {
  document.getElementById("cap-doms").innerHTML = DOMAINS.map(d => {
    const active    = cap.doms.includes(d);
    const suggested = !active && cap.suggested.doms && cap.suggested.doms.includes(d);
    return `<button class="cap-chip ${active?"selected":""}" onclick="toggleCapDom('${d}')">${d}</button>`;
  }).join("");
}

function renderCapBeliefs() {
  const bs = bels();
  document.getElementById("cap-beliefs").innerHTML = bs.map(b => {
    const sel = cap.beliefs.includes(b.id);
    const sug = !sel && cap.suggested.beliefs && cap.suggested.beliefs[b.id];
    const reason = (sug && cap.suggested.beliefs[b.id].reason) ? cap.suggested.beliefs[b.id].reason : "";
    return `<button class="cap-bel ${sel?"selected":""} ${sug?"suggested":""}" onclick="toggleCapBelief('${b.id}')">
      <span class="chk">${sel?"✓":""}</span>
      <span>${escHtml(b.title)}</span>
      ${reason ? `<span class="sug-reason">${escHtml(reason)}</span>` : ""}
    </button>`;
  }).join("");
}

function toggleCapFunc(f) {
  const i = cap.funcs.indexOf(f);
  if (i >= 0) cap.funcs.splice(i, 1); else cap.funcs.push(f);
  renderCapAll();
}
function toggleCapDom(d) {
  const i = cap.doms.indexOf(d);
  if (i >= 0) cap.doms.splice(i, 1); else cap.doms.push(d);
  renderCapDoms();
}
function toggleCapBelief(id) {
  const i = cap.beliefs.indexOf(id);
  if (i >= 0) cap.beliefs.splice(i, 1); else cap.beliefs.push(id);
  renderCapBeliefs();
}
function pickSrc(el) {
  cap.srcType = cap.srcType === el.dataset.s ? null : el.dataset.s;
  renderCapSrcType();
}

function pickStatus(el) {
  document.querySelectorAll("#cap-status-chips .cap-chip").forEach(c => c.classList.remove("selected"));
  el.classList.add("selected");
  capStatus = el.dataset.s;
}

async function addNewBelief() {
  const input = document.getElementById("cap-new-belief");
  const title = input.value.trim();
  if (!title) return;
  const id = genId("b");
  const newBelief = {
    id, functions:["belief"], title, body:title,
    status:"exploring",
    domains: cap.doms.length ? [...cap.doms] : ["Strategy"],
    linkedIds:[], created: new Date().toISOString().slice(0,10),
    keywords: title.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  };
  try {
    await saveNewItem(newBelief);
    cap.beliefs.push(id);
    input.value = "";
    rSidebar();
    renderCapBeliefs();
    showToast("New belief added");
  } catch(e) {
    showToast("Error saving belief");
    console.error(e);
  }
}

async function saveCapture() {
  const title = document.getElementById("cap-title").value.trim();
  const notes = document.getElementById("cap-notes").value.trim();
  const whyV  = document.getElementById("cap-why").value.trim();
  const url   = document.getElementById("cap-url").value.trim();

  if (!title) { showToast("Add a title first"); return; }
  if (!cap.funcs.length) { showToast("Select at least one function"); return; }

  // ── EDIT MODE ──
  if (cap.editing) {
    const item = get(cap.editing);
    if (!item) { showToast("Item not found"); return; }
    item.title     = title;
    item.body      = notes || title;
    item.functions = [...cap.funcs];
    if (cap.doms.length) item.domains = [...cap.doms];
    if (whyV)            item.whySaved   = whyV;
    if (url)             item.source     = url;
    if (cap.imageData)   item.image      = cap.imageData;
    if (cap.srcType)     item.sourceType = cap.srcType;
    try {
      await updateItem(item);
      closeCapture();
      render();
      showToast(`Updated "${title}"`);
    } catch(e) {
      showToast("Error updating — check connection");
      console.error(e);
    }
    return;
  }

  // ── CREATE MODE ──
  const id = genId(cap.funcs.includes("belief") ? "b" : "i");
  const newItem = {
    id,
    functions: [...cap.funcs],
    title,
    body:     notes || title,
    domains:  cap.doms.length ? [...cap.doms] : ["Strategy"],
    keywords: title.toLowerCase().split(/\s+/).filter(w => w.length > 3),
    created:  new Date().toISOString().slice(0,10)
  };

  if (whyV)          newItem.whySaved   = whyV;
  if (url)           newItem.source     = url;
  if (cap.imageData) newItem.image      = cap.imageData;
  if (cap.srcType)   newItem.sourceType = cap.srcType;

  if (cap.funcs.includes("belief")) {
    newItem.status    = capStatus || "exploring";
    newItem.linkedIds = [];
  }

  if (cap.beliefs.length) {
    if (cap.funcs.includes("proof")) newItem.supportsBelief = [...cap.beliefs];
    if (cap.funcs.includes("craft")) newItem.relatedBelief  = [...cap.beliefs];
    cap.beliefs.forEach(bId => {
      const b = get(bId);
      if (b && b.linkedIds && !b.linkedIds.includes(id)) {
        b.linkedIds.push(id);
        updateItem(b).catch(console.error);
      }
    });
  }

  try {
    await saveNewItem(newItem);
    // If filed from inbox, delete the source inbox item
    if (cap.sourceInboxId) {
      const srcId = cap.sourceInboxId;
      await apiFetch(`${API.inbox}?id=${srcId}`, { method:"DELETE" }).catch(console.error);
      inboxItems = inboxItems.filter(i => i.id !== srcId);
    }
    closeCapture();
    render();
    showToast(`Saved "${title}"`);
  } catch(e) {
    showToast("Error saving — check connection");
    console.error(e);
  }
}

// Edit item — open capture with existing data
function editItem(id) {
  const item = get(id);
  if (!item) return;
  closePanel();

  cap = {
    funcs:     [...(item.functions||[])],
    doms:      [...(item.domains||[])],
    beliefs:   [...(item.supportsBelief||item.relatedBelief||[])],
    srcType:   item.sourceType || null,
    imageData: item.image || null,
    suggested: { funcs:[], doms:[], beliefs:{} },
    editing:   id
  };
  capStatus = item.status || "exploring";

  document.getElementById("cap-title").value = item.title || "";
  document.getElementById("cap-notes").value = item.body  || "";
  document.getElementById("cap-why").value   = item.whySaved || "";
  document.getElementById("cap-url").value   = item.source   || "";

  if (item.image) {
    document.getElementById("preview-img").src = item.image;
    document.getElementById("cap-preview").style.display = "inline-block";
    document.getElementById("dropzone").style.display    = "none";
  } else {
    document.getElementById("cap-preview").style.display = "none";
    document.getElementById("dropzone").style.display    = "block";
  }

  document.getElementById("sug-banner").classList.add("hidden");
  renderCapAll();
  document.getElementById("cap-overlay").classList.add("open");
}


// ─── IMAGE HANDLING ───
const dz = document.getElementById("dropzone");
const fi = document.getElementById("file-input");

dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("dragover"); });
dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
dz.addEventListener("drop",      e => {
  e.preventDefault();
  dz.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fi.addEventListener("change", e => { if (e.target.files.length) handleFile(e.target.files[0]); });

function handleFile(file) {
  if (!file.type.startsWith("image/")) return;
  const r = new FileReader();
  r.onload = e => {
    cap.imageData = e.target.result;
    document.getElementById("preview-img").src = e.target.result;
    document.getElementById("cap-preview").style.display = "inline-block";
    dz.style.display = "none";
  };
  r.readAsDataURL(file);
}

function removeImage() {
  cap.imageData = null;
  document.getElementById("cap-preview").style.display = "none";
  dz.style.display = "block";
  fi.value = "";
}

// ─── CONVERSATION HELPERS ───
function extractBeliefFromConv(conversation) {
  // Pull the last bold statement from Claude messages — that's the refined/agreed output
  // Try to get the longest bold block (full articulated belief, not just a label)
  const claudeMsgs = (conversation || []).filter(m => m.role === "assistant").reverse();
  let best = "";
  for (const msg of claudeMsgs) {
    const matches = [...msg.content.matchAll(/\*\*([^*]{20,})\*\*/g)];
    for (const m of matches) {
      if (m[1].length > best.length) best = m[1];
    }
    if (best.length > 80) return best; // got a proper statement, stop looking
  }
  return best;
}

function convToNotes(conversation) {
  return (conversation || []).map(m =>
    `${m.role === "user" ? "You" : "Claude"}: ${m.content}`
  ).join("\n\n");
}

// ─── THINK MODAL ───
let thinkConversation = [];

function openThink() {
  think = { source:"Own thinking" };
  thinkConversation = [];
  document.getElementById("think-title").value = "";
  document.getElementById("think-dump").value  = "";
  document.getElementById("think-conv-thread").innerHTML = "";
  document.getElementById("think-hdr-sub").textContent = "Dump raw thinking. Don't filter.";
  document.querySelectorAll(".think-source-chip").forEach(c => c.classList.toggle("selected", c.textContent.trim() === "Own thinking"));
  document.getElementById("think-dump-phase").style.display = "flex";
  document.getElementById("think-spar-phase").style.display = "none";
  document.getElementById("think-overlay").classList.add("open");
}

function closeThink() {
  document.getElementById("think-overlay").classList.remove("open");
}

function pickThinkSource(el) {
  document.querySelectorAll(".think-source-chip").forEach(c => c.classList.remove("selected"));
  el.classList.add("selected");
  think.source = el.textContent.trim();
}

async function startThinkSpar() {
  const raw = document.getElementById("think-dump").value.trim();
  if (!raw) { showToast("Add some thinking first"); return; }

  // Switch to spar phase
  document.getElementById("think-dump-phase").style.display = "none";
  document.getElementById("think-spar-phase").style.display = "flex";
  document.getElementById("think-hdr-sub").textContent = "Sparring with Claude";

  // Send raw dump as first message
  thinkConversation = [{ role:"user", content: raw }];
  renderThinkConv();
  await callThinkSpar();
}

async function sendThinkSpar() {
  const inputEl = document.getElementById("think-conv-input");
  const msg = (inputEl.value||"").trim();
  if (!msg) return;
  inputEl.value = "";
  thinkConversation.push({ role:"user", content: msg });
  renderThinkConv();
  await callThinkSpar();
}

async function callThinkSpar() {
  const btn = document.getElementById("think-send-btn");
  if (btn) { btn.textContent = "..."; btn.disabled = true; }

  try {
    const res = await fetch("/api/think-chat", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ conversation: thinkConversation, beliefs: items })
    });
    const data = await res.json();
    const reply = data.reply || "Something went wrong — try again.";
    thinkConversation.push({ role:"assistant", content: reply });
    renderThinkConv();
  } catch(e) {
    showToast("Error reaching Claude — check connection");
    console.error(e);
  } finally {
    if (btn) { btn.textContent = "Send"; btn.disabled = false; }
  }
}

function renderThinkConv() {
  const thread = document.getElementById("think-conv-thread");
  thread.innerHTML = thinkConversation.map(msg =>
    `<div class="conv-msg ${msg.role}">
      <div class="conv-msg-role">${msg.role === "user" ? "You" : "Claude"}</div>
      <div class="conv-msg-text">${escHtml(msg.content)}</div>
    </div>`
  ).join("");
  // Scroll to bottom
  const scroll = document.getElementById("think-conv-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

async function saveThink() {
  const title = document.getElementById("think-title").value.trim();
  const raw   = document.getElementById("think-dump").value.trim();
  if (!raw) { showToast("Add some thinking first"); return; }
  await _saveThinkItem(title, raw, []);
}

async function saveThinkWithConv() {
  const title = document.getElementById("think-title").value.trim();
  const raw   = document.getElementById("think-dump").value.trim() || (thinkConversation[0]||{}).content || "";
  await _saveThinkItem(title, raw, thinkConversation);
}

function fileThinkAsBelief() {
  const raw = document.getElementById("think-dump").value.trim() || (thinkConversation[0]||{}).content || "";
  const thinkTitle = document.getElementById("think-title").value.trim();
  const extracted  = extractBeliefFromConv(thinkConversation);
  closeThink();
  openCapture({
    funcs: ["belief"],
    title: thinkTitle || extracted.slice(0, 80) || "",
    notes: extracted || raw,   // agreed output as the belief body, not the full transcript
    why:   raw.slice(0, 300)
  });
}

function promoteInboxItem(id) {
  const item = inboxItems.find(i => i.id === id);
  if (!item) return;
  closePanel();
  const extracted = extractBeliefFromConv(item.conversation || []);
  const agreedOutput = item.agreedOutput || extracted;
  openCapture({
    funcs: ["belief"],
    title: agreedOutput.slice(0, 80) || item.title || "",
    notes: agreedOutput || item.raw,
    why:   (item.raw || "").slice(0, 300),
    sourceInboxId: id
  });
}

async function _saveThinkItem(title, raw, conversation) {
  if (!raw) { showToast("Nothing to save"); return; }
  const id = genId("in");
  const agreedOutput = extractBeliefFromConv(conversation);
  const item = {
    id,
    title:    title || agreedOutput.slice(0, 80) || raw.slice(0, 60),
    agreedOutput: agreedOutput || null,
    status:   "new",
    source:   think.source || "manual",
    raw,
    conversation,
    outputs:  [],
    contentIdeas: [],
    created:  new Date().toISOString().slice(0,10)
  };
  try {
    await saveNewInbox(item);
    closeThink();
    setView("inbox");
    showToast("Saved to Inbox");
  } catch(e) {
    showToast("Error saving — check connection");
    console.error(e);
  }
}

// ─── INBOX VIEW ───
function renderInbox(root) {
  const items_ = [...inboxItems].sort((a,b) => (b.created||"").localeCompare(a.created||""));

  const listHtml = items_.length
    ? items_.map(it => {
        const hasThread = it.conversation && it.conversation.length > 0;
        return `<div class="inbox-item ${hasThread?"has-thread":""}" onclick="openInboxItem('${it.id}')">
          <div class="inbox-item-hdr">
            <span class="inbox-item-title">${escHtml(it.title||"Untitled")}</span>
            <span class="inbox-item-status ${it.status==="processed"?"processed":""}">${it.status||"new"}</span>
            <span class="inbox-item-date">${it.created||""}</span>
          </div>
          <div class="inbox-item-raw">${escHtml(it.raw||"")}</div>
          <div class="inbox-item-meta">
            <span class="card-domain">${it.source||"manual"}</span>
            ${hasThread ? `<span class="card-domain">${it.conversation.length} message${it.conversation.length!==1?"s":""}</span>` : ""}
            ${(it.contentIdeas||[]).length ? `<span class="card-domain">${it.contentIdeas.length} idea${it.contentIdeas.length!==1?"s":""}</span>` : ""}
          </div>
        </div>`;
      }).join("")
    : `<div class="empty-state"><p>Inbox empty — use Think to add raw ideas</p></div>`;

  root.innerHTML = `
    <div class="content">
      <div class="view-hdr">
        <h2>Thinking Inbox</h2>
        <p>${items_.length} item${items_.length!==1?"s":""}</p>
      </div>
      <div class="inbox-list">${listHtml}</div>
    </div>`;
}

function renderInboxPanel(id) {
  const item = inboxItems.find(i => i.id === id);
  if (!item) return;

  const convHtml = (item.conversation||[]).map(msg =>
    `<div class="conv-msg ${msg.role}">
      <div class="conv-msg-role">${msg.role === "user" ? "You" : "Claude"}</div>
      <div class="conv-msg-text">${escHtml(msg.content)}</div>
    </div>`
  ).join("");

  document.getElementById("panel").innerHTML = `
    <div class="panel-close"><button onclick="closePanel()">Close</button></div>
    <div class="panel-body">
      <div class="panel-funcs"><span class="card-domain">${item.source||"manual"}</span></div>
      <h2>${escHtml(item.title||"Untitled")}</h2>
      <span class="panel-date">${item.created||""}</span>

      ${(item.agreedOutput || extractBeliefFromConv(item.conversation||[])) ? `
      <div class="panel-section">
        <div class="panel-section-label">Agreed Output</div>
        <div class="inbox-panel-agreed"><p>${escHtml(item.agreedOutput || extractBeliefFromConv(item.conversation||[]))}</p></div>
      </div>` : ""}

      <div class="panel-section">
        <div class="panel-section-label">Raw Thinking</div>
        <div class="inbox-panel-raw"><p>${escHtml(item.raw||"")}</p></div>
      </div>

      <div class="panel-section">
        <div class="panel-section-label">Sparring</div>
        <div class="conv-thread" id="inbox-conv-thread-${id}">${convHtml}</div>
        <div class="conv-input-wrap" style="margin-top:8px">
          <textarea class="conv-input" id="conv-input-${id}" placeholder="Reply to Claude..." rows="2"></textarea>
          <button class="conv-send-btn" id="conv-send-${id}" onclick="sendConvMessage('${id}')">Send</button>
        </div>
      </div>

      <div class="panel-actions">
        <button class="panel-action-btn primary" onclick="promoteInboxItem('${id}')">File as Belief →</button>
        <button class="panel-action-btn" onclick="markInboxProcessed('${id}')">Mark Processed</button>
        <button class="panel-action-btn danger" onclick="confirmDeleteInbox('${id}')">Delete</button>
      </div>
    </div>`;
}

async function openInboxItem(id) {
  const item = inboxItems.find(i => i.id === id);
  if (!item) return;

  renderInboxPanel(id);
  document.getElementById("overlay").classList.add("open");

  // Auto-start sparring if no conversation yet
  if (!item.conversation || item.conversation.length === 0) {
    item.conversation = [{ role:"user", content: item.raw }];
    const sendBtn = document.getElementById(`conv-send-${id}`);
    if (sendBtn) { sendBtn.textContent = "..."; sendBtn.disabled = true; }

    try {
      const res = await fetch("/api/think-chat", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ conversation: item.conversation, beliefs: items })
      });
      const data = await res.json();
      const reply = data.reply || "Something went wrong.";
      item.conversation.push({ role:"assistant", content: reply });
      await updateInboxItem(item);
      renderInboxPanel(id); // re-render with conversation
    } catch(e) {
      console.error(e);
    } finally {
      if (sendBtn) { sendBtn.textContent = "Send"; sendBtn.disabled = false; }
    }
  }
}

async function sendConvMessage(id) {
  const item = inboxItems.find(i => i.id === id);
  if (!item) return;

  const inputEl = document.getElementById(`conv-input-${id}`);
  const userMsg = (inputEl.value||"").trim();
  if (!userMsg) return;

  inputEl.value = "";
  const sendBtn = inputEl.nextElementSibling;
  sendBtn.classList.add("loading");
  sendBtn.textContent = "...";

  item.conversation = item.conversation || [];
  item.conversation.push({ role:"user", content:userMsg });

  // Optimistic render
  const thread = document.getElementById(`inbox-conv-thread-${id}`);
  if (thread) thread.innerHTML = item.conversation.map(msg =>
    `<div class="conv-msg ${msg.role}">
      <div class="conv-msg-role">${msg.role === "user" ? "You" : "Claude"}</div>
      <div class="conv-msg-text">${escHtml(msg.content)}</div>
    </div>`
  ).join("");

  const aiRes = await fetch("/api/think-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation: item.conversation, beliefs: items })
  });

  const aiData = await aiRes.json();
  const assistantReply = aiData.reply || "Something went wrong — try again.";
  item.conversation.push({ role:"assistant", content:assistantReply });

  try {
    await updateInboxItem(item);
    sendBtn.classList.remove("loading");
    sendBtn.textContent = "Send";
    renderInboxPanel(id); // re-render conversation
  } catch(e) {
    showToast("Error saving conversation");
    sendBtn.classList.remove("loading");
    sendBtn.textContent = "Send";
    console.error(e);
  }
}

async function markInboxProcessed(id) {
  const item = inboxItems.find(i => i.id === id);
  if (!item) return;
  item.status = "processed";
  try {
    await updateInboxItem(item);
    closePanel();
    renderInbox(document.getElementById("view-root"));
    showToast("Marked as processed");
  } catch(e) {
    showToast("Error updating");
    console.error(e);
  }
}

async function confirmDeleteInbox(id) {
  if (!confirm("Delete this inbox item?")) return;
  closePanel();
  try {
    await deleteInboxItem(id);
    renderInbox(document.getElementById("view-root"));
    showToast("Deleted");
  } catch(e) {
    showToast("Error deleting");
    console.error(e);
  }
}

// ─── CONTENT PIPELINE VIEW ───
function renderContentPipeline(root) {
  const statuses = ["idea","drafting","editing","published"];
  const statusLabels = { idea:"Ideas", drafting:"Drafting", editing:"Editing", published:"Published" };

  const colsHtml = statuses.map(status => {
    const cols_ = contentItems.filter(c => c.status === status);
    const cardsHtml = cols_.length
      ? cols_.map(c => `
          <div class="kanban-card" onclick="openContentItem('${c.id}')">
            <div class="kanban-card-title">${escHtml(c.title||"Untitled")}</div>
            <div class="kanban-card-format">${c.format||"essay"}</div>
          </div>`).join("")
      : "";

    return `
      <div class="kanban-col">
        <div class="kanban-col-hdr">
          <h3>${statusLabels[status]}</h3>
          <span class="kanban-col-cnt">${cols_.length}</span>
        </div>
        <div class="kanban-cards">${cardsHtml}</div>
      </div>`;
  }).join("");

  root.innerHTML = `
    <div class="content">
      <div class="view-hdr">
        <h2>Content Pipeline</h2>
        <p>${contentItems.length} piece${contentItems.length!==1?"s":""}</p>
        <button class="vt-btn" style="margin-left:auto;border:1px solid var(--rule-dk);padding:4px 12px" onclick="openNewContent()">+ New</button>
      </div>
      <div class="kanban">${colsHtml}</div>
    </div>`;
}

function openContentItem(id) {
  const item = contentItems.find(c => c.id === id);
  if (!item) return;

  const statusOpts = ["idea","drafting","editing","published"].map(s =>
    `<option value="${s}" ${item.status===s?"selected":""}>${s}</option>`
  ).join("");

  document.getElementById("panel").innerHTML = `
    <div class="panel-close"><button onclick="closePanel()">Close</button></div>
    <div class="panel-body">
      <div class="panel-funcs"><span class="card-domain">${item.format||"essay"}</span></div>
      <h2>${escHtml(item.title||"Untitled")}</h2>
      <span class="panel-date">${item.created||""}</span>

      <div class="panel-section">
        <div class="panel-section-label">Status</div>
        <select style="border:1px solid var(--rule);padding:4px 8px;font-family:Montserrat,sans-serif;font-size:11px;background:none" onchange="updateContentStatus('${id}',this.value)">
          ${statusOpts}
        </select>
      </div>

      ${item.thesis ? `<div class="panel-section"><div class="panel-section-label">Thesis</div><p>${escHtml(item.thesis)}</p></div>` : ""}
      ${item.keyPoints ? `<div class="panel-section"><div class="panel-section-label">Key Points</div><p>${escHtml(item.keyPoints)}</p></div>` : ""}
      ${item.notes ? `<div class="panel-section"><div class="panel-section-label">Notes</div><p>${escHtml(item.notes)}</p></div>` : ""}

      <div class="panel-actions">
        <button class="panel-action-btn danger" onclick="confirmDeleteContent('${id}')">Delete</button>
      </div>
    </div>`;
  document.getElementById("overlay").classList.add("open");
}

function openNewContent() {
  const title = prompt("Content title:");
  if (!title) return;
  const format = prompt("Format (essay, thread, video, carousel, newsletter):", "essay") || "essay";
  const id = genId("c");
  const item = {
    id, title, format, status:"idea",
    beliefs:[], proof:[], craft:[],
    created: new Date().toISOString().slice(0,10),
    thesis:"", keyPoints:"", notes:""
  };
  saveNewContent(item).then(() => {
    renderContentPipeline(document.getElementById("view-root"));
    showToast(`Added "${title}"`);
  }).catch(e => { showToast("Error saving"); console.error(e); });
}

async function updateContentStatus(id, status) {
  const item = contentItems.find(c => c.id === id);
  if (!item) return;
  item.status = status;
  try {
    await updateContentItem(item);
    renderContentPipeline(document.getElementById("view-root"));
    showToast("Status updated");
  } catch(e) {
    showToast("Error updating");
    console.error(e);
  }
}

async function confirmDeleteContent(id) {
  if (!confirm("Delete this content item?")) return;
  const item = contentItems.find(c => c.id === id);
  if (!item) return;
  try {
    // content.js DELETE
    await apiFetch(`${API.content}?id=${id}`, { method:"DELETE" });
    contentItems = contentItems.filter(c => c.id !== id);
    closePanel();
    renderContentPipeline(document.getElementById("view-root"));
    showToast("Deleted");
  } catch(e) {
    showToast("Error deleting");
    console.error(e);
  }
}

// ─── NAV & FILTERS ───
function setView(v) {
  S.view = v;
  S.belief = null;
  render();
}

function focusBelief(id) {
  S.belief = S.belief === id ? null : id;
  S.view   = "all";
  render();
}

function toggleFunc(f) {
  S.funcF = S.funcF === f ? null : f;
  if (S.funcF !== "proof") S.srcF = null;
  render();
}
function toggleSrc(s) { S.srcF = S.srcF === s ? null : s; render(); }
function toggleDom(d) { S.domF = S.domF === d ? null : d; render(); }
function setLayout(l) { S.layout = l; rContent(); }

document.getElementById("search").addEventListener("input", e => {
  S.search = e.target.value;
  rContent();
});

// ─── FAB ───
function toggleFab() {
  document.getElementById("fab-wrap").classList.toggle("open");
}

// Close fab when clicking outside
document.addEventListener("click", e => {
  const wrap = document.getElementById("fab-wrap");
  if (!wrap.contains(e.target)) wrap.classList.remove("open");
});

// ─── TOAST ───
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ─── KEYBOARD ───
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closePanel();
    closeCapture();
    closeThink();
    document.getElementById("fab-wrap").classList.remove("open");
  }
});

// Click-outside to close overlay
document.getElementById("overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) closePanel();
});
document.getElementById("cap-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeCapture();
});
document.getElementById("think-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeThink();
});

// ─── UTILS ───
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

// ─── INIT ───
// Render shell immediately so sidebar/dashboard are visible, then load data
render();
loadAll();

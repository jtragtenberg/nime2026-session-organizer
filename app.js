// app.js — NIME 2026 Session Organizer — main application logic

// ── State ──────────────────────────────────────────────────────────────────────

let state = {
  papers:   [],
  sessions: [],
  lastHash: "",
};

let sim                 = null;
let pollTimer           = null;
let syncStatus          = { ts: 0, ok: true };
let activeFilter        = new Set(Object.keys(AREA_COLORS));
let searchQuery         = "";
let searchFields        = new Set(["title", "authors", "keywords"]);
let searchResultIndex   = -1;
let _pendingPanelRender = false;
let _draggingPaperId    = null;
let _draggingSessionId  = null;

// ── Paper order persistence ───────────────────────────────────────────────────

function getPaperOrder(sessionId) {
  try { return (JSON.parse(localStorage.getItem("nime2026-order") || "{}")[sessionId]) || []; }
  catch { return []; }
}
function savePaperOrder(sessionId, ids) {
  try {
    const all = JSON.parse(localStorage.getItem("nime2026-order") || "{}");
    all[sessionId] = ids;
    localStorage.setItem("nime2026-order", JSON.stringify(all));
  } catch {}
}
function sortedSessionPapers(sessionId) {
  const papers = state.papers.filter(p => p.sessionId === sessionId);
  const order  = getPaperOrder(sessionId);
  if (!order.length) return papers;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...papers].sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 999) - (rank.has(b.id) ? rank.get(b.id) : 999));
}

function _isEditing() {
  const el = document.activeElement;
  return !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.contentEditable === "true"));
}

// ── Boot ───────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  buildFilterPills();
  initSim();

  // Load cached state immediately for fast start
  const cached = localStorage.getItem("nime2026-state");
  if (cached) {
    try {
      const data = JSON.parse(cached);
      applyState(data);
    } catch {}
  }

  initSearch();
  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
});

// ── Simulation init ───────────────────────────────────────────────────────────

function initSim() {
  const svgEl = document.getElementById("sim-svg");
  const panel = document.getElementById("panel");
  const canvasW = window.innerWidth - panel.offsetWidth;
  const canvasH = window.innerHeight;

  svgEl.setAttribute("width",  canvasW);
  svgEl.setAttribute("height", canvasH);

  sim = new NIMESimulation(svgEl, canvasW, canvasH, handleAssign);

  window.addEventListener("resize", () => {
    const w = window.innerWidth - panel.offsetWidth;
    const h = window.innerHeight;
    svgEl.setAttribute("width", w);
    svgEl.setAttribute("height", h);
    sim.resize(w, h);
  });
}

// ── Polling & sync ────────────────────────────────────────────────────────────

async function poll() {
  setSyncStatus("syncing");
  try {
    const res  = await fetch(APPS_SCRIPT_URL + "?action=read", { redirect: "follow" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Read failed");

    const hash = JSON.stringify(data);
    if (hash !== state.lastHash) {
      state.lastHash = hash;
      applyState(data);
      localStorage.setItem("nime2026-state", hash);
    }
    setSyncStatus("ok");
  } catch (err) {
    console.warn("Poll error:", err);
    setSyncStatus("error");
  }
}

function setSyncStatus(status) {
  const el = document.getElementById("sync-status");
  if (status === "syncing") {
    el.textContent = "⟳ Syncing…";
    el.className   = "sync syncing";
  } else if (status === "ok") {
    const sec = Math.round((Date.now() - syncStatus.ts) / 1000);
    el.textContent = `✓ ${sec}s ago`;
    el.className   = "sync ok";
    syncStatus     = { ts: Date.now(), ok: true };
  } else {
    el.textContent = "⚠ Sync error";
    el.className   = "sync error";
    syncStatus     = { ts: syncStatus.ts, ok: false };
  }
}

function applyState(data) {
  state.papers   = data.papers;
  state.sessions = data.sessions;
  sim.setData(data.papers, data.sessions);
  if (_isEditing()) {
    _pendingPanelRender = true;
  } else {
    renderPanel();
    _pendingPanelRender = false;
  }
  updateGlobalStats();
}

// ── Paper assignment ──────────────────────────────────────────────────────────

async function handleAssign(paperId, sessionId) {
  const paper   = state.papers.find(p => p.id === paperId);
  const session = sessionId ? state.sessions.find(s => s.id === sessionId) : null;
  if (!paper) return;

  const prevSessionId = paper.sessionId;

  // Optimistic update
  paper.sessionId   = sessionId || "";
  paper.sessionName = session ? session.name : "";

  if (sessionId) {
    sim.removePaper(paperId);
  } else {
    sim.restorePaper(paper);
  }
  renderPanel();
  updateGlobalStats();

  // Sync to Sheets
  const params = new URLSearchParams({
    action:      "assignPaper",
    paperId:     paperId,
    sessionId:   sessionId || "",
    sessionName: session ? session.name : "",
  });
  await sheetPost(params);
}

// ── Panel rendering ───────────────────────────────────────────────────────────

function renderPanel() {
  // Save which paper cards are currently flipped (showing abstract)
  const flippedIds = new Set(
    [...document.querySelectorAll(".paper-card.flipped")].map(c => c.dataset.paperId)
  );

  const container = document.getElementById("session-list");
  container.innerHTML = "";

  const SLOTS = [1, 2, 3, 4, 5, 7, 8, 9];
  for (const slot of SLOTS) {
    const slotEl = document.createElement("div");
    slotEl.className = "slot-group";

    const sessionsInSlot = state.sessions.filter(s => s.slot === slot);
    const timeLimit      = sessionsInSlot[0]?.timeLimit ?? 90;
    const trackLabel     = sessionsInSlot.map(s => s.id).join(" · ");

    const slotHeader = document.createElement("div");
    slotHeader.className = "slot-header";
    slotHeader.innerHTML = `<span class="slot-label">Slot ${slot}</span><span class="slot-time">${timeLimit} min / track</span>`;
    slotEl.appendChild(slotHeader);

    const tracksRow = document.createElement("div");
    tracksRow.className = "tracks-row";

    for (const session of sessionsInSlot) {
      tracksRow.appendChild(renderSessionBox(session));
    }
    slotEl.appendChild(tracksRow);

    // Star balance warning between A and B
    if (sessionsInSlot.length === 2) {
      const stars = sessionsInSlot.map(s =>
        state.papers.filter(p => p.sessionId === s.id && p.featured).length
      );
      if (Math.abs(stars[0] - stars[1]) >= 2) {
        const warn = document.createElement("div");
        warn.className = "star-balance-warn";
        warn.textContent = `★ imbalance: ${sessionsInSlot[0].id} has ${stars[0]}, ${sessionsInSlot[1].id} has ${stars[1]} featured papers`;
        slotEl.appendChild(warn);
      }
    }

    container.appendChild(slotEl);
  }

  // Restore any cards that were open before the re-render (no animation)
  flippedIds.forEach(id => {
    const card  = document.querySelector(`.paper-card[data-paper-id="${id}"]`);
    if (!card) return;
    const front = card.querySelector(".card-front");
    const back  = card.querySelector(".card-back");
    if (front && back) {
      front.style.display = "none";
      back.style.display  = "block";
      card.classList.add("flipped");
    }
  });
}

function renderSessionBox(session) {
  const papers = sortedSessionPapers(session.id);
  const totalTime = papers.reduce((s, p) => s + (p.length || 0), 0);
  const starCount = papers.filter(p => p.featured).length;
  const pct  = Math.min(100, (totalTime / session.timeLimit) * 100);
  const over = totalTime > session.timeLimit;

  const box = document.createElement("div");
  box.className = "session-box";
  box.dataset.sessionId = session.id;

  // ── Header ──
  const header = document.createElement("div");
  header.className = "session-header";

  // Editable name
  const nameEl = document.createElement("span");
  nameEl.className     = "session-name";
  nameEl.contentEditable = "true";
  nameEl.spellcheck    = false;
  nameEl.textContent   = session.name || session.id;
  nameEl.dataset.sessionId = session.id;

  // Autocomplete on name field
  attachAutocomplete(nameEl, val => {
    session.name = val;
    sheetPost(new URLSearchParams({ action: "renameSession", sessionId: session.id, name: val }));
  });

  nameEl.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); nameEl.blur(); }
  });

  const badges = document.createElement("span");
  badges.className = "session-badges";
  if (starCount) {
    const sb = document.createElement("span");
    sb.className = "star-badge";
    sb.title = `${starCount} featured paper(s)`;
    sb.textContent = `★ ${starCount}`;
    badges.appendChild(sb);
  }
  badges.innerHTML += `<span class="paper-count-badge">${papers.length} papers</span>`;

  // Config drawer toggle
  const configBtn = document.createElement("button");
  configBtn.className = "config-btn";
  configBtn.title     = "Configure gravity";
  configBtn.textContent = "⚙";
  configBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openAttractionDrawer(session);
  });

  header.append(nameEl, badges, configBtn);

  // ── Time bar ──
  const timeBar = document.createElement("div");
  timeBar.className = "time-bar-wrap";
  timeBar.innerHTML = `
    <div class="time-bar-track">
      <div class="time-bar-fill${over ? " over" : ""}" style="width:${pct}%"></div>
    </div>
    <span class="time-bar-label${over ? " over" : ""}">${totalTime} / ${session.timeLimit} min</span>
  `;

  // ── Papers list ──
  const paperList = document.createElement("div");
  paperList.className = "paper-list";
  paperList.dataset.sessionId = session.id;

  // Drop zone for dragged paper cards
  paperList.addEventListener("dragover", e => {
    e.preventDefault();
    paperList.classList.add("drag-over");
  });
  paperList.addEventListener("dragleave", () => paperList.classList.remove("drag-over"));
  paperList.addEventListener("drop", e => {
    e.preventDefault();
    paperList.classList.remove("drag-over");
    const paperId = e.dataTransfer.getData("text/plain");
    if (paperId) handleAssign(paperId, session.id);
  });

  for (const paper of papers) {
    paperList.appendChild(renderPaperCard(paper, session));
  }

  box.append(header, timeBar, paperList);
  return box;
}

function renderPaperCard(paper, session) {
  const color    = AREA_COLORS[paper.primary] || "#888";
  const barWidth = paper.ptype === "Long" ? 12 : paper.ptype === "Medium" ? 8 : 4;

  const card = document.createElement("div");
  card.className = "paper-card";
  card.draggable = true;
  card.dataset.paperId = paper.id;

  card.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", paper.id);
    card.classList.add("dragging");
    _draggingPaperId   = paper.id;
    _draggingSessionId = session ? session.id : null;
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    _draggingPaperId   = null;
    _draggingSessionId = null;
    document.querySelectorAll(".paper-card.drop-above,.paper-card.drop-below")
      .forEach(c => c.classList.remove("drop-above", "drop-below"));
  });

  // ── Within-session reorder ───────────────────────────────────────────────────
  card.addEventListener("dragover", e => {
    if (!_draggingPaperId || _draggingPaperId === paper.id) return;
    if (_draggingSessionId !== (session ? session.id : null)) return;
    e.preventDefault();
    e.stopPropagation();
    const mid = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
    document.querySelectorAll(".paper-card.drop-above,.paper-card.drop-below")
      .forEach(c => { if (c !== card) c.classList.remove("drop-above", "drop-below"); });
    card.classList.toggle("drop-above", e.clientY < mid);
    card.classList.toggle("drop-below", e.clientY >= mid);
  });
  card.addEventListener("dragleave", e => {
    if (!e.relatedTarget || !card.contains(e.relatedTarget))
      card.classList.remove("drop-above", "drop-below");
  });
  card.addEventListener("drop", e => {
    const draggedId = _draggingPaperId;
    if (!draggedId || !session || _draggingSessionId !== session.id || draggedId === paper.id) return;
    e.preventDefault();
    e.stopPropagation();
    const ordered = sortedSessionPapers(session.id);
    const fromIdx = ordered.findIndex(p => p.id === draggedId);
    if (fromIdx === -1) return;
    const [moved] = ordered.splice(fromIdx, 1);
    const toIdx   = ordered.findIndex(p => p.id === paper.id);
    const before  = e.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
    ordered.splice(before ? toIdx : toIdx + 1, 0, moved);
    savePaperOrder(session.id, ordered.map(p => p.id));
    card.classList.remove("drop-above", "drop-below");
    renderPanel();
  });

  // ── Front face ──────────────────────────────────────────────────────────────
  const front = document.createElement("div");
  front.className = "card-front";

  const bar = document.createElement("span");
  bar.className = "paper-bar";
  bar.style.cssText = `background:${color};width:${barWidth}px;`;

  const icons = document.createElement("span");
  icons.className = "paper-icons";

  const starIcon = document.createElement("span");
  starIcon.className = paper.featured ? "paper-star active" : "paper-star";
  starIcon.textContent = "★";
  starIcon.title = paper.featured ? "Featured — click to remove" : "Click to mark as featured";
  starIcon.addEventListener("click", async (e) => {
    e.stopPropagation();
    paper.featured = !paper.featured;
    starIcon.className = paper.featured ? "paper-star active" : "paper-star";
    renderPanel();
    await sheetPost(new URLSearchParams({ action: "toggleFeatured", paperId: paper.id, value: paper.featured }));
  });

  const wifiIcon = document.createElement("span");
  wifiIcon.className = paper.remote ? "paper-wifi active" : "paper-wifi";
  wifiIcon.textContent = "⌁";
  wifiIcon.title = paper.remote ? "Remote — click to remove" : "Click to mark as remote";
  wifiIcon.addEventListener("click", async (e) => {
    e.stopPropagation();
    paper.remote = !paper.remote;
    wifiIcon.className = paper.remote ? "paper-wifi active" : "paper-wifi";
    renderPanel();
    await sheetPost(new URLSearchParams({ action: "toggleRemote", paperId: paper.id, value: paper.remote }));
  });

  icons.append(starIcon, wifiIcon);

  const info = document.createElement("span");
  info.className = "paper-info";
  info.innerHTML = `<span class="paper-title">${truncate(paper.title, 60)}</span><span class="paper-authors"> · ${truncate(paper.authors, 40)}</span>`;

  const unBtn = document.createElement("button");
  unBtn.className = "unassign-btn";
  unBtn.title     = "Return to simulation";
  unBtn.textContent = "↩";
  unBtn.addEventListener("click", (e) => { e.stopPropagation(); handleAssign(paper.id, null); });

  const topRow = document.createElement("div");
  topRow.className = "paper-card-top";
  topRow.append(bar, icons, info, unBtn);
  front.appendChild(topRow);

  // ── Back face ───────────────────────────────────────────────────────────────
  const back = document.createElement("div");
  back.className = "card-back";
  back.style.display = "none";

  const backHeader = document.createElement("div");
  backHeader.className = "card-back-header";

  const backBar = document.createElement("span");
  backBar.className = "paper-bar";
  backBar.style.cssText = `background:${color};width:${barWidth}px;flex-shrink:0;height:100%;`;

  const backTitle = document.createElement("span");
  backTitle.className = "card-back-title";
  backTitle.textContent = paper.title;

  const closeBtn = document.createElement("button");
  closeBtn.className = "card-back-close";
  closeBtn.title = "Close";
  closeBtn.textContent = "×";

  backHeader.append(backBar, backTitle, closeBtn);
  back.append(backHeader, buildExpandedContent(paper));

  // ── Flip animation ──────────────────────────────────────────────────────────
  let flipped = false;
  function doFlip(e) {
    if (e) e.stopPropagation();
    const wasFlipped = flipped;
    card.style.transition = "transform 0.14s ease-in";
    card.style.transform  = "scaleX(0)";
    card.addEventListener("transitionend", () => {
      if (!flipped) {
        front.style.display = "none";
        back.style.display  = "block";
        card.classList.add("flipped");
      } else {
        back.style.display  = "none";
        front.style.display = "block";
        card.classList.remove("flipped");
      }
      flipped = !flipped;
      card.style.transition = "transform 0.14s ease-out";
      requestAnimationFrame(() => {
        card.style.transform = "scaleX(1)";
        card.addEventListener("transitionend", () => {
          card.style.transition = "";
          card.style.transform  = "";
          // Flush deferred panel update when closing the card
          if (wasFlipped && _pendingPanelRender && !_isEditing()) {
            renderPanel();
            _pendingPanelRender = false;
          }
        }, { once: true });
      });
    }, { once: true });
  }

  topRow.addEventListener("click", doFlip);
  closeBtn.addEventListener("click", doFlip);

  card.append(front, back);
  return card;
}

function buildExpandedContent(paper) {
  const el = document.createElement("div");
  el.className = "expanded-inner";

  // Keywords
  if (paper.keywords) {
    const kwWrap = document.createElement("div");
    kwWrap.className = "ideas-wrap";
    kwWrap.innerHTML = `<div class="ideas-label">Keywords</div>`;
    const chips = document.createElement("div");
    chips.className = "chips-row";
    paper.keywords.split(/[;,]/).map(s => s.trim()).filter(Boolean).forEach(kw => {
      const chip = document.createElement("span");
      chip.className = "idea-chip kw-chip";
      chip.textContent = kw;
      chips.appendChild(chip);
    });
    kwWrap.appendChild(chips);
    el.appendChild(kwWrap);
  }

  // Abstract
  const abs = document.createElement("p");
  abs.className = "expanded-abstract";
  abs.textContent = paper.abstract || "No abstract available.";
  el.appendChild(abs);

  // AI ideas (read-only chips)
  const aiIdeas = [paper.idea1, paper.idea2, paper.idea3].filter(Boolean);
  if (aiIdeas.length) {
    const aiWrap = document.createElement("div");
    aiWrap.className = "ideas-wrap";
    aiWrap.innerHTML = `<div class="ideas-label">AI session ideas</div>`;
    const chips = document.createElement("div");
    chips.className = "chips-row";
    aiIdeas.forEach(idea => {
      const chip = document.createElement("span");
      chip.className = "idea-chip ai-chip";
      chip.textContent = idea;
      chips.appendChild(chip);
    });
    aiWrap.appendChild(chips);
    el.appendChild(aiWrap);
  }

  // User-added ideas
  const userWrap = document.createElement("div");
  userWrap.className = "ideas-wrap";
  userWrap.innerHTML = `<div class="ideas-label">Session ideas</div>`;
  const userChips = document.createElement("div");
  userChips.className = "chips-row";
  userChips.id = "user-ideas-" + paper.id;

  const userIdeas = paper.userIdeas ? paper.userIdeas.split(";").map(s => s.trim()).filter(Boolean) : [];
  userIdeas.forEach(idea => userChips.appendChild(makeUserChip(paper, idea)));

  const addInput = buildIdeaInput(paper, userChips);
  userWrap.append(userChips, addInput);
  el.appendChild(userWrap);

  return el;
}

function makeUserChip(paper, idea) {
  const chip = document.createElement("span");
  chip.className = "idea-chip user-chip";
  chip.innerHTML = `${idea} <button class="chip-remove" title="Remove">×</button>`;
  chip.querySelector(".chip-remove").addEventListener("click", async () => {
    paper.userIdeas = paper.userIdeas.split(";").map(s => s.trim()).filter(s => s && s !== idea).join("; ");
    chip.remove();
    await sheetPost(new URLSearchParams({ action: "removeSessionIdea", paperId: paper.id, idea }));
    buildAutocompletePool(); // refresh pool
  });
  return chip;
}

function buildIdeaInput(paper, chipsContainer) {
  const wrap = document.createElement("div");
  wrap.className = "idea-input-wrap";

  const input = document.createElement("input");
  input.type        = "text";
  input.placeholder = "Add a session idea…";
  input.className   = "idea-input";

  const acList = document.createElement("ul");
  acList.className = "autocomplete-list";

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    acList.innerHTML = "";
    if (!q) { acList.style.display = "none"; return; }
    const matches = getAutocompletePool()
      .filter(s => s.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { acList.style.display = "none"; return; }
    acList.style.display = "block";
    matches.forEach(m => {
      const li = document.createElement("li");
      li.textContent = m;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        commitIdea(paper, m, input, acList, chipsContainer);
      });
      acList.appendChild(li);
    });
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value.trim();
      if (val) commitIdea(paper, val, input, acList, chipsContainer);
    }
    if (e.key === "Escape") { acList.style.display = "none"; }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => { acList.style.display = "none"; }, 150);
  });

  wrap.append(input, acList);
  return wrap;
}

async function commitIdea(paper, idea, input, acList, chipsContainer) {
  idea = idea.trim();
  if (!idea) return;
  const existing = paper.userIdeas ? paper.userIdeas.split(";").map(s => s.trim()) : [];
  if (existing.includes(idea)) return;
  paper.userIdeas = existing.concat(idea).join("; ");
  chipsContainer.appendChild(makeUserChip(paper, idea));
  input.value = "";
  acList.style.display = "none";
  await sheetPost(new URLSearchParams({ action: "addSessionIdea", paperId: paper.id, idea }));
  buildAutocompletePool();
}

// ── Autocomplete pool ─────────────────────────────────────────────────────────

let _acPool = [];

function buildAutocompletePool() {
  const pool = new Set();
  for (const p of state.papers) {
    [p.idea1, p.idea2, p.idea3].filter(Boolean).forEach(i => pool.add(i.trim()));
    if (p.userIdeas) p.userIdeas.split(";").map(s => s.trim()).filter(Boolean).forEach(i => pool.add(i));
  }
  for (const s of state.sessions) {
    if (s.name) pool.add(s.name);
  }
  _acPool = Array.from(pool).sort();
}

function getAutocompletePool() {
  if (!_acPool.length) buildAutocompletePool();
  return _acPool;
}

function attachAutocomplete(inputEl, onCommit) {
  const acList = document.createElement("ul");
  acList.className = "autocomplete-list name-ac";
  inputEl.parentElement && inputEl.parentElement.style && (inputEl.parentElement.style.position = "relative");
  inputEl.insertAdjacentElement("afterend", acList);

  inputEl.addEventListener("input", () => {
    const q = inputEl.textContent.trim().toLowerCase();
    acList.innerHTML = "";
    if (!q) { acList.style.display = "none"; return; }
    const matches = getAutocompletePool()
      .filter(s => s.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { acList.style.display = "none"; return; }
    acList.style.display = "block";
    matches.forEach(m => {
      const li = document.createElement("li");
      li.textContent = m;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        inputEl.textContent = m;
        acList.style.display = "none";
        onCommit(m);
      });
      acList.appendChild(li);
    });
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(() => {
      acList.style.display = "none";
      const val = inputEl.textContent.trim();
      if (val) onCommit(val);
    }, 150);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { acList.style.display = "none"; }
  });
}

// ── Attraction config drawer ──────────────────────────────────────────────────

function openAttractionDrawer(session) {
  const existing = document.getElementById("attr-drawer");
  if (existing) existing.remove();

  const drawer = document.createElement("div");
  drawer.id = "attr-drawer";
  drawer.innerHTML = `
    <div class="drawer-header">
      <span>${session.id} — Gravitational Attraction</span>
      <button id="drawer-close">×</button>
    </div>
    <div class="drawer-section">
      <label class="drawer-label">Based on historical session</label>
      <select id="based-on-select">
        <option value="">— (manual)</option>
        ${HISTORICAL_SESSIONS.map(s => `<option value="${s.key}" ${session.basedOn === s.key ? "selected" : ""}>${s.key}</option>`).join("")}
      </select>
    </div>
    <div class="drawer-section" id="attractions-list"></div>
    <div class="drawer-section">
      <select id="add-area-select">
        <option value="">+ Add area…</option>
        ${AREA_ORDER.map(a => `<option value="${a}">${AREA_LABELS[a] || a}</option>`).join("")}
      </select>
    </div>
    <div class="drawer-actions">
      <button id="save-attractions">Save</button>
    </div>
  `;

  let currentAttractions = JSON.parse(JSON.stringify(session.attractions || []));

  function renderAttractionsList() {
    const list = drawer.querySelector("#attractions-list");
    list.innerHTML = "";
    currentAttractions.forEach((attr, i) => {
      const row = document.createElement("div");
      row.className = "attr-row";
      row.innerHTML = `
        <span class="attr-area" style="color:${AREA_COLORS[attr.area] || '#888'}">${AREA_LABELS[attr.area] || attr.area}</span>
        <label>Primary <input type="range" min="0" max="1" step="0.05" value="${attr.primaryWeight}" class="attr-primary" data-i="${i}"></label>
        <label>Secondary <input type="range" min="0" max="1" step="0.05" value="${attr.secondaryWeight}" class="attr-secondary" data-i="${i}"></label>
        <button class="attr-remove" data-i="${i}">×</button>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll(".attr-primary").forEach(r => {
      r.addEventListener("input", () => {
        currentAttractions[+r.dataset.i].primaryWeight = parseFloat(r.value);
      });
    });
    list.querySelectorAll(".attr-secondary").forEach(r => {
      r.addEventListener("input", () => {
        currentAttractions[+r.dataset.i].secondaryWeight = parseFloat(r.value);
      });
    });
    list.querySelectorAll(".attr-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        currentAttractions.splice(+btn.dataset.i, 1);
        renderAttractionsList();
      });
    });
  }

  renderAttractionsList();

  drawer.querySelector("#based-on-select").addEventListener("change", e => {
    const key = e.target.value;
    if (key) {
      currentAttractions = JSON.parse(JSON.stringify(getHistoricalAttractions(key)));
      renderAttractionsList();
    }
  });

  drawer.querySelector("#add-area-select").addEventListener("change", e => {
    const area = e.target.value;
    if (!area) return;
    if (!currentAttractions.find(a => a.area === area)) {
      currentAttractions.push({ area, primaryWeight: 0.8, secondaryWeight: 0.3 });
      renderAttractionsList();
    }
    e.target.value = "";
  });

  drawer.querySelector("#drawer-close").addEventListener("click", () => drawer.remove());

  drawer.querySelector("#save-attractions").addEventListener("click", async () => {
    session.attractions = currentAttractions;
    const basedOn = drawer.querySelector("#based-on-select").value;
    session.basedOn = basedOn;
    sim.updateAnchorLabels(state.sessions);
    renderPanel();

    if (basedOn) {
      await sheetPost(new URLSearchParams({
        action:      "linkHistoricalSession",
        sessionId:   session.id,
        basedOn,
        attractions: JSON.stringify(currentAttractions),
      }));
    } else {
      await sheetPost(new URLSearchParams({
        action:      "updateAttraction",
        sessionId:   session.id,
        attractions: JSON.stringify(currentAttractions),
      }));
    }
    drawer.remove();
  });

  document.body.appendChild(drawer);
}

// ── Filter pills ──────────────────────────────────────────────────────────────

function buildFilterPills() {
  const wrap = document.getElementById("filter-pills");
  wrap.innerHTML = "";

  AREA_ORDER.forEach(area => {
    const pill = document.createElement("button");
    pill.className = "filter-pill active";
    pill.style.setProperty("--area-color", AREA_COLORS[area]);
    pill.textContent = AREA_LABELS[area] || area;
    pill.dataset.area = area;
    pill.addEventListener("click", () => toggleFilter(area, pill));
    wrap.appendChild(pill);
  });
}

function toggleFilter(area, pill) {
  if (activeFilter.has(area)) {
    activeFilter.delete(area);
    pill.classList.remove("active");
  } else {
    activeFilter.add(area);
    pill.classList.add("active");
  }
  sim.setFilter(Array.from(activeFilter));
}

// ── Filter panel toggle ───────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("filter-toggle").addEventListener("click", () => {
    document.getElementById("filter-panel").classList.toggle("open");
  });

  document.getElementById("filter-all").addEventListener("click", () => {
    activeFilter = new Set(Object.keys(AREA_COLORS));
    document.querySelectorAll(".filter-pill").forEach(p => p.classList.add("active"));
    sim.setFilter(Array.from(activeFilter));
  });

  document.getElementById("filter-none").addEventListener("click", () => {
    activeFilter = new Set();
    document.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
    sim.setFilter([]);
  });
});

// ── Global stats ──────────────────────────────────────────────────────────────

function updateGlobalStats() {
  buildAutocompletePool();

  const assigned    = state.papers.filter(p => p.sessionId);
  const unassigned  = state.papers.filter(p => !p.sessionId);
  const assignedMin = assigned.reduce((s, p) => s + (p.length || 0), 0);
  const unassMin    = unassigned.reduce((s, p) => s + (p.length || 0), 0);

  document.getElementById("stat-assigned").textContent =
    `${assignedMin} / ${TOTAL_AVAILABLE_MIN} min assigned`;
  document.getElementById("stat-unassigned").textContent =
    `${unassigned.length} papers unassigned (${unassMin} min)`;
}

// ── Search ────────────────────────────────────────────────────────────────────

function initSearch() {
  const input = document.getElementById("search-input");

  input.addEventListener("input", () => {
    searchQuery = input.value.trim().toLowerCase();
    searchResultIndex = 0;
    runSearch();
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Escape") clearSearch();
  });

  document.getElementById("search-clear").addEventListener("click", clearSearch);

  document.querySelectorAll("#search-checkboxes input[type=checkbox]").forEach(cb => {
    if (cb.checked) searchFields.add(cb.dataset.field);
    cb.addEventListener("change", () => {
      if (cb.checked) searchFields.add(cb.dataset.field);
      else            searchFields.delete(cb.dataset.field);
      if (searchFields.size === 0) { cb.checked = true; searchFields.add(cb.dataset.field); }
      runSearch();
    });
  });
}

function clearSearch() {
  document.getElementById("search-input").value = "";
  searchQuery = "";
  searchResultIndex = 0;
  runSearch();
}

function runSearch() {
  const resultsEl = document.getElementById("search-results");

  if (!searchQuery) {
    resultsEl.innerHTML = "";
    resultsEl.classList.remove("has-results");
    sim.setSearch(null);
    return;
  }

  const matches = state.papers.filter(p => paperMatches(p, searchQuery, searchFields));

  if (!matches.length) {
    resultsEl.innerHTML = `<div id="search-results-header">No matches</div>`;
    resultsEl.classList.add("has-results");
    sim.setSearch(new Set());
    return;
  }

  sim.setSearch(new Set(matches.map(p => p.id)));

  resultsEl.innerHTML = "";
  resultsEl.classList.add("has-results");

  const header = document.createElement("div");
  header.id = "search-results-header";
  header.textContent = `${matches.length} paper${matches.length === 1 ? "" : "s"} found`;
  resultsEl.appendChild(header);

  matches.forEach((paper, i) => {
    resultsEl.appendChild(buildResultCard(paper, i));
  });
}

function buildResultCard(paper, i) {
  const color  = AREA_COLORS[paper.primary] || "#888";
  const label  = AREA_LABELS[paper.primary] || paper.primary;
  const q      = searchQuery;

  const card = document.createElement("div");
  card.className = "search-result-card";
  card.dataset.paperId = paper.id;

  const sessionInfo = paper.sessionId
    ? `<span class="src-session">${paper.sessionId}${paper.sessionName ? " · " + paper.sessionName : ""}</span>`
    : "<span>unassigned</span>";

  const starIcon = paper.featured ? " ★" : "";
  const wifiIcon = paper.remote   ? " ⌁" : "";

  card.innerHTML = `
    <div class="src-title">
      <span class="src-area-dot" style="background:${color}"></span>${hlText(paper.title, q)}${starIcon}${wifiIcon}
    </div>
    <div class="src-authors">${hlText(paper.authors, q)}</div>
    <div class="src-meta">
      <span style="color:${color}">${label}</span>
      <span>·</span>
      <span>${paper.type} · ${paper.length} min</span>
      <span>·</span>
      ${sessionInfo}
    </div>
  `;

  // Click: scroll to the paper's session box in the panel, or highlight in sim
  card.addEventListener("click", () => {
    document.querySelectorAll(".search-result-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");

    if (paper.sessionId) {
      // Scroll session box into view in the panel
      const box = document.querySelector(`.session-box[data-session-id="${paper.sessionId}"]`);
      if (box) {
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
        // Briefly highlight the paper card inside the session box
        const pcard = box.querySelector(`.paper-card[data-paper-id="${paper.id}"]`);
        if (pcard) {
          pcard.classList.add("search-match");
          setTimeout(() => pcard.classList.remove("search-match"), 2000);
        }
      }
    } else {
      // Flash the dot in the simulation
      sim.flashPaper(paper.id);
    }
  });

  return card;
}

function paperMatches(paper, query, fields) {
  const terms = query.split(/\s+/).filter(Boolean);
  const haystack = [
    fields.has("title")    ? (paper.title    || "") : "",
    fields.has("authors")  ? (paper.authors  || "") : "",
    fields.has("abstract") ? (paper.abstract || "") : "",
    fields.has("keywords") ? (paper.keywords || "") : "",
  ].join(" ").toLowerCase();
  return terms.every(t => haystack.includes(t));
}

function hlText(text, query) {
  if (!text || !query) return esc(text || "");
  const terms = query.split(/\s+/).filter(Boolean);
  let result = esc(text);
  terms.forEach(term => {
    const re = new RegExp(escRe(esc(term)), "gi");
    result = result.replace(re, m => `<mark>${m}</mark>`);
  });
  return result;
}

function esc(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Export ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("export-btn").addEventListener("click", exportTSV);

  // Flush deferred panel render when focus leaves any text field in the panel
  document.getElementById("panel").addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (_pendingPanelRender && !_isEditing()) {
        renderPanel();
        _pendingPanelRender = false;
      }
    });
  }, true);
});

function exportTSV() {
  const cols = ["Session ID","Session Name","Paper ID","Title","Authors","Primary Area","Type","Length (min)","Featured","Remote"];
  const rows = [cols.join("\t")];
  const sorted = [...state.papers].sort((a, b) => {
    if (a.sessionId < b.sessionId) return -1;
    if (a.sessionId > b.sessionId) return 1;
    return 0;
  });
  for (const p of sorted) {
    rows.push([
      p.sessionId || "(unassigned)",
      p.sessionName || "",
      p.id,
      p.title,
      p.authors,
      AREA_LABELS[p.primary] || p.primary,
      p.type,
      p.length,
      p.featured ? "YES" : "",
      p.remote   ? "YES" : "",
    ].join("\t"));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/tab-separated-values" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "nime2026-sessions.tsv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sheet write helper ────────────────────────────────────────────────────────

async function sheetPost(params) {
  try {
    await fetch(APPS_SCRIPT_URL + "?" + params.toString(), { redirect: "follow" });
  } catch (err) {
    console.warn("Sheet write error:", err);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function truncate(str, n) {
  str = str || "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

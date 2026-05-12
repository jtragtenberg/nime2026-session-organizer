// Code.gs — NIME 2026 Session Organizer — Google Apps Script
// Deploy as Web App: Execute as Me · Who has access: Anyone
// Fill in your Spreadsheet ID below after creating the sheet.

const SPREADSHEET_ID  = "1v2_tsexRnWPkTRzhXjKivdEwVUqUAiJwnPYuPMGR3g8";
const PAPERS_SHEET    = "Papers";
const SESSIONS_SHEET  = "Sessions";

// Column indices (1-based) — Papers sheet
const P_ID          = 1;
const P_TITLE       = 2;
const P_AUTHORS     = 3;
const P_ABSTRACT    = 4;
const P_PRIMARY     = 5;
const P_SECONDARY   = 6;
const P_KEYWORDS    = 7;
const P_LENGTH      = 8;
const P_TYPE        = 9;
const P_IDEA1       = 10;
const P_IDEA2       = 11;
const P_IDEA3       = 12;
const P_FEATURED    = 13;
const P_REMOTE      = 14;
const P_USER_IDEAS  = 15;
const P_SESSION_ID  = 16;
const P_SESSION_NAME= 17;

// Column indices (1-based) — Sessions sheet
const S_ID          = 1;
const S_SLOT        = 2;
const S_TRACK       = 3;
const S_NAME        = 4;
const S_TIME_LIMIT  = 5;
const S_BASED_ON    = 6;
const S_ATTRACTIONS = 7;
const S_PAPER_COUNT = 8;
const S_TOTAL_TIME  = 9;

function doGet(e) {
  const params = e.parameter || {};
  const action = params.action || "read";

  try {
    if (action === "read")                return readAll();
    if (action === "assignPaper")         return assignPaper(params);
    if (action === "renameSession")       return renameSession(params);
    if (action === "updateAttraction")    return updateAttraction(params);
    if (action === "linkHistoricalSession") return linkHistoricalSession(params);
    if (action === "toggleFeatured")      return toggleBool(params, P_FEATURED);
    if (action === "toggleRemote")        return toggleBool(params, P_REMOTE);
    if (action === "addSessionIdea")      return addSessionIdea(params);
    if (action === "removeSessionIdea")   return removeSessionIdea(params);
    return jsonOut({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

// ── Read ───────────────────────────────────────────────────────────────────────

function readAll() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const papersVals   = ss.getSheetByName(PAPERS_SHEET).getDataRange().getValues();
  const sessionsVals = ss.getSheetByName(SESSIONS_SHEET).getDataRange().getValues();

  const papers = papersVals.slice(1).map(r => ({
    id:          String(r[P_ID - 1]).trim(),
    title:       r[P_TITLE - 1],
    authors:     r[P_AUTHORS - 1],
    abstract:    r[P_ABSTRACT - 1],
    primary:     r[P_PRIMARY - 1],
    secondary:   r[P_SECONDARY - 1],
    keywords:    r[P_KEYWORDS - 1],
    length:      Number(r[P_LENGTH - 1]) || 0,
    type:        r[P_TYPE - 1],
    idea1:       r[P_IDEA1 - 1],
    idea2:       r[P_IDEA2 - 1],
    idea3:       r[P_IDEA3 - 1],
    featured:    r[P_FEATURED - 1] === true || r[P_FEATURED - 1] === "TRUE",
    remote:      r[P_REMOTE - 1] === true || r[P_REMOTE - 1] === "TRUE",
    userIdeas:   String(r[P_USER_IDEAS - 1] || ""),
    sessionId:   String(r[P_SESSION_ID - 1] || "").trim(),
    sessionName: String(r[P_SESSION_NAME - 1] || ""),
  }));

  const sessions = sessionsVals.slice(1).map(r => ({
    id:          String(r[S_ID - 1]).trim(),
    slot:        Number(r[S_SLOT - 1]),
    track:       String(r[S_TRACK - 1]).trim(),
    name:        String(r[S_NAME - 1] || ""),
    timeLimit:   Number(r[S_TIME_LIMIT - 1]) || 90,
    basedOn:     String(r[S_BASED_ON - 1] || ""),
    attractions: parseJSON(r[S_ATTRACTIONS - 1], []),
  }));

  return jsonOut({ ok: true, papers, sessions });
}

// ── Write helpers ──────────────────────────────────────────────────────────────

function assignPaper(p) {
  const sh = openSheet(PAPERS_SHEET);
  const row = findPaperRow(sh, p.paperId);
  if (!row) throw new Error("Paper not found: " + p.paperId);
  sh.getRange(row, P_SESSION_ID).setValue(p.sessionId || "");
  sh.getRange(row, P_SESSION_NAME).setValue(p.sessionName || "");
  updateSessionCounts();
  return jsonOut({ ok: true });
}

function renameSession(p) {
  const sh = openSheet(SESSIONS_SHEET);
  const row = findSessionRow(sh, p.sessionId);
  if (!row) throw new Error("Session not found: " + p.sessionId);
  sh.getRange(row, S_NAME).setValue(p.name || "");
  // Also update session name on all papers assigned to this session
  const papers = openSheet(PAPERS_SHEET);
  const ids = papers.getRange(2, P_SESSION_ID, papers.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === p.sessionId) {
      papers.getRange(i + 2, P_SESSION_NAME).setValue(p.name || "");
    }
  }
  return jsonOut({ ok: true });
}

function updateAttraction(p) {
  const sh = openSheet(SESSIONS_SHEET);
  const row = findSessionRow(sh, p.sessionId);
  if (!row) throw new Error("Session not found: " + p.sessionId);
  sh.getRange(row, S_ATTRACTIONS).setValue(p.attractions || "[]");
  return jsonOut({ ok: true });
}

function linkHistoricalSession(p) {
  const sh = openSheet(SESSIONS_SHEET);
  const row = findSessionRow(sh, p.sessionId);
  if (!row) throw new Error("Session not found: " + p.sessionId);
  sh.getRange(row, S_BASED_ON).setValue(p.basedOn || "");
  sh.getRange(row, S_ATTRACTIONS).setValue(p.attractions || "[]");
  return jsonOut({ ok: true });
}

function toggleBool(p, col) {
  const sh = openSheet(PAPERS_SHEET);
  const row = findPaperRow(sh, p.paperId);
  if (!row) throw new Error("Paper not found: " + p.paperId);
  sh.getRange(row, col).setValue(p.value === "true" || p.value === true);
  return jsonOut({ ok: true });
}

function addSessionIdea(p) {
  const sh = openSheet(PAPERS_SHEET);
  const row = findPaperRow(sh, p.paperId);
  if (!row) throw new Error("Paper not found: " + p.paperId);
  const cell = sh.getRange(row, P_USER_IDEAS);
  const cur = String(cell.getValue() || "").trim();
  cell.setValue(cur ? cur + "; " + p.idea : p.idea);
  return jsonOut({ ok: true });
}

function removeSessionIdea(p) {
  const sh = openSheet(PAPERS_SHEET);
  const row = findPaperRow(sh, p.paperId);
  if (!row) throw new Error("Paper not found: " + p.paperId);
  const cell = sh.getRange(row, P_USER_IDEAS);
  const ideas = String(cell.getValue() || "").split(";").map(s => s.trim()).filter(Boolean);
  const updated = ideas.filter(s => s !== p.idea).join("; ");
  cell.setValue(updated);
  return jsonOut({ ok: true });
}

// ── Computed columns ───────────────────────────────────────────────────────────

function updateSessionCounts() {
  const papers   = openSheet(PAPERS_SHEET);
  const sessions = openSheet(SESSIONS_SHEET);
  const lastPaperRow    = papers.getLastRow();
  const lastSessionRow  = sessions.getLastRow();
  if (lastPaperRow < 2 || lastSessionRow < 2) return;

  const paperRows  = papers.getRange(2, 1, lastPaperRow - 1, 17).getValues();
  const sessionIds = sessions.getRange(2, S_ID, lastSessionRow - 1, 1).getValues().map(r => String(r[0]).trim());

  for (let si = 0; si < sessionIds.length; si++) {
    const sid = sessionIds[si];
    let count = 0, totalTime = 0;
    for (const row of paperRows) {
      if (String(row[P_SESSION_ID - 1]).trim() === sid) {
        count++;
        totalTime += Number(row[P_LENGTH - 1]) || 0;
      }
    }
    sessions.getRange(si + 2, S_PAPER_COUNT).setValue(count);
    sessions.getRange(si + 2, S_TOTAL_TIME).setValue(totalTime);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function openSheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}

function findPaperRow(sh, paperId) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const ids = sh.getRange(2, P_ID, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(paperId).trim()) return i + 2;
  }
  return null;
}

function findSessionRow(sh, sessionId) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const ids = sh.getRange(2, S_ID, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(sessionId).trim()) return i + 2;
  }
  return null;
}

function parseJSON(val, fallback) {
  try { return val ? JSON.parse(val) : fallback; } catch { return fallback; }
}

function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

#!/usr/bin/env python3
"""
populate_sheets.py — NIME 2026 Session Organizer
Reads papers-slim.tsv and outputs two TSV files ready to import into Google Sheets.

Usage:
  python3 populate_sheets.py

Output:
  papers-data.tsv   → import into "Papers" sheet
  sessions-data.tsv → import into "Sessions" sheet

Instructions:
  1. Open your Google Spreadsheet
     (https://docs.google.com/spreadsheets/d/1v2_tsexRnWPkTRzhXjKivdEwVUqUAiJwnPYuPMGR3g8)
  2. Create two sheets named exactly: "Papers" and "Sessions"
  3. In the Papers sheet: File → Import → Upload papers-data.tsv
     (Select "Replace current sheet" and "Tab" separator)
  4. In the Sessions sheet: File → Import → Upload sessions-data.tsv
  5. Set up Google Apps Script:
     - Tools → Script editor
     - Paste the contents of Code.gs
     - Set SPREADSHEET_ID = "1v2_tsexRnWPkTRzhXjKivdEwVUqUAiJwnPYuPMGR3g8"
     - Deploy → New deployment → Web app
       · Execute as: Me
       · Who has access: Anyone
     - Copy the deployment URL into config.js as APPS_SCRIPT_URL
"""

import csv
import os

PAPERS_TSV   = os.path.join(os.path.dirname(__file__), "..", "nime2026", "papers-slim.tsv")
OUT_PAPERS   = os.path.join(os.path.dirname(__file__), "papers-data.tsv")
OUT_SESSIONS = os.path.join(os.path.dirname(__file__), "sessions-data.tsv")

# Session time limits (slot → minutes)
SESSION_TIMES = {1: 90, 2: 90, 3: 60, 4: 90, 5: 90, 7: 60, 8: 90, 9: 90}
SLOTS = [1, 2, 3, 4, 5, 7, 8, 9]

# ── Read papers-slim.tsv ───────────────────────────────────────────────────────

papers = []
with open(PAPERS_TSV, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f, delimiter="\t")
    # Strip leading/trailing spaces from column names
    key = {k.strip(): k for k in reader.fieldnames}
    for row in reader:
        def col(name):
            return row.get(key.get(name, name), "").strip()

        papers.append({
            "Paper ID":                 col("Paper ID"),
            "Title":                    col("Title"),
            "Authors":                  col("Authors"),
            "Abstract":                 col("Abstract"),
            "Primary Subject Area":     col("Primary Subject Area"),
            "Secondary Subject Areas":  col("Secondary Subject Areas"),
            "Keywords":                 col("Keywords"),
            "Presentation Length (min)": col("Presentation Length (min)"),
            "Submission Type":          col("Submission Type"),
            "Session Idea 1":           col("Session Idea 1"),
            "Session Idea 2":           col("Session Idea 2"),
            "Session Idea 3":           col("Session Idea 3"),
            "Featured":                 "FALSE",
            "Remote":                   "FALSE",
            "User Session Ideas":       "",
            "Session ID":               "",
            "Session Name":             "",
        })

# ── Write papers-data.tsv ──────────────────────────────────────────────────────

PAPERS_COLS = [
    "Paper ID", "Title", "Authors", "Abstract",
    "Primary Subject Area", "Secondary Subject Areas", "Keywords",
    "Presentation Length (min)", "Submission Type",
    "Session Idea 1", "Session Idea 2", "Session Idea 3",
    "Featured", "Remote", "User Session Ideas",
    "Session ID", "Session Name",
]

with open(OUT_PAPERS, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=PAPERS_COLS, delimiter="\t",
                            extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(papers)

print(f"✓ Wrote {len(papers)} papers to {OUT_PAPERS}")

# ── Write sessions-data.tsv ────────────────────────────────────────────────────

SESSIONS_COLS = [
    "Session ID", "Slot", "Track", "Name", "Time Limit (min)",
    "Based On", "Attracted Areas", "Paper Count", "Total Time (min)",
]

sessions = []
for slot in SLOTS:
    for track in ["A", "B"]:
        sessions.append({
            "Session ID":       f"{slot}{track}",
            "Slot":             slot,
            "Track":            track,
            "Name":             "",
            "Time Limit (min)": SESSION_TIMES[slot],
            "Based On":         "",
            "Attracted Areas":  "[]",
            "Paper Count":      0,
            "Total Time (min)": 0,
        })

with open(OUT_SESSIONS, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=SESSIONS_COLS, delimiter="\t",
                            extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(sessions)

print(f"✓ Wrote {len(sessions)} sessions (slots {SLOTS}) to {OUT_SESSIONS}")

# ── Summary ────────────────────────────────────────────────────────────────────

areas = {}
for p in papers:
    a = p["Primary Subject Area"]
    areas[a] = areas.get(a, 0) + 1

print("\nPrimary areas in dataset:")
for area, count in sorted(areas.items(), key=lambda x: -x[1]):
    print(f"  {count:3d}  {area}")

total_time = sum(int(p["Presentation Length (min)"]) for p in papers if p["Presentation Length (min)"].isdigit())
print(f"\nTotal presentation time: {total_time} min across {len(papers)} papers")
print(f"Total session capacity:  1320 min (660 per track × 2)")
print(f"Fit margin:              {1320 - total_time} min")

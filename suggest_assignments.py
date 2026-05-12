#!/usr/bin/env python3
"""
suggest_assignments.py — NIME 2026 paper-to-session suggestion

Phase 1 : GPT-4 discovers 16 session themes by clustering the AI-generated
           session ideas across 81 papers and relating them to historical NIME
           sessions and their subject-area profiles.
Phase 2 : GPT-4 assigns each paper to the most thematically appropriate
           session, considering: paper ideas, primary/secondary areas, keywords,
           and inferred area-to-session relationships from session titles.
Phase 3 : Algorithmic two-pass greedy + iterative local-search balancing
           to fix any time-limit violations without breaking thematic clusters.

Outputs:
  assignments.tsv  — paper_id → session_id + session_name (import into Sheets)
  session_plan.tsv — session_id → name, areas, paper count, total time
"""

import csv, json, os, re, sys, textwrap
from pathlib import Path
from collections import defaultdict

try:
    from openai import OpenAI
except ImportError:
    sys.exit("Run:  pip install openai")

BASE = Path(__file__).parent
PAPERS_TSV   = BASE / "papers-data.tsv"
SESSIONS_TSV = BASE / "sessions-data.tsv"
OUT_ASSIGN   = BASE / "assignments.tsv"
OUT_PLAN     = BASE / "session_plan.tsv"
OUT_MD       = BASE / "suggested_sessions.md"

# ── Historical session → area profiles ────────────────────────────────────────

HISTORICAL_MD = """
NIME 2025 sessions and their dominant subject areas:
- Accessibility: Accessible interfaces for musical expression
- Body and Motion: Motion/gesture, Novel controllers, Sensors/actuators, ML performance
- Collective and Embodied: Cultural impact, Novel controllers, Accessible interfaces, Motion/gesture
- Entangled NIME: Communities/cross-cultural NIME (2026 theme)
- Environment, Sustainability, Longevity: Communities, ML, Practice-based research
- Extended Reality: XR/AR/VR environments, User evaluation
- Historical and Cultural Reflections: Cultural impact, Historical/philosophical, Novel controllers
- Machine Learning and Co-Creativity: Novel controllers, ML performance, HCI, Motion/gesture
- Novel Techniques and Technologies: Novel controllers, Augmented instruments, Communities/Entangled

NIME 2024 sessions and their dominant subject areas:
- Reflections on Impact, Longevity, and Sustainability: Cultural impact, Practice-based research
- Embracing Resistance and Failure: Augmented instruments, Novel controllers, Practice-based research
- Data, Materials, and More-than-Human: Augmented instruments, Interactive sound art, ML, HCI
- Revisiting and Extending Previous NIMEs: ML, Novel controllers, Software frameworks, Sensors
- Designing and Performing with AI: ML performance, Generative algorithms, Musical mapping
- NIMEs in the Metaverse and VR: XR/AR/VR environments
- Co- and Participatory Design for Accessible Instruments: Accessible interfaces
- Sensor and Actuators in Haptic Instruments: Sensors/actuators, Accessible interfaces
- Feminist Technoscience and Cross-Cultural NIMEs: Cultural impact, Accessible interfaces, Practice-based
- User Perception and Audience Participation: User evaluation, HCI, Novel controllers
- Gestural Interfaces, Inputs, and Mappings: Motion/gesture, Novel controllers

NIME 2026 subject areas available:
1. Accessible interfaces for musical expression
2. Augmented, embedded and hyper instruments
3. Discussions about the artistic, cultural, and social impact of NIME technology
4. Evaluation and user studies of new interfaces for musical expression
5. Explorations of relationships between motion, gesture and music
6. Extended reality environments: augmented, virtual, mixed reality
7. Historical, theoretical, critical, or philosophical discussions about designing or performing with new interfaces
8. Interactive sound art and installations
9. Machine learning in musical performance
10. Musical applications of robotics
11. NIME 2026 theme: Communities. Topic 1: interviews with, reports on, or collaborations with artists/makers outside the NIME academic community
12. Novel controllers, interfaces or instruments for musical expression
13. Pedagogical perspectives or reports on student projects in the framework of NIME
14. Performance rendering and generative algorithms
15. Practice-based research approaches/methodologies/criticism
16. Sensor and actuator technologies, including haptics and force feedback devices
17. Software frameworks, interface protocols, and data formats, for supporting musical interaction
18. Technologies or systems for collaborative music-making
"""

# ── Load data ─────────────────────────────────────────────────────────────────

def load_papers():
    with open(PAPERS_TSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))

def load_sessions():
    with open(SESSIONS_TSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))

# ── GPT helpers ───────────────────────────────────────────────────────────────

def gpt(client, system, user, model="gpt-4-turbo", max_tokens=4000, temperature=0.2):
    resp = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    )
    return resp.choices[0].message.content.strip()

def extract_json(text):
    m = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
    if not m:
        raise ValueError("No JSON found:\n" + text[:600])
    return json.loads(m.group(1))

# ── Phase 1: Discover session themes ─────────────────────────────────────────

def phase1_discover_themes(client, papers, sessions):
    print("Phase 1: discovering session themes via GPT-4…")

    # Compact paper idea list
    idea_lines = []
    for p in papers:
        ideas = [p.get(f"Session Idea {i}", "").strip() for i in (1, 2, 3)]
        ideas = [x for x in ideas if x]
        area  = p["Primary Subject Area"][:60]
        idea_lines.append(f"[{p['Paper ID']}] {area} | " + " / ".join(ideas))

    slot_caps = {}
    for s in sessions:
        slot_caps[s["Session ID"]] = s["Time Limit (min)"]
    slot_info = "  " + ", ".join(
        f"{sid}({cap}min)" for sid, cap in sorted(slot_caps.items())
    )

    system = textwrap.dedent("""
        You are the program chair of NIME 2026 (New Interfaces for Musical Expression).
        Your task: design 16 distinct, thematically rich paper sessions for the conference.

        Guidelines:
        - Sessions run in parallel tracks A and B within each time slot; parallel sessions
          must be clearly distinct so the audience has a real choice.
        - Slots 3 and 7 are 60-minute sessions (plan for ~4 papers).
          Slots 1, 2, 4, 5, 8, 9 are 90-minute sessions (plan for ~5–6 papers).
        - Session names should be evocative and 3–6 words, inspired by historical NIME
          naming conventions.
        - Base each session on patterns visible in the paper ideas and subject areas.
        - Infer area relationships from session titles (e.g. "Body and Motion" naturally
          attracts sensor/actuator, gesture, and HCI papers).
    """).strip()

    user = textwrap.dedent(f"""
    PAPER IDEAS (paper_id | primary subject area | three AI-generated session title ideas):
    {chr(10).join(idea_lines)}

    SESSION SLOTS:
    {slot_info}

    HISTORICAL NIME SESSION CONTEXT (for naming inspiration and area inference):
    {HISTORICAL_MD}

    TASK:
    Design exactly 16 paper session themes — one for each slot-track combination:
    1A, 1B, 2A, 2B, 3A, 3B, 4A, 4B, 5A, 5B, 7A, 7B, 8A, 8B, 9A, 9B.

    For each session return:
    - "id": session ID (e.g. "1A")
    - "name": evocative 3–6 word session title
    - "based_on": closest past NIME session name, or ""
    - "primary_areas": list of 1–3 subject area names most central to this theme
      (use exact area strings from the list above)
    - "secondary_areas": list of 0–3 supporting subject area strings
    - "rationale": one sentence explaining the theme

    Constraints:
    - Parallel sessions in the same slot (e.g. 1A and 1B) must be distinct themes.
    - Ensure every of the 18 subject areas appears in at least one session's areas.

    Return ONLY valid JSON — an array of exactly 16 objects with the fields above.
    """).strip()

    reply  = gpt(client, system, user, max_tokens=3000)
    themes = extract_json(reply)
    print(f"  Received {len(themes)} session themes")
    return {t["id"]: t for t in themes}

# ── Phase 2: Assign papers to sessions ───────────────────────────────────────

def phase2_assign(client, papers, themes, sessions):
    print("Phase 2: assigning papers to sessions via GPT-4…")

    session_limits = {s["Session ID"]: int(s["Time Limit (min)"]) for s in sessions}

    theme_lines = []
    for sid, t in sorted(themes.items()):
        lim = session_limits.get(sid, 90)
        pa  = ", ".join(t.get("primary_areas", [])[:2])
        theme_lines.append(
            f"  {sid} ({lim}min) '{t['name']}' | primary: {pa} | {t.get('rationale','')[:80]}"
        )

    paper_lines = []
    for p in papers:
        ideas = " / ".join(filter(None, [
            p.get("Session Idea 1", "").strip(),
            p.get("Session Idea 2", "").strip(),
            p.get("Session Idea 3", "").strip(),
        ]))
        sec   = p.get("Secondary Subject Areas", "").strip()
        paper_lines.append(
            f"  [{p['Paper ID']}] {p['Presentation Length (min)']}min "
            f"primary={p['Primary Subject Area'][:50]} | "
            f"secondary={sec[:40]} | "
            f"title={p['Title'][:55]} | ideas: {ideas}"
        )

    system = textwrap.dedent("""
        You are a NIME 2026 program chair assigning 81 accepted papers to 16 sessions.
        Maximize thematic fit while keeping every session within its time budget.
        Consider the paper's primary area, secondary areas, title, and AI session ideas.
    """).strip()

    user = textwrap.dedent(f"""
    SESSION THEMES:
    {chr(10).join(theme_lines)}

    PAPERS (id | duration | primary area | secondary areas | title | session ideas):
    {chr(10).join(paper_lines)}

    TASK:
    Assign every paper to exactly one session.

    Rules:
    1. Thematic fit: primary area and session ideas should match the session theme.
    2. Time budget (hard):
       - 60-min sessions: total paper minutes ≤ 60
       - 90-min sessions: total paper minutes ≤ 90
    3. All 81 papers must be assigned.
    4. Papers that match multiple themes: prefer the session where the match is strongest.

    Return ONLY valid JSON: one object mapping paper_id (string) → session_id (string).
    Example: {{"223": "1A", "172": "3B", ...}}
    Include all 81 paper IDs.
    """).strip()

    reply = gpt(client, system, user, max_tokens=2500)
    raw   = extract_json(reply)
    return {str(k): str(v) for k, v in raw.items()}

# ── Phase 3: Two-pass greedy to fix time overflows ────────────────────────────

OVERAGE_TOLERANCE = 1.10  # sessions may run up to 10% over their nominal limit

def phase3_balance(papers, assignment, sessions, themes):
    """Fix time-limit violations via two strategies:
    1. Move over-budget papers to sessions with slack (best affinity)
    2. Cascade swaps when no direct move is possible
    Sessions are considered over-budget only when they exceed limit * OVERAGE_TOLERANCE.
    """
    print("Phase 3: balancing time limits…")

    paper_by_id    = {p["Paper ID"]: p for p in papers}
    session_ids    = [s["Session ID"] for s in sessions]
    session_limits = {s["Session ID"]: int(s["Time Limit (min)"]) for s in sessions}
    effective_caps = {sid: int(lim * OVERAGE_TOLERANCE) for sid, lim in session_limits.items()}

    def loads():
        d = defaultdict(int)
        for pid, sid in assignment.items():
            d[sid] += int(paper_by_id[pid]["Presentation Length (min)"])
        return d

    def over_sessions(ld):
        return [sid for sid in session_ids if ld[sid] > effective_caps[sid]]

    n_moves = 0
    for iteration in range(200):
        ld = loads()
        over = over_sessions(ld)
        if not over:
            break

        moved = False
        for sid_over in over:
            # Papers in this session, smallest first (easier to relocate)
            papers_here = sorted(
                [(pid, int(paper_by_id[pid]["Presentation Length (min)"]))
                 for pid, sid in assignment.items() if sid == sid_over],
                key=lambda x: x[1]
            )
            for pid, dur in papers_here:
                # Find any non-parallel session with enough slack
                slot_over = next(s["Slot"] for s in sessions if s["Session ID"] == sid_over)
                candidates = [
                    s for s in session_ids
                    if s != sid_over
                    and next(sess["Slot"] for sess in sessions if sess["Session ID"] == s) != slot_over
                    and ld[s] + dur <= effective_caps[s]
                ]
                if candidates:
                    # Pick the one with most remaining slack to minimise future pressure
                    target = max(candidates, key=lambda s: session_limits[s] - ld[s])
                    assignment[pid] = target
                    ld[sid_over] -= dur
                    ld[target]   += dur
                    n_moves += 1
                    moved = True
                    break
            if moved:
                break

        if not moved:
            print(f"  ⚠ Could not resolve overflow for {over} — trying cascade swap…")
            # Cascade: find a paper in a non-over session that can give its spot
            # to an over-session paper by moving elsewhere
            for sid_over in over:
                papers_here = sorted(
                    [(pid, int(paper_by_id[pid]["Presentation Length (min)"]))
                     for pid, sid in assignment.items() if sid == sid_over],
                    key=lambda x: x[1]
                )
                cascaded = False
                for pid_move, dur_move in papers_here:
                    slot_over = next(s["Slot"] for s in sessions if s["Session ID"] == sid_over)
                    for sid_mid in session_ids:
                        if sid_mid == sid_over:
                            continue
                        slot_mid = next(s["Slot"] for s in sessions if s["Session ID"] == sid_mid)
                        if slot_mid == slot_over:
                            continue
                        # Would pid_move fit in sid_mid if we first move something out of sid_mid?
                        if ld[sid_mid] + dur_move > session_limits[sid_mid]:
                            # Try to free space in sid_mid
                            need = dur_move - (session_limits[sid_mid] - ld[sid_mid])
                            for pid_out, dur_out in sorted(
                                [(pid, int(paper_by_id[pid]["Presentation Length (min)"]))
                                 for pid, sid in assignment.items() if sid == sid_mid],
                                key=lambda x: x[1]
                            ):
                                if dur_out >= need:
                                    # Find a new home for pid_out
                                    slot_out_home = slot_mid
                                    for sid_dest in session_ids:
                                        if sid_dest in (sid_over, sid_mid):
                                            continue
                                        slot_dest = next(s["Slot"] for s in sessions if s["Session ID"] == sid_dest)
                                        if slot_dest in (slot_over, slot_out_home):
                                            continue
                                        if ld[sid_dest] + dur_out <= effective_caps[sid_dest]:
                                            # Perform the cascade
                                            assignment[pid_out]  = sid_dest
                                            assignment[pid_move] = sid_mid
                                            ld[sid_mid]  += dur_move - dur_out
                                            ld[sid_over] -= dur_move
                                            ld[sid_dest] += dur_out
                                            n_moves += 2
                                            cascaded = True
                                            print(f"  Cascade: {pid_move}→{sid_mid}, {pid_out}→{sid_dest}")
                                            break
                                if cascaded:
                                    break
                            if cascaded:
                                break
                    if cascaded:
                        break
                if not cascaded:
                    print(f"  ⚠ Could not fix overflow in {sid_over}")
                    break
            if not cascaded:
                break

    final_ld = loads()
    still_over = over_sessions(final_ld)
    if still_over:
        print(f"  {len(still_over)} session(s) still over limit: {still_over}")
    else:
        print(f"  All sessions within time limits — {n_moves} moves total")

    return assignment

# ── Output ────────────────────────────────────────────────────────────────────

def write_outputs(papers, sessions, assignment, themes):
    paper_by_id    = {p["Paper ID"]: p for p in papers}
    session_ids    = [s["Session ID"] for s in sessions]
    session_limits = {s["Session ID"]: int(s["Time Limit (min)"]) for s in sessions}

    sess_papers = defaultdict(list)
    for pid, sid in assignment.items():
        sess_papers[sid].append(pid)

    # ── assignments.tsv ──
    with open(OUT_ASSIGN, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["Paper ID", "Title", "Primary Area", "Length (min)",
                    "Session ID", "Session Name"])
        for sid in sorted(session_ids):
            theme = themes.get(sid, {})
            sname = theme.get("name", "")
            for pid in sorted(sess_papers[sid],
                              key=lambda p: -int(paper_by_id[p]["Presentation Length (min)"])):
                p = paper_by_id[pid]
                w.writerow([pid, p["Title"], p["Primary Subject Area"],
                             p["Presentation Length (min)"], sid, sname])
    print(f"Wrote {OUT_ASSIGN.name}")

    # ── session_plan.tsv ──
    with open(OUT_PLAN, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["Session ID", "Name", "Based On",
                    "Primary Areas", "Secondary Areas",
                    "Time Limit", "Total Time", "Papers"])
        for sid in sorted(session_ids):
            t     = themes.get(sid, {})
            pids  = sess_papers.get(sid, [])
            total = sum(int(paper_by_id[pid]["Presentation Length (min)"]) for pid in pids)
            w.writerow([
                sid,
                t.get("name", ""),
                t.get("based_on", ""),
                "; ".join(t.get("primary_areas", [])),
                "; ".join(t.get("secondary_areas", [])),
                session_limits.get(sid, ""),
                total,
                len(pids),
            ])
    print(f"Wrote {OUT_PLAN.name}")

    # ── suggested_sessions.md ──
    slot_labels = {
        "1": "Slot 1 — 90 min", "2": "Slot 2 — 90 min",
        "3": "Slot 3 — 60 min", "4": "Slot 4 — 90 min",
        "5": "Slot 5 — 90 min", "7": "Slot 7 — 60 min",
        "8": "Slot 8 — 90 min", "9": "Slot 9 — 90 min",
    }
    ptype_min = {"Short": 10, "Medium": 13, "Long": 17}
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("# NIME 2026 — Suggested Paper Sessions\n\n")
        f.write("_Generated by suggest_assignments.py using GPT-4 Turbo._\n\n")
        f.write("---\n\n")

        prev_slot = None
        for sid in sorted(session_ids):
            slot = sid[:-1]
            if slot != prev_slot:
                f.write(f"## {slot_labels.get(slot, f'Slot {slot}')}\n\n")
                prev_slot = slot

            t     = themes.get(sid, {})
            pids  = sess_papers.get(sid, [])
            total = sum(int(paper_by_id[pid]["Presentation Length (min)"]) for pid in pids)
            cap   = session_limits.get(sid, 90)
            over  = " ⚠ OVER LIMIT" if total > cap else ""
            based = f" · based on: *{t['based_on']}*" if t.get("based_on") else ""
            pa    = ", ".join(t.get("primary_areas", []))
            sa    = ", ".join(t.get("secondary_areas", []))

            f.write(f"### Session {sid} — {t.get('name', '')}\n\n")
            f.write(f"**{total}/{cap} min ({len(pids)} papers)**{over}{based}\n\n")
            if t.get("rationale"):
                f.write(f"_{t['rationale']}_\n\n")
            if pa:
                f.write(f"**Primary areas:** {pa}  \n")
            if sa:
                f.write(f"**Secondary areas:** {sa}  \n")
            f.write("\n")

            for pid in sorted(pids, key=lambda p: -int(paper_by_id[p]["Presentation Length (min)"])):
                pp   = paper_by_id[pid]
                dur  = pp["Presentation Length (min)"]
                ptype = pp.get("Submission Type", "").strip() or (
                    "Long" if int(dur) == 17 else "Medium" if int(dur) == 13 else "Short"
                )
                ideas = [
                    pp.get(f"Session Idea {i}", "").strip()
                    for i in (1, 2, 3)
                ]
                ideas = [x for x in ideas if x]
                kws   = [k.strip() for k in re.split(r"[;,]", pp.get("Keywords", "")) if k.strip()]
                sec   = [s.strip() for s in pp.get("Secondary Subject Areas", "").split(";") if s.strip()]

                f.write(f"#### [{pid}] {pp['Title']}\n\n")
                f.write(f"- **Authors:** {pp['Authors']}\n")
                f.write(f"- **Type:** {ptype} ({dur} min)\n")
                f.write(f"- **Primary area:** {pp['Primary Subject Area']}\n")
                if sec:
                    f.write(f"- **Secondary areas:** {'; '.join(sec)}\n")
                if kws:
                    f.write(f"- **Keywords:** {', '.join(kws)}\n")
                if ideas:
                    f.write(f"- **AI session ideas:** {' / '.join(ideas)}\n")
                f.write("\n")

    print(f"Wrote {OUT_MD.name}")

    # ── terminal summary ──
    print()
    print(f"{'ID':>3}  {'Session Name':<40}  {'Used':>4}/{'Cap':>3}  {'#':>3}  Based on")
    print("─" * 82)
    for sid in sorted(session_ids):
        t     = themes.get(sid, {})
        pids  = sess_papers.get(sid, [])
        total = sum(int(paper_by_id[pid]["Presentation Length (min)"]) for pid in pids)
        cap   = session_limits.get(sid, 90)
        flag  = " ⚠" if total > int(cap * OVERAGE_TOLERANCE) else ""
        bom   = t.get("based_on", "")[:34]
        print(f"{sid:>3}  {t.get('name',''):<40}  {total:>4}/{cap:<3}  {len(pids):>3}  {bom}{flag}")

    print()
    unassigned = [p["Paper ID"] for p in papers if p["Paper ID"] not in assignment]
    if unassigned:
        print(f"⚠  Unassigned: {unassigned}")
    else:
        total_used = sum(int(paper_by_id[pid]["Presentation Length (min)"]) for pid in assignment)
        total_cap  = sum(session_limits.values())
        print(f"✓  All 81 papers assigned — {total_used}/{total_cap} min used")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit("Set OPENAI_API_KEY environment variable.")

    client   = OpenAI(api_key=api_key)
    papers   = load_papers()
    sessions = load_sessions()

    total_min = sum(int(p["Presentation Length (min)"]) for p in papers)
    cap_min   = sum(int(s["Time Limit (min)"]) for s in sessions)
    print(f"Papers: {len(papers)}  |  Sessions: {len(sessions)}")
    print(f"Paper time: {total_min} min  |  Capacity: {cap_min} min  |  Slack: {cap_min-total_min} min\n")

    themes     = phase1_discover_themes(client, papers, sessions)

    print("\nProposed session themes:")
    for sid in sorted(themes):
        t = themes[sid]
        print(f"  {sid}: {t['name']}")
        if t.get("based_on"):
            print(f"       ← based on: {t['based_on']}")
        pa = t.get("primary_areas", [])
        if pa:
            print(f"       areas: {', '.join(pa[:3])}")
    print()

    assignment = phase2_assign(client, papers, themes, sessions)

    missing = {p["Paper ID"] for p in papers} - set(assignment.keys())
    if missing:
        print(f"  GPT-4 missed {len(missing)} papers — placing in least-loaded session")
        for pid in missing:
            dur = int(next(p for p in papers if p["Paper ID"] == pid)["Presentation Length (min)"])
            ld  = defaultdict(int)
            for pk, sk in assignment.items():
                ld[sk] += int(next(p for p in papers if p["Paper ID"] == pk)["Presentation Length (min)"])
            best = min(sessions, key=lambda s: ld[s["Session ID"]])
            assignment[pid] = best["Session ID"]

    assignment = phase3_balance(papers, assignment, sessions, themes)

    print()
    write_outputs(papers, sessions, assignment, themes)

if __name__ == "__main__":
    main()

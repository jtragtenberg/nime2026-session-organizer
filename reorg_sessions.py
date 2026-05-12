#!/usr/bin/env python3
"""
reorg_sessions.py — applies the reorganisation plan derived from the
alignment & title-quality analyses and writes a new suggested_sessions.md.
"""

import re
from pathlib import Path

BASE    = Path(__file__).parent
IN_MD   = BASE / "suggested_sessions.md"
OUT_MD  = BASE / "suggested_sessions.md"   # overwrite in place

# ── New session configuration ─────────────────────────────────────────────────

SESSIONS = [
    # (session_id, slot, cap_min, title, based_on, rationale, primary_areas, secondary_areas)
    ("1A", "1", 90,
     "Haptics, Sensors, and Multisensory Instruments",
     "Body and Motion",
     "Explores sensor and actuator technologies, haptic feedback, and the design of instruments that engage multiple senses.",
     ["Sensor and actuator technologies, including haptics and force feedback devices",
      "Accessible interfaces for musical expression"],
     ["Explorations of relationships between motion, gesture and music"]),

    ("1B", "1", 90,
     "Community Collaborations and Cultural Musical Practice",
     "Entangled NIME",
     "Papers grounded in collaborations with artists and communities outside academia, examining how cultural context shapes instrument and performance design.",
     ["NIME 2026 theme: Communities. Topic 1: interviews with, reports on, or collaborations with artists/makers outside the NIME academic community"],
     ["Historical, theoretical, critical, or philosophical discussions about designing or performing with new interfaces"]),

    ("2A", "2", 90,
     "AI and Machine Musicianship",
     "Machine Learning and Co-Creativity",
     "Investigates how machine learning enables new forms of musical agency, co-improvisation, and performance practice.",
     ["Machine learning in musical performance"],
     ["Performance rendering and generative algorithms"]),

    ("2B", "2", 90,
     "Sound Installations and Situated Sonic Practice",
     "Interactive sound art and installations",
     "Examines interactive sound art installations and site-specific sonic practice in urban, communal, and environmental contexts.",
     ["Interactive sound art and installations"],
     ["Discussions about the artistic, cultural, and social impact of NIME technology"]),

    ("3A", "3", 60,
     "Body, Gesture, and Musical Motion",
     "Body and Motion",
     "Investigates how embodied movement — from breath and gesture to tactile navigation — drives musical expression.",
     ["Explorations of relationships between motion, gesture and music"],
     ["Sensor and actuator technologies, including haptics and force feedback devices"]),

    ("3B", "3", 60,
     "Historical and Critical Perspectives on Musical Interfaces",
     "Historical and Cultural Reflections",
     "Applies historical, analytical, and discourse-critical lenses to understand how musical interface concepts have evolved.",
     ["Historical, theoretical, critical, or philosophical discussions about designing or performing with new interfaces"],
     []),

    ("4A", "4", 90,
     "Networked Instruments and Collaborative Performance",
     "",
     "Explores systems, protocols, and instruments designed for distributed, networked, and collaborative musical performance.",
     ["Technologies or systems for collaborative music-making",
      "Software frameworks, interface protocols, and data formats, for supporting musical interaction"],
     []),

    ("4B", "4", 90,
     "Material Encounters: Objects, Fabrication, and Tactile Instruments",
     "",
     "Investigates instruments built from everyday objects, physical materials, and tangible fabrication strategies — foregrounding the materiality of making.",
     ["Novel controllers, interfaces or instruments for musical expression"],
     ["Practice-based research approaches/methodologies/criticism"]),

    ("5A", "5", 90,
     "Extended Reality and Immersive Musical Experience",
     "NIMEs in the Metaverse and VR",
     "Explores how augmented, virtual, and mixed reality technologies create new spaces and modalities for musical expression.",
     ["Extended reality environments: augmented, virtual, mixed reality"],
     ["Evaluation and user studies of new interfaces for musical expression"]),

    ("5B", "5", 90,
     "Software Practice, Open Tools, and Community Knowledge",
     "",
     "Papers centred on software instruments, live coding ecosystems, open methodology, and the sharing of instrument-design knowledge across communities.",
     ["Software frameworks, interface protocols, and data formats, for supporting musical interaction"],
     ["Practice-based research approaches/methodologies/criticism"]),

    ("7A", "7", 60,
     "Accessible and Inclusive Musical Interfaces",
     "Co- and Participatory Design for Accessible Instruments",
     "Addresses crip design, participatory accessibility, and inclusive instrument making for disabled and diverse musicians.",
     ["Accessible interfaces for musical expression"],
     ["NIME 2026 theme: Communities. Topic 1: interviews with, reports on, or collaborations with artists/makers outside the NIME academic community"]),

    ("7B", "7", 60,
     "Augmented and Hybrid Instrument Design",
     "Embracing Resistance and Failure",
     "Examines the design of instruments that blend acoustic, electronic, and computational elements through augmentation and hybridity.",
     ["Augmented, embedded and hyper instruments"],
     ["Novel controllers, interfaces or instruments for musical expression"]),

    ("8A", "8", 90,
     "Craft, Cosmology, and Culturally Situated Instruments",
     "Entangled NIME",
     "Brings together papers that ground instrument design in non-Western epistemologies, indigenous cosmologies, craft traditions, and critical cultural values.",
     ["NIME 2026 theme: Communities. Topic 1: interviews with, reports on, or collaborations with artists/makers outside the NIME academic community",
      "Practice-based research approaches/methodologies/criticism"],
     ["Discussions about the artistic, cultural, and social impact of NIME technology"]),

    ("8B", "8", 90,
     "Critical Methods and Reflective Practice in NIME",
     "",
     "Critically examines evaluation methodologies, research practices, and the politics of knowledge production in NIME.",
     ["Evaluation and user studies of new interfaces for musical expression",
      "Practice-based research approaches/methodologies/criticism"],
     []),

    ("9A", "9", 90,
     "Heritage, Identity, and Cross-Cultural Instruments",
     "Feminist Technoscience and Cross-Cultural NIMEs",
     "Explores the intersection of cultural heritage, identity, and contemporary digital instrument design across global traditions.",
     ["NIME 2026 theme: Communities. Topic 1: interviews with, reports on, or collaborations with artists/makers outside the NIME academic community"],
     ["Novel controllers, interfaces or instruments for musical expression"]),

    ("9B", "9", 90,
     "Generative Systems and Algorithmic Performance",
     "Designing and Performing with AI",
     "Investigates dynamic systems, generative algorithms, latent-space control, and algorithmic approaches to musical performance.",
     ["Performance rendering and generative algorithms"],
     ["Machine learning in musical performance"]),
]

# ── New paper → session assignment ────────────────────────────────────────────

NEW_ASSIGNMENT = {
    # 1A — Haptics, Sensors, Multisensory
    "239": "1A", "71": "1A", "454": "1A", "256": "1A",

    # 1B — Community Collaborations
    "102": "1B", "399": "1B", "176": "1B", "203": "1B", "205": "1B",

    # 2A — AI and Machine Musicianship
    "191": "2A", "86": "2A", "376": "2A", "432": "2A", "163": "2A", "507": "2A",

    # 2B — Sound Installations
    "78": "2B", "438": "2B", "212": "2B", "435": "2B", "10": "2B",

    # 3A — Body, Gesture, Motion
    "51": "3A", "52": "3A", "209": "3A", "381": "3A",

    # 3B — Historical and Critical Perspectives
    "90": "3B", "34": "3B", "119": "3B",

    # 4A — Networked and Collaborative
    "425": "4A", "404": "4A", "132": "4A", "617": "4A", "27": "4A", "437": "4A",

    # 4B — Material / Objects / Tactile
    "172": "4B", "62": "4B", "60": "4B", "215": "4B", "245": "4B", "635": "4B",

    # 5A — Extended Reality
    "459": "5A", "104": "5A", "354": "5A", "110": "5A",

    # 5B — Software Practice / Open Tools
    "53": "5B", "255": "5B", "609": "5B", "83": "5B",

    # 7A — Accessible and Inclusive
    "631": "7A", "266": "7A", "206": "7A", "126": "7A",

    # 7B — Augmented and Hybrid
    "434": "7B", "514": "7B", "213": "7B", "280": "7B", "173": "7B",

    # 8A — Craft, Cosmology, Culturally Situated
    "143": "8A", "42": "8A", "4": "8A", "194": "8A", "159": "8A", "210": "8A",

    # 8B — Critical Methods / Reflective Practice
    "428": "8B", "182": "8B", "59": "8B", "154": "8B", "160": "8B",

    # 9A — Heritage, Identity, Cross-Cultural
    "294": "9A", "223": "9A", "529": "9A", "33": "9A", "139": "9A", "161": "9A",

    # 9B — Generative Systems / Algorithmic Performance
    "220": "9B", "632": "9B", "357": "9B", "112": "9B", "226": "9B", "94": "9B", "148": "9B",
}

PAPER_DURATIONS = {
    # filled automatically from the markdown parse
}

SLOT_LABELS = {
    "1": "Slot 1 — 90 min",
    "2": "Slot 2 — 90 min",
    "3": "Slot 3 — 60 min",
    "4": "Slot 4 — 90 min",
    "5": "Slot 5 — 90 min",
    "7": "Slot 7 — 60 min",
    "8": "Slot 8 — 90 min",
    "9": "Slot 9 — 90 min",
}

# ── Parse existing markdown ───────────────────────────────────────────────────

def parse_papers(md_text):
    """Return dict {paper_id: markdown_block_string}"""
    parts = re.split(r"(?=^#### \[)", md_text, flags=re.MULTILINE)
    papers = {}
    for part in parts:
        m = re.match(r"^#### \[(\d+)\]", part)
        if not m:
            continue
        pid = m.group(1)
        # Extract duration from "Type: X (N min)"
        dm = re.search(r"\*\*Type:\*\*.*?\((\d+) min\)", part)
        if dm:
            PAPER_DURATIONS[pid] = int(dm.group(1))
        # Trim trailing section headers / session metadata that leaked in
        # Keep only the #### line and its bullet-point block
        clean_lines = []
        for line in part.splitlines():
            if clean_lines and re.match(r"^(##|###|\*\*\d+/\d+|_[A-Z])", line):
                break
            clean_lines.append(line)
        # Drop trailing blank lines
        while clean_lines and not clean_lines[-1].strip():
            clean_lines.pop()
        papers[pid] = "\n".join(clean_lines)
    return papers

# ── Build new markdown ────────────────────────────────────────────────────────

def build_md(papers):
    lines = [
        "# NIME 2026 — Suggested Paper Sessions",
        "",
        "_Reorganised after alignment and title-quality analysis._",
        "",
        "---",
        "",
    ]

    prev_slot = None
    for sess in SESSIONS:
        sid, slot, cap, title, based_on, rationale, pa, sa = sess

        # Slot heading
        if slot != prev_slot:
            lines.append(f"## {SLOT_LABELS[slot]}")
            lines.append("")
            prev_slot = slot

        # Collect papers for this session
        pids = [pid for pid, s in NEW_ASSIGNMENT.items() if s == sid]
        # Sort: Long first, then Medium, then Short; within same duration keep stable order
        dur_order = {17: 0, 13: 1, 10: 2}
        pids.sort(key=lambda p: (dur_order.get(PAPER_DURATIONS.get(p, 13), 1), p))

        total = sum(PAPER_DURATIONS.get(p, 13) for p in pids)
        n = len(pids)
        over = " ⚠ OVER LIMIT" if total > int(cap * 1.10) else ""
        based = f" · based on: *{based_on}*" if based_on else ""

        lines.append(f"### Session {sid} — {title}")
        lines.append("")
        lines.append(f"**{total}/{cap} min ({n} papers)**{over}{based}")
        lines.append("")
        lines.append(f"_{rationale}_")
        lines.append("")
        if pa:
            lines.append(f"**Primary areas:** {', '.join(pa)}  ")
        if sa:
            lines.append(f"**Secondary areas:** {', '.join(sa)}  ")
        lines.append("")

        for pid in pids:
            if pid in papers:
                lines.append(papers[pid])
                lines.append("")
            else:
                lines.append(f"#### [{pid}] _(paper block not found)_")
                lines.append("")

    return "\n".join(lines) + "\n"

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    md_text = IN_MD.read_text(encoding="utf-8")
    papers  = parse_papers(md_text)

    print(f"Parsed {len(papers)} paper blocks")

    assigned = set(NEW_ASSIGNMENT.keys())
    parsed   = set(papers.keys())
    missing  = assigned - parsed
    if missing:
        print(f"  ⚠ Paper IDs in assignment but not in markdown: {sorted(missing)}")
    unassigned_parsed = parsed - assigned
    if unassigned_parsed:
        print(f"  ℹ Paper IDs in markdown but not assigned (unassigned): {sorted(unassigned_parsed)}")

    # Session timing summary
    print()
    print(f"{'ID':>3}  {'Title':<45}  {'Used':>4}/{'Cap':>3}  {'#':>3}")
    print("─" * 70)
    for sess in SESSIONS:
        sid, slot, cap, title, *_ = sess
        pids  = [p for p, s in NEW_ASSIGNMENT.items() if s == sid]
        total = sum(PAPER_DURATIONS.get(p, 13) for p in pids)
        flag  = " ⚠" if total > int(cap * 1.10) else ""
        print(f"{sid:>3}  {title:<45}  {total:>4}/{cap:<3}  {len(pids):>3}{flag}")

    new_md = build_md(papers)
    OUT_MD.write_text(new_md, encoding="utf-8")
    print(f"\nWrote {OUT_MD.name}")

if __name__ == "__main__":
    main()

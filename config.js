// config.js — NIME 2026 Session Organizer
// Fill in your deployed Apps Script URL after publishing the web app.

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxmJnlUnmUjkaKYqrop6wlpJizeXjUafB8foabE9JIE478eSViCuRLvc9Vcy6jPpVTShQ/exec";

const POLL_INTERVAL_MS = 5000;

// ── Paper time rules ───────────────────────────────────────────────────────────
// Total = talk + 5 min Q&A
const PAPER_TIME = { Short: 10, Medium: 13, Long: 17 };

// ── Session time limits by slot ────────────────────────────────────────────────
const SESSION_SLOTS = [
  { slot: 1, timeLimit: 90 },
  { slot: 2, timeLimit: 90 },
  { slot: 3, timeLimit: 60 },
  { slot: 4, timeLimit: 90 },
  { slot: 5, timeLimit: 90 },
  // slot 6 = alt-NIME, no paper sessions
  { slot: 7, timeLimit: 60 },
  { slot: 8, timeLimit: 90 },
  { slot: 9, timeLimit: 90 },
];

const TOTAL_AVAILABLE_MIN = 1320; // 660 per track × 2 tracks

// ── Primary area colors (18 areas in 2026 corpus) ─────────────────────────────
const AREA_COLORS = {
  "NIME 2026 theme: Communities. Topic 1: interviews with, reports on, or collaborations with artists/makers outside the NIME academic community": "#8e7bc4",
  "Novel controllers, interfaces or instruments for musical expression": "#e07b54",
  "Machine learning in musical performance": "#d4a843",
  "Historical, theoretical, critical, or philosophical discussions about designing or performing with new interfaces": "#c8a86b",
  "Practice-based research approaches/methodologies/criticism": "#9a9a9a",
  "Accessible interfaces for musical expression": "#c65b8a",
  "Software frameworks, interface protocols, and data formats, for supporting musical interaction": "#7090d0",
  "Evaluation and user studies of new interfaces for musical expression": "#e8a050",
  "Explorations of relationships between motion, gesture and music": "#70b8a0",
  "Augmented, embedded and hyper instruments": "#5b9bd5",
  "Extended reality environments: augmented, virtual, mixed reality": "#6aab6a",
  "Interactive sound art and installations": "#e8608a",
  "Musical applications of robotics": "#f06040",
  "Sensor and actuator technologies, including haptics and force feedback devices": "#d47b6a",
  "Technologies or systems for collaborative music-making": "#a0c050",
  "Pedagogical perspectives or reports on student projects in the framework of NIME-related courses": "#c0c0c0",
  "Discussions about the artistic, cultural, and social impact of NIME technology": "#a67c52",
  "Performance rendering and generative algorithms": "#5b8fa8",
};

// Short labels for filter pills
const AREA_LABELS = {
  "NIME 2026 theme: Communities. Topic 1: interviews with, reports on, or collaborations with artists/makers outside the NIME academic community": "Communities",
  "Novel controllers, interfaces or instruments for musical expression": "Novel Controllers",
  "Machine learning in musical performance": "Machine Learning",
  "Historical, theoretical, critical, or philosophical discussions about designing or performing with new interfaces": "Historical/Theoretical",
  "Practice-based research approaches/methodologies/criticism": "Practice-Based",
  "Accessible interfaces for musical expression": "Accessibility",
  "Software frameworks, interface protocols, and data formats, for supporting musical interaction": "Software Frameworks",
  "Evaluation and user studies of new interfaces for musical expression": "Evaluation",
  "Explorations of relationships between motion, gesture and music": "Gesture / Motion",
  "Augmented, embedded and hyper instruments": "Augmented Instruments",
  "Extended reality environments: augmented, virtual, mixed reality": "Extended Reality",
  "Interactive sound art and installations": "Sound Art",
  "Musical applications of robotics": "Robotics",
  "Sensor and actuator technologies, including haptics and force feedback devices": "Sensors / Haptics",
  "Technologies or systems for collaborative music-making": "Collaborative",
  "Pedagogical perspectives or reports on student projects in the framework of NIME-related courses": "Pedagogy",
  "Discussions about the artistic, cultural, and social impact of NIME technology": "Impact / Culture",
  "Performance rendering and generative algorithms": "Rendering / Generative",
};

// Ordered list of areas (for consistent pill ordering)
const AREA_ORDER = Object.keys(AREA_COLORS);

// ── Historical session profiles for "Based On" feature ─────────────────────────
// Areas mapped to 2026 label equivalents.
// primaryWeight: strength for papers whose PRIMARY area matches
// secondaryWeight: strength for papers whose SECONDARY area matches
const HISTORICAL_SESSIONS = [
  {
    key: "2025: Accessibility",
    attractions: [
      { area: "Accessible interfaces for musical expression", primaryWeight: 1.0, secondaryWeight: 0.35 },
    ],
  },
  {
    key: "2025: Body and Motion",
    attractions: [
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Explorations of relationships between motion, gesture and music", primaryWeight: 0.6, secondaryWeight: 0.2 },
      { area: "Machine learning in musical performance", primaryWeight: 0.4, secondaryWeight: 0.15 },
      { area: "Sensor and actuator technologies, including haptics and force feedback devices", primaryWeight: 0.3, secondaryWeight: 0.1 },
    ],
  },
  {
    key: "2025: Collective and Embodied",
    attractions: [
      { area: "Discussions about the artistic, cultural, and social impact of NIME technology", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 0.5, secondaryWeight: 0.2 },
      { area: "Accessible interfaces for musical expression", primaryWeight: 0.4, secondaryWeight: 0.15 },
      { area: "Explorations of relationships between motion, gesture and music", primaryWeight: 0.4, secondaryWeight: 0.15 },
    ],
  },
  {
    key: "2025: Entangled NIME",
    attractions: [
      { area: "Practice-based research approaches/methodologies/criticism", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Historical, theoretical, critical, or philosophical discussions about designing or performing with new interfaces", primaryWeight: 0.5, secondaryWeight: 0.2 },
    ],
  },
  {
    key: "2025: Environment, Sustainability, Longevity",
    attractions: [
      { area: "Practice-based research approaches/methodologies/criticism", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Machine learning in musical performance", primaryWeight: 0.5, secondaryWeight: 0.2 },
      { area: "Discussions about the artistic, cultural, and social impact of NIME technology", primaryWeight: 0.4, secondaryWeight: 0.15 },
    ],
  },
  {
    key: "2025: Extended Reality",
    attractions: [
      { area: "Extended reality environments: augmented, virtual, mixed reality", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Evaluation and user studies of new interfaces for musical expression", primaryWeight: 0.3, secondaryWeight: 0.1 },
    ],
  },
  {
    key: "2025: Historical and Cultural Reflections",
    attractions: [
      { area: "Discussions about the artistic, cultural, and social impact of NIME technology", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Historical, theoretical, critical, or philosophical discussions about designing or performing with new interfaces", primaryWeight: 0.5, secondaryWeight: 0.2 },
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 0.3, secondaryWeight: 0.1 },
    ],
  },
  {
    key: "2025: Machine Learning and Co-Creativity",
    attractions: [
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Machine learning in musical performance", primaryWeight: 0.6, secondaryWeight: 0.2 },
      { area: "Explorations of relationships between motion, gesture and music", primaryWeight: 0.4, secondaryWeight: 0.15 },
    ],
  },
  {
    key: "2025: Novel Techniques and Technologies",
    attractions: [
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Augmented, embedded and hyper instruments", primaryWeight: 0.6, secondaryWeight: 0.2 },
      { area: "Practice-based research approaches/methodologies/criticism", primaryWeight: 0.4, secondaryWeight: 0.15 },
    ],
  },
  {
    key: "2024: Reflections on Impact, Longevity, and Sustainability",
    attractions: [
      { area: "Discussions about the artistic, cultural, and social impact of NIME technology", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Practice-based research approaches/methodologies/criticism", primaryWeight: 1.0, secondaryWeight: 0.35 },
    ],
  },
  {
    key: "2024: Embracing Resistance and Failure",
    attractions: [
      { area: "Augmented, embedded and hyper instruments", primaryWeight: 0.7, secondaryWeight: 0.25 },
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 0.7, secondaryWeight: 0.25 },
      { area: "Practice-based research approaches/methodologies/criticism", primaryWeight: 0.7, secondaryWeight: 0.25 },
    ],
  },
  {
    key: "2024: Data, Materials, and More-than-Human",
    attractions: [
      { area: "Augmented, embedded and hyper instruments", primaryWeight: 0.7, secondaryWeight: 0.2 },
      { area: "Interactive sound art and installations", primaryWeight: 0.7, secondaryWeight: 0.2 },
      { area: "Machine learning in musical performance", primaryWeight: 0.7, secondaryWeight: 0.2 },
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 0.7, secondaryWeight: 0.2 },
      { area: "Evaluation and user studies of new interfaces for musical expression", primaryWeight: 0.6, secondaryWeight: 0.15 },
    ],
  },
  {
    key: "2024: Revisiting and Extending Previous NIMEs",
    attractions: [
      { area: "Machine learning in musical performance", primaryWeight: 0.8, secondaryWeight: 0.25 },
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 0.8, secondaryWeight: 0.25 },
      { area: "Software frameworks, interface protocols, and data formats, for supporting musical interaction", primaryWeight: 0.8, secondaryWeight: 0.25 },
      { area: "Sensor and actuator technologies, including haptics and force feedback devices", primaryWeight: 0.7, secondaryWeight: 0.2 },
    ],
  },
  {
    key: "2024: Designing and Performing with AI",
    attractions: [
      { area: "Machine learning in musical performance", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Software frameworks, interface protocols, and data formats, for supporting musical interaction", primaryWeight: 0.4, secondaryWeight: 0.15 },
    ],
  },
  {
    key: "2024: NIMEs in the Metaverse and VR",
    attractions: [
      { area: "Extended reality environments: augmented, virtual, mixed reality", primaryWeight: 1.0, secondaryWeight: 0.35 },
    ],
  },
  {
    key: "2024: Co- and Participatory Design for Accessible Instruments",
    attractions: [
      { area: "Accessible interfaces for musical expression", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Technologies or systems for collaborative music-making", primaryWeight: 0.4, secondaryWeight: 0.15 },
    ],
  },
  {
    key: "2024: Sensor and Actuators in Haptic Instruments",
    attractions: [
      { area: "Sensor and actuator technologies, including haptics and force feedback devices", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Accessible interfaces for musical expression", primaryWeight: 0.3, secondaryWeight: 0.1 },
    ],
  },
  {
    key: "2024: Feminist Technoscience and Cross-Cultural NIMEs",
    attractions: [
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Accessible interfaces for musical expression", primaryWeight: 0.3, secondaryWeight: 0.1 },
      { area: "Historical, theoretical, critical, or philosophical discussions about designing or performing with new interfaces", primaryWeight: 0.3, secondaryWeight: 0.1 },
      { area: "Discussions about the artistic, cultural, and social impact of NIME technology", primaryWeight: 0.3, secondaryWeight: 0.1 },
    ],
  },
  {
    key: "2024: User Perception and Audience Participation",
    attractions: [
      { area: "Augmented, embedded and hyper instruments", primaryWeight: 0.7, secondaryWeight: 0.2 },
      { area: "Interactive sound art and installations", primaryWeight: 0.7, secondaryWeight: 0.2 },
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 0.7, secondaryWeight: 0.2 },
      { area: "Evaluation and user studies of new interfaces for musical expression", primaryWeight: 0.5, secondaryWeight: 0.15 },
    ],
  },
  {
    key: "2024: Gestural Interfaces, Inputs, and Mappings",
    attractions: [
      { area: "Novel controllers, interfaces or instruments for musical expression", primaryWeight: 1.0, secondaryWeight: 0.35 },
      { area: "Explorations of relationships between motion, gesture and music", primaryWeight: 0.5, secondaryWeight: 0.15 },
    ],
  },
];

// Helper: look up historical session by key
function getHistoricalAttractions(key) {
  const found = HISTORICAL_SESSIONS.find(s => s.key === key);
  return found ? found.attractions : [];
}

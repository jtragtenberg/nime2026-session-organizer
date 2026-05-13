// simulation.js — D3 v7 force simulation for NIME 2026 Session Organizer
// Reuses patterns from papers-gravity.html

class NIMESimulation {
  constructor(svgEl, canvasW, canvasH, onAssign) {
    this.svgEl    = svgEl;
    this.canvasW  = canvasW;
    this.canvasH  = canvasH;
    this.onAssign = onAssign; // callback(paperId, sessionId)

    this.papers   = [];
    this.sessions = [];
    this.filter   = new Set(Object.keys(AREA_COLORS)); // active areas

    this.paperNodes   = [];
    this.sessionAnchors = [];
    this.sim          = null;
    this.hoveredSession = null;
    this.transform    = d3.zoomIdentity;

    // Force parameters (tunable via sliders)
    this.ppStrength = 0.06;
    this.ppDist     = 90;
    this.psStrength = 0.55;
    this.charge     = -28;

    // Paper-paper bonds (Cmd/Ctrl+click)
    this._bonds      = this._loadBonds();
    this._bindSource = null; // paper id waiting for a second click

    this._buildDOM();
    this._buildTerrain();
  }

  // ── DOM setup ────────────────────────────────────────────────────────────────

  _buildDOM() {
    const svg = d3.select(this.svgEl);
    svg.selectAll("*").remove();

    this.zoomG = svg.append("g").attr("class", "zoom-root");

    // Layers (bottom to top)
    this.terrainLayer  = this.zoomG.append("g").attr("class", "terrain-layer");
    this.anchorLayer   = this.zoomG.append("g").attr("class", "anchor-layer");
    this.linkLayer     = this.zoomG.append("g").attr("class", "link-layer");
    this.paperLayer    = this.zoomG.append("g").attr("class", "paper-layer");

    // Zoom / pan
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (e) => {
        this.transform = e.transform;
        this.zoomG.attr("transform", e.transform);
        this._scheduleTerrainRender();
      });
    d3.select(this.svgEl).call(zoom);

    // Drop zone for paper cards dragged back from panel
    d3.select(this.svgEl)
      .on("dragover", (e) => { e.preventDefault(); })
      .on("drop", (e) => {
        e.preventDefault();
        const paperId = e.dataTransfer.getData("text/plain");
        if (paperId) this.onAssign(paperId, null); // null = unassign
      })
      .on("click.popup", () => {
        this._hidePaperPopup();
        if (this._bindSource) { this._bindSource = null; this._drawPapers(); }
      });

    // Floating paper-detail popup (positioned inside canvas-wrap)
    this._paperPopup = document.createElement("div");
    this._paperPopup.className = "paper-popup";
    this._paperPopup.style.display = "none";
    this.svgEl.parentElement.appendChild(this._paperPopup);

    this._wasDragged = false;
  }

  _buildTerrain() {
    this.terrainCanvas = document.createElement("canvas");
    this.terrainCanvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;filter:blur(54px) saturate(1.4);opacity:0.32;";
    this.svgEl.parentElement.insertBefore(this.terrainCanvas, this.svgEl);
    this._rafId = null;
  }

  _scheduleTerrainRender() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._renderTerrain();
    });
  }

  _renderTerrain() {
    const tc = this.terrainCanvas;
    const TRES = 5;
    tc.width  = Math.ceil(this.canvasW / TRES);
    tc.height = Math.ceil(this.canvasH / TRES);
    tc.style.width  = this.canvasW + "px";
    tc.style.height = this.canvasH + "px";

    const ctx = tc.getContext("2d");
    const { x: tx, y: ty, k } = this.transform;

    const pts = this.paperNodes
      .filter(n => n.x != null && !n.assigned)
      .map(n => ({
        sx: (n.x * k + tx) / TRES,
        sy: (n.y * k + ty) / TRES,
        rgb: hexToRgb(AREA_COLORS[n.primary] || "#888"),
      }));

    if (!pts.length) { ctx.clearRect(0, 0, tc.width, tc.height); return; }

    const TW = tc.width, TH = tc.height;
    const img = ctx.createImageData(TW, TH);
    const d = img.data;
    const POW = 2.2;

    for (let py = 0; py < TH; py++) {
      for (let px = 0; px < TW; px++) {
        let sw = 0, r = 0, g = 0, b = 0;
        for (const p of pts) {
          const dx = px - p.sx, dy = py - p.sy;
          const w = 1 / Math.pow(dx * dx + dy * dy + 0.01, POW / 2);
          sw += w; r += w * p.rgb[0]; g += w * p.rgb[1]; b += w * p.rgb[2];
        }
        const idx = (py * TW + px) * 4;
        d[idx] = r / sw; d[idx + 1] = g / sw; d[idx + 2] = b / sw; d[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── Session anchor positions ──────────────────────────────────────────────────

  _computeAnchorPositions() {
    const W = this.canvasW, H = this.canvasH;
    const cx = W / 2, cy = H / 2;

    // Radius: fit inside canvas with padding
    const R = Math.min(W * 0.40, H * 0.38);

    this.anchorW = 160;
    this.anchorH = 72;

    // 8 slots arranged so A sessions form the left semicircle,
    // B sessions mirror them on the right — each pair shares the same y.
    // Angular span: 105° (top-left) → 255° (bottom-left) for A,
    // mirrored as 75° → -75° for B.
    const SLOTS = [1, 2, 3, 4, 5, 7, 8, 9];
    const n     = SLOTS.length;
    const gap   = Math.PI / 12;                   // 15° gap at top and bottom
    const span  = Math.PI - 2 * gap;              // 150° usable arc

    const pos = {};
    SLOTS.forEach((slot, i) => {
      const alpha = Math.PI / 2 + gap + (span * i / (n - 1)); // left semicircle
      const beta  = Math.PI - alpha;                           // mirror on right

      pos[slot + "A"] = {
        x: cx + R * Math.cos(alpha),
        y: cy - R * Math.sin(alpha), // SVG y-axis flipped
      };
      pos[slot + "B"] = {
        x: cx + R * Math.cos(beta),
        y: cy - R * Math.sin(beta),
      };
    });
    return pos;
  }

  // ── Data update ───────────────────────────────────────────────────────────────

  setData(papers, sessions) {
    this.papers   = papers;
    this.sessions = sessions;

    // If the unassigned+filtered paper set is unchanged, skip full rebuild —
    // just refresh metadata and visuals so the simulation doesn't jump.
    const newIds = papers
      .filter(p => !p.sessionId && this.filter.has(p.primary))
      .map(p => p.id).sort().join(",");
    const curIds = this.paperNodes.map(n => n.id).sort().join(",");

    if (newIds === curIds) {
      for (const node of this.paperNodes) {
        const p = papers.find(pp => pp.id === node.id);
        if (!p) continue;
        node.title     = p.title;
        node.featured  = p.featured;
        node.remote    = p.remote;
        node.userIdeas = p.userIdeas;
      }
      for (const anchor of this.sessionAnchors) {
        const s = sessions.find(ss => ss.id === anchor.id);
        if (!s) continue;
        anchor.name        = s.name;
        anchor.attractions = s.attractions || [];
      }
      this._drawAnchors();
      this._drawPapers();
      return;
    }

    this._rebuild();
  }

  _rebuild() {
    const anchorPos = this._computeAnchorPositions();

    // Session anchors (fixed nodes)
    this.sessionAnchors = this.sessions.map(s => ({
      id:       s.id,
      type:     "session",
      name:     s.name,
      slot:     s.slot,
      track:    s.track,
      timeLimit: s.timeLimit,
      fx: anchorPos[s.id] ? anchorPos[s.id].x : this.canvasW / 2,
      fy: anchorPos[s.id] ? anchorPos[s.id].y : this.canvasH / 2,
      attractions: s.attractions || [],
    }));

    // Preserve existing paper node positions
    const prevPos = {};
    for (const n of this.paperNodes) prevPos[n.id] = { x: n.x, y: n.y };

    // Paper nodes — only unassigned AND in active filter
    this.paperNodes = this.papers
      .filter(p => !p.sessionId && this.filter.has(p.primary))
      .map(p => {
        const prev = prevPos[p.id];
        return {
          id:       p.id,
          type:     "paper",
          title:    p.title,
          authors:  p.authors,
          abstract: p.abstract,
          primary:  p.primary,
          secondary: (p.secondary || "").split(";").map(s => s.trim()).filter(Boolean),
          length:   p.length,
          ptype:    p.type,
          featured: p.featured,
          remote:   p.remote,
          idea1:    p.idea1,
          idea2:    p.idea2,
          idea3:    p.idea3,
          userIdeas: p.userIdeas,
          assigned: false,
          x: prev ? prev.x : this.canvasW / 2 + (Math.random() - 0.5) * 200,
          y: prev ? prev.y : this.canvasH / 2 + (Math.random() - 0.5) * 200,
        };
      });

    this._rebuildSim();
    this._drawAnchors();
    this._drawPapers();
    if (this._searchIds) this.setSearch(this._searchIds);
    this._scheduleTerrainRender();
  }

  _buildLinks() {
    const links = [];

    // ── Paper → Session attraction links ──────────────────────────────────────
    for (const paper of this.paperNodes) {
      for (const session of this.sessionAnchors) {
        let weight = 0;
        for (const attr of session.attractions) {
          if (attr.area === paper.primary) {
            weight = Math.max(weight, attr.primaryWeight);
          } else if (paper.secondary.includes(attr.area)) {
            weight = Math.max(weight, attr.secondaryWeight);
          }
        }
        if (weight > 0) links.push({ source: paper.id, target: session.id, weight, ltype: "ps" });
      }
    }

    // ── Paper → Paper same-area clustering links ───────────────────────────────
    for (let i = 0; i < this.paperNodes.length; i++) {
      const a = this.paperNodes[i];
      for (let j = i + 1; j < this.paperNodes.length; j++) {
        const b = this.paperNodes[j];
        let weight = 0;
        if (a.primary && a.primary === b.primary) {
          weight = 1.0;                                        // same primary area
        } else {
          if (b.secondary.includes(a.primary)) weight = Math.max(weight, 0.35); // a-primary in b-secondary
          if (a.secondary.includes(b.primary)) weight = Math.max(weight, 0.35); // b-primary in a-secondary
          for (const s of a.secondary)
            if (b.secondary.includes(s)) weight = Math.max(weight, 0.2);        // shared secondary
        }
        if (weight > 0) links.push({ source: a.id, target: b.id, weight, ltype: "pp" });
      }
    }

    // ── Explicit bonds (Cmd/Ctrl+click) ──────────────────────────────────────────
    const nodeIds = new Set(this.paperNodes.map(n => n.id));
    for (const key of this._bonds) {
      const [a, b] = key.split(":");
      if (nodeIds.has(a) && nodeIds.has(b))
        links.push({ source: a, target: b, weight: 1, ltype: "bond" });
    }

    return links;
  }

  _rebuildSim() {
    if (this.sim) this.sim.stop();

    const cx = this.canvasW / 2, cy = this.canvasH / 2;
    const nodes = [...this.sessionAnchors, ...this.paperNodes];
    const links = this._buildLinks();

    const linkForce = d3.forceLink(links)
      .id(d => d.id)
      .distance(l => l.ltype === "bond" ? 22 : l.ltype === "pp" ? this.ppDist : 100 - l.weight * 30)
      .strength(l => l.ltype === "bond" ? 0.9 : l.ltype === "pp" ? l.weight * this.ppStrength : l.weight * this.psStrength);

    this.sim = d3.forceSimulation(nodes)
      .force("link", linkForce)
      .force("charge", d3.forceManyBody()
        .strength(d => d.type === "session" ? 0 : this.charge))
      // Always pull papers gently toward center — prevents wandering when no attractions
      .force("gravX", d3.forceX(cx).strength(d => d.type === "paper" ? 0.04 : 0))
      .force("gravY", d3.forceY(cy).strength(d => d.type === "paper" ? 0.04 : 0))
      // Hard collision: papers never overlap each other or session anchors
      .force("collide", d3.forceCollide()
        .radius(d => d.type === "session" ? 55 : this._paperRadius(d) + 4)
        .strength(1.0)
        .iterations(4))
      .alphaDecay(0.01)
      .on("tick", () => this._tick())
      .on("end",  () => this._scheduleTerrainRender());

    this._resolvedLinks = linkForce.links();
    this._drawLinks();
  }

  // ── Bond helpers ──────────────────────────────────────────────────────────────

  _bondKey(a, b) { return [a, b].sort().join(":"); }

  _loadBonds() {
    try { return new Set(JSON.parse(localStorage.getItem("nime2026-bonds") || "[]")); }
    catch { return new Set(); }
  }

  _saveBonds() {
    localStorage.setItem("nime2026-bonds", JSON.stringify([...this._bonds]));
  }

  _handleBind(paperId) {
    if (this._bindSource === null) {
      this._bindSource = paperId;
    } else if (this._bindSource === paperId) {
      this._bindSource = null;          // cancel
    } else {
      const key = this._bondKey(this._bindSource, paperId);
      if (this._bonds.has(key)) this._bonds.delete(key);
      else                      this._bonds.add(key);
      this._saveBonds();
      this._bindSource = null;
      this._rebuildSim();
    }
    this._drawPapers();
  }

  refreshAnchorDots() {
    this._drawAnchors();
  }

  setForceParams({ ppStrength, ppDist, psStrength, charge } = {}) {
    if (ppStrength !== undefined) this.ppStrength = ppStrength;
    if (ppDist     !== undefined) this.ppDist     = ppDist;
    if (psStrength !== undefined) this.psStrength = psStrength;
    if (charge     !== undefined) this.charge     = charge;
    this._rebuildSim();
  }

  _drawLinks() {
    this.linkLayer.selectAll("line.attraction-link")
      .data((this._resolvedLinks || []).filter(l => l.ltype === "ps"), (d, i) => i)
      .join("line")
      .attr("class", "attraction-link")
      .attr("stroke", l => AREA_COLORS[l.source.primary] || "#888")
      .attr("stroke-opacity", l => 0.12 + l.weight * 0.25)
      .attr("stroke-width", l => 0.6 + l.weight * 0.7)
      .attr("stroke-dasharray", "4,5");

    this.linkLayer.selectAll("line.bond-link")
      .data((this._resolvedLinks || []).filter(l => l.ltype === "bond"), (d, i) => i)
      .join("line")
      .attr("class", "bond-link")
      .attr("stroke", "#e3b341")
      .attr("stroke-opacity", 0.9)
      .attr("stroke-width", 2)
      .attr("stroke-linecap", "round");
  }

  reheat() {
    if (this.sim) this.sim.alpha(0.3).restart();
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────

  _drawAnchors() {
    const self = this;
    const AW = this.anchorW, AH = this.anchorH;
    const DOT_R = 4, DOT_GAP = 10, DOT_Y = AH / 2 - 11; // y relative to anchor center

    const sel = this.anchorLayer.selectAll("g.anchor")
      .data(this.sessionAnchors, d => d.id)
      .join(enter => {
        const g = enter.append("g").attr("class", "anchor").style("cursor", "pointer");
        g.append("rect").attr("rx", 10).attr("ry", 10)
          .attr("width", AW).attr("height", AH)
          .attr("x", -AW / 2).attr("y", -AH / 2);
        g.append("text").attr("class", "anchor-id");
        g.append("text").attr("class", "anchor-name");
        g.append("text").attr("class", "anchor-time");
        g.append("g").attr("class", "anchor-dots");

        g.on("click", (e, d) => {
          e.stopPropagation();
          const box = document.querySelector(`.session-box[data-session-id="${d.id}"]`);
          if (!box) return;
          box.scrollIntoView({ behavior: "smooth", block: "nearest" });
          box.classList.add("highlight-flash");
          setTimeout(() => box.classList.remove("highlight-flash"), 900);
        });

        return g;
      });

    sel.attr("transform", d => `translate(${d.fx},${d.fy})`);

    sel.select("rect")
      .attr("fill", "#1a1f2b")
      .attr("stroke", "#30363d")
      .attr("stroke-width", 1.5)
      .attr("fill-opacity", 0.7);

    sel.select(".anchor-id")
      .attr("text-anchor", "middle")
      .attr("y", -AH / 2 + 13)
      .attr("font-size", "11px").attr("font-weight", "700")
      .attr("fill", "#8b949e")
      .text(d => d.id);

    sel.select(".anchor-name")
      .attr("text-anchor", "middle")
      .attr("y", -AH / 2 + 28)
      .attr("font-size", "10px").attr("fill", "#e6edf3")
      .text(d => truncate(d.name || "—", 24));

    sel.select(".anchor-time")
      .attr("text-anchor", "middle")
      .attr("y", -AH / 2 + 42)
      .attr("font-size", "9px").attr("fill", "#484f58")
      .text(d => d.timeLimit + " min");

    // Assigned paper dots
    sel.select(".anchor-dots").each(function(d) {
      const assigned = self.papers.filter(p => p.sessionId === d.id);
      const maxDots  = Math.floor((AW - 16) / DOT_GAP);
      const shown    = assigned.slice(0, maxDots);
      const totalW   = (shown.length - 1) * DOT_GAP;
      const startX   = -totalW / 2;

      const dots = d3.select(this).selectAll("circle")
        .data(shown, p => p.id);

      dots.enter().append("circle")
        .merge(dots)
        .attr("r", DOT_R)
        .attr("cx", (_, i) => startX + i * DOT_GAP)
        .attr("cy", DOT_Y)
        .attr("fill", p => AREA_COLORS[p.primary] || "#888")
        .attr("fill-opacity", 0.85)
        .attr("stroke", "#0d1117")
        .attr("stroke-width", 0.8);

      dots.exit().remove();
    });
  }

  updateAnchorLabels(sessions) {
    this.sessions = sessions;
    this.sessionAnchors.forEach(a => {
      const s = sessions.find(s => s.id === a.id);
      if (s) { a.name = s.name; a.timeLimit = s.timeLimit; a.attractions = s.attractions || []; }
    });
    this._drawAnchors();
    this._rebuildSim();
  }

  _paperRadius(d) {
    if (!d) return 6;
    if (d.ptype === "Long"   || d.length === 17) return 11;
    if (d.ptype === "Medium" || d.length === 13) return 8;
    return 6;
  }

  _drawPapers() {
    const self = this;

    const sel = this.paperLayer.selectAll("g.paper-node")
      .data(this.paperNodes, d => d.id)
      .join(
        enter => {
          const g = enter.append("g")
            .attr("class", "paper-node")
            .style("cursor", "grab")
            .call(this._drag());

          g.append("circle").attr("class", "bond-ring");   // bond / bind-mode indicator
          g.append("circle").attr("class", "paper-circle")
            .attr("stroke", "#0d1117").attr("stroke-width", 1.2);

          // Featured star
          g.append("text").attr("class", "star-icon")
            .attr("text-anchor", "middle").attr("dominant-baseline", "central")
            .attr("font-size", "8px");

          // Remote wifi glyph
          g.append("text").attr("class", "wifi-icon")
            .attr("text-anchor", "middle").attr("dominant-baseline", "central")
            .attr("font-size", "7px");

          // Tooltip on hover
          g.on("mouseover", (e, d) => self._showTooltip(e, d))
            .on("mousemove", (e)    => self._moveTooltip(e))
            .on("mouseout",  ()     => self._hideTooltip());

          // Click → popup; Cmd/Ctrl+click → bond
          g.on("click", (e, d) => {
            if (self._wasDragged) return;
            e.stopPropagation();
            if (e.metaKey || e.ctrlKey) {
              self._hideTooltip();
              self._handleBind(d.id);
              return;
            }
            self._hideTooltip();
            self._showPaperPopup(e, d);
          });

          return g;
        },
        update => update,
        exit   => exit.remove()
      );

    // Bond ring: glows amber when this paper is the bind-source,
    // stays as a faint ring if the paper has any active bonds
    sel.select(".bond-ring")
      .attr("r", d => this._paperRadius(d) + 4)
      .attr("fill", "none")
      .attr("stroke", d => d.id === this._bindSource ? "#e3b341" : "#e3b341")
      .attr("stroke-width", d => d.id === this._bindSource ? 2.5 : 1.5)
      .attr("stroke-opacity", d => {
        if (d.id === this._bindSource) return 1;
        const hasBond = [...this._bonds].some(k => k.split(":").includes(d.id));
        return hasBond ? 0.55 : 0;
      });

    sel.select(".paper-circle")
      .attr("r",    d => this._paperRadius(d))
      .attr("fill", d => AREA_COLORS[d.primary] || "#888")
      .attr("fill-opacity", 0.88);

    sel.select(".star-icon")
      .text(d => d.featured ? "★" : "")
      .attr("fill", "#f0c040")
      .attr("dy", d => -this._paperRadius(d) * 0.8);

    sel.select(".wifi-icon")
      .text(d => d.remote ? "⌁" : "")
      .attr("fill", "#60b0f0")
      .attr("dy", d => this._paperRadius(d) * 0.8);
  }

  _drag() {
    const self = this;
    let hovered = null;

    return d3.drag()
      .on("start", (e, d) => {
        self._wasDragged = false;
        self.sim.alphaTarget(0.15).restart();
        d.fx = d.x; d.fy = d.y;
        d3.select(e.sourceEvent.target.closest("g.paper-node")).style("cursor", "grabbing");
      })
      .on("drag", (e, d) => {
        self._wasDragged = true;
        d.fx = e.x; d.fy = e.y;
        hovered = self._nearestAnchor(e.x, e.y);
        self._highlightAnchor(hovered);
      })
      .on("end", (e, d) => {
        self.sim.alphaTarget(0);
        d3.select(e.sourceEvent.target.closest("g.paper-node")).style("cursor", "grab");
        if (hovered) {
          self.onAssign(d.id, hovered);
          hovered = null;
        } else {
          d.fx = null; d.fy = null;
        }
        self._highlightAnchor(null);
      });
  }

  _nearestAnchor(x, y) {
    const hw = this.anchorW / 2, hh = this.anchorH / 2;
    for (const s of this.sessionAnchors) {
      if (x >= s.fx - hw && x <= s.fx + hw && y >= s.fy - hh && y <= s.fy + hh) {
        return s.id;
      }
    }
    return null;
  }

  _highlightAnchor(id) {
    this.anchorLayer.selectAll("g.anchor").select("rect")
      .attr("stroke", d => d.id === id ? "#58a6ff" : "#30363d")
      .attr("stroke-width", d => d.id === id ? 2.5 : 1.5)
      .attr("fill-opacity", d => d.id === id ? 0.9 : 0.7);
  }

  // ── Tick ──────────────────────────────────────────────────────────────────────

  _tick() {
    this.paperLayer.selectAll("g.paper-node")
      .attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    this.linkLayer.selectAll("line.attraction-link")
      .attr("x1", l => l.source.x ?? 0)
      .attr("y1", l => l.source.y ?? 0)
      .attr("x2", l => l.target.fx ?? l.target.x ?? 0)
      .attr("y2", l => l.target.fy ?? l.target.y ?? 0);
    this.linkLayer.selectAll("line.bond-link")
      .attr("x1", l => l.source.x ?? 0)
      .attr("y1", l => l.source.y ?? 0)
      .attr("x2", l => l.target.x ?? 0)
      .attr("y2", l => l.target.y ?? 0);
    if (Math.random() < 0.05) this._scheduleTerrainRender();
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  setSearch(matchingIds) {
    this._searchIds = matchingIds || null;
    this.paperLayer.selectAll("g.paper-node")
      .transition().duration(150)
      .attr("opacity", d => {
        if (!this._searchIds) return 1;
        return this._searchIds.has(d.id) ? 1 : 0.1;
      });
  }

  flashPaper(paperId) {
    const node = this.paperLayer.selectAll("g.paper-node")
      .filter(d => d.id === paperId);
    if (node.empty()) return;
    node.select(".paper-circle")
      .transition().duration(120).attr("r", d => this._paperRadius(d) * 2.5)
      .transition().duration(300).attr("r", d => this._paperRadius(d));
  }

  // ── Filter ────────────────────────────────────────────────────────────────────

  setFilter(activeAreas) {
    this.filter = new Set(activeAreas);
    this._rebuild();
  }

  // ── Remove / restore paper ───────────────────────────────────────────────────

  removePaper(paperId) {
    const idx = this.paperNodes.findIndex(n => n.id === paperId);
    if (idx >= 0) this.paperNodes.splice(idx, 1);
    this._rebuildSim();
    this._drawPapers();
  }

  restorePaper(paper) {
    if (this.paperNodes.find(n => n.id === paper.id)) return;
    if (!this.filter.has(paper.primary)) return;
    this.paperNodes.push({
      id: paper.id, type: "paper",
      title: paper.title, authors: paper.authors, abstract: paper.abstract,
      primary: paper.primary,
      secondary: (paper.secondary || "").split(";").map(s => s.trim()).filter(Boolean),
      length: paper.length, ptype: paper.type,
      featured: paper.featured, remote: paper.remote,
      idea1: paper.idea1, idea2: paper.idea2, idea3: paper.idea3,
      userIdeas: paper.userIdeas, assigned: false,
      x: this.canvasW / 2 + (Math.random() - 0.5) * 80,
      y: this.canvasH / 2 + (Math.random() - 0.5) * 80,
    });
    this._rebuildSim();
    this._drawPapers();
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────────

  _showTooltip(e, d) {
    const tip = document.getElementById("sim-tooltip");
    const color = AREA_COLORS[d.primary] || "#888";
    const ideas = [d.idea1, d.idea2, d.idea3].filter(Boolean)
      .map(i => `<span class="tip-chip">${i}</span>`).join(" ");
    const secAreas = d.secondary.filter(Boolean)
      .map(a => `<span class="tip-chip" style="background:${AREA_COLORS[a] || '#333'}22;border-color:${AREA_COLORS[a] || '#555'}">${AREA_LABELS[a] || a}</span>`)
      .join(" ");
    const icons = (d.featured ? '<span class="tip-star">★ Featured</span>' : '')
                + (d.remote   ? ' <span class="tip-wifi">⌁ Remote</span>'  : '');
    tip.innerHTML = `
      <div class="tip-title" style="color:${color}">${d.title}</div>
      <div class="tip-authors">${d.authors}</div>
      <div class="tip-row"><span class="tip-label">Type</span> ${d.ptype} · ${d.length} min ${icons}</div>
      <div class="tip-row"><span class="tip-label">Primary</span> <span style="color:${color}">${AREA_LABELS[d.primary] || d.primary}</span></div>
      ${secAreas ? `<div class="tip-row"><span class="tip-label">Secondary</span> ${secAreas}</div>` : ""}
      ${ideas ? `<div class="tip-row"><span class="tip-label">AI session ideas</span> ${ideas}</div>` : ""}
    `;
    tip.style.display = "block";
    this._moveTooltip(e);
  }

  _moveTooltip(e) {
    const tip = document.getElementById("sim-tooltip");
    const x = e.sourceEvent ? e.sourceEvent.clientX : e.clientX;
    const y = e.sourceEvent ? e.sourceEvent.clientY : e.clientY;
    tip.style.left = (x + 16) + "px";
    tip.style.top  = Math.min(y - 10, window.innerHeight - tip.offsetHeight - 10) + "px";
  }

  _hideTooltip() {
    document.getElementById("sim-tooltip").style.display = "none";
  }

  // ── Paper detail popup ────────────────────────────────────────────────────────

  _showPaperPopup(e, d) {
    const color = AREA_COLORS[d.primary] || "#888";
    const label = AREA_LABELS[d.primary] || d.primary;
    const barW  = d.ptype === "Long" ? 12 : d.ptype === "Medium" ? 8 : 4;
    const kws   = d.keywords ? d.keywords.split(/[;,]/).map(s => s.trim()).filter(Boolean) : [];

    const kwHtml = kws.length
      ? `<div class="pp-keywords">${kws.map(k => `<span class="pp-kw">${this._esc(k)}</span>`).join("")}</div>`
      : "";

    this._paperPopup.innerHTML = `
      <div class="pp-header">
        <span class="pp-bar" style="background:${color};width:${barW}px"></span>
        <span class="pp-title">${this._esc(d.title)}</span>
        <button class="pp-close">×</button>
      </div>
      <div class="pp-authors">${this._esc(d.authors)}</div>
      <div class="pp-meta" style="color:${color}">${this._esc(label)} · ${d.ptype || ""} · ${d.length || ""} min</div>
      ${kwHtml}
      <div class="pp-abstract">${this._esc(d.abstract || "No abstract available.")}</div>
    `;

    this._paperPopup.querySelector(".pp-close").addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._hidePaperPopup();
    });

    const rect = this.svgEl.parentElement.getBoundingClientRect();
    const mx   = e.sourceEvent ? e.sourceEvent.clientX : e.clientX;
    const my   = e.sourceEvent ? e.sourceEvent.clientY : e.clientY;
    const px   = mx - rect.left;
    const py   = my - rect.top;

    this._paperPopup.style.display = "block";
    const popW = 300;
    this._paperPopup.style.left = Math.min(Math.max(px + 14, 4), this.canvasW - popW - 4) + "px";
    this._paperPopup.style.top  = Math.max(Math.min(py - 20, this.canvasH - 360), 4) + "px";
  }

  _hidePaperPopup() {
    if (this._paperPopup) this._paperPopup.style.display = "none";
  }

  _esc(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Resize ───────────────────────────────────────────────────────────────────

  resize(w, h) {
    this.canvasW = w;
    this.canvasH = h;
    this._rebuild();
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function hexToRgb(h) {
  h = h.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

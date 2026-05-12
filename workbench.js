(function () {
  const state = {
    run: null,
    selectedCandidate: null,
    selectedStructure: null,
    svgView: "rna"
  };
  let viennaRenderModulePromise = null;
  const ASSET_BASE_URL = new URL("./", document.currentScript ? document.currentScript.src : window.location.href).href;

  const EXAMPLES = [
    { name: "human insulin B chain", sequence: "FVNQHLCGSHLVEALYLVCGERGFFYTPKT" },
    { name: "human glucagon", sequence: "HSQGTFTSDYSKYLDSRRAQDFVQWLMNT" },
    { name: "somatostatin-14", sequence: "AGCKNFFWKTFTSC" },
    { name: "LL-37 fragment", sequence: "LLGDFFRKSKEKIGKEFKRIVQRIKDFLRNLVPRTES" },
    { name: "p53 transactivation fragment", sequence: "MEEPQSDPSVEPPLSQETFSDLWKLLPEN" }
  ];

  const BASE_COLORS = {
    A: "#35A779",
    C: "#357ABD",
    G: "#F2A93B",
    U: "#D84F5F",
    T: "#D84F5F"
  };

  const GENETIC_CODE = {
    UUU: "F", UUC: "F", UUA: "L", UUG: "L",
    UCU: "S", UCC: "S", UCA: "S", UCG: "S",
    UAU: "Y", UAC: "Y", UAA: "*", UAG: "*",
    UGU: "C", UGC: "C", UGA: "*", UGG: "W",
    CUU: "L", CUC: "L", CUA: "L", CUG: "L",
    CCU: "P", CCC: "P", CCA: "P", CCG: "P",
    CAU: "H", CAC: "H", CAA: "Q", CAG: "Q",
    CGU: "R", CGC: "R", CGA: "R", CGG: "R",
    AUU: "I", AUC: "I", AUA: "I", AUG: "M",
    ACU: "T", ACC: "T", ACA: "T", ACG: "T",
    AAU: "N", AAC: "N", AAA: "K", AAG: "K",
    AGU: "S", AGC: "S", AGA: "R", AGG: "R",
    GUU: "V", GUC: "V", GUA: "V", GUG: "V",
    GCU: "A", GCC: "A", GCA: "A", GCG: "A",
    GAU: "D", GAC: "D", GAA: "E", GAG: "E",
    GGU: "G", GGC: "G", GGA: "G", GGG: "G"
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (x, d = 3) => Number.isFinite(Number(x)) ? Number(x).toFixed(d) : "";

  function assetUrl(path) {
    return new URL(path, ASSET_BASE_URL).href;
  }

  function setStatus(text, isError = false) {
    $("status").textContent = text || "";
    $("status").className = isError ? "status error" : "status";
  }

  function cleanPsi(raw) {
    return String(raw || "").toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, "");
  }

  function normalizeRna(rna) {
    return String(rna || "").toUpperCase().replace(/T/g, "U");
  }

  function chooseExample() {
    const current = cleanPsi($("psi").value);
    const pool = EXAMPLES.filter((item) => item.sequence !== current);
    const choice = (pool.length ? pool : EXAMPLES)[Math.floor(Math.random() * (pool.length || EXAMPLES.length))];
    $("psi").value = choice.sequence;
    $("psi").title = choice.name;
  }

  function metric(label, value) {
    return `<div class="metric"><div class="value">${value}</div><div class="label">${label}</div></div>`;
  }

  function resolveRunSettings(psi, structures) {
    const requestedMode = $("rankingMode").value;
    let rankingMode = requestedMode === "fast" ? "fast" : requestedMode === "exact" ? "exact" : "auto";
    let rankPool = Math.max(1, Number($("rankPool").value) || 20);
    const notes = [];
    if (rankingMode === "auto") {
      if (psi.length >= 120) {
        rankingMode = "fast";
        rankPool = Math.min(rankPool, 20);
        if (structures > 20) {
          structures = 20;
          notes.push("auto capped structures to 20 for long sequence");
        }
        notes.push("auto fast ranked for long sequences");
      } else if (psi.length >= 80) {
        rankingMode = "fast";
        rankPool = Math.min(rankPool, 50);
        if (structures > 100) {
          structures = 100;
          notes.push("auto capped structures to 100 for medium sequence");
        }
        notes.push("auto fast ranked for medium sequences");
      } else {
        rankingMode = "exact";
      }
    }
    return { requestedMode, rankingMode, structures, rankPool, notes };
  }

  async function runWasmDesign(payload) {
    const stdout = [];
    const stderr = [];
    const module = await createCodonDesignModule({
      locateFile: (path) => assetUrl(path),
      print: (line) => stdout.push(line),
      printErr: (line) => stderr.push(line)
    });
    const args = [
      payload.psi,
      "/params/physical_rna_3_3_1.json",
      String(payload.rna_samples),
      String(payload.top_k),
      String(payload.structures_per_candidate),
      "1",
      String(payload.seed),
      "cpu",
      payload.ranking_mode,
      String(payload.rank_pool)
    ];
    const exitCode = module.callMain(args);
    if (exitCode !== 0) {
      throw new Error(stderr.join("\n") || `WASM backend exited with ${exitCode}`);
    }
    if (!stdout.length) {
      throw new Error(stderr.join("\n") || "WASM backend produced no JSON output.");
    }
    return JSON.parse(stdout.join("\n"));
  }

  async function submitDesign() {
    const psi = cleanPsi($("psi").value);
    if (!psi) {
      setStatus("Enter a valid amino-acid sequence.", true);
      return;
    }
    $("psi").value = psi;
    const rnaSamples = Math.max(1, Number($("rnaSamples").value) || 2000);
    const structures = Math.max(0, Number($("structureSamples").value) || 0);
    const settings = resolveRunSettings(psi, structures);
    const payload = {
      psi,
      rna_samples: rnaSamples,
      top_k: Math.max(1, Number($("topK").value) || 5),
      structures_per_candidate: settings.structures,
      seed: Math.max(0, Number($("seed").value) || 123),
      ranking_mode: settings.rankingMode,
      requested_ranking_mode: settings.requestedMode,
      rank_pool: settings.rankPool,
      browser_notes: settings.notes
    };
    $("designBtn").disabled = true;
    setStatus("Running CPU-WASM backend...");
    const start = performance.now();
    try {
      const run = await runWasmDesign(payload);
      run.wall_elapsed_browser_seconds = (performance.now() - start) / 1000;
      run.requested_ranking_mode = payload.requested_ranking_mode;
      run.browser_notes = payload.browser_notes;
      state.run = run;
      state.selectedCandidate = null;
      state.selectedStructure = null;
      renderRun();
      setStatus(`Finished in ${fmt(run.wall_elapsed_browser_seconds, 2)} s${run.browser_notes.length ? "\n" + run.browser_notes.join("\n") : ""}`);
    } catch (err) {
      setStatus(err && err.stack ? err.stack : String(err), true);
    } finally {
      $("designBtn").disabled = false;
    }
  }

  function renderRun() {
    renderMetrics(state.run);
    renderCandidates(state.run);
    if (state.run.candidates.length) {
      selectCandidate(0, "best");
    }
  }

  function renderMetrics(run) {
    if (!run) {
      $("metrics").innerHTML = "";
      return;
    }
    const best = run.candidates[0];
    const rankLabel = run.requested_ranking_mode === "auto" ? `auto→${run.ranking_mode}` : run.ranking_mode;
    $("metrics").innerHTML = [
      metric("AA length", run.psi.length),
      metric("sampled RNAs", run.rna_sample_count),
      metric("unique RNAs", run.unique_rna_count),
      metric("best score", best ? fmt(best.negative_log_conditional_probability, 2) : ""),
      metric("ranking", rankLabel),
      metric("seconds", fmt(run.wall_elapsed_browser_seconds, 1))
    ].join("");
  }

  function gcFraction(rna) {
    const seq = normalizeRna(rna);
    if (!seq.length) return 0;
    return Array.from(seq).filter((base) => base === "G" || base === "C").length / seq.length;
  }

  function bestStructureFor(candidate) {
    if (!candidate || !candidate.structures || !candidate.structures.length) return null;
    return candidate.structures.reduce((best, item) => {
      const left = Number(best.q_phi_structure);
      const right = Number(item.q_phi_structure);
      if (Number.isFinite(right) && (!Number.isFinite(left) || right < left)) return item;
      return best;
    }, candidate.structures[0]);
  }

  function renderCandidates(run) {
    const body = $("candidateRows");
    body.innerHTML = run.candidates.map((candidate, index) => {
      const bestStructure = bestStructureFor(candidate);
      return `<tr data-index="${index}">
        <td>${candidate.rank}</td>
        <td class="sequence" title="${candidate.rna}">${candidate.rna}</td>
        <td>${fmt(candidate.negative_log_conditional_probability, 3)}</td>
        <td>${fmt(candidate.q_phi, 3)}</td>
        <td>${candidate.observation_count}</td>
        <td>${candidate.structures.length}</td>
        <td>${bestStructure ? fmt(bestStructure.q_phi_structure, 3) : ""}</td>
        <td>${bestStructure ? fmt(bestStructure.negative_log_structure_probability, 3) : ""}</td>
        <td>${fmt(gcFraction(candidate.rna), 3)}</td>
      </tr>`;
    }).join("");
    body.querySelectorAll("tr").forEach((row) => {
      row.addEventListener("click", () => selectCandidate(Number(row.dataset.index), "best"));
    });
  }

  async function selectCandidate(index, mode) {
    const candidate = state.run && state.run.candidates[index];
    if (!candidate) return;
    state.selectedCandidate = index;
    const rows = Array.from($("candidateRows").querySelectorAll("tr"));
    rows.forEach((row) => row.classList.toggle("selected", Number(row.dataset.index) === index));
    $("randomStructureBtn").disabled = !candidate.structures.length;
    $("bestStructureBtn").disabled = !candidate.structures.length;
    $("toggleViewBtn").disabled = !candidate.structures.length;
    $("copyRnaBtn").disabled = false;
    state.svgView = "rna";
    $("toggleViewBtn").textContent = "Show AA view";
    if (!candidate.structures.length) {
      state.selectedStructure = null;
      $("structureSvg").className = "svg-placeholder";
      $("structureSvg").textContent = "No sampled structures were requested for this candidate.";
      renderDetails(candidate, null);
      return;
    }
    let structure = bestStructureFor(candidate);
    if (mode === "random") {
      structure = candidate.structures[Math.floor(Math.random() * candidate.structures.length)];
    }
    state.selectedStructure = structure;
    await renderSelectedStructure();
  }

  async function renderSelectedStructure() {
    const candidate = state.run.candidates[state.selectedCandidate];
    const structure = state.selectedStructure;
    if (!candidate || !structure) return;
    const root = $("structureSvg");
    root.className = "";
    root.innerHTML = `<div class="svg-placeholder">Rendering sampled structure...</div>`;
    try {
      const html = await renderStructureVariant(candidate, structure, state.svgView);
      root.innerHTML = html;
      fitSvgs(root);
    } catch (err) {
      root.className = "svg-placeholder";
      root.textContent = `Structure rendering failed: ${err && err.message ? err.message : String(err)}`;
    }
    renderDetails(candidate, structure);
  }

  function renderDetails(candidate, structure) {
    const best = structure === bestStructureFor(candidate);
    $("viewerCaption").innerHTML = best
      ? "Lowest sampled q<sub>ψ</sub>(φ,s)"
      : "Random sampled structure";
    $("details").textContent = [
      `rank: ${candidate.rank}`,
      `RNA: ${candidate.rna}`,
      `AA:  ${candidate.translated}`,
      `q_psi(phi) - q_psi: ${fmt(candidate.negative_log_conditional_probability, 6)}`,
      `q_psi(phi): ${fmt(candidate.q_phi, 6)}`,
      structure ? `sample index: ${structure.sample_index}` : "",
      structure ? `dot-bracket: ${structure.structure_dot_bracket}` : "",
      structure ? `q_psi(phi,s): ${fmt(structure.q_phi_structure, 6)}` : "",
      structure ? `-log p(s|phi): ${fmt(structure.negative_log_structure_probability, 6)}` : ""
    ].filter(Boolean).join("\n");
  }

  async function getViennaRenderModule() {
    if (typeof createViennaRenderModule !== "function") {
      throw new Error("ViennaRNA WASM renderer is not loaded");
    }
    if (!viennaRenderModulePromise) {
      viennaRenderModulePromise = createViennaRenderModule({
        locateFile: (path) => assetUrl(path)
      });
    }
    return viennaRenderModulePromise;
  }

  async function renderStructureVariant(candidate, structure, viewMode) {
    const cacheKey = viewMode === "aa" ? "_aaSvg" : "_rnaSvg";
    if (structure[cacheKey]) return structure[cacheKey];
    const rna = normalizeRna(candidate.rna);
    const dot = structure.structure_dot_bracket || dotFromPairing(structure.pairing || []);
    const module = await getViennaRenderModule();
    const raw = module.renderSvg(rna, dot, "simple");
    structure[cacheKey] = styleViennaSvg(raw, rna, viewMode);
    return structure[cacheKey];
  }

  function dotFromPairing(pairing) {
    const chars = Array.from({ length: pairing.length }, () => ".");
    pairing.forEach((partner, i) => {
      if (partner > i) {
        chars[i] = "(";
        chars[partner] = ")";
      }
    });
    return chars.join("");
  }

  function fitSvgs(root) {
    root.querySelectorAll("svg").forEach((svg) => {
      const viewBox = svg.getAttribute("viewBox");
      if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] && parts[3]) {
          const aspect = parts[2] / parts[3];
          svg.style.width = aspect >= 1 ? "100%" : `${Math.max(1, Math.floor(root.clientWidth * aspect))}px`;
        }
      }
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      svg.style.margin = "0 auto";
    });
  }

  function styleViennaSvg(rawSvg, rna, viewMode) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== "svg") return rawSvg;
    svg.querySelectorAll("script").forEach((node) => node.remove());
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    if (viewMode === "aa") svg.classList.add("show-aa");
    svg.querySelectorAll("rect").forEach((rect) => {
      const style = rect.getAttribute("style") || "";
      if (style.includes("fill: white")) {
        rect.setAttribute("style", "stroke: none; fill: transparent");
        rect.setAttribute("pointer-events", "none");
      }
    });
    ensureViennaDefs(doc, svg);
    const coords = Array.from(svg.querySelectorAll("text.nucleotide")).map((node) => ({
      x: Number(node.getAttribute("x")),
      y: Number(node.getAttribute("y")),
      base: node.textContent || ""
    })).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
    if (coords.length !== rna.length) return rawSvg;
    const distances = [];
    for (let i = 0; i + 1 < coords.length; i += 1) {
      distances.push(Math.hypot(coords[i + 1].x - coords[i].x, coords[i + 1].y - coords[i].y));
    }
    distances.sort((a, b) => a - b);
    const medianDistance = distances.length ? distances[Math.floor(distances.length / 2)] : 14.0;
    const radius = Math.max(3.3, Math.min(4.9, medianDistance * 0.29));
    const fontSize = Math.max(4.3, Math.min(6.2, radius * 1.12));
    addViennaStyle(doc, svg, fontSize);
    const seq = svg.querySelector("#seq") || svg.querySelector("text.nucleotide")?.parentElement;
    if (!seq) return rawSvg;
    while (seq.firstChild) seq.removeChild(seq.firstChild);
    seq.setAttribute("class", "sequence-layers");
    seq.removeAttribute("transform");
    const boxes = [];
    seq.appendChild(makeBaseLayer(doc, coords, radius));
    coords.forEach((item) => boxes.push([item.x - radius, item.y - radius, item.x + radius, item.y + radius]));
    const codonLayer = makeCodonBoundaryLayer(doc, coords, radius);
    if (codonLayer) {
      seq.appendChild(codonLayer.group);
      boxes.push(...codonLayer.boxes);
    }
    const aaLayer = makeAaLayer(doc, rna, coords, radius, fontSize);
    if (aaLayer) {
      seq.appendChild(aaLayer.group);
      boxes.push(...aaLayer.boxes);
    }
    fitViennaSvgToBoxes(svg, boxes);
    return new XMLSerializer().serializeToString(svg);
  }

  function ensureViennaDefs(doc, svg) {
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    if (!svg.querySelector("#bubbleShadow")) {
      const filter = doc.createElementNS("http://www.w3.org/2000/svg", "filter");
      filter.setAttribute("id", "bubbleShadow");
      filter.setAttribute("x", "-40%");
      filter.setAttribute("y", "-40%");
      filter.setAttribute("width", "180%");
      filter.setAttribute("height", "180%");
      const shadow = doc.createElementNS("http://www.w3.org/2000/svg", "feDropShadow");
      shadow.setAttribute("dx", "0");
      shadow.setAttribute("dy", "0.65");
      shadow.setAttribute("stdDeviation", "0.85");
      shadow.setAttribute("flood-color", "#2C342F");
      shadow.setAttribute("flood-opacity", "0.28");
      filter.appendChild(shadow);
      defs.appendChild(filter);
    }
  }

  function addViennaStyle(doc, svg, fontSize) {
    const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
    style.setAttribute("type", "text/css");
    style.textContent = `
      .backbone { stroke: #9BA398; fill: none; stroke-width: 1.18; stroke-linecap: round; stroke-linejoin: round; }
      .basepairs { stroke: #7B3F96; fill: none; stroke-width: 2.25; stroke-linecap: round; opacity: 0.84; }
      .base-bubble { stroke: #FFFDF6; stroke-width: 1.00; filter: url(#bubbleShadow); }
      .base-letter { font-family: Avenir Next, Helvetica Neue, Arial, sans-serif; font-weight: 800; font-size: ${fontSize.toFixed(2)}px; fill: #FFFDF6; dominant-baseline: central; pointer-events: none; }
      .codon-boundary { stroke: #273B59; fill: none; stroke-width: 0.74; stroke-linecap: round; opacity: 0.82; }
      .aa-view { opacity: 0; pointer-events: none; transition: opacity 180ms ease; }
      .rna-base-view, .codon-boundaries, .backbone, .basepairs { transition: opacity 180ms ease; }
      svg.show-aa .aa-view { opacity: 1; pointer-events: auto; }
      svg.show-aa .rna-base-view { opacity: 0.10; }
      svg.show-aa .codon-boundaries { opacity: 0.24; }
      svg.show-aa .backbone { opacity: 0.18; }
      svg.show-aa .basepairs { opacity: 0.08; }
      .aa-connector { stroke: #5C6F68; stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; fill: none; opacity: 0.72; }
      .aa-connector-underlay { stroke: #FFF8E8; stroke-width: 3.90; stroke-linecap: round; stroke-linejoin: round; fill: none; opacity: 0.62; }
      .aa-bubble { fill: #FFF3C7; stroke: #5B4630; stroke-width: 1.35; filter: url(#bubbleShadow); opacity: 1; }
      .codon-aa { font-family: Avenir Next, Helvetica Neue, Arial, sans-serif; font-weight: 900; font-size: ${(fontSize * 0.96).toFixed(2)}px; fill: #2F2417; dominant-baseline: central; pointer-events: none; }
    `;
    const firstStyle = svg.querySelector("style");
    if (firstStyle && firstStyle.parentNode) {
      firstStyle.parentNode.insertBefore(style, firstStyle.nextSibling);
    } else {
      svg.insertBefore(style, svg.firstChild);
    }
  }

  function makeBaseLayer(doc, coords, radius) {
    const group = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "rna-base-view");
    coords.forEach((item, index) => {
      const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("class", `base-bubble base-${item.base}`);
      circle.setAttribute("cx", item.x.toFixed(3));
      circle.setAttribute("cy", item.y.toFixed(3));
      circle.setAttribute("r", radius.toFixed(3));
      circle.setAttribute("fill", BASE_COLORS[item.base] || "#58606A");
      const title = doc.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${index + 1}: ${item.base}`;
      circle.appendChild(title);
      group.appendChild(circle);
    });
    coords.forEach((item) => {
      const text = doc.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("class", "base-letter");
      text.setAttribute("x", item.x.toFixed(3));
      text.setAttribute("y", (item.y + 0.15).toFixed(3));
      text.setAttribute("text-anchor", "middle");
      text.textContent = item.base;
      group.appendChild(text);
    });
    return group;
  }

  function makeCodonBoundaryLayer(doc, coords, radius) {
    if (coords.length < 6) return null;
    const group = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "codon-boundaries");
    const boxes = [];
    for (let boundary = 1; boundary < Math.floor(coords.length / 3); boundary += 1) {
      const left = coords[boundary * 3 - 1];
      const right = coords[boundary * 3];
      const tangent = normalizeVector(right.x - left.x, right.y - left.y, 1, 0);
      const normal = [-tangent[1], tangent[0]];
      const midX = (left.x + right.x) / 2;
      const midY = (left.y + right.y) / 2;
      const tickHalf = radius * 0.42;
      const tickGap = radius * 0.10;
      [-1, 1].forEach((side) => {
        const cx = midX + tangent[0] * tickGap * side;
        const cy = midY + tangent[1] * tickGap * side;
        const line = doc.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("class", "codon-boundary");
        line.setAttribute("x1", (cx - normal[0] * tickHalf).toFixed(3));
        line.setAttribute("y1", (cy - normal[1] * tickHalf).toFixed(3));
        line.setAttribute("x2", (cx + normal[0] * tickHalf).toFixed(3));
        line.setAttribute("y2", (cy + normal[1] * tickHalf).toFixed(3));
        group.appendChild(line);
        boxes.push(expandedBox(
          cx - normal[0] * tickHalf,
          cy - normal[1] * tickHalf,
          cx + normal[0] * tickHalf,
          cy + normal[1] * tickHalf,
          radius * 0.20
        ));
      });
    }
    return { group, boxes };
  }

  function makeAaLayer(doc, rna, coords, radius, fontSize) {
    if (rna.length % 3 !== 0 || coords.length < 3) return null;
    const aa = translateRna(rna);
    if (!aa) return null;
    const codonCenters = [];
    for (let codon = 0; codon < Math.floor(rna.length / 3); codon += 1) {
      const mid = coords[3 * codon + 1];
      if (!mid) continue;
      codonCenters.push({ x: mid.x, y: mid.y, codon: rna.slice(3 * codon, 3 * codon + 3), aa: aa[codon] || "?" });
    }
    const group = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "aa-view");
    const boxes = [];
    const connectorGroup = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    connectorGroup.setAttribute("class", "aa-connectors");
    const path = smoothPath(coords.map((item) => [item.x, item.y]));
    ["aa-connector-underlay", "aa-connector"].forEach((cls) => {
      const node = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      node.setAttribute("class", cls);
      node.setAttribute("d", path);
      connectorGroup.appendChild(node);
    });
    group.appendChild(connectorGroup);
    const aaRadius = adaptiveAaRadius(codonCenters, radius);
    const aaFontSize = Math.max(3.2, Math.min(fontSize * 0.96, aaRadius * 1.06));
    if (coords.length) {
      const xs = coords.map((item) => item.x);
      const ys = coords.map((item) => item.y);
      boxes.push([Math.min(...xs) - aaRadius, Math.min(...ys) - aaRadius, Math.max(...xs) + aaRadius, Math.max(...ys) + aaRadius]);
    }
    codonCenters.forEach((item, index) => {
      const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("class", "aa-bubble");
      circle.setAttribute("cx", item.x.toFixed(3));
      circle.setAttribute("cy", item.y.toFixed(3));
      circle.setAttribute("r", aaRadius.toFixed(3));
      const title = doc.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `codon ${index + 1}: ${item.codon} -> ${item.aa}`;
      circle.appendChild(title);
      group.appendChild(circle);
      const text = doc.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("class", "codon-aa");
      text.setAttribute("x", item.x.toFixed(3));
      text.setAttribute("y", (item.y + 0.12).toFixed(3));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("style", `font-size:${aaFontSize.toFixed(3)}px`);
      text.textContent = item.aa;
      group.appendChild(text);
      boxes.push([item.x - aaRadius, item.y - aaRadius, item.x + aaRadius, item.y + aaRadius]);
    });
    return { group, boxes };
  }

  function fitViennaSvgToBoxes(svg, boxes, margin = 16.0) {
    if (!boxes.length) return;
    const rootGroup = Array.from(svg.querySelectorAll("g")).find((node) => {
      const transform = node.getAttribute("transform") || "";
      return transform.startsWith("scale(") && transform.includes("translate(");
    });
    if (!rootGroup) return;
    const parsed = parseViennaRootTransform(rootGroup.getAttribute("transform") || "");
    if (!parsed) return;
    const [scaleX, scaleY] = parsed.scale;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    boxes.forEach(([left, top, right, bottom]) => {
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return;
    const newTx = -minX + margin / scaleX;
    const newTy = -minY + margin / scaleY;
    const newWidth = Math.ceil((maxX - minX) * scaleX + 2.0 * margin);
    const newHeight = Math.ceil((maxY - minY) * scaleY + 2.0 * margin);
    svg.setAttribute("width", String(newWidth));
    svg.setAttribute("height", String(newHeight));
    svg.setAttribute("viewBox", `0 0 ${newWidth} ${newHeight}`);
    svg.querySelectorAll("rect").forEach((rect) => {
      const style = rect.getAttribute("style") || "";
      if (style.includes("fill: transparent")) {
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(newWidth));
        rect.setAttribute("height", String(newHeight));
      }
    });
    rootGroup.setAttribute("transform", `scale(${scaleX.toFixed(6)},${scaleY.toFixed(6)}) translate(${newTx.toFixed(6)},${newTy.toFixed(6)})`);
  }

  function parseViennaRootTransform(transform) {
    const match = transform.match(/scale\(([-0-9.]+),([-0-9.]+)\)\s+translate\(([-0-9.]+),([-0-9.]+)\)/);
    if (!match) return null;
    return {
      scale: [Number(match[1]), Number(match[2])],
      translate: [Number(match[3]), Number(match[4])]
    };
  }

  function expandedBox(x1, y1, x2, y2, padding) {
    return [
      Math.min(x1, x2) - padding,
      Math.min(y1, y2) - padding,
      Math.max(x1, x2) + padding,
      Math.max(y1, y2) + padding
    ];
  }

  function normalizeVector(x, y, fallbackX, fallbackY) {
    const norm = Math.hypot(x, y);
    return norm < 1e-8 ? [fallbackX, fallbackY] : [x / norm, y / norm];
  }

  function adaptiveAaRadius(codonCenters, baseRadius) {
    const desired = Math.max(baseRadius * 1.65, 6.4);
    let minDistance = Infinity;
    for (let i = 0; i < codonCenters.length; i += 1) {
      for (let j = i + 1; j < codonCenters.length; j += 1) {
        minDistance = Math.min(minDistance, Math.hypot(codonCenters[i].x - codonCenters[j].x, codonCenters[i].y - codonCenters[j].y));
      }
    }
    return Number.isFinite(minDistance) ? Math.min(desired, Math.max(4.8, minDistance * 0.44)) : desired;
  }

  function smoothPath(points) {
    if (!points.length) return "";
    if (points.length === 1) return `M ${points[0][0].toFixed(3)} ${points[0][1].toFixed(3)}`;
    const parts = [`M ${points[0][0].toFixed(3)} ${points[0][1].toFixed(3)}`];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const p0 = index > 0 ? points[index - 1] : points[index];
      const p1 = points[index];
      const p2 = points[index + 1];
      const p3 = index + 2 < points.length ? points[index + 2] : p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      parts.push(`C ${c1x.toFixed(3)} ${c1y.toFixed(3)}, ${c2x.toFixed(3)} ${c2y.toFixed(3)}, ${p2[0].toFixed(3)} ${p2[1].toFixed(3)}`);
    }
    return parts.join(" ");
  }

  function translateRna(rna) {
    const normalized = normalizeRna(rna);
    let out = "";
    for (let i = 0; i + 2 < normalized.length; i += 3) {
      out += GENETIC_CODE[normalized.slice(i, i + 3)] || "?";
    }
    return out;
  }

  $("designBtn").addEventListener("click", submitDesign);
  $("exampleBtn").addEventListener("click", chooseExample);
  $("clearBtn").addEventListener("click", () => {
    $("psi").value = "";
    setStatus("");
  });
  $("mainPageBtn").addEventListener("click", () => {
    window.location.href = "index.html";
  });
  $("randomStructureBtn").addEventListener("click", () => selectCandidate(state.selectedCandidate, "random"));
  $("bestStructureBtn").addEventListener("click", () => selectCandidate(state.selectedCandidate, "best"));
  $("toggleViewBtn").addEventListener("click", async () => {
    state.svgView = state.svgView === "aa" ? "rna" : "aa";
    $("toggleViewBtn").textContent = state.svgView === "aa" ? "Show RNA view" : "Show AA view";
    await renderSelectedStructure();
  });
  $("copyRnaBtn").addEventListener("click", async () => {
    const candidate = state.run && state.run.candidates[state.selectedCandidate];
    if (!candidate) return;
    await navigator.clipboard.writeText(candidate.rna);
  });
  window.addEventListener("resize", () => fitSvgs($("structureSvg")));
  chooseExample();
})();

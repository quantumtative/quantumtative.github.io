(function () {
  const state = {
    run: null,
    selectedCandidate: null,
    selectedStructure: null,
    svgView: "rna",
    structureSvgs: null
  };
  let viennaRenderModulePromise = null;
  const ASSET_BASE_URL = new URL("./", document.currentScript ? document.currentScript.src : window.location.href).href;

  function assetUrl(path) {
    return new URL(path, ASSET_BASE_URL).href;
  }

  const EXAMPLE_SEQUENCES = [
    { name: "human insulin B chain", sequence: "FVNQHLCGSHLVEALYLVCGERGFFYTPKT" },
    { name: "human glucagon", sequence: "HSQGTFTSDYSKYLDSRRAQDFVQWLMNT" },
    { name: "somatostatin-14", sequence: "AGCKNFFWKTFTSC" },
    { name: "oxytocin peptide", sequence: "CYIQNCPLG" },
    { name: "vasopressin peptide", sequence: "CYFQNCPRG" },
    { name: "bradykinin peptide", sequence: "RPPGFSPFR" },
    { name: "angiotensin II", sequence: "DRVYIHPF" },
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

  function showPage(name) {
    $("input-page").classList.toggle("hidden", name !== "input");
    $("candidate-page").classList.toggle("hidden", name !== "candidates");
    $("viz-page").classList.toggle("hidden", name !== "viz");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fmt(value, digits = 3) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
    return value.toFixed(digits);
  }

  function cleanPsi(raw) {
    return raw.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, "");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function candidateSummaryHtml(candidate) {
    return `q<sub>ψ</sub>(φ) − q<sub>ψ</sub> = ${fmt(candidate.negative_log_conditional_probability)} · ${candidate.structures.length} structures`;
  }

  function setError(message) {
    const box = $("input-error");
    box.textContent = message || "";
    box.classList.toggle("hidden", !message);
  }

  function chooseInitialExample() {
    const current = cleanPsi($("psi").value);
    const pool = EXAMPLE_SEQUENCES.filter((item) => item.sequence !== current);
    const choices = pool.length ? pool : EXAMPLE_SEQUENCES;
    const choice = choices[Math.floor(Math.random() * choices.length)];
    $("psi").value = choice.sequence;
    $("psi").title = choice.name;
  }

  function resolveRunSettings(psi, structures) {
    const requestedMode = $("ranking-mode").value;
    let rankingMode = requestedMode === "fast" ? "fast" : requestedMode === "exact" ? "exact" : "auto";
    let rankPool = Math.max(1, Number($("rank-pool").value) || 20);
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
    const maybeExitCode = module.callMain(args);
    let exitCode = maybeExitCode && typeof maybeExitCode.then === "function"
      ? await maybeExitCode
      : maybeExitCode;
    if (exitCode !== 0) {
      throw new Error(stderr.join("\n") || `WASM backend exited with ${exitCode}`);
    }
    if (stdout.length === 0) {
      throw new Error(stderr.join("\n") || "WASM backend produced no JSON output.");
    }
    return JSON.parse(stdout.join("\n"));
  }

  async function checkWebGpu() {
    return undefined;
  }

  async function benchmarkWebGpuColumn() {
    return undefined;
  }

  function makeColumnPropagationProblem(n, j) {
    const modes = 4;
    const widths = new Uint32Array(n + 1);
    for (let i = 0; i <= n; i += 1) {
      widths[i] = 3 * (1 + ((i * 7 + 3) % 6));
    }
    const offsets = new Uint32Array(n * n);
    let arenaCount = 0;
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        offsets[row * n + col] = arenaCount;
        arenaCount += modes * widths[row] * widths[col];
      }
    }
    const arena = new Float32Array(arenaCount);
    let seed = 0x12345678;
    const rand = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < arena.length; i += 1) {
      arena[i] = 0.04 + 0.12 * rand();
    }
    const logScales = new Float32Array(n * n);
    for (let i = 0; i < logScales.length; i += 1) {
      logScales[i] = -0.25 + 0.50 * rand();
    }
    const baseScales = new Float32Array(n);
    baseScales.fill(-3.4e38);
    const elementPrefix = new Uint32Array(j + 1);
    for (let i = 0; i < j; i += 1) {
      let base = -3.4e38;
      for (let k = i; k < j; k += 1) {
        base = Math.max(base, logScales[i * n + k] + logScales[j * n + k]);
      }
      baseScales[i] = base;
      elementPrefix[i + 1] = elementPrefix[i] + modes * widths[i] * widths[j];
      const outOffset = offsets[i * n + j];
      arena.fill(0, outOffset, outOffset + modes * widths[i] * widths[j]);
    }
    return {
      n,
      j,
      modes,
      widths,
      offsets,
      arena,
      logScales,
      baseScales,
      elementPrefix,
      totalElements: elementPrefix[j]
    };
  }

  function cpuPropagateColumn(problem) {
    const { n, j, modes, widths, offsets, arena, logScales, baseScales, elementPrefix, totalElements } = problem;
    const expected = new Float32Array(totalElements);
    for (let i = 0; i < j; i += 1) {
      const rows = widths[i];
      const cols = widths[j];
      const plane = rows * cols;
      const baseScale = baseScales[i];
      for (let mode = 0; mode < modes; mode += 1) {
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            let accum = 0.0;
            for (let k = i; k < j; k += 1) {
              const leftScale = logScales[i * n + k];
              const rightScale = logScales[j * n + k];
              const weight = Math.exp((leftScale + rightScale) - baseScale);
              const inner = widths[k];
              const leftOffset = offsets[i * n + k];
              const rightOffset = offsets[j * n + k];
              const leftPlane = rows * inner;
              const rightPlane = cols * inner;
              if (mode === 0) {
                for (let h = 0; h < inner; h += 1) {
                  const l0 = arena[leftOffset + row * inner + h];
                  const l1 = arena[leftOffset + leftPlane + row * inner + h];
                  const r0 = arena[rightOffset + col * inner + h];
                  const r1 = arena[rightOffset + rightPlane + col * inner + h];
                  accum += weight * (l0 * r1 + l1 * r0);
                }
              } else {
                const leftModeOffset = mode * leftPlane;
                const rightModeOffset = mode * rightPlane;
                for (let h = 0; h < inner; h += 1) {
                  accum += weight *
                    arena[leftOffset + leftModeOffset + row * inner + h] *
                    arena[rightOffset + rightModeOffset + col * inner + h];
                }
              }
            }
            expected[elementPrefix[i] + mode * plane + row * cols + col] = accum;
          }
        }
      }
    }
    return expected;
  }

  async function webGpuPropagateColumn(device, problem, repeats) {
    const shader = device.createShaderModule({
      code: `
        struct Params {
          n: u32,
          j: u32,
          total_elements: u32,
          pad: u32,
        };

        @group(0) @binding(0) var<storage, read_write> arena: array<f32>;
        @group(0) @binding(1) var<storage, read> log_scales: array<f32>;
        @group(0) @binding(2) var<storage, read> widths: array<u32>;
        @group(0) @binding(3) var<storage, read> block_offsets: array<u32>;
        @group(0) @binding(4) var<storage, read> base_scales: array<f32>;
        @group(0) @binding(5) var<storage, read> element_prefix: array<u32>;
        @group(0) @binding(6) var<uniform> p: Params;

        @compute @workgroup_size(256)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
          let gid = id.x;
          if (gid >= p.total_elements) {
            return;
          }

          var lo = 0u;
          var hi = p.j;
          loop {
            if (lo + 1u >= hi) {
              break;
            }
            let mid = (lo + hi) >> 1u;
            if (element_prefix[mid] <= gid) {
              lo = mid;
            } else {
              hi = mid;
            }
          }

          let i = lo;
          let local = gid - element_prefix[i];
          let rows = widths[i];
          let cols = widths[p.j];
          let plane = rows * cols;
          let mode = local / plane;
          let rem = local - mode * plane;
          let row = rem / cols;
          let col = rem - row * cols;
          let out_offset = block_offsets[i * p.n + p.j];
          let base_scale = base_scales[i];
          if (base_scale < -3.0e38) {
            arena[out_offset + mode * plane + row * cols + col] = 0.0;
            return;
          }

          var accum = 0.0;
          for (var k = i; k < p.j; k = k + 1u) {
            let left_scale = log_scales[i * p.n + k];
            let right_scale = log_scales[p.j * p.n + k];
            if (left_scale < -3.0e38 || right_scale < -3.0e38) {
              continue;
            }
            let weight = exp((left_scale + right_scale) - base_scale);
            let inner = widths[k];
            let left_offset = block_offsets[i * p.n + k];
            let right_offset = block_offsets[p.j * p.n + k];
            let left_plane = rows * inner;
            let right_plane = cols * inner;
            if (mode == 0u) {
              for (var h = 0u; h < inner; h = h + 1u) {
                let l0 = arena[left_offset + row * inner + h];
                let l1 = arena[left_offset + left_plane + row * inner + h];
                let r0 = arena[right_offset + col * inner + h];
                let r1 = arena[right_offset + right_plane + col * inner + h];
                accum += weight * (l0 * r1 + l1 * r0);
              }
            } else {
              let left_mode_offset = mode * left_plane;
              let right_mode_offset = mode * right_plane;
              for (var h = 0u; h < inner; h = h + 1u) {
                let l = arena[left_offset + left_mode_offset + row * inner + h];
                let r = arena[right_offset + right_mode_offset + col * inner + h];
                accum += weight * l * r;
              }
            }
          }
          arena[out_offset + mode * plane + row * cols + col] = accum;
        }
      `
    });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: shader, entryPoint: "main" }
    });
    const arenaBuffer = writeStorageBuffer(device, problem.arena, GPUBufferUsage.COPY_SRC);
    const logBuffer = writeStorageBuffer(device, problem.logScales, 0);
    const widthBuffer = writeStorageBuffer(device, problem.widths, 0);
    const offsetBuffer = writeStorageBuffer(device, problem.offsets, 0);
    const baseBuffer = writeStorageBuffer(device, problem.baseScales, 0);
    const prefixBuffer = writeStorageBuffer(device, problem.elementPrefix, 0);
    const params = new Uint32Array([problem.n, problem.j, problem.totalElements, 0]);
    const paramBuffer = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(paramBuffer, 0, params);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: arenaBuffer } },
        { binding: 1, resource: { buffer: logBuffer } },
        { binding: 2, resource: { buffer: widthBuffer } },
        { binding: 3, resource: { buffer: offsetBuffer } },
        { binding: 4, resource: { buffer: baseBuffer } },
        { binding: 5, resource: { buffer: prefixBuffer } },
        { binding: 6, resource: { buffer: paramBuffer } }
      ]
    });
    const encode = () => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(problem.totalElements / 256));
      pass.end();
      return encoder.finish();
    };
    device.queue.submit([encode()]);
    await device.queue.onSubmittedWorkDone();
    const start = performance.now();
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      device.queue.submit([encode()]);
    }
    await device.queue.onSubmittedWorkDone();
    const msPerRepeat = (performance.now() - start) / repeats;
    const readback = device.createBuffer({
      size: problem.arena.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(arenaBuffer, 0, readback, 0, problem.arena.byteLength);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const arena = new Float32Array(readback.getMappedRange()).slice();
    readback.unmap();
    return { msPerRepeat, arena };
  }

  function writeStorageBuffer(device, data, extraUsage) {
    const buffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extraUsage
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  function maxColumnError(problem, expected, arena) {
    const { n, j, modes, widths, offsets, elementPrefix } = problem;
    let maxError = 0.0;
    for (let i = 0; i < j; i += 1) {
      const rows = widths[i];
      const cols = widths[j];
      const plane = rows * cols;
      const outOffset = offsets[i * n + j];
      for (let mode = 0; mode < modes; mode += 1) {
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const local = elementPrefix[i] + mode * plane + row * cols + col;
            const actual = arena[outOffset + mode * plane + row * cols + col];
            maxError = Math.max(maxError, Math.abs(actual - expected[local]));
          }
        }
      }
    }
    return maxError;
  }

  async function adapterInfo(adapter) {
    if (adapter.info) return adapter.info;
    if (typeof adapter.requestAdapterInfo === "function") {
      try {
        return await adapter.requestAdapterInfo();
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  async function runTinyWebGpuCompute(device) {
    const values = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const size = values.byteLength;
    const input = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const output = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    device.queue.writeBuffer(input, 0, values);
    const shader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read> x: array<f32>;
        @group(0) @binding(1) var<storage, read_write> y: array<f32>;
        @compute @workgroup_size(8)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
          let i = id.x;
          if (i < 8u) {
            y[i] = 2.0 * x[i] + 1.0;
          }
        }
      `
    });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: shader, entryPoint: "main" }
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: input } },
        { binding: 1, resource: { buffer: output } }
      ]
    });
    const start = performance.now();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, size);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readback.getMappedRange()).slice();
    readback.unmap();
    const expected = Array.from(values, (value) => 2 * value + 1);
    const ok = expected.every((value, i) => Math.abs(result[i] - value) < 1e-6);
    if (!ok) throw new Error(`compute result mismatch: ${Array.from(result).join(", ")}`);
    return performance.now() - start;
  }

  async function submitDesign(event) {
    event.preventDefault();
    setError("");
    const psi = cleanPsi($("psi").value);
    if (!psi) {
      setError("Enter a valid amino-acid sequence.");
      return;
    }
    const rnaSamples = Math.max(1, Number($("rna-samples").value) || 2000);
    const structures = Math.max(0, Number($("structure-samples").value) || 0);
    const resolved = resolveRunSettings(psi, structures);
    const payload = {
      psi,
      rna_samples: rnaSamples,
      top_k: Math.max(1, Number($("top-k").value) || 5),
      structures_per_candidate: resolved.structures,
      seed: Math.max(0, Number($("seed").value) || 123),
      backend: "cpu",
      ranking_mode: resolved.rankingMode,
      requested_ranking_mode: resolved.requestedMode,
      rank_pool: resolved.rankPool,
      browser_notes: resolved.notes
    };
    $("run-button").disabled = true;
    $("input-loader").classList.remove("hidden");
    $("status-pill").textContent = "running CPU-WASM";
    const start = performance.now();
    try {
      const run = await runWasmDesign(payload);
      run.wall_elapsed_browser_seconds = (performance.now() - start) / 1000;
      run.requested_ranking_mode = payload.requested_ranking_mode;
      run.browser_notes = payload.browser_notes;
      state.run = run;
      renderCandidates();
      showPage("candidates");
    } catch (err) {
      setError(err && err.stack ? err.stack : String(err));
    } finally {
      $("run-button").disabled = false;
      $("input-loader").classList.add("hidden");
    }
  }

  function renderCandidates() {
    const run = state.run;
    $("candidate-aa").textContent = run.psi;
    const rankLabel = run.requested_ranking_mode === "auto"
      ? `auto → ${run.ranking_mode}`
      : run.ranking_mode;
    const notes = run.browser_notes && run.browser_notes.length
      ? ` · ${run.browser_notes.join(" · ")}`
      : "";
    $("run-summary").textContent =
      `${run.rna_sample_count} RNA samples · ${run.unique_rna_count} unique RNAs · ${rankLabel} ranking · single-thread CPU-WASM · ${fmt(run.wall_elapsed_browser_seconds)} s browser wall time${notes}`;
    $("candidate-cards").innerHTML = run.candidates.map((candidate, index) => `
      <article class="panel candidate-card" data-index="${index}">
        <div class="rank">${candidate.rank}</div>
        <div class="rna">${escapeHtml(candidate.rna)}</div>
        <div class="metrics">
          <div class="metric-row"><span>lowest scoring</span><b>${fmt(candidate.negative_log_conditional_probability)}</b></div>
          <div class="metric-row"><span>seen</span><b>${candidate.observation_count}</b></div>
          <div class="metric-row"><span>structures</span><b>${candidate.structures.length}</b></div>
        </div>
      </article>
    `).join("");
    document.querySelectorAll(".candidate-card").forEach((card) => {
      card.addEventListener("click", () => openCandidate(Number(card.dataset.index)));
    });
    updateCopyButtonForTruncation("candidate-aa", "candidate-aa-copy");
  }

  async function openCandidate(index) {
    state.selectedCandidate = index;
    state.selectedStructure = null;
    state.svgView = "rna";
    state.structureSvgs = null;
    const candidate = state.run.candidates[index];
    $("viz-title").textContent = `Candidate ${candidate.rank}`;
    $("viz-subtitle").innerHTML = candidateSummaryHtml(candidate);
    $("viz-rna").textContent = candidate.rna;
    $("viz-aa").textContent = candidate.translated;
    $("viz-metrics").innerHTML = `
      <div class="metric-row"><span>q<sub>ψ</sub>(φ) − q<sub>ψ</sub></span><b>${fmt(candidate.negative_log_conditional_probability)}</b></div>
      <div class="metric-row"><span>sample count</span><b>${candidate.observation_count}</b></div>
      <div class="metric-row"><span>renderer</span><b>ViennaRNA WASM</b></div>`;
    showPage("viz");
    await refreshStructure(true);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function refreshStructure(randomize = true) {
    const candidate = state.run.candidates[state.selectedCandidate];
    if (!candidate) return;
    if (!candidate.structures || candidate.structures.length < 1) {
      $("svg-panel").classList.remove("loading");
      $("svg-panel").innerHTML = '<div class="subtle" style="padding: 32px;">No structures were requested for this WASM run.</div>';
      $("structure-meta").textContent = "";
      return;
    }
    let structureIndex = state.selectedStructure;
    if (randomize || structureIndex === null) {
      structureIndex = Math.floor(Math.random() * candidate.structures.length);
    }
    state.selectedStructure = structureIndex;
    state.structureSvgs = null;
    const structure = candidate.structures[structureIndex];
    const existingStage = $("svg-stage");
    if (existingStage) {
      existingStage.classList.remove("visible");
      existingStage.classList.add("fade-out");
      await sleep(370);
    } else {
      $("svg-panel").classList.add("loading");
      $("svg-panel").innerHTML = '<div class="loader"><span class="spinner"></span><span>Rendering structure...</span></div>';
    }
    state.structureSvgs = await renderStructureVariants(candidate, structure);
    $("svg-panel").classList.remove("loading");
    $("svg-panel").innerHTML = `
      <button id="structure-view-toggle" class="structure-toggle" type="button"></button>
      <div id="svg-stage" class="svg-stage">
        <div id="svg-view" class="svg-view active"></div>
      </div>`;
    $("structure-view-toggle").addEventListener("click", toggleStructureView);
    applyStructureView();
    revealStructureStage();
    $("structure-meta").textContent =
      `Structure ${structureIndex + 1} of ${candidate.structures.length} · NLL ${fmt(structure.negative_log_structure_probability)}`;
  }

  function revealStructureStage() {
    const stage = $("svg-stage");
    if (!stage) return;
    stage.classList.remove("fade-out");
    stage.classList.remove("visible");
    void stage.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("visible")));
  }

  function applyStructureView() {
    const candidate = state.run.candidates[state.selectedCandidate];
    const structure = candidate.structures[state.selectedStructure || 0];
    const isAa = state.svgView === "aa";
    const view = $("svg-view");
    if (view && structure) {
      const svgs = state.structureSvgs;
      view.innerHTML = svgs ? (isAa ? svgs.aa : svgs.rna) : renderStructureSvg(candidate.rna, structure.pairing, isAa);
      view.classList.add("active");
      normalizeStructureSvgs();
    }
    const toggle = $("structure-view-toggle");
    if (toggle) toggle.textContent = isAa ? "Show RNA view" : "Show AA view";
  }

  function toggleStructureView() {
    state.svgView = state.svgView === "aa" ? "rna" : "aa";
    applyStructureView();
  }

  function normalizeStructureSvgs() {
    document.querySelectorAll(".svg-view svg").forEach((svg) => {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.style.display = "block";
      svg.style.width = structureSvgWidthForVerticalCap(svg);
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      svg.style.margin = "0 auto";
    });
  }

  function structureSvgWidthForVerticalCap(svg) {
    const view = svg.closest(".svg-view");
    const containerWidth = view ? view.clientWidth : 0;
    const viewBox = svg.getAttribute("viewBox");
    if (!viewBox || !containerWidth) return "100%";
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || !parts[2] || !parts[3]) return "100%";
    const aspect = parts[2] / parts[3];
    if (aspect >= 1) return "100%";
    return `${Math.max(1, Math.floor(containerWidth * aspect))}px`;
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

  async function renderStructureVariants(candidate, structure) {
    const rna = normalizeRna(candidate.rna);
    const dot = structure.structure_dot_bracket || dotFromPairing(structure.pairing || []);
    try {
      const module = await getViennaRenderModule();
      const raw = module.renderSvg(rna, dot, "simple");
      return {
        rna: styleViennaSvg(raw, rna, "rna"),
        aa: styleViennaSvg(raw, rna, "aa")
      };
    } catch (err) {
      console.warn("ViennaRNA renderer failed; falling back to browser hairpin renderer", err);
      return {
        rna: renderStructureSvg(rna, structure.pairing, false),
        aa: renderStructureSvg(rna, structure.pairing, true)
      };
    }
  }

  function normalizeRna(rna) {
    return String(rna || "").toUpperCase().replace(/T/g, "U");
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
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
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

  function renderStructureSvg(rna, pairing, aaMode) {
    const n = rna.length;
    const coords = computeHairpinLayout(n, pairing);
    const bounds = paddedBounds(coords, 44);
    const backbone = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const pairs = [];
    for (let i = 0; i < pairing.length; i += 1) {
      const j = pairing[i];
      if (j > i) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[j];
        pairs.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#C25A3A" stroke-width="2.35" stroke-linecap="round" stroke-opacity="0.72"/>`);
      }
    }
    const bases = coords.map(([x, y], i) => {
      const base = rna[i];
      const color = BASE_COLORS[base] || "#58606A";
      return `<g>
        <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="9.2" fill="${color}" stroke="#fffaf0" stroke-width="2"/>
        <text x="${x.toFixed(2)}" y="${(y + 3.6).toFixed(2)}" text-anchor="middle" font-size="10" font-weight="900" fill="#fffaf0">${base}</text>
      </g>`;
    }).join("");
    const aa = translateRna(rna);
    const aaNodes = [];
    const aaLinks = [];
    for (let codon = 0; codon < Math.floor(n / 3); codon += 1) {
      const idx = 3 * codon + 1;
      const [x, y] = coords[idx];
      const amino = aa[codon] || "?";
      aaNodes.push(`<g>
        <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="13.2" fill="#FFF3C7" stroke="#5B4630" stroke-width="2"/>
        <text x="${x.toFixed(2)}" y="${(y + 4.2).toFixed(2)}" text-anchor="middle" font-size="12" font-weight="900" fill="#2F2417">${amino}</text>
      </g>`);
      if (codon > 0) {
        const [px, py] = coords[3 * (codon - 1) + 1];
        const mx = (px + x) / 2;
        const my = (py + y) / 2;
        aaLinks.push(`<path d="M ${px.toFixed(2)} ${py.toFixed(2)} Q ${mx.toFixed(2)} ${my.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}" fill="none" stroke="#255f5a" stroke-width="2.3" stroke-linecap="round" stroke-opacity="0.35"/>`);
      }
    }
    const inner = aaMode
      ? `${aaLinks.join("")}${aaNodes.join("")}`
      : `${pairs.join("")}<polyline points="${backbone}" fill="none" stroke="#8F9A8D" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>${bases}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX.toFixed(2)} ${bounds.minY.toFixed(2)} ${bounds.width.toFixed(2)} ${bounds.height.toFixed(2)}" role="img">
      <rect x="${bounds.minX.toFixed(2)}" y="${bounds.minY.toFixed(2)}" width="${bounds.width.toFixed(2)}" height="${bounds.height.toFixed(2)}" fill="transparent"/>
      ${inner}
    </svg>`;
  }

  function computeHairpinLayout(n, pairing) {
    if (n < 1) return [];
    if (n === 1) return [[0, 0]];
    const pairs = [];
    for (let i = 0; i < n; i += 1) {
      const j = Number(pairing[i]);
      if (Number.isInteger(j) && j > i && j < n && pairing[j] === i) pairs.push([i, j]);
    }
    const depth = Array(n).fill(0);
    pairs.forEach(([left, right]) => {
      for (let k = left; k <= right; k += 1) depth[k] += 1;
    });
    const step = 16.5;
    const mid = (n - 1) / 2;
    const anchors = Array.from({ length: n }, (_, i) => {
      const paired = pairing[i] >= 0 && pairing[i] !== i;
      const side = paired ? (pairing[i] > i ? -1 : 1) : 0;
      return [
        (i - mid) * step,
        -depth[i] * 15.5 + side * 2.5
      ];
    });
    const coords = anchors.map(([x, y]) => [x, y]);
    const velocity = Array.from({ length: n }, () => [0, 0]);
    const edges = [];
    for (let i = 0; i + 1 < n; i += 1) edges.push([i, i + 1, step, 0.08]);
    pairs.forEach(([i, j]) => edges.push([i, j, 20.0, 0.14]));
    const iterations = n < 80 ? 320 : n < 240 ? 240 : 160;
    const repelCutoff = n < 240 ? 78 : 58;
    const repelCutoffSq = repelCutoff * repelCutoff;
    const repulsion = n < 240 ? 28.0 : 18.0;
    const anchorK = pairs.length ? 0.0025 : 0.012;
    for (let iter = 0; iter < iterations; iter += 1) {
      for (const [i, j, target, k] of edges) {
        const dx = coords[j][0] - coords[i][0];
        const dy = coords[j][1] - coords[i][1];
        const dist = Math.max(0.001, Math.hypot(dx, dy));
        const force = (dist - target) * k;
        const fx = force * dx / dist;
        const fy = force * dy / dist;
        velocity[i][0] += fx;
        velocity[i][1] += fy;
        velocity[j][0] -= fx;
        velocity[j][1] -= fy;
      }
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 2; j < n; j += 1) {
          const dx = coords[i][0] - coords[j][0];
          const dy = coords[i][1] - coords[j][1];
          const d2 = dx * dx + dy * dy + 0.01;
          if (d2 > repelCutoffSq) continue;
          const dist = Math.sqrt(d2);
          const force = repulsion / d2;
          const fx = force * dx / dist;
          const fy = force * dy / dist;
          velocity[i][0] += fx;
          velocity[i][1] += fy;
          velocity[j][0] -= fx;
          velocity[j][1] -= fy;
        }
      }
      for (let i = 0; i < n; i += 1) {
        velocity[i][0] += (anchors[i][0] - coords[i][0]) * anchorK;
        velocity[i][1] += (anchors[i][1] - coords[i][1]) * anchorK;
        velocity[i][0] *= 0.78;
        velocity[i][1] *= 0.78;
        coords[i][0] += velocity[i][0] * 0.36;
        coords[i][1] += velocity[i][1] * 0.36;
      }
    }
    return coords;
  }

  function paddedBounds(coords, pad) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    coords.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, width: 1, height: 1 };
    return {
      minX: minX - pad,
      minY: minY - pad,
      width: Math.max(1, maxX - minX + 2 * pad),
      height: Math.max(1, maxY - minY + 2 * pad)
    };
  }

  function translateRna(rna) {
    const normalized = rna.replace(/T/g, "U");
    let out = "";
    for (let i = 0; i + 2 < normalized.length; i += 3) {
      out += GENETIC_CODE[normalized.slice(i, i + 3)] || "?";
    }
    return out;
  }

  function updateCopyButtonForTruncation(targetId, buttonId) {
    const target = $(targetId);
    const button = $(buttonId);
    if (!target || !button) return;
    requestAnimationFrame(() => {
      const clipped = target.scrollHeight > target.clientHeight + 1 || target.scrollWidth > target.clientWidth + 1;
      button.classList.toggle("hidden", !clipped);
    });
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.left = "-1000px";
    document.body.appendChild(area);
    area.focus();
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  $("design-form").addEventListener("submit", submitDesign);
  $("refresh-structure").addEventListener("click", () => refreshStructure(true));
  $("random-psi").addEventListener("click", chooseInitialExample);
  $("back-candidates").addEventListener("click", () => showPage("candidates"));
  $("back-input").addEventListener("click", () => { chooseInitialExample(); showPage("input"); });
  $("new-sequence").addEventListener("click", () => { chooseInitialExample(); showPage("input"); });
  document.querySelectorAll(".copy-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = $(button.dataset.copyTarget);
      await copyToClipboard(target ? target.textContent : "");
      button.classList.add("copied");
      const original = button.textContent;
      button.textContent = "copied";
      setTimeout(() => {
        button.classList.remove("copied");
        button.textContent = original;
      }, 900);
    });
  });
  window.addEventListener("resize", normalizeStructureSvgs);
  chooseInitialExample();
  $("status-pill").textContent = "single-thread WASM";
})();

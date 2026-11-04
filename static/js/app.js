/* ==========================================================================
   app.js - Container Resource Allocation Simulator frontend
   ========================================================================== */

import { LineChart, renderStackBar, renderGauge, colorFor, hexToRgba } from "./charts.js";

/* ---------------------------------------------------------------- helpers */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const num = (v, digits = 2) => {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(digits).replace(/\.?0+$/, "") || "0";
};
const fixed = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : "-");
const pct = (v, digits = 1) => (Number.isFinite(v) ? `${v.toFixed(digits)}%` : "-");
const mb = (v) => `${Math.round(v).toLocaleString()} MB`;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const statusLabel = {
  normal: "Normal",
  ok: "Normal",
  near: "Near limit",
  throttled: "CPU throttled",
  pressure: "Memory pressure",
  oom: "OOM kill",
};

const ICONS = {
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
  ram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 17v3m4-3v3m4-3v3m4-3v3M7 11h2m3 0h2m3 0h2"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3M19 9h3m-3 6h3"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m0 0-6-6m6 6-6 6"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>',
};

/* ------------------------------------------------------------------ state */
const state = {
  presets: [],
  profiles: [],
  policies: [],
  activePreset: "deck",
  config: null,
  result: null,
  scrubStep: 0,
  playing: false,
  playTimer: null,
  compare: null,
  busy: false,
};

const charts = {};

/* ------------------------------------------------------------------- API */
async function api(path, payload) {
  const opts = payload
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    : {};
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ----------------------------------------------------------------- toast */
function toast(title, message, kind = "error") {
  const host = $("#toasts");
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.innerHTML = `
    <span class="t-icon">${kind === "success" ? ICONS.check : ICONS.alert}</span>
    <div class="t-body">
      <div class="t-title">${esc(title)}</div>
      ${message ? `<div class="t-msg">${esc(message)}</div>` : ""}
    </div>`;
  host.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateX(20px)";
    node.style.transition = "opacity .25s, transform .25s";
    setTimeout(() => node.remove(), 260);
  }, 4600);
}

/* ------------------------------------------------------------ configuration */
function defaultConfig() {
  return {
    host: { cpu: 4, memory: 4096 },
    containers: [
      { name: "web", demand: 2.4, cap: 2, weight: 2, mem_usage: 700, mem_limit: 1024 },
      { name: "database", demand: 2.5, cap: 2, weight: 2, mem_usage: 1800, mem_limit: 2048 },
      { name: "worker", demand: 1.5, cap: 1, weight: 1, mem_usage: 1150, mem_limit: 1024 },
    ],
    policy: "weighted",
    profile: "contention",
    steps: 10,
    seed: 7,
  };
}

function readConfigFromForm() {
  const containers = $$(".editor-row").map((row) => ({
    name: $(".ctr-name-input", row).value.trim() || "container",
    demand: parseFloat($('[data-field="demand"]', row).value) || 0,
    cap: parseFloat($('[data-field="cap"]', row).value) || 0,
    weight: parseInt($('[data-field="weight"]', row).value, 10) || 1,
    mem_usage: parseFloat($('[data-field="mem_usage"]', row).value) || 0,
    mem_limit: parseFloat($('[data-field="mem_limit"]', row).value) || 0,
  }));
  return {
    host: {
      cpu: parseFloat($("#host-cpu").value) || 0,
      memory: parseFloat($("#host-mem").value) || 0,
    },
    containers,
    policy: $("#policy-select").value,
    profile: $("#profile-select").value,
    steps: parseInt($("#steps-input").value, 10) || 10,
    seed: parseInt($("#seed-input").value, 10) || 7,
  };
}

/* --------------------------------------------------------------- rendering */
function renderEditor() {
  const host = $("#editor-list");
  host.replaceChildren();
  state.config.containers.forEach((c, index) => {
    const node = document.createElement("div");
    node.className = "editor-row";
    node.dataset.index = String(index);
    node.innerHTML = `
      <div class="editor-row-head">
        <span class="mini-dot" style="background:${colorFor(index)}"></span>
        <input type="text" class="ctr-name-input" value="${esc(c.name)}" maxlength="24" spellcheck="false" aria-label="Container name" />
        <button class="icon-btn" data-action="remove" title="Remove container" ${state.config.containers.length <= 1 ? "disabled" : ""}>${ICONS.trash}</button>
      </div>
      <div class="editor-grid">
        <div class="editor-field"><label>CPU demand</label><input type="number" step="0.1" min="0" data-field="demand" value="${c.demand}" /></div>
        <div class="editor-field"><label>CPU cap</label><input type="number" step="0.1" min="0.1" data-field="cap" value="${c.cap}" /></div>
        <div class="editor-field"><label>Weight</label><input type="number" step="1" min="1" data-field="weight" value="${c.weight}" /></div>
        <div class="editor-field"><label>Mem use MB</label><input type="number" step="10" min="0" data-field="mem_usage" value="${c.mem_usage}" /></div>
        <div class="editor-field"><label>Mem limit MB</label><input type="number" step="10" min="1" data-field="mem_limit" value="${c.mem_limit}" /></div>
        <div class="editor-field"><label>Eligible</label><input type="text" data-field="eligible" value="" readonly tabindex="-1" /></div>
      </div>`;
    host.appendChild(node);
  });
  updateEligiblePreview();
}

function updateEligiblePreview() {
  $$(".editor-row").forEach((row) => {
    const demand = parseFloat($('[data-field="demand"]', row).value) || 0;
    const cap = parseFloat($('[data-field="cap"]', row).value) || 0;
    const eligible = Math.min(demand, cap);
    const field = $('[data-field="eligible"]', row);
    field.value = `${num(eligible)} vCPU`;
    field.style.color = demand > cap ? "#ffb545" : "#9aa8c7";
  });
}

/* --------------------------------------------------------------- presets UI */
function renderPresets() {
  const host = $("#preset-list");
  host.replaceChildren();
  state.presets.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `preset-item${preset.id === state.activePreset ? " active" : ""}`;
    btn.innerHTML = `
      <span class="preset-icon">${preset.id === "oom" ? ICONS.alert : preset.id === "many" ? ICONS.layers : ICONS.box}</span>
      <span class="preset-body">
        <span class="preset-name">${esc(preset.label)}</span>
        <span class="preset-blurb">${esc(preset.blurb)}</span>
      </span>`;
    btn.addEventListener("click", () => loadPreset(preset.id));
    host.appendChild(btn);
  });
}

async function loadPreset(id) {
  const preset = state.presets.find((p) => p.id === id);
  if (!preset) return;
  state.activePreset = id;
  state.config = {
    host: { ...preset.host },
    containers: preset.containers.map((c) => ({ ...c })),
    policy: preset.policy,
    profile: preset.profile,
    steps: preset.steps,
    seed: preset.seed,
  };
  syncForm();
  renderEditor();
  renderPresets();
  await runSimulation({ silent: true });
  toast("Scenario loaded", preset.label, "success");
}

function syncForm() {
  $("#host-cpu").value = state.config.host.cpu;
  $("#host-mem").value = state.config.host.memory;
  $("#policy-select").value = state.config.policy;
  $("#profile-select").value = state.config.profile;
  $("#steps-input").value = state.config.steps;
  $("#seed-input").value = state.config.seed;
  $$("#policy-seg button").forEach((b) => b.classList.toggle("active", b.dataset.policy === state.config.policy));
}

/* --------------------------------------------------------------- simulation */
async function runSimulation({ silent = false } = {}) {
  if (state.busy) return;
  state.config = readConfigFromForm();
  state.busy = true;
  stopPlayback();
  const btn = $("#run-btn");
  btn.disabled = true;
  btn.innerHTML = `${ICONS.pulse}<span>Running…</span>`;

  try {
    const result = await api("/api/simulate", state.config);
    state.result = result;
    state.scrubStep = result.timeline.length - 1;
    renderAll();
    if (!silent) toast("Simulation complete", `${result.profile.label} · ${result.steps} steps`, "success");
  } catch (err) {
    console.error("[simulate] ", err);
    toast("Cannot run simulation", err.message);
  } finally {
    state.busy = false;
    btn.disabled = false;
    btn.innerHTML = `${ICONS.play}<span>Run simulation</span>`;
  }
}

/* ---------------------------------------------------------------- rendering */
function renderAll() {
  if (!state.result) return;
  renderMetrics();
  renderContainers();
  renderTimeSeries();
  renderHostBars();
  renderTable();
  renderLog();
  renderSemantics();
  renderScrubber();
  renderCompare();
}

function currentFrame() {
  const r = state.result;
  if (!r) return null;
  return r.timeline[Math.min(state.scrubStep, r.timeline.length - 1)];
}

function renderMetrics() {
  const frame = currentFrame();
  const sum = state.result.summary;
  if (!frame) return;

  const hostCpu = state.config.host.cpu;
  const hostMem = state.config.host.memory;
  const overcommit = frame.cpu.eligible > hostCpu;
  const throttled = frame.containers.filter((c) => c.cpu_throttle_pct > 0.5).length;
  const pressured = frame.containers.filter((c) => c.mem_status === "pressure" || c.mem_status === "oom").length;

  const metrics = [
    {
      label: "CPU allocated",
      value: fixed(frame.cpu.allocated, 2),
      unit: `/ ${fixed(hostCpu, 1)} vCPU`,
      sub: `${pct(frame.cpu.utilisation_pct)} of host capacity`,
      accent: "accent-cyan",
      meter: frame.cpu.utilisation_pct,
      meterClass: frame.cpu.utilisation_pct > 95 ? "crit" : frame.cpu.utilisation_pct > 75 ? "warn" : "ok",
      icon: ICONS.cpu,
    },
    {
      label: "Memory in use",
      value: Math.round(frame.memory.used).toLocaleString(),
      unit: `/ ${Math.round(hostMem).toLocaleString()} MB`,
      sub: `${pct(frame.memory.pct)} of host RAM`,
      accent: frame.memory.pct > 100 ? "accent-red" : frame.memory.pct > 85 ? "accent-amber" : "accent-violet",
      meter: frame.memory.pct,
      meterClass: frame.memory.pct > 100 ? "crit" : frame.memory.pct > 85 ? "warn" : "ok",
      icon: ICONS.ram,
    },
    {
      label: "Containers",
      value: String(state.result.timeline[0].containers.length),
      unit: "workloads",
      sub: `${throttled} throttled · ${pressured} pressured`,
      accent: "accent-amber",
      meter: null,
      icon: ICONS.box,
    },
    {
      label: "Overcommit",
      value: overcommit ? `+${fixed(((frame.cpu.eligible - hostCpu) / hostCpu) * 100, 1)}` : "0",
      unit: "%",
      sub: `eligible ${fixed(frame.cpu.eligible, 2)} vCPU vs ${fixed(hostCpu, 2)}`,
      accent: overcommit ? "accent-red" : "accent-green",
      meter: null,
      icon: ICONS.zap,
    },
  ];

  $("#metric-grid").innerHTML = metrics
    .map(
      (m) => `
    <div class="metric ${m.accent}">
      <div class="metric-label">${m.icon}<span>${m.label}</span></div>
      <div class="metric-value">${m.value}<span class="unit">${m.unit}</span></div>
      <div class="metric-sub">${m.sub}</div>
      ${
        m.meter !== null
          ? `<div class="meter thin ${m.meterClass}" style="margin-top:9px"><span style="width:${Math.min(100, Math.max(0, m.meter))}%"></span></div>`
          : ""
      }
    </div>`
    )
    .join("");

  // verdict
  const v = sum.verdict;
  const vIcon = { ok: ICONS.check, info: ICONS.info, warn: ICONS.alert, critical: ICONS.alert }[v.level] || ICONS.info;
  $("#verdict").className = `verdict ${v.level}`;
  $("#verdict").innerHTML = `
    <div class="verdict-icon">${vIcon}</div>
    <div>
      <div class="verdict-title">${esc(v.title)}</div>
      <div class="verdict-detail">${esc(v.detail)}</div>
    </div>`;
}

function renderContainers() {
  const frame = currentFrame();
  if (!frame) return;
  const host = $("#ctr-grid");
  host.replaceChildren();

  frame.containers.forEach((c, index) => {
    const statusClass = c.status === "normal" ? "" : `s-${c.status}`;
    const card = document.createElement("div");
    card.className = `ctr-card ${statusClass}`;
    const capPct = c.cpu_cap > 0 ? (c.cpu_allocated / c.cpu_cap) * 100 : 0;
    const memPct = c.mem_limit > 0 ? (c.mem_usage / c.mem_limit) * 100 : 0;
    const memClass = memPct > 100 ? "crit" : memPct > 90 ? "warn" : "ok";

    card.innerHTML = `
      <div class="ctr-head">
        <span class="ctr-avatar" style="background:linear-gradient(135deg, ${colorFor(index)}, ${hexToRgba(colorFor(index), 0.45)})">${esc((c.name[0] || "?").toUpperCase())}</span>
        <span class="grow" style="min-width:0">
          <div class="ctr-name">${esc(c.name)}</div>
          <div class="ctr-meta">w=${esc(state.config.containers[index]?.weight ?? "-")} · cap ${num(c.cpu_cap)} vCPU · demand ${num(c.cpu_demand)}</div>
        </span>
        <span class="badge ${c.status}">${statusLabel[c.status] || c.status}</span>
      </div>
      <div class="ctr-stats">
        <div>
          <div class="ctr-stat-row">
            <span class="ctr-stat-label">CPU</span>
            <span class="ctr-stat-value">${fixed(c.cpu_allocated, 2)} <span class="unit">vCPU</span></span>
          </div>
          <div class="meter thin ${capPct > 99 ? "warn" : "ok"}" style="margin-top:5px"><span style="width:${Math.min(100, capPct)}%"></span></div>
          <div class="ctr-stat-row" style="margin-top:4px">
            <span class="tiny faint mono">demand ${fixed(c.cpu_demand, 2)}</span>
            <span class="tiny mono" style="color:${c.cpu_throttle_pct > 1 ? "#ffb545" : "#6b7a9b"}">${c.cpu_throttle_pct > 1 ? `throttled ${pct(c.cpu_throttle_pct, 0)}` : "not throttled"}</span>
          </div>
        </div>
        <div>
          <div class="ctr-stat-row">
            <span class="ctr-stat-label">Memory</span>
            <span class="ctr-stat-value" style="color:${memPct > 100 ? "#ff8b9c" : memPct > 90 ? "#ffc46b" : "inherit"}">${Math.round(c.mem_usage)} <span class="unit">/ ${Math.round(c.mem_limit)} MB</span></span>
          </div>
          <div class="meter thin ${memClass}" style="margin-top:5px"><span style="width:${Math.min(100, memPct)}%"></span></div>
          <div class="ctr-stat-row" style="margin-top:4px">
            <span class="tiny faint mono">${pct(memPct, 0)} of limit</span>
            <span class="tiny mono" style="color:${c.mem_excess > 0 ? "#ff8b9c" : "#6b7a9b"}">${c.mem_excess > 0 ? `+${Math.round(c.mem_excess)} MB over` : `${Math.round(c.mem_limit - c.mem_usage)} MB free`}</span>
          </div>
        </div>
      </div>
      <div class="ctr-foot">
        <span>${Math.round((c.cpu_allocated / Math.max(state.config.host.cpu, 0.0001)) * 100)}% of host CPU</span>
        <span style="color:${c.mem_excess > 0 ? "#ff8b9c" : "#6b7a9b"}">${esc(c.event)}</span>
      </div>`;
    host.appendChild(card);
  });
}

function renderTimeSeries() {
  const r = state.result;
  const names = r.timeline[0].containers.map((c) => c.name);

  /* ---- CPU allocation chart ---- */
  const cpuSeries = names.map((name, i) => ({
    name,
    data: r.series.cpu_allocated[name] || [],
    color: colorFor(i),
    width: 2,
  }));
  cpuSeries.push({
    name: "Host capacity",
    data: r.series.host_cpu,
    color: "#ff8a4c",
    dashed: true,
    width: 1.4,
    noTip: true,
  });

  if (!charts.cpu) charts.cpu = new LineChart($("#chart-cpu"), { height: 210, formatValue: (v) => `${v.toFixed(2)} vCPU` });
  charts.cpu.options.capacity = { value: state.config.host.cpu, label: `host ${num(state.config.host.cpu)} vCPU`, color: "#ff8a4c" };
  charts.cpu.setData(cpuSeries, r.series.labels);

  /* ---- memory chart ---- */
  const memSeries = names.map((name, i) => ({
    name,
    data: r.series.mem_usage[name] || [],
    color: colorFor(i),
    width: 2,
  }));
  if (!charts.mem) charts.mem = new LineChart($("#chart-mem"), { height: 210, formatValue: (v) => `${Math.round(v)} MB` });
  charts.mem.setData(memSeries, r.series.labels);

}

function renderHostBars() {
  const frame = currentFrame();
  if (!frame) return;
  const names = frame.containers.map((c) => c.name);

  /* ---- host composition bar ---- */
  const segments = frame.containers.map((c, i) => ({ name: c.name, value: c.cpu_allocated, color: colorFor(i) }));
  renderStackBar($("#stackbar-cpu"), segments, state.config.host.cpu, { unit: " vCPU" });

  const memSegments = frame.containers.map((c, i) => ({ name: c.name, value: c.mem_usage, color: colorFor(i) }));
  renderStackBar($("#stackbar-mem"), memSegments, state.config.host.memory, { unit: " MB" });

  /* ---- gauges ---- */
  renderGauge($("#gauge-cpu"), frame.cpu.utilisation_pct, {
    size: 108, stroke: 8, color: frame.cpu.utilisation_pct > 95 ? "#ffb545" : "#5b8cff", caption: "cpu used",
  });
  renderGauge($("#gauge-mem"), frame.memory.pct, {
    size: 108, stroke: 8,
    color: frame.memory.pct > 100 ? "#ff5d73" : frame.memory.pct > 85 ? "#ffb545" : "#2ee6d6",
    caption: "ram used",
  });

  /* ---- legends ---- */
  $("#legend-cpu").innerHTML = names
    .map((n, i) => `<span class="legend-item"><span class="legend-swatch" style="background:${colorFor(i)}"></span>${esc(n)}</span>`)
    .join("") +
    `<span class="legend-item"><span class="legend-swatch" style="background:repeating-linear-gradient(90deg,#ff8a4c 0 3px,transparent 3px 6px)"></span>host capacity</span>`;

  $("#legend-mem").innerHTML = names
    .map((n, i) => `<span class="legend-item"><span class="legend-swatch" style="background:${colorFor(i)}"></span>${esc(n)}</span>`)
    .join("");
}

function renderTable() {
  const frame = currentFrame();
  const tbody = $("#result-tbody");
  tbody.replaceChildren();

  frame.containers.forEach((c, index) => {
    const tr = document.createElement("tr");
    const allocPctOfCap = c.cpu_cap > 0 ? (c.cpu_allocated / c.cpu_cap) * 100 : 0;
    tr.innerHTML = `
      <td><span class="table-name"><span class="mini-dot" style="background:${colorFor(index)}"></span>${esc(c.name)}</span></td>
      <td class="num mono">${fixed(c.cpu_demand, 2)}</td>
      <td class="num mono">${fixed(c.cpu_cap, 2)}</td>
      <td class="num mono">${esc(state.config.containers[index]?.weight ?? "-")}</td>
      <td class="num mono" style="color:#a9c2ff;font-weight:600">${fixed(c.cpu_allocated, 2)}</td>
      <td class="num mono">
        <span style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
          ${fixed(c.cpu_throttle_pct, 0)}%
          <span class="meter thin" style="width:38px"><span style="width:${Math.min(100, allocPctOfCap)}%"></span></span>
        </span>
      </td>
      <td class="num mono">${Math.round(c.mem_usage)} / ${Math.round(c.mem_limit)}</td>
      <td class="num mono" style="color:${c.mem_excess > 0 ? "#ff8b9c" : c.mem_usage / c.mem_limit > 0.9 ? "#ffc46b" : "#9aa8c7"}">${pct((c.mem_usage / Math.max(1, c.mem_limit)) * 100, 0)}</td>
      <td><span class="badge ${c.status}">${statusLabel[c.status] || c.status}</span></td>`;
    tbody.appendChild(tr);
  });

  const t = frame.cpu;
  $("#result-tfoot").innerHTML = `
    <tr>
      <td colspan="4" style="color:var(--text-faint);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;font-weight:700">Totals · step ${frame.step}</td>
      <td class="num mono" style="font-weight:700">${fixed(t.allocated, 2)}</td>
      <td class="num mono">${pct(t.utilisation_pct, 0)} used</td>
      <td class="num mono">${Math.round(frame.memory.used)} / ${Math.round(frame.memory.capacity)}</td>
      <td class="num mono">${pct(frame.memory.pct, 0)}</td>
      <td>${t.contention ? '<span class="badge warn">contention</span>' : '<span class="badge normal">healthy</span>'}</td>
    </tr>`;
}

function renderLog() {
  const host = $("#event-log");
  const events = (state.result.events || []).slice().reverse();
  if (!events.length) {
    host.innerHTML = `<div class="empty-state">No resource events in this run — every container stayed within its caps and limits.</div>`;
    return;
  }
  host.innerHTML = events
    .map(
      (e) => `
    <div class="log-row ${e.severity}">
      <span class="log-step">t${e.step}</span>
      <span class="log-kind ${e.kind}">${esc(e.kind)}</span>
      <span class="log-msg">${esc(e.message)}</span>
    </div>`
    )
    .join("");
}

/* ------------------------------------------------ explain-the-run semantics */
function renderSemantics() {
  const frame = currentFrame();
  const cfg = state.config;
  const host = cfg.host.cpu;

  // CPU allocation walkthrough
  const rows = frame.containers.map((c, i) => {
    const weight = cfg.containers[i]?.weight ?? 1;
    return { ...c, weight, color: colorFor(i) };
  });
  const eligibleTotal = rows.reduce((a, r) => a + Math.min(r.cpu_demand, r.cpu_cap), 0);
  const contention = eligibleTotal > host;

  $("#cpu-math").innerHTML = `
    <div class="formula" style="margin-bottom:12px">
      e<sub>i</sub> = min(d<sub>i</sub>, q<sub>i</sub>) &nbsp;<span class="cm">→</span>&nbsp;
      Σe = <span class="hl">${fixed(eligibleTotal, 2)}</span> vCPU
      &nbsp;<span class="cm">${contention ? ">" : "≤"}</span>&nbsp;
      C = <span class="hl">${fixed(host, 2)}</span> vCPU
      <br><span class="cm">${contention ? "contention → share by weight" : "fits → no redistribution needed"}</span>
    </div>
    <table>
      <thead><tr>
        <th>Container</th><th class="num">d<sub>i</sub></th><th class="num">q<sub>i</sub></th>
        <th class="num">e<sub>i</sub></th><th class="num">w<sub>i</sub></th><th class="num">a<sub>i</sub></th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
          <td><span class="table-name"><span class="mini-dot" style="background:${r.color}"></span>${esc(r.name)}</span></td>
          <td class="num mono">${fixed(r.cpu_demand, 2)}</td>
          <td class="num mono">${fixed(r.cpu_cap, 2)}</td>
          <td class="num mono">${fixed(Math.min(r.cpu_demand, r.cpu_cap), 2)}</td>
          <td class="num mono">${r.weight}</td>
          <td class="num mono" style="color:#a9c2ff;font-weight:700">${fixed(r.cpu_allocated, 2)}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <div class="notice" style="margin-top:12px">${ICONS.info}
      <span>${contention
        ? `Total eligible demand ${fixed(eligibleTotal, 2)} vCPU exceeds the ${fixed(host, 2)} vCPU host, so CPU is handed out in proportion to weight (${cfg.policy} policy). A container that cannot use its share (because of its cap) releases it to the others.`
        : `Every container's eligible demand fits inside the ${fixed(host, 2)} vCPU host, so each receives exactly <code>min(demand, cap)</code> and ${fixed(host - eligibleTotal, 2)} vCPU stays idle.`}
      </span></div>`;

  // Memory explanation
  const over = rows.filter((r) => r.mem_usage > r.mem_limit);
  $("#mem-math").innerHTML = `
    <div class="formula" style="margin-bottom:12px">
      usage<sub>i</sub> &gt; limit<sub>i</sub> &nbsp;<span class="cm">→</span>&nbsp; pressure
      &nbsp;&nbsp;|&nbsp;&nbsp;
      usage<sub>i</sub> &gt; 1.25 × limit<sub>i</sub> &nbsp;<span class="cm">→</span>&nbsp; OOM
      <br><span class="cm">limits are independent boundaries, never weighted shares</span>
    </div>
    ${rows
      .map((r) => {
        const p = (r.mem_usage / Math.max(1, r.mem_limit)) * 100;
        const cls = p > 100 ? "crit" : p > 90 ? "warn" : "ok";
        return `<div style="margin-bottom:10px">
        <div class="spread" style="margin-bottom:4px">
          <span class="small" style="display:flex;align-items:center;gap:7px"><span class="mini-dot" style="background:${r.color}"></span>${esc(r.name)}</span>
          <span class="mono tiny" style="color:${p > 100 ? "#ff8b9c" : "#9aa8c7"}">${Math.round(r.mem_usage)} / ${Math.round(r.mem_limit)} MB · ${pct(p, 0)}</span>
        </div>
        <div class="meter thin ${cls}"><span style="width:${Math.min(100, p)}%"></span></div>
      </div>`;
      })
      .join("")}
    <div class="notice ${over.length ? "warn" : ""}" style="margin-top:12px">${over.length ? ICONS.alert : ICONS.info}
      <span>${over.length
        ? `${over.map((r) => `${esc(r.name)} is ${Math.round(r.mem_usage - r.mem_limit)} MB over its limit`).join("; ")}. OOM is simulated as a state change only — no real process is terminated.`
        : `All ${rows.length} containers are inside their memory hard limits. Totals: ${Math.round(rows.reduce((a, r) => a + r.mem_usage, 0))} MB used of ${Math.round(cfg.host.memory)} MB host RAM.`}
      </span></div>`;
}

/* ------------------------------------------------------------------ scrubber */
function renderScrubber() {
  const r = state.result;
  const max = r.timeline.length - 1;
  const input = $("#scrub");
  input.max = String(max);
  input.value = String(state.scrubStep);
  input.style.setProperty("--pct", `${(state.scrubStep / Math.max(1, max)) * 100}%`);
  const frame = r.timeline[state.scrubStep];
  $("#scrub-label").textContent = `t${frame.step} / ${max}`;
  $("#scrub-status").innerHTML = frame.cpu.contention
    ? `<span class="badge warn">CPU contention</span>`
    : `<span class="badge normal">No contention</span>`;
}

function setScrubStep(step) {
  if (!state.result) return;
  const max = state.result.timeline.length - 1;
  state.scrubStep = Math.max(0, Math.min(max, step));
  renderMetrics();
  renderContainers();
  renderHostBars();
  renderTable();
  renderSemantics();
  renderScrubber();
}

function stopPlayback() {
  state.playing = false;
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
  const btn = $("#play-btn");
  if (btn) btn.innerHTML = ICONS.play;
}

function togglePlayback() {
  if (!state.result) return;
  if (state.playing) return stopPlayback();
  state.playing = true;
  $("#play-btn").innerHTML = ICONS.pause;
  if (state.scrubStep >= state.result.timeline.length - 1) setScrubStep(0);
  state.playTimer = setInterval(() => {
    if (state.scrubStep >= state.result.timeline.length - 1) return stopPlayback();
    setScrubStep(state.scrubStep + 1);
  }, 620);
}

/* ------------------------------------------------------------------ compare */
async function renderCompare() {
  try {
    const data = await api("/api/compare", state.config);
    state.compare = data;
    const host = state.config.host.cpu;
    const names = data.containers;
    const maxAlloc = Math.max(host, ...data.policies.flatMap((p) => Object.values(p.allocated))) || 1;

    $("#compare-grid").innerHTML = data.policies
      .map((p) => {
        const label = { weighted: "Weighted fair-share", equal: "Equal share", priority: "Strict priority" }[p.policy] || p.policy;
        const detail = {
          weighted: "share ∝ weight",
          equal: "every weight = 1",
          priority: "highest weight first",
        }[p.policy];
        return `
        <div class="cmp-card">
          <h3>${label}</h3>
          <div class="tiny faint mono" style="margin-bottom:8px">${detail} · util ${pct(p.utilisation_pct, 0)}</div>
          ${names
            .map((n, i) => {
              const v = p.allocated[n] ?? 0;
              return `<div class="cmp-row">
                <span class="cmp-name">${esc(n)}</span>
                <span class="cmp-bar"><span style="width:${(v / maxAlloc) * 100}%;background:${colorFor(i)}"></span></span>
                <span class="cmp-val">${fixed(v, 2)}</span>
              </div>`;
            })
            .join("")}
        </div>`;
      })
      .join("");
  } catch (err) {
    $("#compare-grid").innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

/* ------------------------------------------------------------------- export */
function exportReport() {
  const r = state.result;
  if (!r) return;
  const frame = currentFrame();
  const lines = [];
  lines.push("CONTAINER RESOURCE ALLOCATION SIMULATOR — RUN REPORT");
  lines.push("=".repeat(58));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Scenario profile : ${r.profile.label} (${r.profile.key})`);
  lines.push(`CPU policy       : ${state.config.policy}`);
  lines.push(`Host             : ${state.config.host.cpu} vCPU / ${state.config.host.memory} MB RAM`);
  lines.push(`Steps            : ${r.steps}   Seed: ${state.config.seed}`);
  lines.push("");
  lines.push(`VIEWING STEP t${frame.step} of ${r.timeline.length - 1}`);
  lines.push("-".repeat(58));
  lines.push(
    ["container".padEnd(14), "demand".padStart(7), "cap".padStart(6), "w".padStart(3), "alloc".padStart(7), "mem MB".padStart(14), "status"].join(" ")
  );
  frame.containers.forEach((c, i) => {
    lines.push(
      [
        c.name.slice(0, 13).padEnd(14),
        fixed(c.cpu_demand, 2).padStart(7),
        fixed(c.cpu_cap, 2).padStart(6),
        String(state.config.containers[i]?.weight ?? "-").padStart(3),
        fixed(c.cpu_allocated, 2).padStart(7),
        `${Math.round(c.mem_usage)}/${Math.round(c.mem_limit)}`.padStart(14),
        c.status,
      ].join(" ")
    );
  });
  lines.push("");
  lines.push(`CPU: ${fixed(frame.cpu.allocated, 2)} of ${fixed(frame.cpu.capacity, 2)} vCPU used (${pct(frame.cpu.utilisation_pct)})`);
  lines.push(`Eligible demand: ${fixed(frame.cpu.eligible, 2)} vCPU  → contention: ${frame.cpu.contention}`);
  lines.push(`Memory: ${Math.round(frame.memory.used)} of ${Math.round(frame.memory.capacity)} MB (${pct(frame.memory.pct)})`);
  lines.push("");
  lines.push("RUN SUMMARY");
  lines.push("-".repeat(58));
  const s = r.summary;
  lines.push(`Verdict            : [${s.verdict.level.toUpperCase()}] ${s.verdict.title}`);
  lines.push(`                     ${s.verdict.detail}`);
  lines.push(`Avg CPU utilisation: ${pct(s.avg_cpu_utilisation_pct)}`);
  lines.push(`Contention steps   : ${s.contention_steps}   Pressure steps: ${s.pressure_steps}   OOM steps: ${s.oom_steps}`);
  lines.push(`Peak memory        : ${Math.round(s.peak_total_memory_mb)} MB`);
  lines.push("");
  lines.push("EVENT LOG");
  lines.push("-".repeat(58));
  (r.events || []).forEach((e) => lines.push(`t${String(e.step).padStart(2)} [${e.severity.toUpperCase().padEnd(8)}] ${e.message}`));
  lines.push("");
  lines.push("Model: e_i = min(d_i, q_i); weighted max-min fair share when Σe_i > C;");
  lines.push("memory hard limits checked per container. OOM is simulated, no process is killed.");

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `resource-run-${r.profile.key}-t${frame.step}.log`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Report downloaded", a.download, "success");
}

/* -------------------------------------------------------------------- views */
function switchView(view) {
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$("#main-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "simulator" && state.result) {
    requestAnimationFrame(() => {
      charts.cpu?.measure();
      charts.mem?.measure();
      renderHostBars();
    });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* --------------------------------------------------------------------- init */
async function init() {
  $("#toasts").replaceChildren();

  // static icons in the shell
  $$("[data-icon]").forEach((node) => {
    node.innerHTML = ICONS[node.dataset.icon] || "";
  });

  // tabs
  $$("#main-nav button").forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.view))
  );

  // form bindings
  $("#run-btn").addEventListener("click", () => runSimulation());
  $("#add-ctr").addEventListener("click", () => {
    if (state.config.containers.length >= 12) return toast("Limit reached", "Up to 12 containers in the editor.");
    const idx = state.config.containers.length + 1;
    state.config.containers.push({
      name: `service-${idx}`, demand: 0.8, cap: 1.0, weight: 1, mem_usage: 256, mem_limit: 512,
    });
    renderEditor();
  });
  $("#editor-list").addEventListener("input", () => {
    updateEligiblePreview();
    readConfigFromFormIntoState();
  });
  $("#editor-list").addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    const row = btn.closest(".editor-row");
    if (state.config.containers.length <= 1) return;
    state.config.containers.splice(Number(row.dataset.index), 1);
    renderEditor();
  });

  $("#policy-select").addEventListener("change", (e) => {
    state.config.policy = e.target.value;
    $$("#policy-seg button").forEach((b) => b.classList.toggle("active", b.dataset.policy === e.target.value));
    runSimulation({ silent: true });
  });
  $$("#policy-seg button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.config.policy = btn.dataset.policy;
      $("#policy-select").value = btn.dataset.policy;
      $$("#policy-seg button").forEach((b) => b.classList.toggle("active", b === btn));
      runSimulation({ silent: true });
    })
  );
  $("#profile-select").addEventListener("change", () => runSimulation({ silent: true }));

  $("#scrub").addEventListener("input", (e) => {
    stopPlayback();
    setScrubStep(Number(e.target.value));
  });
  $("#play-btn").addEventListener("click", togglePlayback);
  $("#export-btn").addEventListener("click", exportReport);

  $("#steps-input").addEventListener("change", () => runSimulation({ silent: true }));
  $("#seed-input").addEventListener("change", () => runSimulation({ silent: true }));
  $("#host-cpu").addEventListener("change", () => runSimulation({ silent: true }));
  $("#host-mem").addEventListener("change", () => runSimulation({ silent: true }));

  // load metadata
  try {
    const meta = await api("/api/presets");
    state.presets = meta.presets;
    state.profiles = meta.profiles;
    state.policies = meta.policies;

    $("#profile-select").innerHTML = state.profiles
      .map((p) => `<option value="${p.key}">${esc(p.label)}</option>`)
      .join("");
    $("#policy-select").innerHTML = state.policies
      .map((p) => `<option value="${p.key}">${esc(p.label)}</option>`)
      .join("");
    $$("#policy-seg button").forEach((b) => {
      if (b.dataset.policy === "weighted") b.classList.add("active");
    });

    $("#profile-list").innerHTML = state.profiles
      .map(
        (p) => `<div class="module-card"><h3>${esc(p.label)}</h3><p>${esc(p.description)}</p></div>`
      )
      .join("");

    state.config = defaultConfig();
    renderPresets();
    syncForm();
    renderEditor();
    await runSimulation({ silent: true });
  } catch (err) {
    console.error("[init] ", err);
    toast("Startup failed", err.message);
  }
}

function readConfigFromFormIntoState() {
  state.config = { ...state.config, ...readConfigFromForm() };
}

document.addEventListener("DOMContentLoaded", init);

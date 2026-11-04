/* ==========================================================================
   charts.js - tiny dependency-free SVG chart engine
   LineChart  : multi-series line / area chart with capacity rule + tooltip
   StackBar   : single horizontal stacked composition bar
   Gauge      : radial utilisation gauge
   ========================================================================== */

const SVG_NS = "http://www.w3.org/2000/svg";

export const PALETTE = [
  "#5b8cff",
  "#2ee6d6",
  "#b388ff",
  "#ffb545",
  "#ff5fa8",
  "#35d39a",
  "#ff8a4c",
  "#6ee7f9",
  "#f472b6",
  "#a3e635",
  "#facc15",
  "#93c5fd",
];

export function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

export function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child) node.appendChild(child);
  }
  return node;
}

function text(content, attrs = {}) {
  const node = el("text", {
    "font-family": "'JetBrains Mono', ui-monospace, monospace",
    "font-size": 10,
    fill: "#6b7a9b",
    ...attrs,
  });
  node.textContent = content;
  return node;
}

/** Choose a "nice" axis maximum. */
function niceMax(value) {
  if (!isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const frac = value / base;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return step * base;
}

function fmtTick(value) {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 10) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/* ==========================================================================
   LineChart
   series: [{ name, data: number[], color, dashed, area, width }]
   options: { capacity: {value, label, color}, height, yUnit, xLabels, formatValue }
   ========================================================================== */
export class LineChart {
  constructor(mount, options = {}) {
    this.mount = mount;
    this.options = options;
    this.width = 0;
    this.hoverIndex = -1;
    this.series = [];
    this.xLabels = [];

    mount.classList.add("chart-wrap");
    this.svg = el("svg", { role: "img" });
    this.tip = document.createElement("div");
    this.tip.className = "chart-tooltip";
    mount.appendChild(this.svg);
    mount.appendChild(this.tip);

    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(mount);

    this.svg.addEventListener("mousemove", (e) => this.onMove(e));
    this.svg.addEventListener("mouseleave", () => this.clearHover());
    window.addEventListener("resize", () => this.measure());
  }

  measure() {
    const w = this.mount.clientWidth;
    if (!w) return;
    if (Math.abs(w - this.width) < 1.5) return;
    this.width = w;
    this.render();
  }

  setData(series, xLabels) {
    this.series = series.filter((s) => s && Array.isArray(s.data) && s.data.length);
    this.xLabels = xLabels || [];
    if (!this.width) this.width = this.mount.clientWidth || 640;
    this.hoverIndex = -1;
    this.clearHover();
    this.render();
  }

  render() {
    const height = this.options.height || 200;
    const pad = { top: 14, right: 16, bottom: 24, left: 42 };
    const w = Math.max(240, this.width);
    const innerW = w - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    this.svg.setAttribute("viewBox", `0 0 ${w} ${height}`);
    this.svg.setAttribute("height", height);
    this.svg.setAttribute("width", w);
    this.svg.replaceChildren();

    const series = this.series;
    const n = Math.max(...series.map((s) => s.data.length), 1);
    const flat = series.flatMap((s) => s.data).filter((v) => Number.isFinite(v));
    const cap = this.options.capacity;
    let peak = Math.max(...flat, 0);
    if (cap && cap.value) peak = Math.max(peak, cap.value);
    const maxY = niceMax(peak * 1.12) || 1;

    const x = (i) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = (v) => pad.top + innerH - (Math.max(0, Math.min(v, maxY)) / maxY) * innerH;

    /* ---- grid + y ticks ---- */
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxY / ticks) * i;
      const gy = y(v);
      this.svg.appendChild(
        el("line", {
          x1: pad.left, x2: pad.left + innerW, y1: gy, y2: gy,
          stroke: "#1a2338", "stroke-width": 1,
          "stroke-dasharray": i === 0 ? "none" : "3 4",
        })
      );
      this.svg.appendChild(
        text(fmtTick(v), { x: pad.left - 9, y: gy + 3.5, "text-anchor": "end", "font-size": 9.5 })
      );
    }

    /* ---- x labels ---- */
    const labelCount = Math.min(n, this.width < 480 ? 4 : 8);
    const stride = Math.max(1, Math.round((n - 1) / Math.max(1, labelCount - 1)));
    for (let i = 0; i < n; i += stride) {
      this.svg.appendChild(
        text(this.xLabels[i] ?? `t${i}`, { x: x(i), y: height - 7, "text-anchor": "middle", "font-size": 9.5 })
      );
    }

    /* ---- capacity rule ---- */
    if (cap && cap.value > 0) {
      const cy = y(cap.value);
      this.svg.appendChild(
        el("line", {
          x1: pad.left, x2: pad.left + innerW, y1: cy, y2: cy,
          stroke: cap.color || "#ff8a4c", "stroke-width": 1.4,
          "stroke-dasharray": "6 4", opacity: 0.9,
        })
      );
      const label = cap.label || "capacity";
      const tw = label.length * 5.6 + 12;
      this.svg.appendChild(
        el("rect", {
          x: pad.left + innerW - tw, y: cy - 15, width: tw, height: 13, rx: 3,
          fill: "rgba(255,138,76,0.14)", stroke: "rgba(255,138,76,0.35)", "stroke-width": 0.8,
        })
      );
      this.svg.appendChild(
        text(label, {
          x: pad.left + innerW - tw / 2, y: cy - 5.5,
          "text-anchor": "middle", "font-size": 8.5, fill: "#ffb98a",
        })
      );
    }

    /* ---- series ---- */
    series.forEach((s) => {
      const pts = s.data.map((v, i) => [x(i), y(v)]);
      if (!pts.length) return;
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");

      if (s.area) {
        const areaD = `${d} L${pts[pts.length - 1][0].toFixed(2)},${y(0)} L${pts[0][0].toFixed(2)},${y(0)} Z`;
        const gradId = `grad-${Math.random().toString(36).slice(2, 9)}`;
        const grad = el("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 }, [
          el("stop", { offset: "0%", "stop-color": s.color, "stop-opacity": 0.28 }),
          el("stop", { offset: "100%", "stop-color": s.color, "stop-opacity": 0.01 }),
        ]);
        this.svg.appendChild(el("defs", {}, [grad]));
        this.svg.appendChild(el("path", { d: areaD, fill: `url(#${gradId})` }));
      }

      this.svg.appendChild(
        el("path", {
          d, fill: "none", stroke: s.color,
          "stroke-width": s.width || 2,
          "stroke-linecap": "round", "stroke-linejoin": "round",
          "stroke-dasharray": s.dashed ? "5 4" : null,
          opacity: s.dashed ? 0.75 : 1,
        })
      );

      // last point marker
      const last = pts[pts.length - 1];
      this.svg.appendChild(el("circle", { cx: last[0], cy: last[1], r: 3.2, fill: s.color }));
      this.svg.appendChild(
        el("circle", { cx: last[0], cy: last[1], r: 6, fill: s.color, opacity: 0.18 })
      );
    });

    /* ---- hover layer ---- */
    this.hoverLine = el("line", {
      y1: pad.top, y2: pad.top + innerH, stroke: "#4a5f8a",
      "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0,
    });
    this.svg.appendChild(this.hoverLine);
    this.hoverDots = series.map((s) =>
      el("circle", { r: 4, fill: "#0b1020", stroke: s.color, "stroke-width": 2, opacity: 0 })
    );
    this.hoverDots.forEach((d) => this.svg.appendChild(d));

    this.hit = el("rect", {
      x: pad.left, y: pad.top, width: innerW, height: innerH,
      fill: "transparent", style: "cursor:crosshair",
    });
    this.svg.appendChild(this.hit);
    if (this.hoverIndex >= 0) this.paintHover(this.hoverIndex);

    this.geom = { pad, innerW, innerH, n, x, y, w, height };
  }

  onMove(event) {
    if (!this.geom) return;
    const rect = this.svg.getBoundingClientRect();
    const scale = this.geom.w / rect.width;
    const px = (event.clientX - rect.left) * scale;
    const { pad, innerW, n } = this.geom;
    const ratio = (px - pad.left) / innerW;
    if (ratio < -0.05 || ratio > 1.05) return this.clearHover();
    const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
    if (idx !== this.hoverIndex) {
      this.hoverIndex = idx;
      this.paintHover(idx);
    }
    this.positionTip(event);
  }

  paintHover(idx) {
    if (!this.geom) return;
    const { x, y, pad, innerH } = this.geom;
    const cx = x(idx);
    this.hoverLine.setAttribute("x1", cx);
    this.hoverLine.setAttribute("x2", cx);
    this.hoverLine.setAttribute("opacity", 0.85);

    this.series.forEach((s, i) => {
      const dot = this.hoverDots[i];
      if (!dot) return;
      const v = s.data[idx];
      if (!Number.isFinite(v)) {
        dot.setAttribute("opacity", 0);
        return;
      }
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", y(v));
      dot.setAttribute("opacity", 1);
    });
    void pad;
    void innerH;
  }

  positionTip(event) {
    const idx = this.hoverIndex;
    if (idx < 0 || !this.geom) return;
    const fmt = this.options.formatValue || ((v) => fmtTick(v));
    const rows = this.series
      .map((s) => {
        const v = s.data[idx];
        if (!Number.isFinite(v)) return "";
        return `<div class="tt-row"><span class="tt-key"><span class="tt-dot" style="background:${s.color}"></span>${s.name}</span><span>${fmt(v)}</span></div>`;
      })
      .filter(Boolean)
      .join("");
    if (!rows) return this.clearHover();

    const title = this.xLabels[idx] ?? `t${idx}`;
    this.tip.innerHTML = `<div class="tt-title">${title}</div>${rows}`;
    this.tip.classList.add("show");

    const mountRect = this.mount.getBoundingClientRect();
    let px = event.clientX - mountRect.left;
    const tipW = this.tip.offsetWidth || 140;
    px = Math.max(tipW / 2 + 2, Math.min(mountRect.width - tipW / 2 - 2, px));
    this.tip.style.left = `${px}px`;
    this.tip.style.top = `${Math.max(0, event.clientY - mountRect.top - 14)}px`;
  }

  clearHover() {
    this.hoverIndex = -1;
    this.tip.classList.remove("show");
    if (this.hoverLine) this.hoverLine.setAttribute("opacity", 0);
    this.hoverDots?.forEach((d) => d.setAttribute("opacity", 0));
  }
}

/* ==========================================================================
   StackBar: horizontal composition of the host capacity
   segments: [{ name, value, color }]  total: number
   ========================================================================== */
export function renderStackBar(mount, segments, total, opts = {}) {
  mount.replaceChildren();
  const host = document.createElement("div");
  host.style.cssText =
    "display:flex;height:" + (opts.height || 22) + "px;border-radius:7px;overflow:hidden;border:1px solid #1e2942;background:#0a0f1c;gap:2px;";

  const realTotal = total > 0 ? total : segments.reduce((a, s) => a + s.value, 0) || 1;
  segments.forEach((s) => {
    if (s.value <= 0.0001) return;
    const pct = (s.value / realTotal) * 100;
    const div = document.createElement("div");
    div.style.cssText = `width:${pct}%;background:${s.color};position:relative;transition:width .5s cubic-bezier(.22,1,.36,1);`;
    div.title = `${s.name}: ${s.value}${opts.unit || ""}`;
    if (pct > 11) {
      const span = document.createElement("span");
      span.textContent = `${Math.round(pct)}%`;
      span.style.cssText =
        "position:absolute;inset:0;display:grid;place-items:center;font-family:var(--mono);font-size:9.5px;font-weight:700;color:rgba(4,8,16,.82);";
      div.appendChild(span);
    }
    host.appendChild(div);
  });

  const free = total - segments.reduce((a, s) => a + s.value, 0);
  if (free > 0.001) {
    const div = document.createElement("div");
    div.style.cssText = `width:${(free / realTotal) * 100}%;background:repeating-linear-gradient(135deg,#141d31,#141d31 5px,#101727 5px,#101727 10px);`;
    div.title = `Idle: ${free.toFixed(2)}${opts.unit || ""}`;
    host.appendChild(div);
  }
  mount.appendChild(host);
}

/* ==========================================================================
   Gauge: radial utilisation dial
   ========================================================================== */
export function renderGauge(mount, pct, opts = {}) {
  const size = opts.size || 132;
  const stroke = opts.stroke || 9;
  const r = (size - stroke) / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const color = opts.color || "#5b8cff";

  const svg = el("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  svg.appendChild(el("circle", {
    cx, cy, r, fill: "none", stroke: "#1a2338", "stroke-width": stroke,
  }));
  const arc = el("circle", {
    cx, cy, r, fill: "none", stroke: color, "stroke-width": stroke,
    "stroke-linecap": "round",
    "stroke-dasharray": circumference,
    "stroke-dashoffset": circumference,
    transform: `rotate(-90 ${cx} ${cy})`,
    style: "transition: stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)",
  });
  svg.appendChild(arc);
  requestAnimationFrame(() => {
    arc.setAttribute("stroke-dashoffset", circumference * (1 - clamped / 100));
  });

  if (opts.trackColor) arc.setAttribute("stroke", opts.trackColor);

  const label = el("text", {
    x: cx, y: cy + 2, "text-anchor": "middle",
    "font-family": "'JetBrains Mono', monospace", "font-size": 21,
    "font-weight": 700, fill: "#e8eefc",
  });
  label.textContent = `${Math.round(clamped)}%`;
  svg.appendChild(label);

  if (opts.caption) {
    const cap = el("text", {
      x: cx, y: cy + 18, "text-anchor": "middle",
      "font-family": "'JetBrains Mono', monospace", "font-size": 8.5,
      fill: "#6b7a9b", "letter-spacing": "0.1em",
    });
    cap.textContent = opts.caption.toUpperCase();
    svg.appendChild(cap);
  }

  mount.replaceChildren(svg);
  return svg;
}

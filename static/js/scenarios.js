/* ==========================================================================
   scenarios.js — browser mirror of simulator/scenarios.py
   The `deck` preset is the exact worked example from the presentation.
   ========================================================================== */

export const PRACTICAL_PRESETS = [
  {
    id: "deck",
    label: "Deck example - CPU contention",
    blurb:
      "The 4 vCPU / 3 container scenario from the presentation. Weighted sharing " +
      "yields 1.6 + 1.6 + 0.8 vCPU; Worker is over its memory limit.",
    tag: "reference",
    host: { cpu: 4, memory: 4096 },
    policy: "weighted",
    profile: "contention",
    steps: 10,
    seed: 7,
    containers: [
      { name: "web", demand: 2.4, cap: 2, weight: 2, mem_usage: 700, mem_limit: 1024 },
      { name: "database", demand: 2.5, cap: 2, weight: 2, mem_usage: 1800, mem_limit: 2048 },
      { name: "worker", demand: 1.5, cap: 1, weight: 1, mem_usage: 1150, mem_limit: 1024 },
    ],
  },
  {
    id: "balanced",
    label: "Healthy host, no contention",
    blurb: "Three modest services that fit comfortably inside the host. Everything reports normal.",
    tag: "baseline",
    host: { cpu: 4, memory: 4096 },
    policy: "weighted",
    profile: "normal",
    steps: 10,
    seed: 3,
    containers: [
      { name: "web", demand: 0.9, cap: 1.5, weight: 3, mem_usage: 420, mem_limit: 1024 },
      { name: "api", demand: 1.1, cap: 1.5, weight: 2, mem_usage: 610, mem_limit: 1024 },
      { name: "cache", demand: 0.6, cap: 1, weight: 1, mem_usage: 780, mem_limit: 1024 },
    ],
  },
  {
    id: "oom",
    label: "Memory OOM event",
    blurb: "A leaky batch job creeps past its hard limit far enough to trigger a simulated OOM kill.",
    tag: "fault injection",
    host: { cpu: 4, memory: 4096 },
    policy: "weighted",
    profile: "pressure",
    steps: 12,
    seed: 11,
    containers: [
      { name: "web", demand: 1.2, cap: 1.5, weight: 3, mem_usage: 500, mem_limit: 1024 },
      { name: "batch", demand: 1.6, cap: 1.5, weight: 1, mem_usage: 900, mem_limit: 1024 },
      { name: "database", demand: 1.4, cap: 2, weight: 2, mem_usage: 1500, mem_limit: 2048 },
    ],
  },
  {
    id: "burst",
    label: "Traffic burst spike",
    blurb: "A mid-run traffic spike pushes demand past capacity for one step, then recovers.",
    tag: "transient",
    host: { cpu: 2, memory: 2048 },
    policy: "weighted",
    profile: "burst",
    steps: 10,
    seed: 5,
    containers: [
      { name: "gateway", demand: 1.1, cap: 1.4, weight: 3, mem_usage: 380, mem_limit: 768 },
      { name: "service", demand: 0.9, cap: 1.2, weight: 2, mem_usage: 520, mem_limit: 900 },
      { name: "telemetry", demand: 0.4, cap: 0.6, weight: 1, mem_usage: 210, mem_limit: 512 },
    ],
  },
  {
    id: "noisy",
    label: "Noisy neighbour isolation",
    blurb: "One greedy container is capped hard so its neighbours keep their share - isolation in action.",
    tag: "isolation",
    host: { cpu: 4, memory: 4096 },
    policy: "weighted",
    profile: "contention",
    steps: 10,
    seed: 9,
    containers: [
      { name: "noisy-job", demand: 5, cap: 0.5, weight: 1, mem_usage: 900, mem_limit: 1024 },
      { name: "web", demand: 1.2, cap: 2, weight: 4, mem_usage: 600, mem_limit: 1024 },
      { name: "database", demand: 1.6, cap: 2, weight: 4, mem_usage: 1600, mem_limit: 2048 },
    ],
  },
  {
    id: "many",
    label: "Ten-container fleet",
    blurb: "A denser host: ten small services whose combined eligible demand overcommits the CPU.",
    tag: "scale",
    host: { cpu: 8, memory: 8192 },
    policy: "weighted",
    profile: "contention",
    steps: 10,
    seed: 21,
    containers: Array.from({ length: 10 }, (_, i) => ({
      name: `svc-${String(i + 1).padStart(2, "0")}`,
      demand: round2(0.9 + (i % 4) * 0.35),
      cap: 1.5,
      weight: 1 + (i % 3),
      mem_usage: 300 + (i % 5) * 90,
      mem_limit: 1024,
    })),
  },
];

function round2(v) {
  return Math.round(v * 100) / 100;
}

export const PROFILES = [
  { key: "normal", label: "Normal load", description: "Steady, light traffic. Total eligible demand fits inside the host." },
  { key: "contention", label: "CPU contention", description: "Every container ramps to its full cap, so eligible demand exceeds the host." },
  { key: "pressure", label: "Memory pressure", description: "Memory creeps upward each step until a container crosses its hard limit." },
  { key: "burst", label: "Traffic burst", description: "A sudden spike in the middle of the run, then recovery." },
];

export const POLICIES = [
  { key: "weighted", label: "Weighted fair-share", detail: "Share follows weight" },
  { key: "equal", label: "Equal share", detail: "Every container weighted 1" },
  { key: "priority", label: "Strict priority", detail: "Highest weight served first" },
];

export function presetById(id) {
  return PRACTICAL_PRESETS.find((p) => p.id === id);
}

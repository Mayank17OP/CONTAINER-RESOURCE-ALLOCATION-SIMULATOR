/* ==========================================================================
   engine.js — browser mirror of the Python simulation core.

   This file is a faithful port of `simulator/` (models, cpu_allocator,
   memory_manager, workload, engine) so the simulator runs with no backend at
   all — which is what allows GitHub Pages to host a fully working copy.

   The allocation and memory logic is numerically identical to Python; the
   cross-check in tests/test_js_parity.py asserts that for hundreds of random
   configurations. Only the workload *noise* sequence differs, because Python's
   Mersenne Twister is replaced by a small deterministic PRNG — so a given seed
   is still reproducible, just not bit-identical to the server run.
   ========================================================================== */

/* ------------------------------------------------------------------ models */
export const MAX_CPU = 128;
export const MAX_MEMORY = 1024 * 1024;
export const MAX_CONTAINERS = 24;

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

export class ConfigError extends Error {}

function number(raw, label, { minimum, maximum }) {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (raw === "" || raw === null || raw === undefined || Number.isNaN(value)) {
    throw new ConfigError(`${label} must be a number.`);
  }
  if (!Number.isFinite(value)) throw new ConfigError(`${label} must be a finite number.`);
  if (value < minimum || value > maximum) {
    throw new ConfigError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return round(value);
}

export function validateConfig(raw) {
  const host = raw.host || {};
  const cfg = {
    host: {
      cpu: number(host.cpu, "Host CPU capacity", { minimum: 0.1, maximum: MAX_CPU }),
      memory: number(host.memory, "Host memory capacity", { minimum: 64, maximum: MAX_MEMORY }),
    },
    containers: [],
    policy: String(raw.policy || "weighted").toLowerCase(),
    profile: String(raw.profile || "normal").toLowerCase(),
    steps: Math.trunc(number(raw.steps ?? 12, "Steps", { minimum: 1, maximum: 120 })),
    seed: Math.trunc(number(raw.seed ?? 7, "Seed", { minimum: 0, maximum: 1000000 })),
  };

  if (!Array.isArray(raw.containers) || raw.containers.length === 0) {
    throw new ConfigError("At least one container is required.");
  }
  if (raw.containers.length > MAX_CONTAINERS) {
    throw new ConfigError(`At most ${MAX_CONTAINERS} containers are supported.`);
  }

  const seen = new Set();
  raw.containers.forEach((c, i) => {
    const name = String(c.name ?? "").trim().slice(0, 32) || `ctr-${i + 1}`;
    if (seen.has(name.toLowerCase())) throw new ConfigError(`Container name '${name}' is used twice.`);
    seen.add(name.toLowerCase());
    cfg.containers.push({
      name,
      demand: number(c.demand, `${name}: CPU demand`, { minimum: 0, maximum: MAX_CPU }),
      cap: number(c.cap, `${name}: CPU cap`, { minimum: 0.01, maximum: MAX_CPU }),
      weight: Math.trunc(number(c.weight, `${name}: weight`, { minimum: 1, maximum: 100 })),
      mem_usage: number(c.mem_usage, `${name}: memory usage`, { minimum: 0, maximum: MAX_MEMORY }),
      mem_limit: number(c.mem_limit, `${name}: memory limit`, { minimum: 1, maximum: MAX_MEMORY }),
    });
  });

  if (!["weighted", "equal", "priority"].includes(cfg.policy)) {
    throw new ConfigError(`Unknown CPU policy '${cfg.policy}'.`);
  }
  if (!["normal", "contention", "pressure", "burst"].includes(cfg.profile)) {
    throw new ConfigError(`Unknown workload profile '${cfg.profile}'.`);
  }
  return cfg;
}

export const eligibleDemand = (c) => round(Math.min(c.demand, c.cap));

/* ----------------------------------------------------------- cpu allocator */
const EPS = 1e-9;

function weightsFor(specs, policy) {
  if (policy === "equal") return specs.map(() => 1);
  if (policy === "priority") {
    return specs.map((s) => Math.max(1, Math.round(s.weight)) ** 12);
  }
  return specs.map((s) => Math.max(1, s.weight));
}

export function allocateCpu(specs, capacity, policy = "weighted") {
  if (capacity <= 0) throw new Error("Host CPU capacity must be positive.");
  const weights = weightsFor(specs, policy);
  const eligible = specs.map(eligibleDemand);
  const allocated = new Array(specs.length).fill(0);

  let remaining = capacity;
  let active = eligible.map((e, i) => (e > EPS ? i : -1)).filter((i) => i >= 0);

  while (active.length && remaining > EPS) {
    const totalWeight = active.reduce((a, i) => a + weights[i], 0);
    if (totalWeight <= 0) break;
    const scale = remaining / totalWeight;
    let served = 0;
    const saturated = [];
    for (const i of active) {
      const want = eligible[i] - allocated[i];
      const grant = Math.min(want, weights[i] * scale);
      allocated[i] += grant;
      served += grant;
      if (want - grant <= EPS) saturated.push(i);
    }
    remaining = Math.max(0, remaining - served);
    active = active.filter((i) => !saturated.includes(i));
    if (!saturated.length) break;
  }

  const containers = specs.map((s, i) => {
    const unmet = Math.max(0, s.demand - allocated[i]);
    const throttlePct = s.demand > EPS ? (unmet / s.demand) * 100 : 0;
    return {
      name: s.name,
      demand: round(s.demand, 3),
      cap: round(s.cap, 3),
      weight: s.weight,
      eligible: round(eligible[i], 3),
      allocated: round(allocated[i], 3),
      unmet: round(unmet, 3),
      throttled: throttlePct > 0.5,
      throttle_pct: round(throttlePct, 2),
      host_share_pct: round(capacity ? (allocated[i] / capacity) * 100 : 0, 2),
    };
  });

  const totalDemand = specs.reduce((a, s) => a + s.demand, 0);
  const totalEligible = eligible.reduce((a, b) => a + b, 0);
  const totalAllocated = allocated.reduce((a, b) => a + b, 0);
  const contention = totalEligible > capacity + EPS;

  const notes = [];
  notes.push(
    contention
      ? `Eligible demand ${totalEligible.toFixed(2)} vCPU exceeds host capacity ${capacity.toFixed(2)} vCPU - capacity is shared by relative weight.`
      : `Eligible demand ${totalEligible.toFixed(2)} vCPU fits inside ${capacity.toFixed(2)} vCPU - no contention.`
  );
  const capped = containers.filter((c) => c.demand > c.cap + EPS).map((c) => c.name);
  if (capped.length) notes.push(`CPU cap binds for ${capped.join(", ")} (demand is higher than the cap).`);
  if (!contention && totalDemand > totalEligible) {
    notes.push("Host capacity is idle because caps bound total demand.");
  }

  return {
    policy,
    capacity: round(capacity, 3),
    total_demand: round(totalDemand, 3),
    total_eligible: round(totalEligible, 3),
    total_allocated: round(totalAllocated, 3),
    idle_capacity: round(Math.max(0, capacity - totalAllocated), 3),
    utilisation_pct: round(capacity ? (totalAllocated / capacity) * 100 : 0, 2),
    contention,
    overcommit_pct: round(capacity ? (Math.max(0, totalEligible - capacity) / capacity) * 100 : 0, 2),
    containers,
    notes,
  };
}

/* -------------------------------------------------------- memory manager */
export const OOM_EXCESS_RATIO = 0.25;
export const NEAR_LIMIT_RATIO = 0.9;

const reasonOom = (ratio) => ratio > 1 + OOM_EXCESS_RATIO;

export function evaluateMemory(specs, hostCapacity) {
  const rows = [];
  const events = [];

  for (const spec of specs) {
    const limit = spec.mem_limit;
    const usage = spec.mem_usage;
    const ratio = limit ? usage / limit : 0;
    const excess = Math.max(0, usage - limit);

    let status;
    let event;
    if (excess > 0 && reasonOom(ratio)) {
      status = "oom";
      event = `OOM (simulated): ${excess.toFixed(0)} MB above hard limit`;
    } else if (excess > 0) {
      status = "pressure";
      event = `Memory pressure: ${excess.toFixed(0)} MB above hard limit`;
    } else if (ratio >= NEAR_LIMIT_RATIO) {
      status = "near";
      event = `Near limit: ${(limit - usage).toFixed(0)} MB headroom left`;
    } else {
      status = "ok";
      event = "Within hard limit";
    }

    if (status === "pressure" || status === "oom") {
      events.push(`[${spec.name}] ${event} (${usage.toFixed(0)} / ${limit.toFixed(0)} MB, ${(ratio * 100).toFixed(1)}% of limit)`);
    }

    rows.push({
      name: spec.name,
      usage: round(usage, 1),
      limit: round(limit, 1),
      utilisation_pct: round(ratio * 100, 1),
      headroom: round(limit - usage, 1),
      excess: round(excess, 1),
      status,
      event,
    });
  }

  const totalUsage = specs.reduce((a, s) => a + s.mem_usage, 0);
  const totalLimit = specs.reduce((a, s) => a + s.mem_limit, 0);

  return {
    total_usage: round(totalUsage, 1),
    total_limit: round(totalLimit, 1),
    host_capacity: round(hostCapacity, 1),
    host_usage_pct: round(hostCapacity ? (totalUsage / hostCapacity) * 100 : 0, 2),
    host_pressure: totalUsage > hostCapacity,
    pressure_count: rows.filter((r) => r.status === "pressure").length,
    oom_count: rows.filter((r) => r.status === "oom").length,
    near_count: rows.filter((r) => r.status === "near").length,
    containers: rows,
    events,
  };
}

/* ------------------------------------------------------- workload profiles */
export const WORKLOAD_PROFILES = {
  normal: {
    key: "normal",
    label: "Normal load",
    description: "Steady, light traffic. Total eligible demand fits inside the host.",
    cpu_scale: 0.7, cpu_jitter: 0.06, mem_growth: 0, mem_growth_pct: 0,
    spike_step: -1, spike_cpu: 0, spike_mem: 0,
  },
  contention: {
    key: "contention",
    label: "CPU contention",
    description: "Every container ramps to its full cap, so eligible demand exceeds the host.",
    cpu_scale: 1.0, cpu_jitter: 0.05, mem_growth: 0, mem_growth_pct: 0,
    spike_step: -1, spike_cpu: 0, spike_mem: 0,
  },
  pressure: {
    key: "pressure",
    label: "Memory pressure",
    description: "Memory creeps upward each step until a container crosses its hard limit.",
    cpu_scale: 0.85, cpu_jitter: 0.05, mem_growth: 0, mem_growth_pct: 0.055,
    spike_step: -1, spike_cpu: 0, spike_mem: 0,
  },
  burst: {
    key: "burst",
    label: "Traffic burst",
    description: "A sudden spike in the middle of the run, then recovery.",
    cpu_scale: 0.9, cpu_jitter: 0.08, mem_growth: 0, mem_growth_pct: 0.018,
    spike_step: 5, spike_cpu: 1.15, spike_mem: 140,
  },
};

/** small deterministic PRNG so a seed always reproduces the same run */
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function generateStep(specs, profile, step, totalSteps, rng) {
  const ramp = Math.min(1, 0.55 + (step / Math.max(1, totalSteps - 1)) * 0.75);
  const eased = 0.35 + 0.65 * ramp;
  const out = [];
  const notes = [];

  specs.forEach((spec, index) => {
    const jitter = rng() * (profile.cpu_jitter * 2) - profile.cpu_jitter;
    let demand = spec.demand * profile.cpu_scale * eased * (1 + jitter);

    const spikeHit = profile.spike_step >= 0 && step === profile.spike_step;
    if (spikeHit && index < Math.max(1, specs.length - 1)) {
      demand += profile.spike_cpu * (index ? 0.55 : 1);
    }
    demand = clamp(round(demand, 3), 0, spec.cap * 2.4 + 1);

    let memory = spec.mem_usage + profile.mem_growth * step + spec.mem_limit * profile.mem_growth_pct * step;
    if (spikeHit && index === 0) memory += profile.spike_mem;
    memory = clamp(round(memory, 1), 0, spec.mem_limit * 1.6);

    out.push({
      name: spec.name,
      demand,
      cap: spec.cap,
      weight: spec.weight,
      mem_usage: memory,
      mem_limit: spec.mem_limit,
    });
  });

  if (profile.spike_step === step) {
    notes.push("Transient burst applied: CPU demand and memory spiked for one step.");
  }
  return { specs: out, notes };
}

/* ------------------------------------------------------------------ engine */
export class SimulationEngine {
  constructor(raw) {
    this.config = validateConfig(raw);
    this.profile = WORKLOAD_PROFILES[this.config.profile];
  }

  evaluate(specs, step) {
    const cpu = allocateCpu(specs, this.config.host.cpu, this.config.policy);
    const mem = evaluateMemory(specs, this.config.host.memory);
    const cpuBy = Object.fromEntries(cpu.containers.map((c) => [c.name, c]));
    const memBy = Object.fromEntries(mem.containers.map((m) => [m.name, m]));

    const containers = specs.map((spec) => {
      const c = cpuBy[spec.name];
      const m = memBy[spec.name];
      let status;
      if (m.status === "oom") status = "oom";
      else if (m.status === "pressure") status = "pressure";
      else if (c.throttled) status = "throttled";
      else if (m.status === "near") status = "near";
      else status = "normal";

      return {
        name: spec.name,
        status,
        cpu_demand: round(c.demand, 3),
        cpu_cap: round(c.cap, 3),
        weight: c.weight,
        cpu_allocated: round(c.allocated, 3),
        cpu_requested_capacity: round(spec.demand, 3),
        cpu_throttle_pct: round(c.throttle_pct, 2),
        host_share_pct: round(c.host_share_pct, 2),
        mem_usage: round(m.usage, 1),
        mem_limit: round(m.limit, 1),
        mem_utilisation_pct: round(m.utilisation_pct, 1),
        mem_excess: round(m.excess, 1),
        mem_headroom: round(m.headroom, 1),
        mem_status: m.status,
        event: m.event,
        pressure: m.status === "pressure" || m.status === "oom",
      };
    });

    return { step, cpu, memory: mem, containers };
  }

  collectEvents(result, sink, baselineOnly = false) {
    const tag = baselineOnly ? "Baseline" : `t${result.step}`;
    if (result.cpu.contention) {
      sink.push({
        step: result.step, kind: "cpu", severity: "warn",
        message: `${tag}: CPU contention - eligible demand ${result.cpu.total_eligible.toFixed(2)} vCPU vs ${result.cpu.capacity.toFixed(2)} vCPU available (${result.cpu.overcommit_pct.toFixed(0)}% overcommit).`,
      });
    }
    result.cpu.containers.forEach((c) => {
      if (c.unmet > 0.005) {
        sink.push({
          step: result.step, kind: "cpu", severity: "info",
          message: `${tag}: ${c.name} throttled to ${c.allocated.toFixed(2)} vCPU (${c.throttle_pct.toFixed(0)}% of demand not served).`,
        });
      }
    });
    result.memory.events.forEach((ev) => {
      sink.push({
        step: result.step, kind: "memory",
        severity: ev.includes("OOM") ? "critical" : "warn",
        message: `${tag}: ${ev}`,
      });
    });
    if (result.memory.host_pressure) {
      sink.push({
        step: result.step, kind: "memory", severity: "critical",
        message: `${tag}: total container memory ${result.memory.total_usage.toFixed(0)} MB exceeds host capacity ${result.memory.host_capacity.toFixed(0)} MB.`,
      });
    }
  }

  run() {
    const cfg = this.config;
    const rng = makeRng(cfg.seed);
    const steps = [];
    const events = [];

    const baseline = this.evaluate(cfg.containers, 0);
    steps.push(baseline);
    this.collectEvents(baseline, events, true);

    for (let step = 1; step <= cfg.steps; step++) {
      const { specs, notes } = generateStep(cfg.containers, this.profile, step, cfg.steps, rng);
      const result = this.evaluate(specs, step);
      steps.push(result);
      notes.forEach((n) => events.push({ step, kind: "system", severity: "warn", message: n }));
      this.collectEvents(result, events);
    }

    const final = steps[steps.length - 1];
    return {
      config: cfg,
      profile: { key: this.profile.key, label: this.profile.label, description: this.profile.description },
      baseline: this.toDict(baseline),
      final: this.toDict(final),
      series: this.series(steps),
      timeline: this.timeline(steps),
      events: events.slice(-60),
      summary: this.summary(steps, events),
      steps: steps.length,
    };
  }

  toDict(r) {
    return { step: r.step, cpu: r.cpu, memory: r.memory, containers: r.containers };
  }

  series(steps) {
    const names = this.config.containers.map((c) => c.name);
    const cpuAlloc = {};
    const cpuDemand = {};
    const memUsage = {};
    const memLimit = {};
    names.forEach((n) => {
      cpuAlloc[n] = []; cpuDemand[n] = []; memUsage[n] = []; memLimit[n] = [];
    });

    steps.forEach((r) => {
      r.containers.forEach((row) => {
        cpuAlloc[row.name].push(row.cpu_allocated);
        cpuDemand[row.name].push(round(row.cpu_demand, 3));
        memUsage[row.name].push(row.mem_usage);
        memLimit[row.name].push(row.mem_limit);
      });
    });

    return {
      labels: steps.map((r) => `t${r.step}`),
      cpu_allocated: cpuAlloc,
      cpu_demand: cpuDemand,
      mem_usage: memUsage,
      mem_limit: memLimit,
      host_cpu: steps.map((r) => round(r.cpu.capacity, 3)),
      host_mem: steps.map((r) => round(r.memory.host_capacity, 1)),
      cpu_utilisation_pct: steps.map((r) => round(r.cpu.utilisation_pct, 2)),
      avg_throttle_pct: steps.map((r) =>
        round(r.containers.reduce((a, c) => a + c.cpu_throttle_pct, 0) / Math.max(1, r.containers.length), 2)
      ),
      mem_host_usage_pct: steps.map((r) => round(r.memory.host_usage_pct, 2)),
    };
  }

  timeline(steps) {
    return steps.map((r) => ({
      step: r.step,
      cpu: {
        capacity: round(r.cpu.capacity, 3),
        allocated: round(r.cpu.total_allocated, 3),
        eligible: round(r.cpu.total_eligible, 3),
        utilisation_pct: round(r.cpu.utilisation_pct, 2),
        contention: r.cpu.contention,
        idle: round(r.cpu.idle_capacity, 3),
      },
      memory: {
        used: round(r.memory.total_usage, 1),
        capacity: round(r.memory.host_capacity, 1),
        pct: round(r.memory.host_usage_pct, 2),
      },
      containers: r.containers.map((c) => ({
        name: c.name,
        status: c.status,
        cpu_allocated: c.cpu_allocated,
        cpu_demand: c.cpu_demand,
        cpu_cap: c.cpu_cap,
        cpu_throttle_pct: c.cpu_throttle_pct,
        mem_usage: c.mem_usage,
        mem_limit: c.mem_limit,
        mem_status: c.mem_status,
        mem_excess: c.mem_excess,
        event: c.event,
      })),
    }));
  }

  summary(steps, events) {
    const contentionSteps = steps.filter((s) => s.cpu.contention).length;
    const pressureSteps = steps.filter((s) => s.memory.pressure_count).length;
    const oomSteps = steps.filter((s) => s.memory.oom_count).length;
    const utils = steps.map((s) => s.cpu.utilisation_pct);
    const peakMem = Math.max(...steps.map((s) => s.memory.total_usage), 0);

    const contended = steps.filter((s) => s.cpu.contention);
    const pool = contended.length ? contended : steps;
    const fairness = this.config.containers.map((spec) => {
      const got = pool.reduce((a, s) => {
        const row = s.containers.find((r) => r.name === spec.name);
        return a + (row ? row.cpu_allocated : 0);
      }, 0) / pool.length;
      const target = eligibleDemand(spec);
      return {
        name: spec.name,
        avg_allocated: round(got, 3),
        weight: spec.weight,
        eligible: round(target, 3),
        at_cap: got >= target - 0.01,
      };
    });

    return {
      contention_steps: contentionSteps,
      pressure_steps: pressureSteps,
      oom_steps: oomSteps,
      avg_cpu_utilisation_pct: round(utils.reduce((a, b) => a + b, 0) / utils.length, 2),
      avg_allocated_vcpu: round(steps.reduce((a, s) => a + s.cpu.total_allocated, 0) / steps.length, 3),
      min_cpu_utilisation_pct: round(Math.min(...utils), 2),
      peak_total_memory_mb: round(peakMem, 1),
      host_memory_pct_peak: round(Math.max(...steps.map((s) => s.memory.host_usage_pct), 0), 2),
      event_count: events.length,
      critical_events: events.filter((e) => e.severity === "critical").length,
      warn_events: events.filter((e) => e.severity === "warn").length,
      fairness,
      verdict: verdictFor(contentionSteps, pressureSteps, oomSteps, steps.length),
    };
  }
}

export function verdictFor(contentionSteps, pressureSteps, oomSteps, totalSteps) {
  if (oomSteps) {
    return {
      level: "critical",
      title: "Resource exhaustion detected",
      detail: `Simulated OOM occurred in ${oomSteps} of ${totalSteps} steps. Raise the offending container's memory limit or reduce its usage.`,
    };
  }
  if (pressureSteps && contentionSteps) {
    return {
      level: "warn",
      title: "Contention and memory pressure",
      detail: `CPU contention in ${contentionSteps} steps and memory pressure in ${pressureSteps} steps. Scheduler and limits are both under strain.`,
    };
  }
  if (pressureSteps) {
    return {
      level: "warn",
      title: "Memory limits are tight",
      detail: `Memory pressure in ${pressureSteps} of ${totalSteps} steps; CPU allocation stayed within the host.`,
    };
  }
  if (contentionSteps) {
    return {
      level: "info",
      title: "CPU contention, memory healthy",
      detail: `Weighted fair-share absorbed an overcommitted host for ${contentionSteps} steps without any memory violation.`,
    };
  }
  return {
    level: "ok",
    title: "Healthy run",
    detail: "All containers stayed inside their CPU caps and memory hard limits.",
  };
}

/* --------------------------------------------------------------- public API */
export function simulate(config) {
  return new SimulationEngine(config).run();
}

export function allocateOnce(config) {
  const cfg = validateConfig(config);
  return allocateCpu(cfg.containers, cfg.host.cpu, cfg.policy);
}

export function comparePolicies(config, policies = ["weighted", "equal", "priority"]) {
  const base = validateConfig(config);
  const out = { policies: [] };
  for (const policy of policies) {
    const result = new SimulationEngine({ ...config, policy }).run();
    out.policies.push({
      policy,
      utilisation_pct: result.summary.avg_cpu_utilisation_pct,
      contention_steps: result.summary.contention_steps,
      allocated: Object.fromEntries(result.final.containers.map((r) => [r.name, r.cpu_allocated])),
      verdict: result.summary.verdict,
    });
  }
  out.containers = base.containers.map((c) => c.name);
  return out;
}

/* ==========================================================================
   client.js — dual-mode engine client.

   The simulator ships two interchangeable backends:

     "server" — POSTs to the Flask API (`/api/simulate`, ...). This is the
                reference implementation: Python runs the model.

     "client" — runs the exact same model in the browser (js/engine.js).
                Used automatically when no backend is reachable, which is what
                lets GitHub Pages host a fully working copy of the simulator.

   The active mode is probed once at startup against /api/health and exposed on
   `engineMode` so the header pill can show which engine is live.
   ========================================================================== */

import {
  simulate,
  allocateOnce,
  comparePolicies,
  WORKLOAD_PROFILES,
} from "./engine.js";
import { PRACTICAL_PRESETS, PROFILES, POLICIES } from "./scenarios.js";

export const engineMode = { current: "client", label: "LOCAL ENGINE" };

const PROBE_TIMEOUT = 2500;

async function withTimeout(promise, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Decide server vs client once. Safe to call repeatedly. */
let probePromise = null;
export function detectEngine() {
  if (!probePromise) {
    probePromise = (async () => {
      try {
        const res = await withTimeout(
          (signal) => fetch("/api/health", { signal, headers: { Accept: "application/json" } }),
          PROBE_TIMEOUT
        );
        const data = res.ok ? await res.json() : null;
        if (data && data.status === "ok") {
          engineMode.current = "server";
          engineMode.label = "PYTHON ENGINE";
          return engineMode;
        }
      } catch {
        /* static hosting: no backend, stay on the local engine */
      }
      engineMode.current = "client";
      engineMode.label = "LOCAL ENGINE";
      return engineMode;
    })();
  }
  return probePromise;
}

/* ------------------------------------------------------------ server calls */
async function postJson(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function getJson(path) {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Small delay keeps the UI's "Running…" state visible instead of flashing. */
const settle = () => new Promise((r) => setTimeout(r, 120));

/* ---------------------------------------------------------------- public API */
export async function getMeta() {
  await detectEngine();
  if (engineMode.current === "server") {
    try {
      return await getJson("/api/presets");
    } catch {
      /* fall through to the built-in metadata; engine mode is unaffected */
    }
  }
  return {
    presets: PRACTICAL_PRESETS,
    profiles: Object.values(WORKLOAD_PROFILES).map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
    })),
    policies: POLICIES,
    thresholds: { near_limit_ratio: 0.9, oom_excess_ratio: 0.25 },
  };
}

export async function runSimulation(config) {
  await detectEngine();
  if (engineMode.current === "server") {
    try {
      return await postJson("/api/simulate", config);
    } catch (err) {
      // A validation error from the server should surface, not silently fall back.
      if (/must be|required|used twice|Unknown/i.test(err.message)) throw err;
      engineMode.current = "client";
      engineMode.label = "LOCAL ENGINE";
    }
  }
  await settle();
  return simulate(config);
}

export async function runAllocate(config) {
  await detectEngine();
  if (engineMode.current === "server") {
    try {
      return await postJson("/api/allocate", config);
    } catch {
      engineMode.current = "client";
      engineMode.label = "LOCAL ENGINE";
    }
  }
  return allocateOnce(config);
}

export async function runCompare(config) {
  await detectEngine();
  if (engineMode.current === "server") {
    try {
      return await postJson("/api/compare", config);
    } catch {
      engineMode.current = "client";
      engineMode.label = "LOCAL ENGINE";
    }
  }
  return comparePolicies(config);
}

export function getPreset(id) {
  const preset = PRACTICAL_PRESETS.find((p) => p.id === id);
  return preset ? { preset, config: preset } : { preset: null, config: null };
}

export { PROFILES, POLICIES, PRACTICAL_PRESETS };

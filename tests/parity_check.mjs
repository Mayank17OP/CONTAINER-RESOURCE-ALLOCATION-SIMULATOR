/* Cross-checks the browser engine (static/js/engine.js) against the Python
   reference implementation on random configurations.
   Run:  node tests/parity_check.mjs        (from the repo root) */
import { allocateCpu, evaluateMemory } from "../static/js/engine.js";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import fs from "fs";
import { execSync } from "child_process";

// generate random configs
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const configs = [];
for (let i = 0; i < 300; i++) {
  const n = 1 + Math.floor(rnd() * 6);
  const containers = [];
  for (let j = 0; j < n; j++) {
    containers.push({
      name: `c${j}`,
      demand: Math.round(rnd() * 40) / 10,
      cap: Math.round((0.1 + rnd() * 40)) / 10,
      weight: 1 + Math.floor(rnd() * 5),
      mem_usage: Math.round(rnd() * 4000),
      mem_limit: Math.round(100 + rnd() * 4000),
    });
  }
  configs.push({
    host: { cpu: Math.round((0.5 + rnd() * 80)) / 10, memory: 4096 },
    containers,
    policy: ["weighted", "equal", "priority"][Math.floor(rnd() * 3)],
    profile: "normal", steps: 1, seed: i,
  });
}
const INPUT_JSON = path.join(ROOT, "tests", ".parity_input.json");
fs.writeFileSync(INPUT_JSON, JSON.stringify(configs));

// python side
const py = `
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from simulator.cpu_allocator import allocate_cpu
from simulator.memory_manager import evaluate_memory
from simulator.models import ContainerSpec
cfgs = json.load(open(os.path.join(os.path.dirname(__file__), ".parity_input.json")))
out = []
for c in cfgs:
    specs = [ContainerSpec(**x) for x in c["containers"]]
    a = allocate_cpu(specs, c["host"]["cpu"], c["policy"]).to_dict()
    m = evaluate_memory(specs, c["host"]["memory"]).to_dict()
    out.append({"alloc": [x["allocated"] for x in a["containers"]],
                "total": a["total_allocated"], "util": a["utilisation_pct"],
                "contention": a["contention"],
                "mem": [x["status"] for x in m["containers"]]})
print(json.dumps(out))
`;
const PY_RUN = path.join(ROOT, "tests", "parity_run.py");
fs.writeFileSync(PY_RUN, py);
const pyOut = JSON.parse(
  execSync(`python3 ${path.join(ROOT, "tests", "parity_run.py")}`, { cwd: ROOT, maxBuffer: 1e8 }).toString()
);

let mismatches = 0, checked = 0, maxDelta = 0;
configs.forEach((cfg, idx) => {
  const js = allocateCpu(cfg.containers, cfg.host.cpu, cfg.policy);
  const jsMem = evaluateMemory(cfg.containers, cfg.host.memory);
  const py = pyOut[idx];
  js.containers.forEach((c, i) => {
    checked++;
    const delta = Math.abs(c.allocated - py.alloc[i]);
    maxDelta = Math.max(maxDelta, delta);
    if (delta > 0.0011) {
      mismatches++;
      if (mismatches <= 3) console.log(`MISMATCH cfg${idx} ${c.name}: js=${c.allocated} py=${py.alloc[i]}`);
    }
  });
  if (Math.abs(js.total_allocated - py.total) > 0.002) { mismatches++; console.log(`TOTAL mismatch cfg${idx}: ${js.total_allocated} vs ${py.total}`); }
  if (js.contention !== py.contention) { mismatches++; console.log(`CONTENTION mismatch cfg${idx}`); }
  jsMem.containers.forEach((c, i) => {
    if (c.status !== py.mem[i]) { mismatches++; if (mismatches <= 6) console.log(`MEM mismatch cfg${idx} ${c.name}: ${c.status} vs ${py.mem[i]}`); }
  });
});
console.log(`\nchecked ${checked} allocations across ${configs.length} random configs`);
console.log(`max allocation delta: ${maxDelta}`);
console.log(mismatches === 0 ? "PARITY OK — browser engine matches Python exactly" : `${mismatches} MISMATCHES`);
process.exit(mismatches ? 1 : 0);

# Demo & Viva Guide

How to present the **Container Resource Allocation Simulator** in ~8 minutes, plus
the questions examiners usually ask.

---

## Before you start (2 minutes)

```bash
pip install -r requirements.txt
python app.py
```

Open the preview / `http://localhost:5000`. Only the **Simulator** tab matters for the
live demo; the other two tabs answer questions on demand.

Make sure the first scenario loaded is **"Deck example – CPU contention"** (it is
selected by default).

---

## Opening line

> "Three containers share one 4 vCPU, 4 GB host. Two of them want more CPU than the
> host has, and one of them is using more memory than it is allowed. This simulator
> shows exactly how the system decides who gets what."

---

## The 8-minute script

### 1. The problem (30 s)
Point at the four metric cards: **CPU allocated 4.00 / 4 vCPU**, **memory in use**,
**containers**, **overcommit**. The `+25%` overcommit card is the whole point — the
containers collectively want 5 vCPU from a 4 vCPU machine.

### 2. The reference result (90 s)
Scroll to the **Allocation table** and read the row out loud:

| Container | demand | cap | weight | alloc |
|---|---|---|---|---|
| web | 2.4 | 2.0 | 2 | **1.6** |
| database | 2.5 | 2.0 | 2 | **1.6** |
| worker | 1.5 | 1.0 | 1 | **0.8** |

> "Total 4.0 vCPU. It is not first-come-first-served — it is shared by weight 2:2:1.
> That is 2/5, 2/5, 1/5 of the 4 vCPU."

Then point at Worker's memory: **1150 / 1024 MB — +126 MB over**. The badge says
**memory pressure**. And the other two containers are unaffected — that is isolation.

### 3. Show the math (60 s)
Scroll to **"Why these numbers"**. This panel derives it live, for whatever values are
on screen:

```
e_i = min(d_i, q_i)   →   2.0 + 2.0 + 1.0 = 5.0 vCPU
C = 4.0 vCPU          →   contention, share by weight
```

> "Eligible demand is the minimum of what a container wants and what its cap allows.
> 5.0 > 4.0, so we redistribute. If a container's cap had been the limit, the unused
> part of its share goes to the others — that is progressive filling."

### 4. Memory is a different mechanism (45 s)
> "Memory has no weights. Each container has its own hard boundary and its own counter.
> Above 90% we call it near limit, above 100% it is pressure, above 125% it is a
> simulated OOM. The OOM is only a state — no process is actually killed, and no kernel
> setting is touched."

### 5. Prove it is not a static mock-up (120 s)
- **Drag the scrubber** — every number, card and bar changes per time step.
- Hit **▶ play** — watch the run animate.
- Change the **policy** to **Equal**: web/database/worker become 1.5 / 1.5 / 1.0.
  Then **Priority**: Worker collapses to ~0.03 while the weight-2 containers fill up —
  strict priority starves the low-weight workload.
- **Add a container** (`+`), set demand high and cap low, hit **Run simulation** — the
  new one is capped and its unused share is redistributed.

### 6. Failure modes (60 s)
Click the **"Memory OOM event"** preset → verdict turns red, **critical**, container
card pulses, event history shows the OOM. Then **"Traffic burst"** → one spike step,
then recovery. This is the fault-injection part.

### 7. Close (40 s)
> "The model enforces two invariants: allocation never exceeds eligible demand
> (0 ≤ aᵢ ≤ eᵢ), and the total never exceeds host capacity (Σaᵢ ≤ C). Real Linux
> cgroup v2 does the same thing in the kernel through cpu.weight, cpu.max and
> memory.max. Our version is a learning model, not a benchmark — and the next step is
> wiring it to real Docker containers."

Finally, hit **download** in the header to show the exported run report (`.log`).

---

## Numbers you must know cold

- `e_i = min(d_i, q_i)` — eligible demand
- Contention test: `Σe_i > C`
- Allocation invariant: `0 ≤ a_i ≤ e_i` and `Σa_i ≤ C`
- Reference run: `5.0 vCPU eligible` vs `4.0 vCPU capacity` → **25% overcommit**
- Weighted split 2:2:1 of 4 vCPU → **1.6 / 1.6 / 0.8**
- Worker memory: **1150 − 1024 = 126 MB** over
- Memory thresholds: **90% near limit**, **>100% pressure**, **>125% OOM (simulated)**

---

## Likely questions

**Q: What is the difference between a CPU cap and a weight?**
A cap (`cpu.max`) is an absolute ceiling on one container. A weight (`cpu.weight`) only
matters when containers compete — it sets the ratio in which free capacity is divided.
A container can have a high weight and still be limited by a low cap.

**Q: What happens when the total demand is below capacity?**
Nothing is shared. Every container gets `min(demand, cap)` and the remainder of the host
sits idle. The dashboard shows the idle portion as a hatched segment in the composition bar.

**Q: Why does a capped container not waste its share?**
Because allocation is done by progressive filling: containers that reach their eligible
demand leave the pool, and the loop re-runs with the reduced weight total, so the unused
slice is handed to whoever still needs CPU.

**Q: Why is memory not shared by weight?**
A hard limit is a boundary on one container's usage, not a share of a pool. Exceeding it
is a per-container fault, so the check is independent per container — that is exactly what
makes accounting isolation demonstrable.

**Q: Why do you call it a "simulated" OOM?**
The simulator sets a state flag; it never sends a signal or touches the kernel. A real OOM
kill would terminate a process, which is unsafe and outside the scope of a modelling project.

**Q: How is this different from actually running Docker?**
This reproduces the *accounting and allocation logic*, not the enforcement. Real cgroup v2
does it in the kernel with hardware-level accounting. The simulator is for understanding the
policy; it is not a benchmark and the numbers are model outputs.

**Q: How do you know the numbers are right?**
40 unit tests assert the invariants: the deck's worked example reproduces exactly
(1.6/1.6/0.8), cap saturation releases share, memory checks are independent per container,
and every timeline frame respects `Σa_i ≤ C`. The engine is seeded, so a run is reproducible.

**Q: Is it deterministic?**
Yes — same configuration and seed produce identical output, which is what makes a demo
repeatable and the tests stable.

**Q: What would you do with more time?**
Integrate Docker Engine + cgroup v2 for real enforcement, add memory reservation/swap/oom
policy options, add a real CFS-style scheduler comparison, and export Prometheus-style
metrics.

---

## If something goes wrong on stage

| Symptom | Fix |
|---|---|
| Blank dashboard | Hard refresh (Ctrl/Cmd+Shift+R) — it reloads presets and runs the demo |
| "Cannot run simulation" toast | A field is invalid (e.g. empty or negative); the message names the field |
| Fonts look plain | Offline — the UI falls back to system fonts, everything still works |
| Page too tall | Use the scrubber and the three tabs instead of scrolling everything |
| Venue laptop has no internet | The app is fully local: Python + browser only, no CDN required for logic |

---

## Fallback plan if the laptop fails

Everything is in the repo:
- `docs/Container_Resource_Allocation_Simulator_Presentation.pdf` — the slide deck
- `README.md` — model, formulas, architecture, API
- `python -m pytest -q` — proves the numbers (run it on any machine)
- This file — the spoken script

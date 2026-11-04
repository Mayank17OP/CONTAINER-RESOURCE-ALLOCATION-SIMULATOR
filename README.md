# Container Resource Allocation Simulator

An interactive simulator that makes **CPU contention** and **memory isolation**
between containers visible and measurable. Built for the Operating Systems Lab
(CIC-353) project.

> Multiple containers share finite CPU and RAM. A busy workload can slow its
> neighbours, and a leaking one can exceed the memory it is allowed to use.
> This simulator lets you configure the host and its containers, run a workload,
> and watch the allocator enforce caps, weights and memory boundaries.

---

## What it demonstrates

| Concept | Where it lives in the code |
|---|---|
| Host CPU / RAM configuration | `simulator/models.py` → `HostSpec` |
| Per-container CPU cap + weight | `simulator/models.py` → `ContainerSpec` |
| Weighted fair-share under contention | `simulator/cpu_allocator.py` |
| Memory hard limits, pressure & OOM | `simulator/memory_manager.py` |
| Separate resource counters, event history | `simulator/engine.py` |
| Time-stepped workload generation | `simulator/workload.py` |

---

## The model

**CPU — progressive filling (weighted max-min fair share)**

```
e_i = min(d_i, q_i)                  eligible demand (demand, cap)
if Σe_i ≤ C:   a_i = e_i             no contention, capacity left idle
else:          share C by active weights, redistribute unused share

invariant:  0 ≤ a_i ≤ e_i   and   Σa_i ≤ C
```

**Memory — hard limits, checked independently per container**

```
usage < 90% of limit        → ok
usage ≥ 90% of limit        → near limit
usage > limit               → memory pressure
usage > 1.25 × limit        → OOM (simulated state only)
```

The reference scenario from the presentation is reproduced exactly: a 4 vCPU host
with `web 2.4/2.0 w2`, `database 2.5/2.0 w2`, `worker 1.5/1.0 w1` yields
**1.6 + 1.6 + 0.8 = 4.0 vCPU** (25 % overcommit), and Worker's 1150 MB exceeds its
1024 MB limit by **126 MB**.

---

## Live demo (GitHub Pages)

**https://mayank17op.github.io/CONTAINER-RESOURCE-ALLOCATION-SIMULATOR/**

GitHub Pages can only serve static files, so the simulator ships **two
interchangeable engines** that run the *same* model:

| Mode | Engine | Used when |
|---|---|---|
| `server` | Python / Flask (`simulator/`) | running locally or on Render/Vercel |
| `client` | Browser mirror (`static/js/engine.js`) | GitHub Pages, or any static host |

The app probes `/api/health` at startup and picks one automatically — the header
pill reports which engine is live (`PYTHON ENGINE` / `LOCAL ENGINE`). Allocation and
memory results are numerically identical; `tests/test_js_parity.py` asserts this over
300 random configurations (max delta 0.001, pure rounding).

Rebuild the static bundle with:

```bash
python build_static.py     # writes _site/
```

Deployment runs automatically via `.github/workflows/deploy-pages.yml` on every push
to `main` (tests must pass first).

---

## Run it locally

```bash
pip install -r requirements.txt
python app.py
# open http://localhost:5000
```

`PORT` is respected, so `PORT=8080 python app.py` also works.

### Tests

```bash
python -m pytest -q      # 40 tests: allocation invariants, limits, API
```

---

## Deploy

**GitHub Pages (already configured)** — automatic on push to `main` via GitHub Actions.

**Render (free tier, for the Python backend)**

`render.yaml` is included. Create a Blueprint at
<https://dashboard.render.com/blueprints>, select this repository, and Render runs:

```
build:  pip install -r requirements.txt
start:  gunicorn app:app --bind 0.0.0.0:$PORT
```

**Railway / Heroku / any Procfile host**

The included `Procfile` is enough.

**Vercel**

`vercel.json` targets `app.py` with `@vercel/python`.

**Docker**

```bash
docker build -t crs . && docker run -p 5000:5000 crs
```

---

## Project layout

```
app.py                     Flask API + static hosting
simulator/
  models.py                HostSpec, ContainerSpec, validation
  cpu_allocator.py         caps + weighted fair-share
  memory_manager.py        hard limits, pressure, OOM
  workload.py              workload profiles (normal/contention/pressure/burst)
  engine.py                the simulation cycle + event log
  scenarios.py             6 ready-made scenarios
static/
  index.html               3 views: Simulator, Resource model, Project
  css/styles.css           design system
  js/app.js                UI logic
  js/charts.js             dependency-free SVG charts
tests/test_simulator.py    40 unit + API tests
```

## API

| Method | Route | Purpose |
|---|---|---|
| `GET`  | `/api/health` | liveness probe |
| `GET`  | `/api/presets` | scenarios, profiles, policies |
| `POST` | `/api/simulate` | full timed run (baseline + timeline + events) |
| `POST` | `/api/allocate` | single-shot CPU allocation |
| `POST` | `/api/compare` | same load under weighted / equal / priority |

Example:

```bash
curl -X POST localhost:5000/api/simulate -H 'Content-Type: application/json' -d '{
  "host": {"cpu": 4, "memory": 4096},
  "containers": [
    {"name":"web","demand":2.4,"cap":2.0,"weight":2,"mem_usage":700,"mem_limit":1024},
    {"name":"database","demand":2.5,"cap":2.0,"weight":2,"mem_usage":1800,"mem_limit":2048},
    {"name":"worker","demand":1.5,"cap":1.0,"weight":1,"mem_usage":1150,"mem_limit":1024}
  ],
  "policy": "weighted", "profile": "contention", "steps": 10, "seed": 7
}'
```

---

## Scope & limitations

- Does **not** start real Docker containers.
- Does **not** modify Linux kernel / cgroup settings.
- The CPU model is simplified weighted sharing, not a real CFS scheduler.
- OOM is a **simulated state** — no process is terminated.
- Results are model outputs, not physical host benchmarks.

Real Linux cgroup v2 provides kernel-level accounting and enforcement of the same
concepts (`cpu.weight`, `cpu.max`, `memory.max`).

---

## References

1. Docker Documentation, “Resource constraints,” Docker Engine Manual.
2. The Linux Kernel Documentation, “Control Group v2.”
3. Kubernetes Documentation, “Resource Management for Pods and Containers.”
4. A. Silberschatz, P. B. Galvin, G. Gagne, *Operating System Concepts*, 10th ed., Wiley, 2018.
5. A. S. Tanenbaum, H. Bos, *Modern Operating Systems*, 4th ed., Pearson, 2015.
6. Python Software Foundation, Python 3 Documentation.

---

**Presented by** Vedang Goel · Samar Jaryal · Soumya Madhyan
**Under the guidance of** Dr. Yashu Shanker
Operating Systems Lab (CIC-353) · Computer Science & Engineering · Session 2026–2027

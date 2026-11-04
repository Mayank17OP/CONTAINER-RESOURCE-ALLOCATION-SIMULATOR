"""The simulation engine: one repeatable resource-simulation cycle.

    configuration -> workload -> CPU allocator -> memory manager -> monitoring

`SimulationEngine.run()` produces a single snapshot plus a time series, so the
dashboard can render the current state *and* the history from one call.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Dict, List

from .cpu_allocator import AllocationResult, allocate_cpu
from .memory_manager import MemoryResult, evaluate_memory
from .models import ContainerSpec, SimulationConfig
from .workload import WORKLOAD_PROFILES, generate_step

STATUS_RANK = {"ok": 0, "normal": 0, "near": 1, "throttled": 2, "pressure": 3, "oom": 4}


@dataclass
class Event:
    step: int
    kind: str        # cpu | memory | system
    severity: str    # info | warn | critical
    message: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step": self.step,
            "kind": self.kind,
            "severity": self.severity,
            "message": self.message,
        }


@dataclass
class StepResult:
    step: int
    cpu: AllocationResult
    memory: MemoryResult
    containers: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step": self.step,
            "cpu": self.cpu.to_dict(),
            "memory": self.memory.to_dict(),
            "containers": self.containers,
        }


class SimulationEngine:
    def __init__(self, config: SimulationConfig):
        self.config = config.validate()
        self.profile = WORKLOAD_PROFILES[self.config.profile]

    # ------------------------------------------------------------------ single
    def _evaluate(self, specs: List[ContainerSpec], step: int) -> StepResult:
        cpu = allocate_cpu(specs, self.config.host.cpu, self.config.policy)
        mem = evaluate_memory(specs, self.config.host.memory)
        cpu_by = cpu.by_name()
        mem_by = mem.by_name()

        rows: List[Dict[str, Any]] = []
        for spec in specs:
            c = cpu_by[spec.name]
            m = mem_by[spec.name]
            if m.status == "oom":
                status = "oom"
            elif m.status == "pressure":
                status = "pressure"
            elif c.throttled:
                status = "throttled"
            elif m.status == "near":
                status = "near"
            else:
                status = "normal"
            rows.append(
                {
                    "name": spec.name,
                    "status": status,
                    "cpu_demand": round(c.demand, 3),
                    "cpu_cap": round(c.cap, 3),
                    "weight": c.weight,
                    "cpu_allocated": round(c.allocated, 3),
                    "cpu_requested_capacity": round(spec.demand, 3),
                    "cpu_throttle_pct": round(c.throttle_pct, 2),
                    "host_share_pct": round(c.host_share_pct, 2),
                    "mem_usage": round(m.usage, 1),
                    "mem_limit": round(m.limit, 1),
                    "mem_utilisation_pct": round(m.utilisation_pct, 1),
                    "mem_excess": round(m.excess, 1),
                    "mem_headroom": round(m.headroom, 1),
                    "mem_status": m.status,
                    "event": m.event,
                    "pressure": m.status in ("pressure", "oom"),
                }
            )

        return StepResult(step=step, cpu=cpu, memory=mem, containers=rows)

    # ---------------------------------------------------------------- timeline
    def run(self) -> Dict[str, Any]:
        cfg = self.config
        rng = random.Random(cfg.seed)
        steps: List[StepResult] = []
        events: List[Event] = []

        # Step 0 is the configuration as entered - the deck's worked example.
        baseline = self._evaluate(cfg.containers, 0)
        steps.append(baseline)
        self._collect_events(baseline, events, baseline_only=True)

        for step in range(1, cfg.steps + 1):
            specs, notes = generate_step(cfg.containers, self.profile, step, cfg.steps, rng)
            result = self._evaluate(specs, step)
            steps.append(result)
            for note in notes:
                events.append(Event(step, "system", "warn", note))
            self._collect_events(result, events)

        final = steps[-1]
        summary = self._summary(steps, events)

        return {
            "config": cfg.to_dict(),
            "profile": {
                "key": self.profile.key,
                "label": self.profile.label,
                "description": self.profile.description,
            },
            "baseline": baseline.to_dict(),
            "final": final.to_dict(),
            "series": self._series(steps),
            "timeline": [
                {
                    "step": r.step,
                    "cpu": {
                        "capacity": round(r.cpu.capacity, 3),
                        "allocated": round(r.cpu.total_allocated, 3),
                        "eligible": round(r.cpu.total_eligible, 3),
                        "utilisation_pct": round(r.cpu.utilisation_pct, 2),
                        "contention": r.cpu.contention,
                        "idle": round(r.cpu.idle_capacity, 3),
                    },
                    "memory": {
                        "used": round(r.memory.total_usage, 1),
                        "capacity": round(r.memory.host_capacity, 1),
                        "pct": round(r.memory.host_usage_pct, 2),
                    },
                    "containers": [
                        {
                            "name": c["name"],
                            "status": c["status"],
                            "cpu_allocated": c["cpu_allocated"],
                            "cpu_demand": c["cpu_demand"],
                            "cpu_cap": c["cpu_cap"],
                            "cpu_throttle_pct": c["cpu_throttle_pct"],
                            "mem_usage": c["mem_usage"],
                            "mem_limit": c["mem_limit"],
                            "mem_status": c["mem_status"],
                            "mem_excess": c["mem_excess"],
                            "event": c["event"],
                        }
                        for c in r.containers
                    ],
                }
                for r in steps
            ],
            "events": [e.to_dict() for e in events][-60:],
            "summary": summary,
            "steps": len(steps),
        }

    # ------------------------------------------------------------------ output
    def _collect_events(self, result: StepResult, sink: List[Event], baseline_only: bool = False) -> None:
        tag = "Baseline" if baseline_only else f"t{result.step}"
        if result.cpu.contention:
            sink.append(
                Event(
                    result.step,
                    "cpu",
                    "warn",
                    f"{tag}: CPU contention - eligible demand {result.cpu.total_eligible:.2f} vCPU "
                    f"vs {result.cpu.capacity:.2f} vCPU available "
                    f"({result.cpu.overcommit_pct:.0f}% overcommit).",
                )
            )
        for c in result.cpu.containers:
            if c.unmet > 0.005:
                sink.append(
                    Event(
                        result.step,
                        "cpu",
                        "info",
                        f"{tag}: {c.name} throttled to {c.allocated:.2f} vCPU "
                        f"({c.throttle_pct:.0f}% of demand not served).",
                    )
                )
        for ev in result.memory.events:
            severity = "critical" if "OOM" in ev else "warn"
            sink.append(Event(result.step, "memory", severity, f"{tag}: {ev}"))
        if result.memory.host_pressure:
            sink.append(
                Event(
                    result.step,
                    "memory",
                    "critical",
                    f"{tag}: total container memory {result.memory.total_usage:.0f} MB exceeds "
                    f"host capacity {result.memory.host_capacity:.0f} MB.",
                )
            )

    def _series(self, steps: List[StepResult]) -> Dict[str, Any]:
        names = [c.name for c in self.config.containers]
        cpu_alloc: Dict[str, List[float]] = {n: [] for n in names}
        cpu_demand: Dict[str, List[float]] = {n: [] for n in names}
        mem_usage: Dict[str, List[float]] = {n: [] for n in names}
        mem_limit: Dict[str, List[float]] = {n: [] for n in names}
        host_cpu: List[float] = []
        host_mem: List[float] = []
        utilisation: List[float] = []
        throttle: List[float] = []

        for result in steps:
            for row in result.containers:
                cpu_alloc[row["name"]].append(row["cpu_allocated"])
                cpu_demand[row["name"]].append(round(row["cpu_demand"], 3))
                mem_usage[row["name"]].append(row["mem_usage"])
                mem_limit[row["name"]].append(row["mem_limit"])
            host_cpu.append(round(result.cpu.capacity, 3))
            host_mem.append(round(result.memory.host_capacity, 1))
            utilisation.append(round(result.cpu.utilisation_pct, 2))
            throttle.append(
                round(
                    sum(r["cpu_throttle_pct"] for r in result.containers) / max(1, len(result.containers)),
                    2,
                )
            )

        return {
            "labels": [f"t{r.step}" for r in steps],
            "cpu_allocated": cpu_alloc,
            "cpu_demand": cpu_demand,
            "mem_usage": mem_usage,
            "mem_limit": mem_limit,
            "host_cpu": host_cpu,
            "host_mem": host_mem,
            "cpu_utilisation_pct": utilisation,
            "avg_throttle_pct": throttle,
            "mem_host_usage_pct": [round(r.memory.host_usage_pct, 2) for r in steps],
        }

    def _summary(self, steps: List[StepResult], events: List[Event]) -> Dict[str, Any]:
        contention_steps = sum(1 for s in steps if s.cpu.contention)
        pressure_steps = sum(1 for s in steps if s.memory.pressure_count)
        oom_steps = sum(1 for s in steps if s.memory.oom_count)
        alloc_series = [s.cpu.utilisation_pct for s in steps]
        peak_mem = max((s.memory.total_usage for s in steps), default=0.0)

        # Per-container fairness: allocated share vs weight share, on contended steps.
        fairness: List[Dict[str, Any]] = []
        contended = [s for s in steps if s.cpu.contention] or steps
        for spec in self.config.containers:
            got = sum(s.cpu.by_name()[spec.name].allocated for s in contended) / len(contended)
            fair_target = spec.eligible_demand
            fairness.append(
                {
                    "name": spec.name,
                    "avg_allocated": round(got, 3),
                    "weight": spec.weight,
                    "eligible": round(fair_target, 3),
                    "at_cap": got >= fair_target - 0.01,
                }
            )

        return {
            "contention_steps": contention_steps,
            "pressure_steps": pressure_steps,
            "oom_steps": oom_steps,
            "avg_cpu_utilisation_pct": round(sum(alloc_series) / len(alloc_series), 2),
            "avg_allocated_vcpu": round(
                sum(s.cpu.total_allocated for s in steps) / len(steps), 3
            ),
            "min_cpu_utilisation_pct": round(min(alloc_series), 2),
            "peak_total_memory_mb": round(peak_mem, 1),
            "host_memory_pct_peak": round(
                max((s.memory.host_usage_pct for s in steps), default=0.0), 2
            ),
            "event_count": len(events),
            "critical_events": sum(1 for e in events if e.severity == "critical"),
            "warn_events": sum(1 for e in events if e.severity == "warn"),
            "fairness": fairness,
            "verdict": self._verdict(contention_steps, pressure_steps, oom_steps, steps),
        }

    @staticmethod
    def _verdict(contention_steps: int, pressure_steps: int, oom_steps: int, steps: List[StepResult]) -> Dict[str, str]:
        if oom_steps:
            return {
                "level": "critical",
                "title": "Resource exhaustion detected",
                "detail": f"Simulated OOM occurred in {oom_steps} of {len(steps)} steps. "
                          "Raise the offending container's memory limit or reduce its usage.",
            }
        if pressure_steps and contention_steps:
            return {
                "level": "warn",
                "title": "Contention and memory pressure",
                "detail": f"CPU contention in {contention_steps} steps and memory pressure in "
                          f"{pressure_steps} steps. Scheduler and limits are both under strain.",
            }
        if pressure_steps:
            return {
                "level": "warn",
                "title": "Memory limits are tight",
                "detail": f"Memory pressure in {pressure_steps} of {len(steps)} steps; "
                          "CPU allocation stayed within the host.",
            }
        if contention_steps:
            return {
                "level": "info",
                "title": "CPU contention, memory healthy",
                "detail": f"Weighted fair-share absorbed an overcommitted host for "
                          f"{contention_steps} steps without any memory violation.",
            }
        return {
            "level": "ok",
            "title": "Healthy run",
            "detail": "All containers stayed inside their CPU caps and memory hard limits.",
        }


def simulate(config: SimulationConfig) -> Dict[str, Any]:
    return SimulationEngine(config).run()


def compare_policies(config: SimulationConfig) -> Dict[str, Any]:
    """Run the same final load under each CPU policy to contrast the schedulers."""
    out: Dict[str, Any] = {"policies": []}
    baseline_specs = None
    for key in SimulationConfig.POLICIES:
        cfg = SimulationConfig(
            host=config.host,
            containers=[
                ContainerSpec(
                    name=c.name, demand=c.demand, cap=c.cap, weight=c.weight,
                    mem_usage=c.mem_usage, mem_limit=c.mem_limit,
                )
                for c in config.containers
            ],
            policy=key,
            profile=config.profile,
            steps=config.steps,
            seed=config.seed,
        )
        engine = SimulationEngine(cfg)
        result = engine.run()
        if baseline_specs is None:
            baseline_specs = [c.name for c in cfg.containers]
        out["policies"].append(
            {
                "policy": key,
                "utilisation_pct": result["summary"]["avg_cpu_utilisation_pct"],
                "contention_steps": result["summary"]["contention_steps"],
                "allocated": {
                    row["name"]: row["cpu_allocated"] for row in result["final"]["containers"]
                },
                "verdict": result["summary"]["verdict"],
            }
        )
    out["containers"] = baseline_specs or []
    return out

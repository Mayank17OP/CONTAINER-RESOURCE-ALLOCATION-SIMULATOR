"""Workload generation.

Each profile shapes how CPU demand and memory usage drift across time steps,
so the dashboard can show *change* rather than a static table.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List, Tuple

from .models import ContainerSpec


@dataclass(frozen=True)
class Profile:
    key: str
    label: str
    description: str
    cpu_scale: float          # multiplies base demand over the run
    cpu_jitter: float         # +/- noise applied per step
    mem_growth: float         # MB added per step (linear creep)
    mem_growth_pct: float     # memory added per step as % of limit
    spike_step: int           # step index that a transient spike hits (-1 = none)
    spike_cpu: float          # extra CPU demand at the spike
    spike_mem: float          # extra MB at the spike


WORKLOAD_PROFILES: Dict[str, Profile] = {
    "normal": Profile(
        "normal", "Normal load",
        "Steady, light traffic. Total eligible demand fits inside the host.",
        0.70, 0.06, 0.0, 0.0, -1, 0.0, 0.0,
    ),
    "contention": Profile(
        "contention", "CPU contention",
        "Every container ramps to its full cap, so eligible demand exceeds the host.",
        1.00, 0.05, 0.0, 0.0, -1, 0.0, 0.0,
    ),
    "pressure": Profile(
        "pressure", "Memory pressure",
        "Memory creeps upward each step until a container crosses its hard limit.",
        0.85, 0.05, 0.0, 0.055, -1, 0.0, 0.0,
    ),
    "burst": Profile(
        "burst", "Traffic burst",
        "A sudden spike in the middle of the run, then recovery.",
        0.90, 0.08, 0.0, 0.018, 5, 1.15, 140.0,
    ),
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def generate_step(
    specs: List[ContainerSpec],
    profile: Profile,
    step: int,
    total_steps: int,
    rng: random.Random,
) -> Tuple[List[ContainerSpec], List[str]]:
    """Produce this step's container load, starting from the configured specs."""
    # Ramp factor: workloads climb towards their profile intensity then hold.
    ramp = min(1.0, 0.55 + (step / max(1, total_steps - 1)) * 0.75)
    eased = 0.35 + 0.65 * ramp

    out: List[ContainerSpec] = []
    notes: List[str] = []
    for index, spec in enumerate(specs):
        jitter = rng.uniform(-profile.cpu_jitter, profile.cpu_jitter)
        demand = spec.demand * profile.cpu_scale * eased * (1.0 + jitter)

        spike_hit = profile.spike_step >= 0 and step == profile.spike_step
        if spike_hit:
            # Only the first two containers take the burst, so the picture is
            # asymmetric - exactly what makes contention visible on a chart.
            if index < max(1, len(specs) - 1):
                demand += profile.spike_cpu * (0.55 if index else 1.0)

        demand = _clamp(round(demand, 3), 0.0, spec.cap * 2.4 + 1.0)

        memory = spec.mem_usage + profile.mem_growth * step + spec.mem_limit * profile.mem_growth_pct * step
        if spike_hit and index == 0:
            memory += profile.spike_mem
        memory = _clamp(round(memory, 1), 0.0, spec.mem_limit * 1.6)

        out.append(
            ContainerSpec(
                name=spec.name,
                demand=demand,
                cap=spec.cap,
                weight=spec.weight,
                mem_usage=memory,
                mem_limit=spec.mem_limit,
            )
        )

    if profile.spike_step == step:
        notes.append("Transient burst applied: CPU demand and memory spiked for one step.")
    return out, notes

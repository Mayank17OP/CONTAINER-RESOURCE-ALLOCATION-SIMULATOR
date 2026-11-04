"""CPU allocation: caps plus weighted fair-share under contention.

The model implemented here is *progressive filling* (a.k.a. weighted
max-min fairness), which is the behaviour the deck describes:

    e_i = min(d_i, q_i)                     eligible demand
    if sum(e_i) <= C:  a_i = e_i            (no contention)
    else: share the capacity in proportion to active weights, and
          redistribute whatever a capped container cannot use.

Result invariant:  0 <= a_i <= e_i   and   sum(a_i) <= C
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

from .models import ContainerSpec

EPS = 1e-9


@dataclass
class ContainerAllocation:
    name: str
    demand: float
    cap: float
    weight: int
    eligible: float
    allocated: float
    unmet: float
    throttled: bool
    throttle_pct: float
    host_share_pct: float

    def to_dict(self) -> Dict[str, object]:
        return {
            "name": self.name,
            "demand": round(self.demand, 3),
            "cap": round(self.cap, 3),
            "weight": self.weight,
            "eligible": round(self.eligible, 3),
            "allocated": round(self.allocated, 3),
            "unmet": round(self.unmet, 3),
            "throttled": self.throttled,
            "throttle_pct": round(self.throttle_pct, 2),
            "host_share_pct": round(self.host_share_pct, 2),
        }


@dataclass
class AllocationResult:
    policy: str
    capacity: float
    total_demand: float
    total_eligible: float
    total_allocated: float
    idle_capacity: float
    utilisation_pct: float
    contention: bool
    overcommit_pct: float
    containers: List[ContainerAllocation] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    def by_name(self) -> Dict[str, ContainerAllocation]:
        return {c.name: c for c in self.containers}

    def to_dict(self) -> Dict[str, object]:
        return {
            "policy": self.policy,
            "capacity": round(self.capacity, 3),
            "total_demand": round(self.total_demand, 3),
            "total_eligible": round(self.total_eligible, 3),
            "total_allocated": round(self.total_allocated, 3),
            "idle_capacity": round(self.idle_capacity, 3),
            "utilisation_pct": round(self.utilisation_pct, 2),
            "contention": self.contention,
            "overcommit_pct": round(self.overcommit_pct, 2),
            "containers": [c.to_dict() for c in self.containers],
            "notes": list(self.notes),
        }


def _weights_for(specs: List[ContainerSpec], policy: str) -> List[float]:
    """Translate a scheduling policy into the weights fed to progressive filling."""
    if policy == "equal":
        return [1.0] * len(specs)
    # 'priority' = strict ordering: weight is treated as an exponential rank so
    # that the highest-weight container is effectively served first.
    if policy == "priority":
        return [float(max(1, int(round(s.weight))) ** 12) for s in specs]
    return [float(max(1, int(s.weight))) for s in specs]


def allocate_cpu(specs: List[ContainerSpec], capacity: float, policy: str = "weighted") -> AllocationResult:
    """Allocate `capacity` vCPU across `specs` using the selected policy."""
    if capacity <= 0:
        raise ValueError("Host CPU capacity must be positive.")

    weights = _weights_for(specs, policy)
    eligible = [s.eligible_demand for s in specs]
    allocated = [0.0] * len(specs)

    remaining = float(capacity)
    # Indices that still have unmet eligible demand.
    active = [i for i in range(len(specs)) if eligible[i] > EPS]

    while active and remaining > EPS:
        total_weight = sum(weights[i] for i in active)
        if total_weight <= 0:
            break
        scale = remaining / total_weight
        served = 0.0
        saturated: List[int] = []
        for i in active:
            want = eligible[i] - allocated[i]
            grant = min(want, weights[i] * scale)
            allocated[i] += grant
            served += grant
            if want - grant <= EPS:
                saturated.append(i)
        remaining = max(0.0, remaining - served)
        # Containers that hit their cap leave the pool so their unused share is
        # redistributed to the others on the next pass.
        active = [i for i in active if i not in saturated]
        if not saturated:
            break  # everyone still active received a proportional slice

    results: List[ContainerAllocation] = []
    for i, spec in enumerate(specs):
        unmet = max(0.0, spec.demand - allocated[i])
        throttle_pct = (unmet / spec.demand * 100.0) if spec.demand > EPS else 0.0
        results.append(
            ContainerAllocation(
                name=spec.name,
                demand=spec.demand,
                cap=spec.cap,
                weight=spec.weight,
                eligible=eligible[i],
                allocated=allocated[i],
                unmet=unmet,
                throttled=throttle_pct > 0.5,
                throttle_pct=throttle_pct,
                host_share_pct=(allocated[i] / capacity * 100.0) if capacity else 0.0,
            )
        )

    total_demand = sum(s.demand for s in specs)
    total_eligible = sum(eligible)
    total_allocated = sum(allocated)
    contention = total_eligible > capacity + EPS

    notes: List[str] = []
    if contention:
        notes.append(
            f"Eligible demand {total_eligible:.2f} vCPU exceeds host capacity "
            f"{capacity:.2f} vCPU - capacity is shared by relative weight."
        )
    else:
        notes.append(
            f"Eligible demand {total_eligible:.2f} vCPU fits inside "
            f"{capacity:.2f} vCPU - no contention."
        )
    capped = [c.name for c in results if c.demand > c.cap + EPS]
    if capped:
        notes.append(
            "CPU cap binds for " + ", ".join(capped) + " (demand is higher than the cap)."
        )
    if not contention and total_demand > total_eligible:
        notes.append("Host capacity is idle because caps bound total demand.")

    return AllocationResult(
        policy=policy,
        capacity=capacity,
        total_demand=total_demand,
        total_eligible=total_eligible,
        total_allocated=total_allocated,
        idle_capacity=max(0.0, capacity - total_allocated),
        utilisation_pct=(total_allocated / capacity * 100.0) if capacity else 0.0,
        contention=contention,
        overcommit_pct=(max(0.0, total_eligible - capacity) / capacity * 100.0) if capacity else 0.0,
        containers=results,
        notes=notes,
    )

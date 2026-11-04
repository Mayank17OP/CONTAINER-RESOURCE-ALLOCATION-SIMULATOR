"""Memory management: hard limits, pressure and simulated OOM events.

A hard limit is a *boundary*, not a weighted share: every container is checked
against its own limit independently, and every container keeps its own counter
so one workload's usage can never overwrite another's.

OOM is simulated as a state change only - no real process is signalled.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

from .models import ContainerSpec

#: Usage this far above the limit is reported as a simulated OOM kill.
OOM_EXCESS_RATIO = 0.25
#: Usage at or above this fraction of the limit is "near limit".
NEAR_LIMIT_RATIO = 0.90


@dataclass
class ContainerMemory:
    name: str
    usage: float
    limit: float
    utilisation_pct: float
    headroom: float
    excess: float
    status: str          # ok | near | pressure | oom
    event: str

    def to_dict(self) -> Dict[str, object]:
        return {
            "name": self.name,
            "usage": round(self.usage, 1),
            "limit": round(self.limit, 1),
            "utilisation_pct": round(self.utilisation_pct, 1),
            "headroom": round(self.headroom, 1),
            "excess": round(self.excess, 1),
            "status": self.status,
            "event": self.event,
        }


@dataclass
class MemoryResult:
    total_usage: float
    total_limit: float
    host_capacity: float
    host_usage_pct: float
    host_pressure: bool
    pressure_count: int
    oom_count: int
    near_count: int
    containers: List[ContainerMemory] = field(default_factory=list)
    events: List[str] = field(default_factory=list)

    def by_name(self) -> Dict[str, ContainerMemory]:
        return {c.name: c for c in self.containers}

    def to_dict(self) -> Dict[str, object]:
        return {
            "total_usage": round(self.total_usage, 1),
            "total_limit": round(self.total_limit, 1),
            "host_capacity": round(self.host_capacity, 1),
            "host_usage_pct": round(self.host_usage_pct, 2),
            "host_pressure": self.host_pressure,
            "pressure_count": self.pressure_count,
            "oom_count": self.oom_count,
            "near_count": self.near_count,
            "containers": [c.to_dict() for c in self.containers],
            "events": list(self.events),
        }


def evaluate_memory(specs: List[ContainerSpec], host_capacity: float) -> MemoryResult:
    """Compare each container's usage with its own hard limit."""
    rows: List[ContainerMemory] = []
    events: List[str] = []

    for spec in specs:
        limit = spec.mem_limit
        usage = spec.mem_usage
        ratio = usage / limit if limit else 0.0
        excess = max(0.0, usage - limit)

        if excess > 0 and reason_oom(ratio):
            status, event = "oom", f"OOM (simulated): {excess:.0f} MB above hard limit"
        elif excess > 0:
            status, event = "pressure", f"Memory pressure: {excess:.0f} MB above hard limit"
        elif ratio >= NEAR_LIMIT_RATIO:
            status, event = "near", f"Near limit: {limit - usage:.0f} MB headroom left"
        else:
            status, event = "ok", "Within hard limit"

        if status in ("pressure", "oom"):
            events.append(
                f"[{spec.name}] {event} ({usage:.0f} / {limit:.0f} MB, "
                f"{ratio * 100:.1f}% of limit)"
            )

        rows.append(
            ContainerMemory(
                name=spec.name,
                usage=usage,
                limit=limit,
                utilisation_pct=ratio * 100.0,
                headroom=limit - usage,
                excess=excess,
                status=status,
                event=event,
            )
        )

    total_usage = sum(s.mem_usage for s in specs)
    total_limit = sum(s.mem_limit for s in specs)

    return MemoryResult(
        total_usage=total_usage,
        total_limit=total_limit,
        host_capacity=host_capacity,
        host_usage_pct=(total_usage / host_capacity * 100.0) if host_capacity else 0.0,
        host_pressure=total_usage > host_capacity,
        pressure_count=sum(1 for r in rows if r.status == "pressure"),
        oom_count=sum(1 for r in rows if r.status == "oom"),
        near_count=sum(1 for r in rows if r.status == "near"),
        containers=rows,
        events=events,
    )


def reason_oom(ratio: float) -> bool:
    """Usage above limit + OOM_EXCESS_RATIO is treated as a simulated OOM."""
    return ratio > 1.0 + OOM_EXCESS_RATIO

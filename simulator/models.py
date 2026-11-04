"""Configuration models for the simulator.

The dataclasses in this module are deliberately plain Python: the simulation
core has no web dependency, so it can be unit-tested, imported from a script or
driven by the Flask API without changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List


class ConfigError(ValueError):
    """Raised when a configuration cannot be simulated."""


#: Hard safety rails so a typo in the UI cannot produce a nonsense run.
MAX_CPU = 128.0
MAX_MEMORY = 1024 * 1024  # MB
MAX_CONTAINERS = 24


def _number(raw: Any, label: str, *, minimum: float, maximum: float) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ConfigError(f"{label} must be a number.")
    if value != value or value in (float("inf"), float("-inf")):
        raise ConfigError(f"{label} must be a finite number.")
    if value < minimum or value > maximum:
        raise ConfigError(f"{label} must be between {minimum:g} and {maximum:g}.")
    return round(value, 4)


@dataclass
class HostSpec:
    """The shared machine that containers compete for."""

    cpu: float = 4.0          # vCPU capacity
    memory: float = 4096.0    # MB of RAM

    def validate(self) -> "HostSpec":
        self.cpu = _number(self.cpu, "Host CPU capacity", minimum=0.1, maximum=MAX_CPU)
        self.memory = _number(self.memory, "Host memory capacity", minimum=64, maximum=MAX_MEMORY)
        return self

    def to_dict(self) -> Dict[str, float]:
        return {"cpu": self.cpu, "memory": self.memory}


@dataclass
class ContainerSpec:
    """One workload sharing the host.

    demand    : CPU the workload would like to consume (vCPU)
    cap       : hard ceiling on CPU this container may receive (vCPU)
    weight    : relative share used when eligible demand exceeds capacity
    mem_usage : memory currently held by the container (MB)
    mem_limit : per-container hard memory boundary (MB)
    """

    name: str = "container"
    demand: float = 1.0
    cap: float = 1.0
    weight: int = 1
    mem_usage: float = 256.0
    mem_limit: float = 512.0

    def validate(self, index: int) -> "ContainerSpec":
        self.name = (str(self.name or "").strip() or f"ctr-{index + 1}")[:32]
        self.demand = _number(self.demand, f"{self.name}: CPU demand", minimum=0.0, maximum=MAX_CPU)
        self.cap = _number(self.cap, f"{self.name}: CPU cap", minimum=0.01, maximum=MAX_CPU)
        self.weight = int(_number(self.weight, f"{self.name}: weight", minimum=1, maximum=100))
        self.mem_usage = _number(self.mem_usage, f"{self.name}: memory usage", minimum=0.0, maximum=MAX_MEMORY)
        self.mem_limit = _number(self.mem_limit, f"{self.name}: memory limit", minimum=1.0, maximum=MAX_MEMORY)
        return self

    @property
    def eligible_demand(self) -> float:
        """e_i = min(d_i, q_i) - the most this container may actually receive."""
        return round(min(self.demand, self.cap), 4)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["eligible_demand"] = self.eligible_demand
        return data


@dataclass
class SimulationConfig:
    """Full input for one simulation run."""

    host: HostSpec = field(default_factory=HostSpec)
    containers: List[ContainerSpec] = field(default_factory=list)
    policy: str = "weighted"     # weighted | equal | priority
    profile: str = "normal"      # normal | contention | pressure | burst
    steps: int = 12              # time steps for a timed run
    seed: int = 7                # deterministic workload noise

    POLICIES = ("weighted", "equal", "priority")
    PROFILES = ("normal", "contention", "pressure", "burst")

    def validate(self) -> "SimulationConfig":
        if not isinstance(self.host, HostSpec):
            self.host = HostSpec(**dict(self.host))
        self.host.validate()

        if not isinstance(self.containers, list) or not self.containers:
            raise ConfigError("At least one container is required.")
        if len(self.containers) > MAX_CONTAINERS:
            raise ConfigError(f"At most {MAX_CONTAINERS} containers are supported.")

        parsed: List[ContainerSpec] = []
        names = set()
        for index, raw in enumerate(self.containers):
            spec = raw if isinstance(raw, ContainerSpec) else ContainerSpec(**dict(raw))
            spec.validate(index)
            if spec.name.lower() in names:
                raise ConfigError(f"Container name '{spec.name}' is used twice.")
            names.add(spec.name.lower())
            parsed.append(spec)
        self.containers = parsed

        self.policy = str(self.policy or "weighted").lower()
        if self.policy not in self.POLICIES:
            raise ConfigError(f"Unknown CPU policy '{self.policy}'.")

        self.profile = str(self.profile or "normal").lower()
        if self.profile not in self.PROFILES:
            raise ConfigError(f"Unknown workload profile '{self.profile}'.")

        self.steps = int(_number(self.steps, "Steps", minimum=1, maximum=120))
        self.seed = int(_number(self.seed, "Seed", minimum=0, maximum=1_000_000))
        return self

    def to_dict(self) -> Dict[str, Any]:
        return {
            "host": self.host.to_dict(),
            "containers": [c.to_dict() for c in self.containers],
            "policy": self.policy,
            "profile": self.profile,
            "steps": self.steps,
            "seed": self.seed,
        }

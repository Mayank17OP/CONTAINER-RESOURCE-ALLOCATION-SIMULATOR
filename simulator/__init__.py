"""Container Resource Allocation Simulator - core simulation package.

Modules
-------
models        : host / container configuration + validation
cpu_allocator : CPU caps and weighted fair-share allocation
memory_manager: per-container memory hard-limit checks
workload      : workload profile generator
engine        : the repeatable simulation cycle
scenarios     : ready-made scenarios used by the dashboard
"""

from .models import ContainerSpec, HostSpec, SimulationConfig, ConfigError
from .cpu_allocator import allocate_cpu, AllocationResult
from .memory_manager import evaluate_memory, MemoryResult
from .engine import SimulationEngine
from .scenarios import PRACTICAL_PRESETS
from .workload import WORKLOAD_PROFILES

__all__ = [
    "ContainerSpec",
    "HostSpec",
    "SimulationConfig",
    "ConfigError",
    "allocate_cpu",
    "AllocationResult",
    "evaluate_memory",
    "MemoryResult",
    "SimulationEngine",
    "PRACTICAL_PRESETS",
    "WORKLOAD_PROFILES",
]

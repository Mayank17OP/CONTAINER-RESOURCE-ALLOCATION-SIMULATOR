"""Ready-made demo scenarios.

`deck` is the exact worked example from the presentation (slide 6/12):
Web 2.4/2.0 w2, Database 2.5/2.0 w2, Worker 1.5/1.0 w1, host 4 vCPU / 4096 MB.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .models import ContainerSpec, HostSpec, SimulationConfig

PRACTICAL_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "deck",
        "label": "Deck example - CPU contention",
        "blurb": "The 4 vCPU / 3 container scenario from the presentation. Weighted sharing "
                 "yields 1.6 + 1.6 + 0.8 vCPU; Worker is over its memory limit.",
        "tag": "reference",
        "host": {"cpu": 4.0, "memory": 4096},
        "policy": "weighted",
        "profile": "contention",
        "steps": 10,
        "seed": 7,
        "containers": [
            {"name": "web", "demand": 2.4, "cap": 2.0, "weight": 2, "mem_usage": 700, "mem_limit": 1024},
            {"name": "database", "demand": 2.5, "cap": 2.0, "weight": 2, "mem_usage": 1800, "mem_limit": 2048},
            {"name": "worker", "demand": 1.5, "cap": 1.0, "weight": 1, "mem_usage": 1150, "mem_limit": 1024},
        ],
    },
    {
        "id": "balanced",
        "label": "Healthy host, no contention",
        "blurb": "Three modest services that fit comfortably inside the host. Everything reports normal.",
        "tag": "baseline",
        "host": {"cpu": 4.0, "memory": 4096},
        "policy": "weighted",
        "profile": "normal",
        "steps": 10,
        "seed": 3,
        "containers": [
            {"name": "web", "demand": 0.9, "cap": 1.5, "weight": 3, "mem_usage": 420, "mem_limit": 1024},
            {"name": "api", "demand": 1.1, "cap": 1.5, "weight": 2, "mem_usage": 610, "mem_limit": 1024},
            {"name": "cache", "demand": 0.6, "cap": 1.0, "weight": 1, "mem_usage": 780, "mem_limit": 1024},
        ],
    },
    {
        "id": "oom",
        "label": "Memory OOM event",
        "blurb": "A leaky batch job creeps past its hard limit far enough to trigger a simulated OOM kill.",
        "tag": "fault injection",
        "host": {"cpu": 4.0, "memory": 4096},
        "policy": "weighted",
        "profile": "pressure",
        "steps": 12,
        "seed": 11,
        "containers": [
            {"name": "web", "demand": 1.2, "cap": 1.5, "weight": 3, "mem_usage": 500, "mem_limit": 1024},
            {"name": "batch", "demand": 1.6, "cap": 1.5, "weight": 1, "mem_usage": 900, "mem_limit": 1024},
            {"name": "database", "demand": 1.4, "cap": 2.0, "weight": 2, "mem_usage": 1500, "mem_limit": 2048},
        ],
    },
    {
        "id": "burst",
        "label": "Traffic burst spike",
        "blurb": "A mid-run traffic spike pushes demand past capacity for one step, then recovers.",
        "tag": "transient",
        "host": {"cpu": 2.0, "memory": 2048},
        "policy": "weighted",
        "profile": "burst",
        "steps": 10,
        "seed": 5,
        "containers": [
            {"name": "gateway", "demand": 1.1, "cap": 1.4, "weight": 3, "mem_usage": 380, "mem_limit": 768},
            {"name": "service", "demand": 0.9, "cap": 1.2, "weight": 2, "mem_usage": 520, "mem_limit": 900},
            {"name": "telemetry", "demand": 0.4, "cap": 0.6, "weight": 1, "mem_usage": 210, "mem_limit": 512},
        ],
    },
    {
        "id": "noisy",
        "label": "Noisy neighbour isolation",
        "blurb": "One greedy container is capped hard so its neighbours keep their share - isolation in action.",
        "tag": "isolation",
        "host": {"cpu": 4.0, "memory": 4096},
        "policy": "weighted",
        "profile": "contention",
        "steps": 10,
        "seed": 9,
        "containers": [
            {"name": "noisy-job", "demand": 5.0, "cap": 0.5, "weight": 1, "mem_usage": 900, "mem_limit": 1024},
            {"name": "web", "demand": 1.2, "cap": 2.0, "weight": 4, "mem_usage": 600, "mem_limit": 1024},
            {"name": "database", "demand": 1.6, "cap": 2.0, "weight": 4, "mem_usage": 1600, "mem_limit": 2048},
        ],
    },
    {
        "id": "many",
        "label": "Ten-container fleet",
        "blurb": "A denser host: ten small services whose combined eligible demand overcommits the CPU.",
        "tag": "scale",
        "host": {"cpu": 8.0, "memory": 8192},
        "policy": "weighted",
        "profile": "contention",
        "steps": 10,
        "seed": 21,
        "containers": [
            {"name": f"svc-{i + 1:02d}", "demand": round(0.9 + (i % 4) * 0.35, 2),
             "cap": 1.5, "weight": 1 + (i % 3), "mem_usage": 300 + (i % 5) * 90,
             "mem_limit": 1024}
            for i in range(10)
        ],
    },
]


def preset_config(preset: Dict[str, Any]) -> SimulationConfig:
    return SimulationConfig(
        host=HostSpec(**preset["host"]),
        containers=[ContainerSpec(**c) for c in preset["containers"]],
        policy=preset.get("policy", "weighted"),
        profile=preset.get("profile", "normal"),
        steps=preset.get("steps", 10),
        seed=preset.get("seed", 7),
    )


def preset_by_id(preset_id: str) -> Dict[str, Any] | None:
    return next((p for p in PRACTICAL_PRESETS if p["id"] == preset_id), None)

"""Unit tests for the simulation core.

Run with:  python -m pytest -q
The suite focuses on the invariants the project claims to uphold:
  * 0 <= a_i <= e_i  and  sum(a_i) <= C   (allocation safety)
  * weighted proportions under contention
  * cap saturation releases unused share
  * memory limits are independent per container
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from simulator.cpu_allocator import allocate_cpu, EPS
from simulator.engine import SimulationEngine, simulate
from simulator.memory_manager import evaluate_memory
from simulator.models import ConfigError, ContainerSpec, HostSpec, SimulationConfig
from simulator.scenarios import PRACTICAL_PRESETS, preset_config
from simulator.workload import WORKLOAD_PROFILES


def deck_specs():
    return [
        ContainerSpec("web", 2.4, 2.0, 2, 700, 1024),
        ContainerSpec("database", 2.5, 2.0, 2, 1800, 2048),
        ContainerSpec("worker", 1.5, 1.0, 1, 1150, 1024),
    ]


# --------------------------------------------------------------------- CPU
def test_deck_example_matches_presentation():
    """Slide 9/12: Web 1.6 + Database 1.6 + Worker 0.8 = 4.0 vCPU."""
    result = allocate_cpu(deck_specs(), 4.0, "weighted")
    got = {c.name: round(c.allocated, 3) for c in result.containers}
    assert got == {"web": 1.6, "database": 1.6, "worker": 0.8}
    assert result.total_allocated == pytest.approx(4.0)
    assert result.contention is True
    assert result.overcommit_pct == pytest.approx(25.0)


def test_eligible_demand_is_min_of_demand_and_cap():
    specs = deck_specs()
    assert [s.eligible_demand for s in specs] == [2.0, 2.0, 1.0]


@pytest.mark.parametrize("policy", ["weighted", "equal", "priority"])
def test_allocation_invariants(policy):
    specs = deck_specs()
    result = allocate_cpu(specs, 4.0, policy)
    for row, spec in zip(result.containers, specs):
        assert row.allocated >= -EPS
        assert row.allocated <= min(spec.demand, spec.cap) + EPS
    assert result.total_allocated <= 4.0 + EPS


def test_no_contention_grants_eligible_and_leaves_idle_capacity():
    specs = [ContainerSpec("a", 1.0, 2.0, 1, 100, 200), ContainerSpec("b", 1.5, 2.0, 1, 100, 200)]
    result = allocate_cpu(specs, 4.0, "weighted")
    assert [c.allocated for c in result.containers] == pytest.approx([1.0, 1.5])
    assert result.idle_capacity == pytest.approx(1.5)
    assert result.contention is False


def test_capped_container_releases_share_to_others():
    """b is capped well below its weight share; a must absorb the remainder."""
    specs = [
        ContainerSpec("a", 4.0, 4.0, 1, 100, 200),
        ContainerSpec("b", 4.0, 0.5, 3, 100, 200),
    ]
    result = allocate_cpu(specs, 4.0, "weighted")
    by = result.by_name()
    assert by["b"].allocated == pytest.approx(0.5)
    assert by["a"].allocated == pytest.approx(3.5)
    assert result.total_allocated == pytest.approx(4.0)


def test_zero_demand_container_gets_nothing():
    specs = [ContainerSpec("idle", 0.0, 1.0, 5, 100, 200), ContainerSpec("busy", 2.0, 2.0, 1, 100, 200)]
    result = allocate_cpu(specs, 2.0, "weighted")
    assert result.by_name()["idle"].allocated == pytest.approx(0.0)
    assert result.by_name()["busy"].allocated == pytest.approx(2.0)


def test_equal_policy_ignores_weights():
    result = allocate_cpu(deck_specs(), 4.0, "equal")
    by = result.by_name()
    # equal weights, capacities 2/2/1 -> 1.5 / 1.5 / 1.0
    assert by["web"].allocated == pytest.approx(1.5)
    assert by["database"].allocated == pytest.approx(1.5)
    assert by["worker"].allocated == pytest.approx(1.0)


def test_priority_policy_favours_high_weight():
    result = allocate_cpu(deck_specs(), 4.0, "priority")
    by = result.by_name()
    assert by["worker"].allocated < by["web"].allocated


def test_throttle_percentage_is_unmet_fraction_of_demand():
    result = allocate_cpu(deck_specs(), 4.0, "weighted")
    web = result.by_name()["web"]
    assert web.unmet == pytest.approx(0.8)
    assert web.throttle_pct == pytest.approx(0.8 / 2.4 * 100)


# ------------------------------------------------------------------ memory
def test_worker_reports_memory_pressure_of_126_mb():
    result = evaluate_memory(deck_specs(), 4096)
    worker = result.by_name()["worker"]
    assert worker.status == "pressure"
    assert worker.excess == pytest.approx(126)
    assert result.pressure_count == 1
    assert result.oom_count == 0


def test_memory_counters_are_independent():
    """One container's usage never affects another's classification."""
    specs = [
        ContainerSpec("over", 1, 1, 1, 1100, 1024),   # 107% -> pressure, not OOM
        ContainerSpec("fine", 1, 1, 1, 100, 1024),
    ]
    result = evaluate_memory(specs, 8192)
    assert result.by_name()["over"].status == "pressure"
    assert result.by_name()["fine"].status == "ok"
    assert result.by_name()["fine"].excess == 0


def test_far_over_limit_becomes_simulated_oom():
    specs = [ContainerSpec("leak", 1, 1, 1, 2000, 1024)]
    result = evaluate_memory(specs, 8192)
    assert result.containers[0].status == "oom"
    assert result.oom_count == 1


def test_near_limit_threshold():
    specs = [ContainerSpec("tight", 1, 1, 1, 950, 1024)]
    assert evaluate_memory(specs, 4096).containers[0].status == "near"


def test_host_memory_pressure_flag():
    specs = [ContainerSpec("a", 1, 1, 1, 3000, 4096), ContainerSpec("b", 1, 1, 1, 2000, 4096)]
    result = evaluate_memory(specs, 4096)
    assert result.host_pressure is True


# ------------------------------------------------------------------ engine
def test_engine_produces_full_timeline():
    cfg = SimulationConfig(host=HostSpec(4.0, 4096), containers=deck_specs(), steps=8)
    out = SimulationEngine(cfg).run()
    assert out["steps"] == 9              # baseline + 8 generated steps
    assert len(out["timeline"]) == 9
    assert len(out["series"]["labels"]) == 9
    assert out["events"]
    assert out["summary"]["verdict"]["level"] in {"ok", "info", "warn", "critical"}


def test_engine_is_deterministic_for_a_seed():
    cfg = lambda: SimulationConfig(host=HostSpec(4.0, 4096), containers=deck_specs(), steps=6, seed=42)
    a = SimulationEngine(cfg()).run()
    b = SimulationEngine(cfg()).run()
    assert a["series"] == b["series"]


def test_every_timeline_frame_respects_capacity():
    cfg = SimulationConfig(host=HostSpec(2.0, 2048), containers=deck_specs(), steps=10, profile="burst")
    out = SimulationEngine(cfg).run()
    for frame in out["timeline"]:
        assert frame["cpu"]["allocated"] <= frame["cpu"]["capacity"] + EPS


@pytest.mark.parametrize("preset", PRACTICAL_PRESETS, ids=[p["id"] for p in PRACTICAL_PRESETS])
def test_all_presets_run_and_serialise(preset):
    out = simulate(preset_config(preset))
    assert out["timeline"]
    assert out["summary"]["verdict"]["title"]
    for frame in out["timeline"]:
        assert {"cpu", "memory", "containers"} <= set(frame)


@pytest.mark.parametrize("profile", list(WORKLOAD_PROFILES))
def test_every_profile_runs(profile):
    cfg = SimulationConfig(host=HostSpec(4.0, 4096), containers=deck_specs(), steps=5, profile=profile)
    assert simulate(cfg)["profile"]["key"] == profile


# ------------------------------------------------------------- validation
@pytest.mark.parametrize(
    "payload",
    [
        {"containers": []},
        {"containers": [{"name": "a", "demand": -1, "cap": 1, "weight": 1, "mem_usage": 1, "mem_limit": 2}]},
        {"containers": [{"name": "a", "demand": 1, "cap": 1, "weight": 1, "mem_usage": 1, "mem_limit": 2}] * 2},
        {"containers": [{"name": "a", "demand": "x", "cap": 1, "weight": 1, "mem_usage": 1, "mem_limit": 2}]},
    ],
)
def test_invalid_configs_raise(payload):
    with pytest.raises(ConfigError):
        SimulationConfig(
            host=HostSpec(4.0, 4096),
            containers=[ContainerSpec(**c) for c in payload.get("containers", [])],
        ).validate()


def test_unknown_policy_and_profile_rejected():
    with pytest.raises(ConfigError):
        SimulationConfig(containers=deck_specs(), policy="magic").validate()
    with pytest.raises(ConfigError):
        SimulationConfig(containers=deck_specs(), profile="magic").validate()


# ------------------------------------------------------------------- API
@pytest.fixture()
def client():
    from app import app

    app.config.update(TESTING=True)
    with app.test_client() as c:
        yield c


def test_api_health(client):
    assert client.get("/api/health").get_json()["status"] == "ok"


def test_api_presets(client):
    data = client.get("/api/presets").get_json()
    assert len(data["presets"]) >= 5
    assert {p["key"] for p in data["profiles"]} == {"normal", "contention", "pressure", "burst"}


def test_api_simulate_deck(client):
    payload = {
        "host": {"cpu": 4, "memory": 4096},
        "containers": [
            {"name": "web", "demand": 2.4, "cap": 2, "weight": 2, "mem_usage": 700, "mem_limit": 1024},
            {"name": "database", "demand": 2.5, "cap": 2, "weight": 2, "mem_usage": 1800, "mem_limit": 2048},
            {"name": "worker", "demand": 1.5, "cap": 1, "weight": 1, "mem_usage": 1150, "mem_limit": 1024},
        ],
        "policy": "weighted",
        "profile": "contention",
        "steps": 6,
    }
    res = client.post("/api/simulate", json=payload)
    assert res.status_code == 200
    body = res.get_json()
    allocs = {c["name"]: c["cpu_allocated"] for c in body["baseline"]["containers"]}
    assert allocs == {"web": 1.6, "database": 1.6, "worker": 0.8}


def test_api_rejects_bad_input(client):
    res = client.post("/api/simulate", json={"containers": []})
    assert res.status_code == 400
    assert "error" in res.get_json()


def test_api_compare_returns_three_policies(client):
    payload = {
        "host": {"cpu": 4, "memory": 4096},
        "containers": [
            {"name": "a", "demand": 2, "cap": 2, "weight": 2, "mem_usage": 100, "mem_limit": 512},
            {"name": "b", "demand": 2, "cap": 2, "weight": 1, "mem_usage": 100, "mem_limit": 512},
        ],
        "steps": 3,
    }
    body = client.post("/api/compare", json=payload).get_json()
    assert len(body["policies"]) == 3


def test_api_allocate_single_step(client):
    payload = {
        "host": {"cpu": 4, "memory": 4096},
        "containers": [
            {"name": "a", "demand": 3, "cap": 3, "weight": 1, "mem_usage": 100, "mem_limit": 512},
            {"name": "b", "demand": 3, "cap": 3, "weight": 1, "mem_usage": 100, "mem_limit": 512},
        ],
    }
    body = client.post("/api/allocate", json=payload).get_json()
    assert body["total_allocated"] == pytest.approx(4.0)

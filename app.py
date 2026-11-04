"""Flask API + static frontend host for the Container Resource Allocation Simulator."""

from __future__ import annotations

import os
from typing import Any, Dict

from flask import Flask, jsonify, request, send_from_directory

from simulator.cpu_allocator import allocate_cpu
from simulator.engine import compare_policies, simulate
from simulator.memory_manager import OOM_EXCESS_RATIO, NEAR_LIMIT_RATIO
from simulator.models import ConfigError, ContainerSpec, HostSpec, SimulationConfig
from simulator.scenarios import PRACTICAL_PRESETS, preset_by_id, preset_config
from simulator.workload import WORKLOAD_PROFILES

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
app.json.sort_keys = False


def _build_config(payload: Dict[str, Any]) -> SimulationConfig:
    host = payload.get("host") or {}
    return SimulationConfig(
        host=HostSpec(cpu=host.get("cpu", 4.0), memory=host.get("memory", 4096)),
        containers=[ContainerSpec(**c) for c in payload.get("containers", [])],
        policy=payload.get("policy", "weighted"),
        profile=payload.get("profile", "normal"),
        steps=payload.get("steps", 10),
        seed=payload.get("seed", 7),
    )


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "engine": "python", "version": "1.0.0"})


@app.get("/api/presets")
def presets():
    return jsonify(
        {
            "presets": PRACTICAL_PRESETS,
            "profiles": [
                {"key": p.key, "label": p.label, "description": p.description}
                for p in WORKLOAD_PROFILES.values()
            ],
            "policies": [
                {"key": "weighted", "label": "Weighted fair-share", "detail": "Share follows weight"},
                {"key": "equal", "label": "Equal share", "detail": "Every container weighted 1"},
                {"key": "priority", "label": "Strict priority", "detail": "Highest weight served first"},
            ],
            "thresholds": {"near_limit_ratio": NEAR_LIMIT_RATIO, "oom_excess_ratio": OOM_EXCESS_RATIO},
        }
    )


@app.post("/api/simulate")
def run_simulation():
    payload = request.get_json(silent=True) or {}
    try:
        result = simulate(_build_config(payload))
    except ConfigError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # defensive: never leak a stack trace to the UI
        return jsonify({"error": f"Simulation failed: {exc}"}), 500
    return jsonify(result)


@app.post("/api/allocate")
def allocate_once():
    """Single-shot CPU allocation - used by the live editor preview."""
    payload = request.get_json(silent=True) or {}
    try:
        cfg = _build_config(payload).validate()
        result = allocate_cpu(cfg.containers, cfg.host.cpu, cfg.policy)
    except ConfigError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result.to_dict())


@app.post("/api/compare")
def compare():
    payload = request.get_json(silent=True) or {}
    try:
        cfg = _build_config(payload).validate()
        result = compare_policies(cfg)
    except ConfigError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result)


@app.get("/api/preset/<preset_id>")
def get_preset(preset_id: str):
    preset = preset_by_id(preset_id)
    if not preset:
        return jsonify({"error": "Unknown preset"}), 404
    cfg = preset_config(preset).validate()
    return jsonify({"preset": preset, "config": cfg.to_dict()})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")

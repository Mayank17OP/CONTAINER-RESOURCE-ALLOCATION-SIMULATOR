"""Cross-language parity: the browser engine must match the Python model.

GitHub Pages serves the simulator without a backend, so `static/js/engine.js`
re-implements the Python core. This test guarantees the two agree, otherwise the
hosted demo would show different numbers from the lab's reference implementation.

Skipped automatically when Node.js is unavailable.
"""

import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "tests", "parity_check.mjs")

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")


def test_browser_engine_matches_python():
    result = subprocess.run(
        ["node", SCRIPT],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=180,
    )
    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert "PARITY OK" in output, output

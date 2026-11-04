#!/usr/bin/env python3
"""Build a fully static copy of the simulator for GitHub Pages.

GitHub Pages can only serve files — it cannot run Flask. The simulator therefore
ships a browser mirror of the Python model (static/js/engine.js), and this script
assembles both into a single self-contained directory that works from a sub-path
such as https://<user>.github.io/<repo>/.

Two outputs are produced so the site works with *either* Pages configuration:

1. `_site/` — self-contained bundle for the Actions-based Pages workflow.
2. Root-level `index.html`, `404.html`, `.nojekyll` — for GitHub Pages in
   "legacy" mode (Deploy from a branch -> main -> /), which serves the repo root
   directly and therefore needs an index.html there.

Both contain the identical app; only the asset paths differ.

Run:  python build_static.py
"""

from __future__ import annotations

import os
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
OUT = os.path.join(ROOT, "_site")

REQUIRED = [
    "index.html",
    "css/styles.css",
    "js/app.js",
    "js/charts.js",
    "js/engine.js",
    "js/client.js",
    "js/scenarios.js",
]

REDIRECT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Container Resource Allocation Simulator</title>
<meta http-equiv="refresh" content="0; url=./" />
<style>
  html,body{height:100%;margin:0;background:#080b14;color:#9aa8c7;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    display:grid;place-items:center;text-align:center}
  a{color:#5b8cff}
</style>
</head>
<body>
  <div>
    <p>Redirecting to the simulator…</p>
    <p><a href="./">Open Container Resource Allocation Simulator</a></p>
  </div>
</body>
</html>
"""


def check_sources() -> None:
    missing = [f for f in REQUIRED if not os.path.exists(os.path.join(STATIC, f))]
    if missing:
        sys.exit(f"ERROR: missing source files: {', '.join(missing)}")


def write_root_files(html: str) -> None:
    """Emit the repo-root entry points used by legacy GitHub Pages."""
    root_html = html.replace('href="./static/css/styles.css"', 'href="./static/css/styles.css"')
    with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(root_html)
    with open(os.path.join(ROOT, "404.html"), "w", encoding="utf-8") as fh:
        fh.write(REDIRECT)
    open(os.path.join(ROOT, ".nojekyll"), "w").close()


def build() -> None:
    check_sources()
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

    # static/ contents become the site root *and* stay reachable under ./static/
    for name in ("css", "js", "assets"):
        src = os.path.join(STATIC, name)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(OUT, name))

    with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as fh:
        html = fh.read()

    # rewrites for the sub-path hosting style used by GitHub Pages
    html = html.replace('href="./css/styles.css"', 'href="./static/css/styles.css"')
    html = html.replace('src="./js/app.js"', 'src="./static/js/app.js"')
    html = html.replace(
        '<title>Container Resource Allocation Simulator · OS Lab</title>',
        '<title>Container Resource Allocation Simulator · OS Lab</title>\n'
        '<meta name="robots" content="index,follow" />',
    )

    # note in the page source that this copy needs no backend
    html = html.replace(
        '<script type="module" src="./static/js/app.js"></script>',
        "<!-- Static build: no backend required. js/engine.js runs the identical\n"
        "     simulation model in the browser. Serve from any static host. -->\n"
        '<script type="module" src="./static/js/app.js"></script>',
    )

    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)

    # duplicate the app under /static/ so relative paths resolve no matter
    # which of the two URL shapes a visitor lands on
    os.makedirs(os.path.join(OUT, "static"), exist_ok=True)
    shutil.copyfile(os.path.join(OUT, "index.html"), os.path.join(OUT, "static", "index.html"))

    with open(os.path.join(OUT, "404.html"), "w", encoding="utf-8") as fh:
        fh.write(REDIRECT)

    open(os.path.join(OUT, ".nojekyll"), "w").close()

    # Root-level entry points for GitHub Pages "legacy" mode (branch -> main -> /)
    write_root_files(html)

    total = 0
    files = 0
    for base, _dirs, names in os.walk(OUT):
        for n in names:
            files += 1
            total += os.path.getsize(os.path.join(base, n))
    print(f"Built {OUT} + root index.html / 404.html / .nojekyll")
    print(f"  {files} files, {total / 1024:.1f} KiB")
    for base, _dirs, names in sorted(os.walk(OUT)):
        for n in sorted(names):
            rel = os.path.relpath(os.path.join(base, n), OUT)
            if rel.startswith("assets/"):
                continue
            print(f"  {rel}")


if __name__ == "__main__":
    build()

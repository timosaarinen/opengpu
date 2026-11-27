#!/usr/bin/env python3
"""Append published screenshots and render the static Card Maker gallery."""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime
from html import escape
import json
from pathlib import Path
import re
from tempfile import NamedTemporaryFile


GALLERY = Path(__file__).resolve().parents[1] / "docs" / "card-maker-platforms"
PLATFORMS = ("Windows", "macOS", "Web desktop", "Web mobile", "iPhone", "Android")
SCREENS = ("Editor", "Studio", "About", "Lite popup", "Export progress")
IMAGE_URL = re.compile(
    r"https://raw\.githubusercontent\.com/timosaarinen/opengpu/[0-9a-f]{40}"
    r"/internal/images/([a-z0-9_-]+/[a-z0-9_-]+-[0-9a-f]{16}\.png)"
)

PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>Card Maker Platforms</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f6fa;
      color: #172639;
      font: 1rem/1.5 system-ui, sans-serif;
    }
    main {
      width: min(76rem, 100%);
      margin: 0 auto;
      padding: clamp(1rem, 4vw, 3rem);
    }
    h1 {
      margin: 0 0 1.75rem;
      font: 600 clamp(2rem, 5vw, 3.5rem)/1.08 Georgia, serif;
      letter-spacing: -.025em;
    }
    details {
      margin-bottom: .85rem;
      background: #fff;
      border: 1px solid #cbd6e3;
      border-radius: .7rem;
    }
    summary {
      padding: .95rem clamp(.85rem, 3vw, 1.45rem);
      cursor: pointer;
      color: #213e59;
    }
    summary strong { margin-inline: .3rem .5rem; }
    .build-meta { color: #465970; font-size: .9rem; overflow-wrap: anywhere; }
    .build { padding: 0 clamp(.85rem, 3vw, 1.45rem) 1.45rem; }
    .platform {
      border-top: 1px solid #dbe3ed;
      padding-top: 1rem;
      margin-top: 1rem;
    }
    .platform:first-child { margin-top: 0; }
    h2 { margin: 0 0 .6rem; font-size: 1.2rem; }
    h3 { margin: .75rem 0 .45rem; color: #465970; font-size: .95rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
      gap: .9rem;
    }
    figure { min-width: 0; margin: 0; }
    .preview {
      display: grid;
      place-items: center;
      height: 15rem;
      padding: .55rem;
      border: 1px solid #dbe3ed;
      border-radius: .5rem;
      background: #edf2f7;
    }
    .preview:hover { border-color: #486783; }
    .preview img { display: block; width: auto; height: auto; max-width: 100%; max-height: 13.75rem; }
    figcaption { display: grid; gap: .12rem; padding: .45rem .15rem 0; overflow-wrap: anywhere; }
    .capture-meta { color: #465970; font-size: .875rem; }
    :focus-visible { outline: 3px solid #24608a; outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <h1>Card Maker Platforms</h1>
{builds}
  </main>
</body>
</html>
"""


def require_fields(value, required, optional=()):
    if not isinstance(value, dict):
        raise ValueError("Expected an object")
    keys = value.keys()
    if missing := set(required) - keys:
        raise ValueError(f"Missing fields: {', '.join(sorted(missing))}")
    if extra := keys - set(required) - set(optional):
        raise ValueError(f"Unknown fields: {', '.join(sorted(extra))}")


def positive_int(value):
    return type(value) is int and value > 0


def short_text(value, limit):
    return isinstance(value, str) and 0 < len(value) <= limit and value == value.strip() and value.isprintable()


def build_time(build):
    return datetime.fromisoformat(build["date"])


def read_captures(path):
    captures = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(captures, list):
        raise ValueError(f"{path}: expected a JSON array")
    for index, capture in enumerate(captures, start=1):
        try:
            validate_capture(capture)
        except (ValueError, TypeError) as error:
            raise ValueError(f"{path}, entry {index}: {error}") from error
    return captures


def validate_capture(capture):
    require_fields(
        capture, ("url", "platform", "screen", "width", "height", "date", "build"), ("device", "viewport")
    )
    if capture["platform"] not in PLATFORMS or capture["screen"] not in SCREENS:
        raise ValueError("Use a supported platform and screen")
    if not isinstance(capture["url"], str) or not IMAGE_URL.fullmatch(capture["url"]):
        raise ValueError("Expected an immutable PNG URL from publish-captures.py")
    if not all(positive_int(capture[key]) for key in ("width", "height")):
        raise ValueError("Image width and height must be positive pixel counts")
    if "viewport" in capture:
        viewport = capture["viewport"]
        if not isinstance(viewport, list) or len(viewport) != 2 or not all(map(positive_int, viewport)):
            raise ValueError("Viewport must contain a positive width and height")
    if "device" in capture and not short_text(capture["device"], 60):
        raise ValueError("Device must be a short name")
    if date.fromisoformat(capture["date"]).isoformat() != capture["date"]:
        raise ValueError("Capture date must use YYYY-MM-DD")
    build = capture["build"]
    require_fields(build, ("version", "number", "revision", "date"), ("label",))
    if not isinstance(build["version"], str) or not re.fullmatch(r"\d+\.\d+\.\d+", build["version"]):
        raise ValueError("Version must use major.minor.patch")
    if not positive_int(build["number"]):
        raise ValueError("Build number must be a positive integer")
    if not isinstance(build["revision"], str) or not re.fullmatch(r"[0-9a-f]{7,12}", build["revision"]):
        raise ValueError("Revision must be a short Git commit")
    if build_time(build).utcoffset() is None:
        raise ValueError("Build date must include a time and UTC offset")
    if "label" in build and not short_text(build["label"], 32):
        raise ValueError("Build label must be a short name")


def merge_captures(existing, additions):
    captures = {}
    for capture in [*existing, *additions]:
        # A later publisher run can link the same immutable file at a newer commit.
        asset = IMAGE_URL.fullmatch(capture["url"])[1]
        if asset in captures:
            previous = captures[asset]
            if previous | {"url": capture["url"]} != capture:
                raise ValueError(f"Conflicting metadata for {asset}")
        else:
            captures[asset] = capture
    return list(captures.values())


def group_builds(captures):
    builds = {}
    grouped = defaultdict(list)
    for capture in captures:
        build = capture["build"]
        key = (build["version"], build["number"], build["revision"], build.get("label", ""))
        if builds.setdefault(key, build) != build:
            raise ValueError(f"Conflicting build dates for {build['revision']}")
        grouped[key].append(capture)
    newest_first = sorted(builds, key=lambda key: (build_time(builds[key]), key), reverse=True)
    return [(builds[key], grouped[key]) for key in newest_first]


def render_capture(capture):
    width, height = capture["width"], capture["height"]
    view_width, view_height = capture.get("viewport", (width, height))
    orientation = ("Square" if view_width == view_height else
                   "Portrait" if view_width < view_height else "Landscape")
    surface = escape(capture.get("device", f"{view_width} × {view_height}"))
    platform = escape(capture["platform"])
    screen = escape(capture["screen"])
    build = capture["build"]
    build_label = f" ({escape(build['label'])})" if "label" in build else ""
    capture_date = capture["date"]
    url = capture["url"]
    return f"""              <figure>
                <a class="preview" href="{url}" target="_blank" rel="noopener"
                   aria-label="Open {platform} {screen} capture at full size, {surface}, {orientation}">
                  <img src="{url}" width="{width}" height="{height}" loading="lazy" decoding="async" alt="">
                </a>
                <figcaption>
                  <strong>{platform} · {surface}</strong>
                  <span class="capture-meta">{orientation} · {build['version']} · Build {build['number']}{build_label} · <time datetime="{capture_date}">{capture_date}</time></span>
                </figcaption>
              </figure>"""


def render_build(build, captures, opened):
    groups = defaultdict(list)
    for capture in captures:
        groups[capture["platform"], capture["screen"]].append(capture)
    label = escape(build.get("label", f"Build {build['number']}"))
    build_date = build_time(build).date().isoformat()
    build_number = f" · Build {build['number']}" if "label" in build else ""
    open_attr = " open" if opened else ""
    sections = [
        f'    <details{open_attr}>',
        f'      <summary><strong>{label}</strong> <span class="build-meta">{build["version"]}{build_number} · {build["revision"]} · <time datetime="{build_date}">{build_date}</time></span></summary>',
        '      <div class="build">',
    ]
    for platform in PLATFORMS:
        screens = [screen for screen in SCREENS if (platform, screen) in groups]
        if not screens:
            continue
        sections.extend(['        <section class="platform">', f"          <h2>{platform}</h2>"])
        for screen in screens:
            sections.extend([f"            <h3>{screen}</h3>", '            <div class="grid">'])
            sections.extend(render_capture(capture) for capture in groups[platform, screen])
            sections.append("            </div>")
        sections.append("        </section>")
    sections.extend(["      </div>", "    </details>"])
    return "\n".join(sections)


def write_if_changed(path, content):
    data = content.encode("utf-8")
    if path.exists() and path.read_bytes() == data:
        return
    with NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
    try:
        temporary.write_bytes(data)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--append", type=Path, action="append", metavar="FILE", help="JSON array of new captures")
    mode.add_argument("--check", action="store_true", help="Check whether the gallery is up to date")
    args = parser.parse_args()
    manifest = GALLERY / "captures.json"
    page = GALLERY / "index.html"
    try:
        existing = read_captures(manifest) if manifest.exists() else []
        additions = [item for path in args.append or [] for item in read_captures(path)]
        captures = merge_captures(existing, additions)
        builds = group_builds(captures)
        sections = [render_build(build, items, index == 0) for index, (build, items) in enumerate(builds)]
        html = PAGE.replace("{builds}", "\n".join(sections))
        data = json.dumps(captures, ensure_ascii=False, indent=2) + "\n"
        if args.check:
            if manifest.read_text(encoding="utf-8") != data or page.read_text(encoding="utf-8") != html:
                raise ValueError("Gallery is out of date. Run this command without --check to regenerate it.")
        else:
            GALLERY.mkdir(parents=True, exist_ok=True)
            write_if_changed(manifest, data)
            write_if_changed(page, html)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print(f"{len(captures)} captures in {len(builds)} builds")


if __name__ == "__main__":
    main()

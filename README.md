# opengpu

Public documentation and discussion for the **Open Finnish GPU initiative** and
the **ValoX path tracing / ML inference API**.

Website: **https://timosaarinen.github.io/opengpu/**

Early research and development; the website describes goals, not a finished
hardware product or a stable API.

## Website

The site is plain HTML and CSS in `docs/index.html`, with no build dependencies.
GitHub Pages publishes `docs/` from `main` automatically after a push.

To preview locally, run `python -m http.server 8000 --directory docs` and open
http://localhost:8000/.

Use this repository's issues for ideas and discussion.

## Capture links for issue comments

Use [tools/publish-captures.py](tools/publish-captures.py) to publish selected
screenshots/short captures under `internal/images/` and obtain immutable public
image links, optionally posting them to an issue in one command. See the
[capture workflow](internal/images/README.md). The tool uses an isolated worktree
and needs no separate image-hosting service.

The background is a curated ValoX forest render: a looping camera flight over
moonlit water and volumetric mist. It is an offline-rendered video, not an
interactive browser renderer. The page offers a pause button and uses a still
image by default when reduced motion or data saving is requested.

## Tuonela browser demo

`docs/tuonela/` is a minified release build of the Tuonela Walk browser demo
(https://timosaarinen.github.io/opengpu/tuonela/), produced by the Tuonela Walk
release packager and copied here unchanged. Do not edit it by hand. Its service worker supplies the cross-origin isolation that
the threaded WebAssembly needs, because GitHub Pages cannot send those headers.

The current release candidate requires WebGPU. It includes experimental learned
ESPCN reconstruction and motion-guided frame interpolation; it is not NVIDIA DLSS
or AMD FSR. Model provenance and the Apache-2.0 license ship under
`docs/tuonela/models/`. `docs/tuonela/release.json` identifies the exact app and
shared-library revisions. Quality and performance are still under evaluation.

## 3D Christmas Card Maker 2026

Try the [free early-access browser demo](https://timosaarinen.github.io/opengpu/christmas-card-maker/). Snowman generates the static bundle in `docs/christmas-card-maker/`. Its release manifest records the source revisions and file hashes.

## Card Maker platform captures

Publish screenshots with [publish-captures.py](tools/publish-captures.py), then
save the new entries as a JSON array in a local file such as `new-captures.json`.
From the repository root, append the entries and regenerate the static gallery
with Python 3.10 or later:

```sh
python tools/generate-capture-gallery.py --append new-captures.json
```

On macOS, use `python3` if that is your Python command. Use the immutable PNG
URL printed by the publisher in each entry:

```json
[
  {
    "url": "https://raw.githubusercontent.com/timosaarinen/opengpu/21e8a5f4e24e6455200d04d9a9896c288ac0a030/internal/images/snowman-mac-rc2-about/about-first-8decdafe2b89e987.png",
    "platform": "macOS",
    "screen": "About",
    "width": 960,
    "height": 540,
    "device": "MacBook Pro 16-inch",
    "date": "2026-11-27",
    "build": {
      "version": "1.0.0",
      "number": 2,
      "revision": "38128c5",
      "date": "2026-11-26T22:02:58+02:00",
      "label": "RC2 QA"
    }
  }
]
```

Use the source image's pixel dimensions for `width` and `height`. Set
`viewport` to `[width, height]` when screen units differ from image pixels,
for example `[390, 844]` for a 2× phone viewport. `device` and `build.label`
are optional. Use the same build metadata across captures of the same build.
Platform names are Windows, macOS, Web desktop, Web mobile, iPhone, and Android.
Screen names are Editor, Studio, About, Lite popup, and Export progress.

Commit `docs/card-maker-platforms/captures.json` and `index.html` together.
The command is safe to rerun with the same input. Run it without `--append`
to regenerate the HTML, or with `--check` to verify the generated files.

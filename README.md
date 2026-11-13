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

The background is a curated ValoX forest render: a looping camera flight over
moonlit water and volumetric mist. It is an offline-rendered video, not an
interactive browser renderer. The page offers a pause button and uses a still
image by default when reduced motion or data saving is requested.

## Tuonela browser demo

`docs/tuonela/` is a minified release build of the Tuonela Walk browser demo
(https://timosaarinen.github.io/opengpu/tuonela/), produced by the Tuonela Walk
release packager and copied here unchanged. Do not edit it by hand. Its service worker supplies the cross-origin isolation that
the threaded WebAssembly needs, because GitHub Pages cannot send those headers.

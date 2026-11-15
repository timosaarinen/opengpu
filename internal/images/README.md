# Issue captures

Public screenshots and short captures for issue discussions. Keep existing asset
paths stable: comments may embed them for years. Uploads use content hashes in
filenames and immutable GitHub raw URLs.

From any directory, publish selected files with:

```sh
python /path/to/opengpu/tools/publish-captures.py --group forest-review \
  --title "Forest enhancement: current views" \
  --issue owner/project#123 \
  --asset "Night overlook" /path/to/overlook.bmp \
  --asset "Short pan" /path/to/pan.mp4
```

Omit `--issue` to print Markdown for pasting yourself. Plain file arguments also
work; their filenames supply the captions. `--dry-run` validates and normalizes
the inputs without Git/network writes. Still images use Pillow (`python -m pip
install Pillow`); Git is required, and posting needs an authenticated `gh`.

The tool fetches main, creates an isolated temporary worktree, commits/pushes
the selected captures by fast-forward, verifies the public URLs, and optionally
posts the Markdown. Repeating the same upload reuses existing content; repeating
the same issue request returns the existing comment. Other worktrees stay intact.
BMP/PNG/JPEG/WebP become PNG with pixels preserved and source metadata removed;
GIF, MP4 and WebM retain their animation. Each file is limited to 50 MiB.

GitHub raw URLs render directly in issue comments as soon as the push is visible,
so they require no separate hosting service or Pages deployment wait. These
assets live outside the website's `docs/` publishing root.

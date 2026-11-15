#!/usr/bin/env python3
"""Publish selected captures and print/post immutable image links for issue comments."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request


def run(args, cwd, check=True):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="Never",
               GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15")
    return subprocess.run(args, cwd=cwd, env=env, check=check, capture_output=True,
                          text=True, encoding="utf-8", timeout=120,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


def git(repo, *args, check=True):
    return run(["git", *args], repo, check).stdout.strip()


def slug(value):
    result = re.sub(r"[^a-z0-9_-]+", "-", value.lower()).strip("-_")[:72]
    if not result:
        raise ValueError("A name must contain letters or numbers")
    return result


def asset(path, label=None):
    path = Path(path).resolve(strict=True)
    if not path.is_file() or path.stat().st_size > 50 * 1024 * 1024:
        raise ValueError(f"Capture must be a file no larger than 50 MiB: {path.name}")
    ext = path.suffix.lower()
    if ext in (".mp4", ".webm", ".gif"):
        data = path.read_bytes()
        valid = ((ext == ".mp4" and data[4:8] == b"ftyp") or
                 (ext == ".webm" and data[:4] == b"\x1aE\xdf\xa3") or
                 (ext == ".gif" and data[:6] in (b"GIF87a", b"GIF89a")))
        if not valid:
            raise ValueError(f"Invalid capture format: {path.name}")
    elif ext in (".bmp", ".png", ".jpg", ".jpeg", ".webp"):
        try:
            from PIL import Image
        except ImportError as error:
            raise RuntimeError("Install Pillow: python -m pip install Pillow") from error
        with Image.open(path) as source:
            if getattr(source, "is_animated", False):
                raise ValueError("Use GIF/WebM/MP4 for an animated capture")
            image = source.convert("RGBA" if "A" in source.getbands() else "RGB")
            image.info.clear()  # publish pixels, without source metadata
            output = io.BytesIO()
            image.save(output, format="PNG")
            data, ext = output.getvalue(), ".png"
    else:
        raise ValueError(f"Expected a browser-viewable capture, got {path.name}")
    digest = hashlib.sha256(data).hexdigest()
    return {"name": f"{slug(path.stem)}-{digest[:16]}{ext}", "data": data,
            "sha256": digest, "label": label or path.stem.replace("-", " ").replace("_", " "),
            "video": ext in (".mp4", ".webm")}


def markdown(assets, repository, commit, group, title):
    fingerprint = hashlib.sha256(json.dumps(
        [group, title, [(a["sha256"], a["label"]) for a in assets]],
        ensure_ascii=True).encode()).hexdigest()[:24]
    lines = [f"<!-- opengpu-captures:{fingerprint} -->", title, ""]
    for item in assets:
        url = f"https://raw.githubusercontent.com/{repository}/{commit}/internal/images/{group}/{item['name']}"
        item["url"] = url
        label = item["label"].replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
        lines += [f"{'!' if not item['video'] else ''}[{label}]({url})", ""]
    return "\n".join(lines), fingerprint


def publish(repo, assets, group):
    remote = git(repo, "remote", "get-url", "origin")
    match = re.fullmatch(r"(?:git@github\.com:|https://github\.com/)([\w.-]+/[\w.-]+?)(?:\.git)?", remote)
    if not match:
        raise ValueError("origin must be an SSH/HTTPS GitHub repository")
    repository = match.group(1)
    git(repo, "fetch", "origin", "main")
    root = Path(tempfile.mkdtemp(prefix="opengpu-captures-")).resolve()
    work = root / "worktree"
    added = False
    try:
        git(repo, "worktree", "add", "--detach", str(work), "origin/main")
        added = True
        directory = work / "internal" / "images" / group
        directory.mkdir(parents=True, exist_ok=True)
        for item in assets:
            target = directory / item["name"]
            if target.exists() and target.read_bytes() != item["data"]:
                raise RuntimeError("A content-addressed capture already has different bytes")
            target.write_bytes(item["data"])
        relative = f"internal/images/{group}"
        git(work, "add", "--", relative)
        if git(work, "diff", "--cached", "--name-only"):
            git(work, "-c", "commit.gpgSign=false", "commit", "-m", f"Publish {group} captures")
            for attempt in range(3):
                result = run(["git", "push", "origin", "HEAD:main"], work, check=False)
                if result.returncode == 0:
                    break
                if attempt == 2:
                    raise RuntimeError(result.stderr)
                git(work, "fetch", "origin", "main")
                git(work, "rebase", "origin/main")  # only our unpublished capture commit
        return repository, git(work, "rev-parse", "HEAD")
    finally:
        # Remove only this tool's verified temporary worktree/directory.
        if added and work.resolve().parent == root:
            git(repo, "worktree", "remove", "--force", str(work))
        if root.parent == Path(tempfile.gettempdir()).resolve() and root.name.startswith("opengpu-captures-"):
            shutil.rmtree(root)


def verify(assets):
    for item in assets:
        for attempt in range(6):
            try:
                request = urllib.request.Request(item["url"], method="HEAD")
                with urllib.request.urlopen(request, timeout=15) as response:
                    if response.status == 200:
                        break
            except OSError:
                if attempt == 5:
                    raise RuntimeError(f"Pushed, but public URL is not ready; rerun: {item['url']}")
                time.sleep(2)


def comment(repo, issue, body, fingerprint):
    match = re.fullmatch(r"([\w.-]+/[\w.-]+)#([1-9][0-9]*)", issue)
    if not match:
        raise ValueError("--issue must be owner/repository#number")
    repository, number = match.groups()
    pages = json.loads(run(["gh", "api", f"repos/{repository}/issues/{number}/comments",
                           "--paginate", "--slurp"], repo).stdout)
    marker = f"<!-- opengpu-captures:{fingerprint} -->"
    for page in pages:
        for row in page:
            if marker in row.get("body", ""):
                return row["html_url"]
    handle, name = tempfile.mkstemp(prefix="capture-comment-", suffix=".md")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as file:
            file.write(body)
        return run(["gh", "issue", "comment", number, "--repo", repository,
                    "--body-file", name], repo).stdout.strip()
    finally:
        Path(name).unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--asset", action="append", nargs=2, metavar=("LABEL", "FILE"), default=[])
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--group", required=True, help="Stable capture group, e.g. forest-review")
    parser.add_argument("--title", default="Visual review captures")
    parser.add_argument("--issue", help="Post once to owner/repository#number (requires gh)")
    parser.add_argument("--dry-run", action="store_true", help="Validate/normalize files without Git/network writes")
    args = parser.parse_args()
    if not args.files and not args.asset:
        parser.error("Select at least one capture")
    if args.issue and not re.fullmatch(r"[\w.-]+/[\w.-]+#[1-9][0-9]*", args.issue):
        parser.error("--issue must be owner/repository#number")
    group = slug(args.group)
    assets = [asset(path) for path in args.files] + [asset(path, label) for label, path in args.asset]
    if args.dry_run:
        print(json.dumps([{k: v for k, v in a.items() if k != "data"} for a in assets], indent=2))
        return
    repo = Path(git(args.repo.resolve(), "rev-parse", "--show-toplevel"))
    repository, commit = publish(repo, assets, group)
    body, fingerprint = markdown(assets, repository, commit, group, args.title)
    verify(assets)
    print(body)
    if args.issue:
        print("Issue comment:", comment(repo, args.issue, body, fingerprint))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Prepare an offline frozen replay; never write measured files or call remote APIs."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shlex
import shutil
import subprocess
import tarfile
import tempfile

ARCHIVE_SHA256 = "618bda63013ae64b3b076c45c0177b4032dfb9a05f82486568b2dc743352030e"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--workspace", required=True, type=Path, help="Workspace with pinned dependencies already installed")
args = parser.parse_args()
workspace = args.workspace.resolve()
here = Path(__file__).resolve().parent

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read_json(path):
    return json.loads(path.read_text())

def unpack(path, destination):
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        assert len(members) < 500, "Unexpected archive file count"
        assert sum(member.size for member in members) < 32 * 1024 * 1024, "Unexpected archive size"
        for member in members:
            name = PurePosixPath(member.name)
            assert not name.is_absolute() and ".." not in name.parts, "Unsafe archive path"
            assert member.isfile() or member.isdir(), "Links and special files are refused"
            target = destination.joinpath(*name.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)

def verify(root, entries):
    for entry in entries:
        assert digest(root / entry["path"]) == entry["sha256"], f"Hash mismatch: {entry['path']}"
    return len(entries)

archive = here / "frozen-harness.tar.gz"
assert digest(archive) == ARCHIVE_SHA256, "Frozen harness archive changed"
root_package = read_json(workspace / "package.json")
web_package = read_json(workspace / "apps/web/package.json")
assert root_package["engines"]["node"] == "24.18.0", "Workspace Node pin changed"
assert subprocess.check_output(["node", "--version"], text=True).strip() == "v24.18.0", "Use pinned Node 24.18.0"
assert web_package["devDependencies"]["miniflare"] == "5.20260921.0-alpha", "Miniflare pin changed"
assert read_json(workspace / "apps/web/node_modules/miniflare/package.json")["version"] == "5.20260921.0-alpha", "Installed Miniflare differs"
replay = Path(tempfile.mkdtemp(prefix="ariviso-e03-replay-"))
harness = replay / "tooling/evidence/state-recovery"
harness.mkdir(parents=True)
unpack(archive, harness)
checks = {}
checks["evidence"] = verify(harness, read_json(harness / "results/evidence-manifest.json")["files"])
checks["supplementary"] = verify(harness, read_json(harness / "results/supplementary-source-hashes.json"))
unpack(harness / "frozen-source.tar.gz", replay)
source = read_json(harness / "source-manifest.json")
checks["source"] = verify(replay, source["sourceFiles"])
bundle = gzip.decompress((harness / "recorded-worker.js.gz").read_bytes())
assert bundle == (harness / "dist/worker.js").read_bytes(), "Recorded bundle differs"
checks["build"] = verify(harness, read_json(harness / "results/build-manifest.json")["files"])
checks["fixture"] = verify(harness, read_json(harness / "fixture-manifest.json")["files"])
# Keep the write-once controller output available under a different replay-only path.
recorded = harness / "recorded"
recorded.mkdir()
shutil.move(harness / "results/local-github-controller.json", recorded / "local-github-controller.json")
for relative in ["package.json", "apps/web/package.json"]:
    target = replay / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(workspace / relative, target)
for relative in ["node_modules", "apps/web/node_modules"]:
    target = replay / relative
    os.symlink(workspace / relative, target, target_is_directory=True)
receipt = {"mode": "offline-frozen-replay-preparation", "sourceTree": source["sourceTree"], "harnessArchiveSha256": ARCHIVE_SHA256, "verifiedFiles": checks, "replayWorkspace": str(replay), "originalResultsModified": False, "networkRequests": 0}
(replay / "replay-preparation.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
print("\nRun the local suites; all result writes stay in this temporary copy:")
print("cd " + shlex.quote(str(harness)))
print("node run-local.mjs")
print("node --experimental-transform-types run-github-local-state.mjs")

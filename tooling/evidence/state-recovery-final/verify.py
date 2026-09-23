#!/usr/bin/env python3
"""Verify the preserved final-source E03 harness and hosted receipts offline."""

import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

HERE = Path(__file__).resolve().parent
SOURCE_TREE = "a953a2b42eb293088ba895484861756610de4f40"
WORKER_VERSION = "89e1c8de-6084-4e81-986a-d729f250b5f4"
HARNESS = "tooling/evidence/state-recovery-final/"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads((HERE / path).read_text())


artifacts = read_json("artifact-manifest.json")
for entry in artifacts["files"]:
    assert digest((HERE / entry["path"]).read_bytes()) == entry["sha256"], entry["path"]

source = read_json("source-manifest.json")
fixture = read_json("fixture-manifest.json")
build = read_json("results/build-manifest.json")
deployment = read_json("results/deployment.json")
report = read_json("results/final-hosted-report.json")
summary = read_json("results/summary.json")
receipts = read_json("results/final-receipt-readback.json")
r2 = read_json("results/final-r2-readback.json")
assert source["sourceTree"] == SOURCE_TREE
assert deployment["sourceTree"] == SOURCE_TREE
assert deployment["versionId"] == WORKER_VERSION
assert report["passed"] and report["sourceTree"] == SOURCE_TREE
assert report["deployment"]["id"] == WORKER_VERSION
assert report["fixtureDigest"] == fixture["digest"]
assert len(report["scenarios"]) == 7
assert all(item["passed"] for item in report["scenarios"])
assert receipts[0]["results"] == []
assert len(receipts[1]["results"]) == 7
assert all(row["passed"] == 1 and row["source_tree"] == SOURCE_TREE
           and row["worker_version"] == WORKER_VERSION for row in receipts[1]["results"])
assert len(r2["verifiedObjects"]) == 35 and r2["verifiedBytes"] == 2450
assert r2["gcFirstReadRefused"]

assertions = sum(len(item["assertions"]) + item["result"].get("assertionCount", 0)
                 for item in report["scenarios"])
assert assertions == summary["assertionCount"] == 147
assert sum(item["d1"]["attemptedStatements"] for item in report["scenarios"]) == 3744

with tarfile.open(HERE / "final-harness.tar.gz", "r:gz") as archive:
    files = {}
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        assert not path.is_absolute() and ".." not in path.parts
        assert member.isfile()
        assert member.name not in files
        files[member.name] = archive.extractfile(member).read()

for entry in source["sourceFiles"]:
    assert digest(files[entry["path"]]) == entry["sha256"], entry["path"]
for entry in fixture["files"]:
    path = HARNESS + entry["path"]
    assert digest(files[path]) == entry["sha256"], path
for entry in build["files"]:
    path = HARNESS + entry["path"]
    assert digest(files[path]) == entry["sha256"], path
assert deployment["bundleSha256"] == digest(files[HARNESS + "dist/worker.js"])
assert len(files) == len(source["sourceFiles"]) + 18

print(json.dumps({
    "passed": True,
    "sourceTree": SOURCE_TREE,
    "workerVersion": WORKER_VERSION,
    "sourceFiles": len(source["sourceFiles"]),
    "scenarios": len(report["scenarios"]),
    "assertions": assertions,
    "d1ForeignKeyErrors": len(receipts[0]["results"]),
    "r2ObjectsReadBack": len(r2["verifiedObjects"]),
}, indent=2))

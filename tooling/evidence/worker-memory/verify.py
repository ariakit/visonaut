#!/usr/bin/env python3
"""Unpack frozen memory receipts and verify their arithmetic without a runtime run."""

import argparse
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import tarfile


ARCHIVE_SHA256 = "6e95b8bdc4190740061c56ecb79cacdef0aa99a00f1de31a04d451fff27ffa9c"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_name(name):
    relative = PurePosixPath(name)
    require(
        relative.parts
        and not relative.is_absolute()
        and ".." not in relative.parts
        and "\\" not in name
        and "\0" not in name
        and relative.as_posix() == name,
        "Unsafe archive path",
    )
    return relative.parts


def read_archive(path):
    data = path.read_bytes()
    require(digest(data) == ARCHIVE_SHA256, "Frozen evidence archive changed")
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        members = archive.getmembers()
        require(len(members) == 15, "Unexpected archive file count")
        require(sum(member.size for member in members) == 372351, "Unexpected archive size")
        for member in members:
            checked_name(member.name)
            require(member.isfile(), "Links and special archive entries are refused")
            require(member.name not in files, "Duplicate archive path")
            with archive.extractfile(member) as source:
                files[member.name] = source.read()
            require(len(files[member.name]) == member.size, "Truncated archive file")
    process_hashes = dict(
        (line.split("  ", 1)[1], line.split("  ", 1)[0])
        for line in files["process/MANIFEST.sha256"].decode().splitlines()
    )
    inspector_hashes = json.loads(files["inspector/hashes.json"])
    for name, data in files.items():
        if name in ("process/MANIFEST.sha256", "inspector/hashes.json"):
            continue
        group, original = name.split("/", 1)
        hashes = process_hashes if group == "process" else inspector_hashes
        require(digest(data) == hashes[original], "Original file hash differs: " + name)
    return files


def check_receipts(files):
    load = lambda name: json.loads(files[name])
    raw = load("process/http-measurements.json")
    summary = load("process/http-summary.json")
    fixtures = {item["name"]: item for item in load("process/source-manifest.json")["fixtures"]}
    require(len(raw["results"]) == 18 and len(summary) == 6, "Unexpected process or summary count")
    require(
        sum(len(item["samples"]) for item in raw["results"]) == 234,
        "Unexpected response count",
    )
    for row in summary:
        selected = [item for item in raw["results"] if item["case"] == row["case"]]
        require(len(selected) == row["processes"] == 3, "Unexpected repetitions")
        require([item["repeat"] for item in selected] == [0, 1, 2], "Invalid repetition indices")
        require(
            sum(len(item["samples"]) for item in selected) == row["responses"],
            "Response count differs",
        )
        for prefix, function in (("max", max), ("min", min)):
            require(
                function(item["peakRssBytes"] for item in selected)
                == row[prefix + "ProcessPeakRssBytes"],
                "RSS summary differs",
            )
            cpu = function(item["totalCpuSeconds"] for item in selected) * 1000
            require(
                math.isclose(cpu, row[prefix + "LifetimeCpuMilliseconds"], rel_tol=1e-12),
                "CPU summary differs",
            )
        require(
            max(sample["wasmMemoryBytes"] for item in selected for sample in item["samples"])
            == row["maxFinalWasmCapacityBytes"],
            "WASM capacity summary differs",
        )
        name, count = row["case"].rsplit("-", 1)
        fixture = fixtures[name]
        require(row["allPassed"], "Summary reports a failed case")
        for item in selected:
            require(item["exitCode"] == 0 and item["error"] is None, "Recorded process failed")
            require(len(item["samples"]) == int(count), "Recorded request count differs")
            require(
                math.isclose(
                    item["totalCpuSeconds"],
                    item["userCpuSeconds"] + item["systemCpuSeconds"],
                    rel_tol=1e-12,
                ),
                "CPU components differ",
            )
            for sample in item["samples"]:
                require(sample["originalDigest"] == fixture["sha256"], "Original digest differs")
                require(sample["rgbaDigest"] == fixture["decodedSha256"], "Pixel digest differs")
                require(
                    sample["outcome"] == "unchanged" and sample["changedPixels"] == 0,
                    "Comparison result differs",
                )
                require(
                    (sample["width"], sample["height"])
                    == (fixture["width"], fixture["height"]),
                    "Fixture dimensions differ",
                )
    calibration = load("process/calibration-measurements.json")
    ranges = {}
    for name in ("empty", "arraybuffer", "wasm"):
        selected = [
            item for item in calibration["results"] if item["case"] == "calibration-" + name
        ]
        require(len(selected) == 3, "Unexpected calibration count")
        require(
            all(
                item["exitCode"] == 0 and item["payloads"][0]["bytes"] == 67108864
                for item in selected
            ),
            "Calibration process failed",
        )
        ranges[name] = [
            min(item["peakRssBytes"] for item in selected),
            max(item["peakRssBytes"] for item in selected),
        ]
    require(
        ranges == {
            "empty": [29786112, 29884416],
            "arraybuffer": [96944128, 97058816],
            "wasm": [97058816, 97206272],
        },
        "Calibration RSS differs",
    )
    inspector = load("inspector/inspector-capabilities.json")
    observations = [
        item["response"]["result"]["backingStorageSize"]
        for item in inspector["commands"]
        if item.get("request", {}).get("method") == "Runtime.getHeapUsage"
    ]
    require(observations[1] - observations[0] == 16777216, "Typed-array calibration differs")
    require(observations[2] - observations[1] == 0, "WASM calibration differs")
    profile = next(
        item["response"]["result"]["profile"]
        for item in inspector["commands"]
        if item.get("request", {}).get("method") == "HeapProfiler.stopSampling"
    )
    require(
        profile["samples"] == []
        and profile["head"]["children"] == []
        and profile["head"]["selfSize"] == 0,
        "WASM allocation profile differs",
    )
    return {
        "status": "Frozen memory receipt hashes and local calculations passed",
        "processes": 18,
        "responses": 234,
        "summaryRows": 6,
        "kernelCalibrationRssRangesBytes": ranges,
        "inspectorBackingStorageIncreaseBytes": {"arraybuffer": 16777216, "wasm": 0},
        "runtimeSha256": raw["runtimeSha256"],
        "workerBundleSha256": raw["workerBundleSha256"],
        "runtimeExecuted": False,
        "hostedIsolatePeakEstablished": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    repository = here.parents[2]
    output = args.out.resolve()
    require(
        not output.exists() and not output.is_relative_to(repository),
        "Choose a new output directory outside the repository",
    )
    files = read_archive(here / "frozen-evidence.tar.gz")
    result = check_receipts(files)
    output.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        target = (output / "recorded").joinpath(*checked_name(name))
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(data)
    result.update(
        archiveSha256=ARCHIVE_SHA256,
        originalFiles=len(files),
        recorded=str(output / "recorded"),
    )
    (output / "VERIFICATION.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

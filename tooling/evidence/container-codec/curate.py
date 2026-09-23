#!/usr/bin/env python3
"""Curate hosted codec receipts without publishing probe URLs or instance IDs."""

import hashlib
import json
import sys
from pathlib import Path


def load(path):
    data = path.read_bytes()
    return json.loads(data), hashlib.sha256(data).hexdigest()


def curate_request(request):
    data = request["data"]
    result = data.get("result")
    row = {
        "fixture": request["fixture"],
        "status": request["status"],
        "clientWallMs": round(request["clientWallMilliseconds"], 3),
    }
    if result is None:
        row["code"] = data.get("code")
        row["error"] = data["error"]
        return row

    row.update(
        {
            "defect": result["defect"],
            "outcome": result["outcome"],
            "changedPixels": result["changedPixels"],
            "decodedSha256": result["decodedSha256"],
            "thumbnailSha256": result["thumbnail"]["decodedSha256"],
            "maskSha256": result["mask"]["decodedSha256"],
            "codecWallMs": round(result["wallMilliseconds"], 3),
            "probeProcessCpuMs": round(
                sum(result["cpuMicroseconds"].values()) / 1000, 3
            ),
            "processMaxRssKiB": max(
                phase["metrics"]["process"]["resourceUsage"]["maxRSS"]
                for phase in result["phases"]
            ),
            "wasmLinearMemoryBytes": result["wasmLinearMemoryBytes"],
            "cgroupPeakUnavailable": all(
                phase["metrics"]["files"]["/sys/fs/cgroup/memory.peak"]
                == {"unavailable": "ENOENT"}
                for phase in result["phases"]
            ),
        }
    )
    return row


def main(source, output):
    fixtures, fixture_hash = load(source / "fixtures" / "index.json")
    expected = {item["name"]: item for item in fixtures["fixtures"]}
    runs = {}
    for name in (
        "native-hosted",
        "wasm-hosted",
        "native-repeat-hosted",
        "wasm-repeat-hosted",
    ):
        raw, digest = load(source / "results" / f"{name}.json")
        rows = [curate_request(request) for request in raw["requests"]]
        assert len(rows) == (30 if "repeat" in name else 19)
        assert not raw.get("failures")
        assert {request["data"]["bootId"] for request in raw["requests"]} == {
            raw["requests"][0]["data"]["bootId"]
        }
        if "repeat" in name:
            assert {
                (row["fixture"], row["defect"]): sum(
                    other["fixture"] == row["fixture"]
                    and other["defect"] == row["defect"]
                    for other in rows
                )
                for row in rows
            } == {
                (fixture, defect): 5
                for fixture in ("largest.png", "largest.webp", "supported-limit.png")
                for defect in ("none", "all")
            }
        else:
            assert {row["fixture"] for row in rows} == set(expected)
            assert len({row["fixture"] for row in rows}) == len(rows)
        for request, row in zip(raw["requests"], rows, strict=True):
            item = expected[row["fixture"]]
            if "repeat" in name:
                assert row["status"] == 200
                assert row["defect"] in ("none", "all")
                assert row["outcome"] == ("changed" if row["defect"] == "all" else "unchanged")
                assert row["changedPixels"] == (
                    item["width"] * item["height"] if row["defect"] == "all" else 0
                )
            else:
                assert row["status"] == item["expectedStatus"]
                if row["status"] == 200:
                    assert row["outcome"] == "unchanged"
                    assert row["changedPixels"] == 0
                    assert row["decodedSha256"] == item["decodedSha256"]
                else:
                    if item["expectedCode"] is not None:
                        assert row["code"] == item["expectedCode"]
            if row["status"] == 200:
                result = request["data"]["result"]
                assert result["originalBytes"] == item["bytes"]
                assert result["originalSha256"] == item["sha256"]
        runs[name] = {
            "rawSha256": digest,
            "startedAt": raw["startedAt"],
            "finishedAt": raw["finishedAt"],
            "mode": raw["mode"],
            "serial": raw.get("serial", True),
            "rows": rows,
        }

    for suffix in ("hosted", "repeat-hosted"):
        native = runs[f"native-{suffix}"]["rows"]
        wasm = runs[f"wasm-{suffix}"]["rows"]
        assert [
            (row["fixture"], row["status"], row.get("code"), row.get("outcome"),
             row.get("changedPixels"), row.get("decodedSha256"),
             row.get("thumbnailSha256"), row.get("maskSha256"))
            for row in native
        ] == [
            (row["fixture"], row["status"], row.get("code"), row.get("outcome"),
             row.get("changedPixels"), row.get("decodedSha256"),
             row.get("thumbnailSha256"), row.get("maskSha256"))
            for row in wasm
        ]

    lifecycle, lifecycle_hash = load(source / "results" / "lifecycle-hosted.json")
    assert lifecycle["probeStatus"] == lifecycle["stopStatus"] == 200
    assert lifecycle["initialState"]["status"] == "stopped"
    assert lifecycle["finalState"]["status"] == "stopped"
    assert lifecycle["newBootId"] != lifecycle["priorBootId"]

    analytics, analytics_hash = load(
        source / "results" / "visonaut-container-analytics-full.json"
    )
    assert analytics["status"] == 200 and not analytics["body"]["errors"]
    groups = analytics["body"]["data"]["viewer"]["accounts"][0][
        "containersMetricsAdaptiveGroups"
    ]
    samples = sorted(
        [
            {
                "minute": group["dimensions"]["datetimeMinute"],
                "count": group["count"],
                "sampledMaxMemoryBytes": group["max"]["memory"],
                "cpuTimeSeconds": group["sum"]["cpuTimeSec"],
            }
            for group in groups
        ],
        key=lambda sample: sample["minute"],
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "fixtureIndexSha256": fixture_hash,
                "runs": runs,
                "lifecycle": {
                    "rawSha256": lifecycle_hash,
                    "initialStatus": lifecycle["initialState"]["status"],
                    "probeStatus": lifecycle["probeStatus"],
                    "stopStatus": lifecycle["stopStatus"],
                    "finalStatus": lifecycle["finalState"]["status"],
                    "newBoot": lifecycle["newBootId"] != lifecycle["priorBootId"],
                },
                "analytics": {
                    "rawSha256": analytics_hash,
                    "queriedAt": analytics["queriedAt"],
                    "samples": samples,
                },
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: curate.py SOURCE_DIRECTORY OUTPUT_JSON")
    main(Path(sys.argv[1]), Path(sys.argv[2]))

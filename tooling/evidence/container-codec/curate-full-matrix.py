"""Reduce private hosted E01 receipts to an identifier-free capacity record."""

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re


parser = argparse.ArgumentParser()
for name in ("final", "active_metrics", "drained_metrics", "archive", "quiescence", "cleanup", "health", "source_cleanup"):
    parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
sources = {
    name: getattr(args, name)
    for name in ("final", "active_metrics", "drained_metrics", "archive", "quiescence", "cleanup", "health", "source_cleanup")
}
receipts = {name: json.loads(path.read_text()) for name, path in sources.items()}
final = receipts["final"]
active = receipts["active_metrics"]
drained = receipts["drained_metrics"]
archive = receipts["archive"]
quiescence = receipts["quiescence"]
cleanup = receipts["cleanup"]
health = receipts["health"]
source_cleanup = receipts["source_cleanup"]
comparison = final.get("comparison", "")
match = re.fullmatch(r"e01-([0-9a-f]{16})-comparison", comparison)
if (
    match is None
    or quiescence.get("probe") != match.group(1)
    or cleanup.get("probe") != match.group(1)
    or active.get("containerApplicationId") != "a03834fe-9bcb-43b5-a0d9-b1d26db2dd20"
    or health.get("url") != "https://diagnostics.visonaut.com/api/operations"
):
    raise RuntimeError("The diagnostic comparison, cleanup, and Container identities differ")

if (
    final.get("verifiedComplete") is not True
    or final.get("tasks") != 3583
    or final.get("changed") != 3583
    or final.get("changedPixels") != 2103582
    or final.get("retriedTasks") != 1
    or final.get("maximumAttempts") != 2
    or final.get("images", {}).get("original", {}).get("count") != 7166
    or final.get("images", {}).get("thumbnail", {}).get("count") != 3583
    or final.get("images", {}).get("mask", {}).get("count") != 3583
):
    raise RuntimeError("The final D1 comparison receipt differs")
if (
    active.get("start") != "2026-09-23T06:50:00Z"
    or active.get("end") != "2026-09-23T12:13:00Z"
    or drained.get("start") != active["start"]
    or drained.get("end") != "2026-09-23T12:45:00Z"
    or active.get("containerApplicationId") != drained.get("containerApplicationId")
):
    raise RuntimeError("The Cloudflare meter scope differs")
if (
    archive.get("verifiedComplete") is not True
    or archive.get("objects") != 14332
    or archive.get("objectHashesVerified") != 14332
    or cleanup.get("remoteCleanupVerified") is not True
    or cleanup.get("configuredProjects") != ["diagnostics"]
    or cleanup.get("fixtureIdentifierOccurrences") != 0
    or health.get("httpStatus") != 200
    or source_cleanup.get("manifestSha256") != archive.get("manifestSha256")
):
    raise RuntimeError("The archive, diagnostic cleanup, or health receipt differs")
samples = quiescence.get("samples", [])
if (
    quiescence.get("quiescent") is not True
    or len(samples) < 3
    or any(
        item.get("queueBacklog") != 0
        or item.get("peekCount") != 0
        or item.get("completeTasks") != 3583
        or item.get("activeTasks") != 0
        for item in samples
    )
):
    raise RuntimeError("The Queue did not drain")
times = [datetime.fromisoformat(item["observedAt"].replace("Z", "+00:00")) for item in samples]
if (times[-1] - times[0]).total_seconds() < 150:
    raise RuntimeError("The Queue quiet interval is too short")
if (datetime.fromisoformat(health["observedAt"].replace("Z", "+00:00"))
        <= datetime.fromisoformat(cleanup["completedAt"].replace("Z", "+00:00"))):
    raise RuntimeError("The health check preceded D1 cleanup")


def operations(record):
    return {
        row["dimensions"]["actionType"]: row["sum"]["billableOperations"]
        for row in record["queue"]["operations"]
    }


metric_rows = active["container"]["metrics"]
usage_rows = active["container"]["usage"]
if len(metric_rows) < 250 or len(usage_rows) < 250:
    raise RuntimeError("The Container metric groups are incomplete")
if len(active["container"]["worker"]) != 1 or len(active["container"]["d1"]) != 1:
    raise RuntimeError("The diagnostic Worker or D1 meter is not singular")
record = {
    "schemaVersion": 1,
    "scope": "diagnostic-only, one Container lane, full current Ariakit pass-1 image-size matrix with synthetic changed candidates",
    "sourceSha256": {
        name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sources.items()
    },
    "comparison": {
        "verifiedAt": final["observedAt"],
        "tasks": final["tasks"],
        "changed": final["changed"],
        "changedPixels": final["changedPixels"],
        "retriedTasks": final["retriedTasks"],
        "maximumAttempts": final["maximumAttempts"],
        "earliestTaskCreationToLastCompletionMs": final["fromEarliestTaskCreationToLastUniqueCompletionMs"],
        "taskCreationToCompletionMs": final["taskCreatedToCompletedLatencyMs"],
        "images": final["images"],
    },
    "cloudflare": {
        "activeInterval": {"start": active["start"], "end": active["end"], "queriedAt": active["queriedAt"]},
        "drainInterval": {"start": drained["start"], "end": drained["end"], "queriedAt": drained["queriedAt"]},
        "queueOperationsThroughUniqueCompletion": operations(active),
        "queueOperationsThroughDrain": operations(drained),
        "maximumObservedConsumerConcurrency": max(row["avg"]["concurrency"] for row in active["queue"]["consumer"]),
        "container": {
            "metricMinuteGroups": len(metric_rows),
            "usageMinuteGroups": len(usage_rows),
            "maximumSampledMemoryBytes": max(row["max"]["memory"] for row in metric_rows),
            "reportedProcessCpuSeconds": round(sum(row["sum"]["cpuTimeSec"] for row in metric_rows), 6),
            "reportedUsageCpuSeconds": round(sum(row["sum"]["cpuTimeSec"] for row in usage_rows), 6),
            "reportedAllocatedMemoryByteSeconds": round(sum(row["sum"]["allocatedMemory"] for row in usage_rows)),
            "reportedAllocatedDiskByteSeconds": round(sum(row["sum"]["allocatedDisk"] for row in usage_rows)),
        },
        "workerRequestsThroughUniqueCompletion": active["container"]["worker"][0]["sum"]["requests"],
        "r2OperationsThroughUniqueCompletion": {
            row["dimensions"]["actionType"]: row["sum"]["requests"]
            for row in active["container"]["r2"]
        },
        "d1ThroughUniqueCompletion": active["container"]["d1"][0]["sum"],
    },
    "afterRun": {
        "archiveObjectsSha256Verified": archive["objectHashesVerified"],
        "archiveBytes": archive["bytes"],
        "queueQuietSamples": len(samples),
        "queueQuietIntervalSeconds": (times[-1] - times[0]).total_seconds(),
        "diagnosticD1FixtureRemoved": cleanup["remoteCleanupVerified"],
        "diagnosticOperationsHttpStatus": health["httpStatus"],
        "sourceR2DeletionCompletedPages": len(source_cleanup["deletedOffsets"]),
        "sourceR2DeletionDeferred": True,
    },
    "limitations": [
        "Container memory is Cloudflare's maximum observed sample, not a continuous or cgroup peak.",
        "Container usage groups cannot be converted to duty from a nominal one-instance envelope.",
        "Task latency includes Queue backlog and is not isolated codec latency.",
        "Resource-scoped adaptive GraphQL meters are not an invoice or a per-comparison cost.",
        "Fixture candidates changed one pixel, except for one 2.1-million-pixel full-change boundary pair.",
    ],
}
args.out.write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({
    "tasks": record["comparison"]["tasks"],
    "sampledMemory": record["cloudflare"]["container"]["maximumSampledMemoryBytes"],
    "queueWrites": record["cloudflare"]["queueOperationsThroughDrain"]["WriteMessage"],
}))

"""Reduce private four-lane Container receipts to a source-linked capacity record."""

import argparse
from collections import Counter
from datetime import datetime, timedelta
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import re


SOURCE_NAMES = (
    "final", "r2", "observations", "tail", "metrics", "archive_before",
    "archive_after", "fixture_manifest", "preflight", "publish",
    "publish_manifest", "worker_config", "hard_stop", "fallback",
    "quiescence", "stop",
)
parser = argparse.ArgumentParser()
for name in SOURCE_NAMES:
    parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
sources = {name: getattr(args, name) for name in SOURCE_NAMES}
data = {name: json.loads(path.read_text()) for name, path in sources.items() if name != "observations"}
observations = [json.loads(line) for line in sources["observations"].read_text().splitlines() if line]
final = data["final"]
r2 = data["r2"]
tail = data["tail"]
metrics = data["metrics"]
before = data["archive_before"]
after = data["archive_after"]
fixture = data["fixture_manifest"]
preflight = data["preflight"]
publish = data["publish"]
manifest = data["publish_manifest"]
config = data["worker_config"]
armed = data["hard_stop"]
fallback = data["fallback"]
quiet = data["quiescence"]
stopped = data["stop"]


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


comparison = final.get("comparison", "")
match = re.fullmatch(r"e01-([0-9a-f]{16})-comparison", comparison)
expected_queues = [f"visonaut-e01-scale4-lane-{lane}" for lane in range(4)]
consumers = config.get("queues", {}).get("consumers", [])
container_settings = config.get("containers", [])
tasks = manifest.get("tasks", [])
if (
    match is None
    or manifest.get("comparison") != comparison
    or len(tasks) != 3583
    or [row.get("ordinal") for row in tasks] != list(range(3583))
    or len({row.get("id") for row in tasks}) != 3583
    or any(row.get("id") != f"{comparison}:e01-{match.group(1)}-capture-candidate-{index}"
           for index, row in enumerate(tasks))
    or set(manifest.get("queues", {})) != set(expected_queues)
    or hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    != publish.get("manifestDigest")
    or r2.get("comparison") != comparison
    or quiet.get("comparison") != comparison
    or stopped.get("finalSha256") != hashlib.sha256(sources["final"].read_bytes()).hexdigest()
    or stopped.get("quietSha256") != hashlib.sha256(sources["quiescence"].read_bytes()).hexdigest()
    or metrics.get("containerApplicationId") != "a0307199-5f13-4d11-b3ae-30de53c9d047"
    or set(metrics.get("queues", {})) != set(expected_queues)
    or set(tail.get("versionCounts", {})) != {"9e91aca2-b443-4852-b9dd-bb042a4a1477"}
    or preflight.get("databaseName") != "visonaut-e01-capacity-20260923"
    or preflight.get("r2BucketName") != "visonaut-e01-capacity-images-20260923"
    or set(preflight.get("queueNames", [])) != set([*expected_queues, "visonaut-e01-scale4-dead-letter"])
    or preflight.get("queuesEmpty") is not True
    or preflight.get("r2BucketAlsoRetainsFirstRunArchive") is not True
    or config.get("name") != "visonaut-e01-capacity-compare"
    or config.get("workers_dev") is not True
    or config.get("routes")
    or config.get("triggers", {}).get("crons")
    or config.get("vars", {}).get("VISONAUT_CODEC_BACKEND") != "container"
    or len(container_settings) != 1
    or container_settings[0].get("max_instances") != 4
    or container_settings[0].get("instance_type") != "basic"
    or not container_settings[0].get("image", "").endswith(
        "@sha256:d9a359f4da61d3c25c711ffb3793295dea05a0ec85e1b120537829fc64780ae6"
    )
    or [row.get("database_name") for row in config.get("d1_databases", [])]
    != [preflight["databaseName"]]
    or [row.get("bucket_name") for row in config.get("r2_buckets", [])]
    != [preflight["r2BucketName"]]
    or [row.get("queue") for row in consumers] != expected_queues
    or any(
        row.get("max_concurrency") != 1
        or row.get("max_batch_size") != 1
        or row.get("max_retries") != 5
        or row.get("dead_letter_queue") != "visonaut-e01-scale4-dead-letter"
        for row in consumers
    )
):
    raise RuntimeError("The comparison, publication, artifact, and stop receipt identities differ")

if (
    final.get("verifiedComplete") is not True
    or final.get("tasks") != 3583
    or final.get("changed") != 3583
    or final.get("changedPixels") != 2103582
    or {role: row.get("count") for role, row in final.get("images", {}).items()}
    != {"original": 7166, "thumbnail": 3583, "mask": 3583}
    or set(final.get("queueBacklogsAtVerification", {}).values()) != {0}
    or len(final.get("queueBacklogsAtVerification", {})) != 4
):
    raise RuntimeError("The isolated comparison is not complete and drained")
cases = fixture.get("cases", [])
if (
    len(cases) != 3583
    or [case.get("index") for case in cases] != list(range(3583))
    or Counter(case.get("browser") for case in cases)
    != {"chromium": 1230, "firefox": 1230, "webkit": 1122, "boundary": 1}
    or not fixture.get("source", "").startswith("Ariakit three-browser pass-1 captures")
    or any(
        case["original"]["width"] != case["candidate"]["width"]
        or case["original"]["height"] != case["candidate"]["height"]
        or any(
            not isinstance(item["bytes"], int) or item["bytes"] < 1
            or not re.fullmatch(r"[0-9a-f]{64}", item["digest"])
            for item in (case["original"], case["candidate"])
        )
        for case in cases
    )
    or sum(case["original"]["bytes"] + case["candidate"]["bytes"] for case in cases)
    != final["images"]["original"]["bytes"]
    or (cases[-1]["original"]["width"], cases[-1]["original"]["height"])
    != (1400, 1500)
):
    raise RuntimeError("The Ariakit source-size manifest differs from the hosted originals")


def distribution(values):
    ordered = sorted(values)
    return {
        "minimum": ordered[0],
        "p50": ordered[math.ceil((len(ordered) - 1) * 0.5)],
        "p95": ordered[math.ceil((len(ordered) - 1) * 0.95)],
        "maximum": ordered[-1],
        "total": sum(ordered),
    }


fixture_summary = {
    "pairs": len(cases),
    "browserCounts": dict(Counter(case["browser"] for case in cases)),
    "baselineBytes": distribution([case["original"]["bytes"] for case in cases]),
    "candidateBytes": distribution([case["candidate"]["bytes"] for case in cases]),
    "widthPixels": distribution([case["original"]["width"] for case in cases]),
    "heightPixels": distribution([case["original"]["height"] for case in cases]),
}
if (
    len(publish.get("sent", [])) != 36
    or {tuple(batch) for batch in publish["sent"]}
    != {(lane, offset) for lane in range(4) for offset in range(0, 900, 100)}
    or not isinstance(publish.get("manifestDigest"), str)
):
    raise RuntimeError("The four-lane Queue publication receipt differs")
if (
    r2.get("verifiedComplete") is not True
    or r2.get("objects") != 14332
    or r2.get("objectHashesVerified") != 14332
    or {role: row.get("count") for role, row in r2.get("roles", {}).items()}
    != {"original": 7166, "thumbnail": 3583, "mask": 3583}
    or r2.get("roles") != final.get("images")
):
    raise RuntimeError("The new-run R2 originals and artifacts are not SHA-verified")
if (
    before.get("objects") != 14332
    or before.get("bytes") != 127363651
    or before.get("originalObjectHashesVerified") != 14332
    or after.get("objects") != before["objects"]
    or after.get("bytes") != before["bytes"]
    or after.get("listedInventorySha256") != before.get("listedInventorySha256")
    or after.get("newProbeIdentityDisjoint") is not True
):
    raise RuntimeError("The frozen first-run archive inventory changed")
start = timestamp(armed["armedAt"])
deadline = timestamp(armed["deadline"])
if deadline - start != timedelta(hours=3) or len(armed.get("queueNames", [])) != 4:
    raise RuntimeError("The isolated hard-stop receipt differs")
if armed["queueNames"] != expected_queues or armed.get("maxContainerInstances") != 4:
    raise RuntimeError("The four-lane resource bound differs")
if fallback.get("deadline") != armed["deadline"] or fallback.get("watchdogCount") != 2:
    raise RuntimeError("The independent E01 stop process was not armed")
quiet_samples = quiet.get("samples", [])
if quiet.get("quiescent") is not True or len(quiet_samples) != 3 or any(
    sample.get("complete") != 3583
    or len(sample.get("queues", {})) != 5
    or any(row != {"backlog": 0, "peekCount": 0} for row in sample["queues"].values())
    for sample in quiet_samples
):
    raise RuntimeError("The isolated Queue drain is not verified")
quiet_seconds = (timestamp(quiet_samples[-1]["at"]) - timestamp(quiet_samples[0]["at"])).total_seconds()
if quiet_seconds < 150:
    raise RuntimeError("The isolated Queue quiet window is too short")
if not (
    timestamp(preflight["verifiedAt"]) < start
    < timestamp(tail["firstQueueDeliveryAt"])
    < timestamp(final["observedAt"])
    <= timestamp(quiet_samples[0]["at"])
    < timestamp(quiet_samples[-1]["at"])
    <= timestamp(stopped["startedAt"])
    < timestamp(stopped["finishedAt"])
    < timestamp(r2["verifiedAt"])
    and timestamp(before["verifiedAt"]) < start
    and timestamp(after["verifiedAt"]) > timestamp(stopped["finishedAt"])
    and start <= timestamp(fallback["verifiedAt"]) < deadline
    and timestamp(metrics["start"]) <= start
    and timestamp(stopped["finishedAt"]) < timestamp(metrics["end"])
    and timestamp(metrics["end"]) <= timestamp(r2["verifiedAt"])
):
    raise RuntimeError("The preflight, delivery, verification, stop, and billing windows differ")
if (
    stopped.get("paused") != armed["queueNames"]
    or stopped.get("stopHttpStatus") != 200
    or set(stopped.get("watchdogsAliveAtClose", [])) != {"primaryPid", "fallbackPid"}
    or timestamp(stopped["finishedAt"]) >= deadline
    or len(stopped.get("containerStates", [])) != 4
    or {lane.get("status") for lane in stopped.get("containerStates", [])}
    not in ({"stopped"}, {"stopped", "stopped_with_code"})
):
    raise RuntimeError("The isolated Queues or Containers were not stopped")
status_rows = [row for row in observations if "status" in row]
if not status_rows or any(
    row["status"].get("total") != 3583
    or row["status"].get("dead") not in (0, None)
    or row["status"].get("wrong_pixels") not in (0, None)
    for row in status_rows
):
    raise RuntimeError("The sampled task results include a dead or incorrect comparison")
observation_times = [timestamp(row["at"]) for row in status_rows]
maximum_observation_gap = max(
    (later - earlier).total_seconds()
    for earlier, later in zip(observation_times, observation_times[1:])
)

healthy = [row for row in status_rows if len(row.get("container", {}).get("lanes", [])) == 4
           and all(lane.get("status") == "healthy" for lane in row["container"]["lanes"])]
if not healthy:
    raise RuntimeError("Four concurrent healthy Container lanes were not observed")
process_peak = {}
cgroup_peak = {}
comparisons = {}
restarts = Counter()
previous_uptime = {}
for row in status_rows:
    for lane in row.get("container", {}).get("lanes", []):
        index = lane.get("lane")
        if index not in range(4):
            continue
        values = lane.get("metrics") or {}
        uptime = values.get("processUptimeSeconds")
        if isinstance(uptime, (int, float)):
            if index in previous_uptime and uptime < previous_uptime[index]:
                restarts[index] += 1
            previous_uptime[index] = uptime
        for target, field in (
            (process_peak, "processMaxRssBytes"),
            (cgroup_peak, "cgroupPeakBytes"),
            (comparisons, "comparisons"),
        ):
            value = values.get(field)
            if isinstance(value, (int, float)) and value >= 0:
                target[index] = max(target.get(index, 0), value)
if set(process_peak) != set(range(4)):
    raise RuntimeError("A Container lane has no process high-water observation")

container = metrics["container"]
usage = container["usage"]
sampled = container["metrics"]
if not usage or not sampled or len(usage) >= 1000 or len(sampled) >= 1000:
    raise RuntimeError("Container Analytics usage is missing or truncated")
if len({row["dimensions"]["instanceId"] for row in usage}) != 4:
    raise RuntimeError("Container usage did not cover exactly four instances")
if len({row["dimensions"]["instanceId"] for row in sampled}) != 4:
    raise RuntimeError("Container samples did not cover exactly four instances")
delivery_to_finish_ms = final["lastCompletedAtMs"] - round(
    timestamp(tail["firstQueueDeliveryAt"]).timestamp() * 1000
)
if delivery_to_finish_ms <= 0:
    raise RuntimeError("The final comparison preceded its first Queue delivery")
cpu = sum(Decimal(str(row["sum"]["cpuTimeSec"])) for row in usage)
memory = sum(Decimal(str(row["sum"]["allocatedMemory"])) for row in usage)
disk = sum(Decimal(str(row["sum"]["allocatedDisk"])) for row in usage)
egress = sum(Decimal(str(row["sum"]["txBytes"])) for row in usage)
rates = {"cpuPerVcpuSecond": Decimal("0.000020"),
         "memoryPerGibSecond": Decimal("0.0000025"),
         "diskPerGbSecond": Decimal("0.00000007")}
rate_equivalent = (
    cpu * rates["cpuPerVcpuSecond"]
    + memory / Decimal(1024 ** 3) * rates["memoryPerGibSecond"]
    + disk / Decimal(1000 ** 3) * rates["diskPerGbSecond"]
)
queue_operations = Counter()
for lane in metrics["queues"].values():
    for row in lane["operations"]:
        queue_operations[row["dimensions"]["actionType"]] += row["sum"]["billableOperations"]

record = {
    "schemaVersion": 1,
    "status": "E01 partial; this isolated probe does not authorize a production fallback switch",
    "scope": "Four basic Containers and one Queue consumer per lane; 3,582 Ariakit pass-1 PNG originals with controlled one-pixel candidate edits, plus one admissible full-change boundary pair",
    "sourceSha256": {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sources.items()},
    "fixture": fixture_summary,
    "comparison": {key: final[key] for key in (
        "tasks", "changed", "changedPixels", "retriedTasks", "maximumAttempts",
        "fromEarliestTaskCreationToLastUniqueCompletionMs", "taskCreatedToCompletedLatencyMs", "images"
    )},
    "publication": {"batches": len(publish["sent"]), "manifestSha256": publish["manifestDigest"],
                    "firstQueueDeliveryAt": tail.get("firstQueueDeliveryAt"),
                    "firstDeliveryToLastUniqueCompletionMs": delivery_to_finish_ms},
    "hardStop": {"armedAt": armed["armedAt"], "deadline": armed["deadline"],
                 "isolatedQueues": len(armed["queueNames"]), "watchdogCount": 2,
                 "watchdogSourceSha256": {"primary": fallback["primarySourceSha256"],
                                          "fallback": fallback["fallbackSourceSha256"]},
                 "completedAt": stopped["finishedAt"], "stoppedBeforeDeadline": True},
    "queueDrain": {"emptyQueueSamples": len(quiet_samples), "durationSeconds": quiet_seconds,
                   "includedDeadLetter": True},
    "memory": {
        "processMaxRssBytesByLane": {str(key): value for key, value in process_peak.items()},
        "cgroupPeakBytesByLane": {str(key): value for key, value in cgroup_peak.items()},
        "maximumCloudflareSampledMemoryBytes": max(row["max"]["memory"] for row in sampled),
        "maximumObservedContainerComparisonsByLane": {str(key): value for key, value in comparisons.items()},
        "observedProcessRestartsByLane": {str(key): restarts[key] for key in range(4)},
        "maximumObservationGapSeconds": maximum_observation_gap,
    },
    "observedFourHealthyLanes": len(healthy),
    "containerFetch": {key: tail[key] for key in (
        "fetch", "uniqueFetchTasks", "httpStatusCounts", "firstFetchMsByLane", "subsequentFetch",
        "fetchCountByLane", "maximumOverlappingObservedFetches", "fetchOverTwoSeconds",
        "fetchOverFiveSeconds", "errors", "lifecycle"
    )},
    "cloudflare": {
        "interval": {"start": metrics["start"], "end": metrics["end"], "queriedAt": metrics["queriedAt"]},
        "usageMinuteGroups": len(usage),
        "metricMinuteGroups": len(sampled),
        "instanceCount": 4,
        "reportedCodeCpuSeconds": sum(row["sum"]["cpuTimeSec"] for row in sampled),
        "reportedContainerUptimeSum": sum(row["sum"]["containerUptime"] for row in sampled),
        "estimatedQueueBillableOperations": dict(queue_operations),
        "worker": container["worker"][0]["sum"] if container["worker"] else None,
        "d1": container["d1"][0]["sum"] if container["d1"] else None,
        "r2": {row["dimensions"]["actionType"]: row["sum"]["requests"] for row in container["r2"]},
        "containerUsage": {"cpuSeconds": float(cpu), "allocatedMemoryByteSeconds": float(memory),
                           "allocatedDiskByteSeconds": float(disk), "transmittedBytes": float(egress)},
        "publishedContainerOverageRatesUsd": {key: str(value) for key, value in rates.items()},
        "rateSource": "https://developers.cloudflare.com/containers/platform/pricing/",
        "containerPublishedRateEquivalentUsd": float(rate_equivalent.quantize(Decimal("0.000001"))),
    },
    "archiveAfterProbe": {"objects": after["objects"], "bytes": after["bytes"],
                          "inventorySha256Unchanged": True},
    "newRunR2": {"objectsSha256Verified": r2["objectHashesVerified"],
                 "bytes": r2["bytes"], "listedInventorySha256": r2["listedInventorySha256"],
                 "verifierWorkerSourceSha256": r2["workerSourceSha256"],
                 "verifierDriverSourceSha256": r2["driverSourceSha256"]},
    "limitations": [
        "The cgroup memory.peak counter was unavailable. Process maxRSS is a Node process high-water mark, not the full Container peak.",
        "Processes can sleep or restart between observations, so even process maxRSS is bounded by sampled lifetimes.",
        "Cloudflare Container memory is a maximum observed sample, not a continuous peak.",
        "Adaptive GraphQL operation totals can be estimates and are not an exact task ledger.",
        "The Container rate equivalent uses published overage rates before monthly allowance; it is not an invoice or full Worker, DO, Queue, D1, R2, log, and egress cost.",
        "The Container uptime sum does not give a validated active duty cycle; the field changed from zero while running to a cumulative-looking value later.",
        "The scoped comparison interval begins after seeding 7,166 original R2 objects, so its R2 writes omit those source uploads. D1 and Worker totals include observation traffic.",
        "The scoped R2 bucket also contains the frozen first-run archive and its read-only inventory audit.",
        "The four-lane probe uses controlled synthetic changes and does not certify the 10,580-capture design or 35,820-capture stress workload.",
    ],
}
if tail["uniqueFetchTasks"] != 3583:
    record["limitations"].append("The live Worker tail missed at least one native fetch; its latency distribution is incomplete.")
if maximum_observation_gap > 30:
    record["limitations"].append("The process high-water series has an observation gap after the status observer's cached OAuth token was rejected.")
args.out.write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"tasks": record["comparison"]["tasks"],
                  "sampledMemory": record["memory"]["maximumCloudflareSampledMemoryBytes"],
                  "containerRateEquivalentUsd": record["cloudflare"]["containerPublishedRateEquivalentUsd"]}))

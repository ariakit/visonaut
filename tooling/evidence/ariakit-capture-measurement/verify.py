#!/usr/bin/env python3
"""Verify frozen evidence hashes and recorded counts without private images."""

import argparse
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import tarfile


ARCHIVE_SHA256 = "3b538e16dce5b583c6180ef670bd51ba370709945d7bab6c560e1b4ea2379186"
MANIFEST_SHA256 = "3f6e072f3b8df520645b15cb1c4dd767183fe46d7338c42c9c7e655662651e2a"
ARCHIVE_BYTES = 31123
ORIGINAL_BYTES = 153972
ORIGINAL_FILES = 28
BROWSERS = ("chromium", "firefox", "webkit")
POLICIES = ("visible-exact-v1", "study-one-level", "study-legacy-ratio")
PAIRS = ((1, 2), (2, 3), (1, 3))


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
    require(path.stat().st_size == ARCHIVE_BYTES, "Frozen archive size changed")
    data = path.read_bytes()
    require(digest(data) == ARCHIVE_SHA256, "Frozen archive hash changed")
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        members = archive.getmembers()
        require(len(members) == ORIGINAL_FILES, "Unexpected archive file count")
        require(
            sum(member.size for member in members) == ORIGINAL_BYTES,
            "Unexpected uncompressed size",
        )
        for member in members:
            checked_name(member.name)
            require(member.isfile(), "Links and special entries are refused")
            require(member.name not in files, "Duplicate archive path")
            with archive.extractfile(member) as source:
                files[member.name] = source.read()
            require(len(files[member.name]) == member.size, "Truncated file")
    require(digest(files["HASHES.json"]) == MANIFEST_SHA256, "Manifest changed")
    manifest = json.loads(files["HASHES.json"])
    require(set(manifest) == set(files) - {"HASHES.json"}, "Inventory changed")
    for name, expected in manifest.items():
        require(digest(files[name]) == expected, "File hash differs: " + name)
    return files


def statistics_match(recorded, expected_count, expected_total):
    require(recorded["count"] == expected_count, "Statistics count differs")
    require(recorded["total"] == expected_total, "Statistics total differs")
    require(
        math.isclose(recorded["mean"], expected_total / expected_count),
        "Recorded mean differs from total/count",
    )


def policy_totals(comparisons):
    totals = {
        policy: {
            key: 0
            for key in ("compared", "unchanged", "changed", "changedPixels", "sizeChanged")
        }
        for policy in POLICIES
    }
    require(
        [(pair["left"], pair["right"]) for pair in comparisons] == list(PAIRS),
        "Comparison pairs differ",
    )
    for pair in comparisons:
        require(pair["completePasses"] and pair["inventoryEqual"], "Incomplete pair")
        require(
            all(
                pair[key] == 0
                for key in ("added", "removed", "profileChanged", "validationFailures")
            ),
            "Pair has missing or incompatible evidence",
        )
        require(set(pair["policyOutcomes"]) == set(POLICIES), "Policy set differs")
        for policy, outcome in pair["policyOutcomes"].items():
            require(outcome["compared"] == pair["common"], "Compared count differs")
            require(
                outcome["changed"] + outcome["unchanged"] == outcome["compared"],
                "Outcome counts do not cover the pair",
            )
            for key in totals[policy]:
                totals[policy][key] += outcome[key]
    return totals


def verify_receipts(files):
    def record(name):
        return json.loads(files[name])

    summary = record("summary.json")
    github = record("github.json")
    scope = record("scope.json")
    workload = record("workload.json")["passes"]
    audit = record("independent-audit/receipt-full-matrix.json")
    require(
        github["status"] == "completed" and github["conclusion"] == "success",
        "Run did not complete",
    )
    require(summary["browsers"] == list(BROWSERS), "Browser set differs")
    require(summary["completeConfiguredCaptureMatrix"], "Matrix is incomplete")
    require(
        summary["sourceMergeSha"] == github["testedMergeSha"] == audit["testedSha"],
        "Tested source differs",
    )
    require(
        str(summary["githubRunId"]) == str(github["id"]) == str(audit["workflowRunId"]),
        "Run ID differs",
    )
    require(scope["upstreamErrors"] == 0, "Upstream collection has errors")
    require(len(workload) == summary["passesPerBrowser"] == 3, "Pass count differs")
    require(audit["fullThreeBrowserMatrix"], "Historical audit is incomplete")
    require(
        digest(files["independent-audit/audit-full-matrix.py"]) == audit["auditSourceSha256"],
        "Historical audit source changed",
    )
    require(
        digest(files["independent-audit/receipt.json"]) == audit["priorTwoBrowserReceiptSha256"],
        "Earlier audit receipt changed",
    )

    totals = {key: 0 for key in audit["totals"]}
    combined_policies = None
    comparisons = {}
    for browser in BROWSERS:
        runner = record(browser + "/summary.json")
        compared = record(browser + "/comparator.json")
        verified = record(browser + "/verification.json")
        attempts = record(browser + "/attempt-coverage.json")
        prior = next(item for item in audit["browsers"] if item["browser"] == browser)
        measured_scope = scope["measured"][browser]
        comparisons[browser] = compared
        require(
            runner["complete"] and compared["complete"] and verified["verified"],
            "Browser evidence is incomplete",
        )
        require(
            all(item["browser"] == browser for item in (runner, compared, verified)),
            "Browser identity differs",
        )
        for item in (runner, compared, verified):
            require(str(item["workflowRunId"]) == str(github["id"]), "Browser run differs")
            require(item["testedSha"] == github["testedMergeSha"], "Browser source differs")
        require(
            measured_scope["missingTests"] == measured_scope["extraTests"] == 0,
            "Collection parity failed",
        )
        project = {"chromium": "chrome", "firefox": "firefox", "webkit": "safari"}[browser]
        require(
            measured_scope["testCount"] == scope["upstreamTestsByProject"][project],
            "Upstream test count differs",
        )
        require(
            verified["localCodecFiles"] == audit["freshWasmRun"]["codecBinaryHashes"],
            "Recorded codec identities differ",
        )
        for name, expected in prior["localReceiptHashesAtAuditTime"].items():
            current_name = name
            if name == "analysis-validated-originals/aggregate.json":
                current_name = "comparator.json"
            require(
                digest(files[browser + "/" + current_name]) == expected,
                "Historical receipt hash differs",
            )
        for name, expected in prior["evidenceHashes"].items():
            require(verified[name] == expected, "Recorded private evidence identity differs")
        for name, expected in compared["sourceHashes"].items():
            require(audit["sourceHashes"][name] == expected, "Recorded comparator source differs")
        for records in (runner["passes"], compared["passes"], attempts, prior["passes"]):
            require(len(records) == 3, "Browser pass count differs")
        for index in range(3):
            capture = runner["passes"][index]
            image = compared["passes"][index]
            retry = attempts[index]
            historical = prior["passes"][index]
            require(
                capture["iteration"]
                == image["pass"]
                == retry["pass"]
                == historical["pass"]
                == index + 1,
                "Pass identity differs",
            )
            require(
                capture["complete"] and image["complete"] and capture["exitCode"] == 0,
                "Capture pass failed",
            )
            for key in ("tests", "captures", "failedAttempts", "recoveredTests"):
                require(capture[key] == image[key], "Runner/comparator counts differ")
            require(capture["tests"] == measured_scope["testCount"], "Selected test count differs")
            require(
                capture["captures"] == measured_scope["captureCount"],
                "Selected capture count differs",
            )
            require(
                image["validatedCaptures"]
                == capture["captures"]
                and image["validationFailures"]
                == 0,
                "Recorded image validation is incomplete",
            )
            require(
                capture["failedTests"] == image["finalFailures"] == historical["finalFailures"] == 0,
                "Final test failure exists",
            )
            statistics_match(image["encodedBytes"], capture["captures"], capture["bytes"])
            statistics_match(image["pixels"], capture["captures"], capture["pixels"])
            require(
                retry["everyAttemptMatchesReport"]
                and retry["finalSelectionMatchesLastSuccessfulAttempt"],
                "Recorded retry audit failed",
            )
            require(
                retry["testAttempts"]
                == capture["tests"] + capture["failedAttempts"]
                == historical["attempts"],
                "Attempt count differs",
            )
            require(
                retry["failedCaptureAttachments"]
                == retry["failedPngAttachments"]
                == retry["failedCapturesReplacedByLaterSuccessfulRetry"],
                "Failed capture accounting differs",
            )
            require(
                retry["allCaptureAttachments"]
                == capture["captures"] + retry["failedCaptureAttachments"]
                == historical["markerPngJoinsAndHashesVerified"],
                "Attachment count differs",
            )
            require(
                historical["failedMarkerPngJoinsAndHashesVerified"]
                == retry["failedCaptureAttachments"],
                "Failed attachment count differs",
            )
            require(
                historical["selectedPayloadsAndOriginalBytesVerified"]
                == historical["profilePayloadDigestsVerified"]
                == retry["selectedCaptures"]
                == capture["captures"],
                "Historical selected count differs",
            )
            for key in totals:
                totals[key] += historical[key]
        policies = policy_totals(compared["comparisons"])
        wasm = next(
            item for item in audit["freshWasmRun"]["browsers"]
            if item["browser"] == browser
        )
        require(
            wasm["selectedCapturesValidated"]
            == sum(item["captures"] for item in compared["passes"]),
            "Historical WASM count differs",
        )
        require(
            wasm["originalBytesEqualBeforeAndAfterWasmDecode"]
            and wasm["policyTotalsMatchSavedPairs"],
            "Historical WASM audit failed",
        )
        for policy in POLICIES:
            for key, value in wasm["policyTotals"][policy].items():
                require(policies[policy][key] == value, "Historical WASM policy totals differ")
        if combined_policies is None:
            combined_policies = policies
        else:
            for policy in POLICIES:
                for key in policies[policy]:
                    combined_policies[policy][key] += policies[policy][key]

    require(totals == audit["totals"], "Historical audit totals differ")
    require(combined_policies == summary["policyTotals"], "Combined policy totals differ")
    require(
        totals["captures"] == summary["validatedSelectedCaptureInstances"],
        "Selected total differs",
    )
    require(
        totals["failedMarkerPngJoinsAndHashesVerified"] == summary["failedAttemptPngsRetained"],
        "Failed PNG total differs",
    )
    for index, full_pass in enumerate(workload):
        parts = [comparisons[browser]["passes"][index] for browser in BROWSERS]
        require(full_pass["pass"] == index + 1, "Workload pass differs")
        require(
            full_pass["tests"]
            == sum(item["tests"] for item in parts)
            == summary["configuredTestsPerFullPass"],
            "Workload tests differ",
        )
        count = sum(item["captures"] for item in parts)
        require(
            full_pass["captures"] == count == summary["configuredCapturesPerFullPass"],
            "Workload captures differ",
        )
        for key in ("encodedBytes", "pixels"):
            statistics_match(full_pass[key], count, sum(item[key]["total"] for item in parts))
        unique_count = sum(item["uniqueImages"] for item in parts)
        require(full_pass["uniqueEncodedDigests"] == unique_count, "Recorded unique count differs")
        statistics_match(
            full_pass["uniqueEncodedBytes"],
            unique_count,
            sum(item["uniqueImageBytes"]["total"] for item in parts),
        )
    return {"recordedHistoricalAuditTotals": totals, "recordedPolicyTotals": combined_policies}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    output = args.out.resolve()
    require(
        not output.exists() and not output.is_relative_to(here.parents[2]),
        "Choose a new output directory outside the repository",
    )
    files = read_archive(here / "frozen-evidence.tar.gz")
    counts = verify_receipts(files)
    output.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        target = output / "frozen-package"
        target = target.joinpath(*checked_name(name))
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(data)
    result = {
        "status": "Frozen hashes and recorded-count consistency passed",
        "archiveSha256": ARCHIVE_SHA256,
        "originalManifestSha256": MANIFEST_SHA256,
        "originalFiles": len(files),
        **counts,
        "privateImagesRevalidated": False,
        "sourceAndCodecBodiesRevalidated": False,
        "recordedQuantilesRecalculated": False,
        "executedHistoricalScripts": False,
        "networkRequests": 0,
        "hostedReplay": False,
    }
    (output / "VERIFICATION.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

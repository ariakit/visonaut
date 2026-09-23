#!/usr/bin/env python3
"""Verify and extract frozen acceptance receipts without a hosted replay."""

import argparse
from datetime import datetime
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile


ARCHIVE_SHA256 = "c7f5410ef906df79d85f643c08759029f1b9cf2c0f3c92114d57fdf09c1b1251"
MANIFEST_SHA256 = "ec96245bb2ce9dd0892f45f6a8374c6918131c111a464ff9e578d72a26ae8b21"
SOURCE_COMMIT = "43552ce5196448f6dee82da665c5b06863638b08"
SOURCE_TREE = "e06628954290ccdbf3792edf5497cdf64af68c09"
WEB_VERSION = "9ea84f79-9a30-46d4-81ab-5bea048cbd76"
COMPARE_VERSION = "09893c22-08b0-4ef1-ba39-6f44ae670298"
SOURCE_RUN = "7f114089-e7e9-41be-bb3a-977d5fa88eec"
FIRST_RUN = "59564c70-8706-4a27-803e-86fd4561a258"
ACTIVE_RUN = "1c3414ed-f934-4b4c-9089-dac42094915a"
TESTED_SHA = "b68da87fd96aee172a1fa691c5b0cbea9f444d42"
CALLER_HEAD = "e1ea980c5421ddb86659874456464f894a2324c1"
REUSABLE_SHA = "dcf42788b6c284a1affb4d2df65954672b04bae0"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_name(name):
    relative = PurePosixPath(name)
    require(
        relative.parts and not relative.is_absolute() and ".." not in relative.parts
        and "\\" not in name and "\0" not in name and relative.as_posix() == name,
        "Unsafe archive path",
    )
    return relative.parts


def read_archive(path):
    data = path.read_bytes()
    require(digest(data) == ARCHIVE_SHA256, "Frozen evidence archive changed")
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        members = archive.getmembers()
        require(len(members) == 39, "Unexpected archive file count")
        require(sum(member.size for member in members) == 203130, "Unexpected archive size")
        for member in members:
            checked_name(member.name)
            require(member.isfile(), "Links and special archive entries are refused")
            require(member.name not in files, "Duplicate archive path")
            with archive.extractfile(member) as source:
                files[member.name] = source.read()
            require(len(files[member.name]) == member.size, "Truncated archive file")
    require(digest(files["SHA256.json"]) == MANIFEST_SHA256, "Original manifest changed")
    manifest = json.loads(files["SHA256.json"])
    require(set(manifest) == set(files) - {"SHA256.json"}, "File inventory differs")
    for name, expected in manifest.items():
        require(len(files[name]) == expected["bytes"], "Original size differs: " + name)
        require(digest(files[name]) == expected["sha256"], "Original hash differs: " + name)
    return files


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def variants(model):
    return {
        (item["key"], variant["key"]): variant
        for item in model["items"] for variant in item["variants"]
    }


def item_map(rows):
    return {(row["item_key"], row["variant_key"]): row for row in rows}


def check_receipts(files):
    load = lambda name: json.loads(files[name])
    receipt = lambda name: load("receipts/" + name + ".json")
    proof = lambda label: receipt("ariviso-hosted-run-" + label)
    source = proof("35713469611-before-acceptance-reuse")
    first = proof("35744613874-acceptance-reuse-attempt1")
    second = proof("35744613874-acceptance-reuse-attempt2")
    after = proof("35744613874-after-complete-undo")
    expected_items = {("synthetic/first", "chromium-light"),
                      ("synthetic/second", "chromium-light")}
    source_rows = item_map(source["datasets"]["comparisonRows"])
    source_images = item_map(source["datasets"]["captures"])
    require(set(source_rows) == expected_items, "Source comparison inventory differs")
    source_decisions = {key: value["decision_id"] for key, value in source_rows.items()}
    require(set(source_decisions.values()) == {
        "8efa8cd0-54dd-4306-b4f9-a09e66185d01",
        "e42b01ab-a2cd-4532-ab82-4131105a0ad5",
    }, "Source decision identities differ")
    plan = source["datasets"]["runs"][0]["plan_digest"]
    job_ids = {}
    for label, document, run_id, attempt, external_id in (
        ("source-attempt3", source, SOURCE_RUN, 3, 35713469611),
        ("dependent-attempt1", first, FIRST_RUN, 1, 35744613874),
        ("dependent-attempt2", second, ACTIVE_RUN, 2, 35744613874),
    ):
        require(document["sourceCommit"] == SOURCE_COMMIT, "Recorded source label differs")
        require(document["webVersion"] == WEB_VERSION, "Recorded Web version differs")
        require(document["compareVersion"] == COMPARE_VERSION, "Comparator version differs")
        data = document["datasets"]
        run = next(row for row in data["runs"] if row["id"] == run_id)
        require(run["active"] == 1 and run["state"] == "reviewing", "Run is not active")
        require(run["attempt"] == attempt and run["sealed_at"], "Run attempt is not sealed")
        require(run["tested_sha"] == TESTED_SHA and run["plan_digest"] == plan,
                "Tested source or plan differs")
        workflow = load("github/" + label + ".json")
        require(workflow["id"] == external_id and workflow["run_attempt"] == attempt,
                "GitHub workflow identity differs")
        require(workflow["status"] == "completed" and workflow["conclusion"] == "success",
                "GitHub workflow did not succeed")
        require(workflow["event"] == "pull_request" and workflow["head_sha"] == CALLER_HEAD,
                "GitHub caller source differs")
        require(workflow["referenced_workflows"][0]["sha"] == REUSABLE_SHA,
                "Reusable workflow differs")
        jobs = load("github/" + label + "-jobs.json")["jobs"]
        require(len(jobs) == 2, "Unexpected GitHub job count")
        jobs = {str(job["id"]): job for job in jobs}
        shards = [row for row in data["shards"] if row["run_id"] == run_id]
        manifests = [row for row in data["manifests"] if row["run_id"] == run_id]
        require(len(shards) == len(manifests) == 2, "Shard or manifest inventory differs")
        for shard in shards:
            discovery = json.loads(shard["discovery_json"])
            manifest = next(row for row in manifests if row["shard_key"] == shard["key"])
            job = jobs[manifest["job_id"]]
            require(shard["state"] == "complete" and shard["source_run_id"] == run_id
                    and shard["source_attempt"] == attempt, "Shard provenance differs")
            require(discovery["jobId"] == str(job["id"])
                    and discovery["attempt"] == attempt
                    and discovery["testedSha"] == TESTED_SHA, "Discovery provenance differs")
            require(job["name"] == "capture / " + shard["key"]
                    and job["run_attempt"] == attempt
                    and job["head_sha"] == CALLER_HEAD
                    and job["status"] == "completed" and job["conclusion"] == "success",
                    "Capture job did not match the successful attempt")
            require(manifest["digest"] == shard["manifest_digest"]
                    and manifest["capture_count"] == 1 and manifest["finalized"] == 1,
                    "Finalized manifest differs")
        images = item_map(data["captures"])
        require(set(images) == expected_items, "Capture inventory differs")
        for key, image in images.items():
            require(image["image_owner_run_id"] == run_id
                    and image["bytes_present"] == image["validated"] == 1,
                    "Current attempt does not own validated image bytes")
            for field in ("digest", "bytes", "width", "height", "profile_digest", "test_id"):
                require(image[field] == source_images[key][field], "Image identity differs")
        job_ids[label] = sorted(int(job) for job in jobs)
    require(set(job_ids["dependent-attempt1"]).isdisjoint(job_ids["dependent-attempt2"]),
            "The full rerun did not replace both jobs")
    for document in (first, second, after):
        rows = item_map(document["datasets"]["comparisonRows"])
        require(set(rows) == expected_items, "Dependent comparison inventory differs")
        for key, row in rows.items():
            require(row["decision_id"] is None
                    and row["source_decision_id"] == source_decisions[key],
                    "Dependent approval lost its exact source decision")
            require(row["reference_capture_id"] == source_rows[key]["reference_capture_id"],
                    "Reference identity differs")
    for document in (second, after):
        runs = {row["id"]: row for row in document["datasets"]["runs"]}
        require(runs[FIRST_RUN]["active"] == 0
                and runs[FIRST_RUN]["state"] == "superseded", "Old attempt is not superseded")
        require(runs[ACTIVE_RUN]["active"] == 1, "Replacement attempt is inactive")

    models = {name: receipt(name) for name in (
        "source-before", "first-dependent-needs-review", "dependent-after-confirmed-rejection",
        "dependent-after-second-undo", "source-after-second-undo",
    )}
    first_item = ("synthetic/first", "chromium-light")
    changed_item = ("synthetic/second", "chromium-light")
    for name, document in models.items():
        model = document["model"]
        expected_run = SOURCE_RUN if name.startswith("source-") else ACTIVE_RUN
        require(model["run"]["id"] == expected_run, "Private model run identity differs")
        require(model["baselineRevision"] == 1, "Baseline revision changed")
        require(model["promotionId"] == models["source-before"]["model"]["promotionId"],
                "Baseline promotion identity changed")
        require(model["run"]["testedSha"] == TESTED_SHA, "Private model source differs")
        require("not an OAuth" in document["scope"], "Synthetic session scope was lost")
        rows = variants(model)
        require(set(rows) == expected_items and rows[first_item]["verdict"] == "approved",
                "Unaffected approval changed")
        pending = "needs-review" in name or "confirmed-rejection" in name
        require(model["run"]["status"] == ("needs-review" if pending else "passed"),
                "Private run status differs")
        require(rows[changed_item]["verdict"] == (None if pending else "approved"),
                "Reused approval was not cleared or restored")
        if pending:
            require(rows[changed_item]["source"] is None, "Invalid source approval remained")
    journal = receipt("source-command-journal")
    operations = journal["operations"]
    require(journal["commands"] == [] and len(operations) == 4,
            "Pending command stack or complete operation journal differs")
    require([operation["mode"] for operation in operations] == ["command", "undo"] * 2,
            "Recorded review operation order differs")
    for index, operation in enumerate(operations):
        require(operation["state"] == ("rejected" if index % 2 == 0 else "passed"),
                "Source operation status differs")
        row = next(value for value in operation["verdicts"]
                   if value["id"] == source_rows[changed_item]["id"])
        require(row["revision"] == 10 + index
                and row["verdict"] == ("rejected" if index % 2 == 0 else "approved"),
                "Source decision revision history differs")
    limit = receipt("first-observation-limit")
    require(limit["sourceRejectAt"] == operations[0]["at"]
            and limit["sourceUndoAt"] == operations[1]["at"], "First-iteration limits differ")
    checks = {
        "first-attempt": (receipt("ariviso-pr7-reuse-check-before-rerun"),
                          106804133256, FIRST_RUN, "success"),
        "before": (receipt("dependent-check-before"), 106806114582, ACTIVE_RUN, "success"),
        "first-unsettled": (receipt("first-check-before-settlement"),
                            106806114582, ACTIVE_RUN, "success"),
        "rejected": (receipt("second-rejection-check"), 106806114582, ACTIVE_RUN, "failure"),
        "restored": (receipt("second-undo-check"), 106806114582, ACTIVE_RUN, "success"),
        "source-restored": (load("github/source-check-after-undo.json"),
                            106710086960, SOURCE_RUN, "success"),
    }
    for check, check_id, run_id, conclusion in checks.values():
        require(check["id"] == check_id and check["external_id"] == "ariviso:" + run_id,
                "Actual App check identity differs")
        require(check["app"]["id"] == 5028451 and check["name"] == "Ariviso",
                "Actual App identity differs")
        require(check["head_sha"] == TESTED_SHA and check["status"] == "completed"
                and check["conclusion"] == conclusion, "Actual check conclusion differs")
    failure = checks["rejected"][0]
    restored = checks["restored"][0]
    observations = receipt("second-rejection-observations")
    require(observations[-1]["conclusion"] == "failure"
            and observations[-1]["completedAt"] == failure["completed_at"],
            "Completed failure was not observed")
    require(timestamp(checks["first-unsettled"][0]["completed_at"])
            < timestamp(operations[0]["at"]), "First check is not the old success")
    require(timestamp(operations[2]["at"]) < timestamp(failure["completed_at"])
            <= timestamp(observations[-1]["at"]) < timestamp(operations[3]["at"])
            < timestamp(restored["completed_at"]), "Second-cycle status ordering differs")
    source_check = receipt("source-after-undo-check")
    for field in ("id", "external_id", "head_sha", "status", "conclusion", "completed_at"):
        require(source_check[field] == checks["source-restored"][0][field],
                "Independent source-check read differs")
    cleanup = receipt("cleanup-verification")
    require(cleanup["fixture"] == "e06-1f64609b-a679-4d22-ac94-5d5f32aae5de"
            and cleanup["counts"] == {"sessions": 0, "accounts": 0, "users": 0}
            and cleanup["localSessionFileRemoved"], "Fixture cleanup was not confirmed")
    require(timestamp(cleanup["checkedAt"])
            > timestamp(models["source-after-second-undo"]["checkedAt"]),
            "Cleanup verification predates the final source observation")
    commit = files["provenance/source-commit.txt"]
    identity = hashlib.sha1(b"commit " + str(len(commit)).encode() + b"\0" + commit).hexdigest()
    require(identity == SOURCE_COMMIT and commit.startswith(("tree " + SOURCE_TREE).encode()),
            "Source commit and tree mapping differs")
    build = load("provenance/ariviso-r5-diagnostic-build-manifest.json")
    require(build["tree"] == SOURCE_TREE and len(build["files"]) == 43,
            "Recorded build artifact manifest differs")
    for name, version in (("web", WEB_VERSION), ("compare", COMPARE_VERSION)):
        log = files["provenance/ariviso-r5-deploy-" + name + ".log"].decode()
        last = json.loads(log.strip().splitlines()[-1])
        require(last["version"] == version and last["bindingsPreserved"]
                and last["cronsPreserved"] and ("version " + version + " at 100%") in log,
                "Recorded deployment confirmation differs")
    return {
        "status": "Local receipt consistency passed; no runtime replay",
        "sourceCommit": SOURCE_COMMIT,
        "sourceTree": SOURCE_TREE,
        "webVersion": WEB_VERSION,
        "compareVersion": COMPARE_VERSION,
        "sourceRun": SOURCE_RUN,
        "supersededRun": FIRST_RUN,
        "activeRun": ACTIVE_RUN,
        "jobIds": job_ids,
        "sourceDecisionIds": sorted(source_decisions.values()),
        "journalOperations": len(operations),
        "firstIterationEstablishesCheckInvalidation": False,
        "secondFailureCompletedAt": failure["completed_at"],
        "secondUndoAt": operations[3]["at"],
        "dependentSuccessCompletedAt": restored["completed_at"],
        "sourceSuccessCompletedAt": source_check["completed_at"],
        "baselineRevision": 1,
        "cleanupVerifiedAt": cleanup["checkedAt"],
        "hostedMutationDuringVerification": False,
        "networkRequestsDuringVerification": 0,
        "oauthProved": False,
        "completeE03OrE06Claimed": False,
        "deploymentLimit": "Version labels agree with saved deployment logs and build manifest; "
                           "omitted artifact bodies are not rehashed or fetched.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    output = args.out.resolve()
    require(not output.exists() and not output.is_relative_to(here.parents[2]),
            "Choose a new output directory outside the repository")
    files = read_archive(here / "frozen-evidence.tar.gz")
    result = check_receipts(files)
    output.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        target = (output / "recorded").joinpath(*checked_name(name))
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(data)
    result.update(archiveSha256=ARCHIVE_SHA256, originalFiles=len(files))
    (output / "VERIFICATION.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

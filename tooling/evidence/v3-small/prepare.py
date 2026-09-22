"""Verify and unpack the exact small v3 drill inputs without network access."""

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile


def digest(content):
    return hashlib.sha256(content).hexdigest()


def checked_path(directory, name):
    relative = PurePosixPath(name)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Invalid evidence path: {name}")
    return directory.joinpath(*relative.parts)


def extract_files(content, directory):
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:") as archive:
        for member in archive:
            if not member.isfile():
                raise ValueError(f"Expected a regular evidence file: {member.name}")
            target = checked_path(directory, member.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    destination = args.destination.resolve()
    if destination.exists():
        raise ValueError("Choose a new destination; existing evidence is not overwritten.")

    here = Path(__file__).resolve().parent
    evidence = here.parents[2] / "docs/evidence/v3-small"
    inputs = json.loads((here / "INPUTS.json").read_text())
    original_manifest = (evidence / "SOURCE-SHA256.json").read_bytes()
    if digest(original_manifest) != inputs["sourceManifestSha256"]:
        raise ValueError("Original source manifest differs.")

    verified = {}
    for record in inputs["files"]:
        content = checked_path(here, record["path"]).read_bytes()
        if len(content) != record["bytes"] or digest(content) != record["sha256"]:
            raise ValueError(f"Compressed input differs: {record['path']}")
        unpacked = gzip.decompress(content)
        if (
            len(unpacked) != record["originalBytes"]
            or digest(unpacked) != record["originalSha256"]
        ):
            raise ValueError(f"Uncompressed input differs: {record['path']}")
        verified[record["path"]] = (content, unpacked)

    recorded = destination / "recorded"
    recorded.mkdir(parents=True)
    for name in ["frozen-replay.tar.gz", "metadata.tar.gz"]:
        extract_files(verified["inputs/" + name][1], recorded)
    (recorded / "fixture/prepared.sql.gz").write_bytes(
        verified["inputs/prepared.sql.gz"][0]
    )
    (recorded / "fixture/seed-objects.portable.json").write_bytes(
        verified["inputs/seed-objects.portable.json.gz"][1]
    )
    for record in json.loads((evidence / "RECEIPTS.json").read_text()):
        content = checked_path(evidence, record["path"]).read_bytes()
        if len(content) != record["bytes"] or digest(content) != record["sha256"]:
            raise ValueError(f"Stored receipt differs: {record['path']}")
        if record["compression"] == "gzip":
            content = gzip.decompress(content)
        if (
            len(content) != record["originalBytes"]
            or digest(content) != record["originalSha256"]
        ):
            raise ValueError(f"Original receipt differs: {record['path']}")
        target = checked_path(recorded, record["sourcePath"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (recorded / "SHA256.json").write_bytes(original_manifest)
    source_hashes = json.loads(original_manifest)
    for name, expected in source_hashes.items():
        if digest(checked_path(recorded, name).read_bytes()) != expected:
            raise ValueError(f"Reconstructed original file differs: {name}")

    fixture = destination / "fixture"
    fixture.mkdir()
    with (fixture / "prepared.sql").open("xb") as output:
        output.write(verified["inputs/prepared.sql.gz"][1])
    (fixture / "prepared.sql").chmod(0o600)
    manifest = json.loads(verified["inputs/seed-objects.portable.json.gz"][1])
    for entry in manifest["objects"]:
        if entry["bucket"] == "quarantine":
            entry["sourcePath"] = str(
                checked_path(recorded / "fixture", entry["sourcePath"])
            )
    save_json(fixture / "seed-objects.json", manifest)

    replay = destination / "replay"
    for name in ["controller", "worker"]:
        shutil.copytree(recorded / name, replay / name)
    config = json.loads((recorded / "wrangler.template.json").read_text())
    save_json(replay / "wrangler.jsonc", config)
    controller_config = {**config, "main": "../worker/worker.js"}
    save_json(replay / "controller/wrangler.jsonc", controller_config)
    save_json(
        replay / "controller/resources.json",
        {
            "accountId": config["account_id"],
            "worker": config["name"],
            "databases": config["d1_databases"],
            "buckets": [
                entry for entry in config["r2_buckets"] if entry["binding"] != "CORPUS"
            ],
        },
    )
    print(
        json.dumps(
            {
                "verifiedOriginalFiles": len(source_hashes),
                "recordedPackage": str(recorded),
                "fixtureDirectory": str(fixture),
                "replayDirectory": str(replay),
                "configuration": "Fresh writable resource placeholders require operator setup.",
                "externalInput": "The original private image corpus is not included.",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

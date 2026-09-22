#!/usr/bin/env python3
"""Unpack verified frozen evidence and check its numeric receipts locally."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile


ARCHIVE_SHA256 = "9c76d5e5698d6aa7af12e61c9bfda18e2a82315df706838106f8d3ef74392edb"
MANIFEST_SHA256 = "768e0a52750c20159bea94df9009eba93af4962abb58359b502e62f4a884a172"
VERIFIER_SHA256 = "4a94dfb7eff588f76bb4165cddda37d06977448c3a696260f67ecfe7be72c3f2"


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
        require(len(members) == 65, "Unexpected archive file count")
        require(sum(member.size for member in members) == 1409455, "Unexpected archive size")
        for member in members:
            checked_name(member.name)
            require(member.isfile(), "Links and special archive entries are refused")
            require(member.name not in files, "Duplicate archive path")
            with archive.extractfile(member) as source:
                files[member.name] = source.read()
            require(len(files[member.name]) == member.size, "Truncated archive file")
    require(digest(files["SHA256.json"]) == MANIFEST_SHA256, "Original manifest changed")
    require(digest(files["verify.py"]) == VERIFIER_SHA256, "Original verifier changed")
    manifest = json.loads(files["SHA256.json"])
    require(set(manifest) == set(files) - {"SHA256.json"}, "Original file inventory changed")
    for name, expected in manifest.items():
        require(digest(files[name]) == expected, "Original file hash differs: " + name)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    repository = args.repository.resolve()
    output = args.out.resolve()
    require(
        not output.exists()
        and not output.is_relative_to(repository)
        and not output.is_relative_to(here),
        "Choose a new output directory outside the repository and evidence directory",
    )
    files = read_archive(here / "frozen-evidence.tar.gz")
    output.mkdir(parents=True, exist_ok=False)
    recorded = output / "frozen-package"
    for name, data in files.items():
        target = recorded.joinpath(*checked_name(name))
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(data)
    verification = output / "numeric-check"
    # The exact archived verifier only reconstructs and calculates local data.
    # Isolated Python mode prevents inherited import paths from changing it.
    subprocess.run(
        [
            sys.executable,
            "-I",
            "-B",
            str(recorded / "verify.py"),
            "--repository",
            str(repository),
            "--out",
            str(verification),
        ],
        check=True,
    )
    result = {
        "status": "Frozen evidence hashes and local numeric verification passed",
        "archiveSha256": ARCHIVE_SHA256,
        "originalManifestSha256": MANIFEST_SHA256,
        "originalVerifierSha256": VERIFIER_SHA256,
        "originalPackageFiles": len(files),
        "recordedPackage": str(recorded),
        "verification": str(verification / "VERIFICATION.json"),
        "networkRequests": 0,
        "hostedReplay": False,
    }
    (output / "PREPARATION.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

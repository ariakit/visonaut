#!/usr/bin/env python3
"""Test the portable verifier with local mutations, without private evidence."""

import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("capture_evidence_verifier", HERE / "verify.py")
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class VerifierTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ariviso-capture-verifier-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.package = self.root / "repository/tooling/evidence/ariakit-capture-measurement"
        self.package.mkdir(parents=True)
        for name in ("verify.py", "frozen-evidence.tar.gz"):
            shutil.copyfile(HERE / name, self.package / name)

    def run_cli(self, output):
        return subprocess.run(
            [sys.executable, "-B", str(self.package / "verify.py"), "--out", str(output)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_complete_check_extracts_exact_originals(self):
        output = self.root / "checked"
        result = self.run_cli(output)
        self.assertEqual(result.returncode, 0, result.stderr)
        files = VERIFIER.read_archive(HERE / "frozen-evidence.tar.gz")
        extracted = {
            path.relative_to(output / "frozen-package").as_posix(): path.read_bytes()
            for path in (output / "frozen-package").rglob("*")
            if path.is_file()
        }
        self.assertEqual(extracted, files)
        receipt = json.loads((output / "VERIFICATION.json").read_text())
        self.assertEqual(receipt["recordedHistoricalAuditTotals"]["captures"], 10746)
        self.assertEqual(
            receipt["recordedHistoricalAuditTotals"]["failedMarkerPngJoinsAndHashesVerified"],
            4,
        )
        for key in (
            "privateImagesRevalidated",
            "sourceAndCodecBodiesRevalidated",
            "recordedQuantilesRecalculated",
            "executedHistoricalScripts",
            "hostedReplay",
        ):
            self.assertFalse(receipt[key])

    def test_existing_output_is_untouched(self):
        output = self.root / "existing"
        output.mkdir()
        marker = output / "preserve"
        marker.write_bytes(b"existing content")
        result = self.run_cli(output)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(output.iterdir()), [marker])
        self.assertEqual(marker.read_bytes(), b"existing content")

    def test_output_within_repository_is_refused(self):
        output = self.package / "new-output"
        self.assertNotEqual(self.run_cli(output).returncode, 0)
        self.assertFalse(output.exists())

    def test_same_size_archive_corruption_creates_no_output(self):
        path = self.package / "frozen-evidence.tar.gz"
        data = bytearray(path.read_bytes())
        data[-1] ^= 1
        path.write_bytes(data)
        output = self.root / "rejected"
        result = self.run_cli(output)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Frozen archive hash changed", result.stderr)
        self.assertFalse(output.exists())

    def test_unsafe_members_are_refused_after_outer_identity_check(self):
        with tarfile.open(HERE / "frozen-evidence.tar.gz", "r:gz") as source:
            original = [(copy.copy(item), source.extractfile(item).read()) for item in source]
        scenarios = (
            ("traversal", "../escape", None, "Unsafe archive path"),
            ("absolute", "/escape", None, "Unsafe archive path"),
            ("backslash", "folder\\escape", None, "Unsafe archive path"),
            ("noncanonical", "./escape", None, "Unsafe archive path"),
            ("symlink", "link", tarfile.SYMTYPE, "Links and special entries"),
            ("duplicate", original[1][0].name, None, "Duplicate archive path"),
        )
        for label, name, kind, expected in scenarios:
            with self.subTest(label=label):
                entries = [(copy.copy(item), data) for item, data in original]
                entries[0][0].name = name
                if kind is not None:
                    entries[0][0].type = kind
                    entries[0][0].linkname = "outside"
                    removed_size = entries[0][0].size
                    entries[0][0].size = 0
                    entries[0] = (entries[0][0], b"")
                    final_member, final_data = entries[-1]
                    final_member.size += removed_size
                    entries[-1] = (final_member, final_data + bytes(removed_size))
                content = io.BytesIO()
                with tarfile.open(fileobj=content, mode="w:gz") as target:
                    for item, data in entries:
                        target.addfile(item, io.BytesIO(data))
                self.check_inner_rejection(content.getvalue(), expected)

    def check_inner_rejection(self, data, expected):
        path = self.root / "mutated.tar.gz"
        path.write_bytes(data)
        saved = VERIFIER.ARCHIVE_SHA256, VERIFIER.ARCHIVE_BYTES
        try:
            # Test the inner parser after deliberately replacing only its outer pin in memory.
            VERIFIER.ARCHIVE_SHA256 = hashlib.sha256(data).hexdigest()
            VERIFIER.ARCHIVE_BYTES = len(data)
            with self.assertRaisesRegex(ValueError, expected):
                VERIFIER.read_archive(path)
        finally:
            VERIFIER.ARCHIVE_SHA256, VERIFIER.ARCHIVE_BYTES = saved

    def test_archive_inventory_and_file_hashes_are_enforced(self):
        with tarfile.open(HERE / "frozen-evidence.tar.gz", "r:gz") as source:
            original = [(copy.copy(item), source.extractfile(item).read()) for item in source]
        for scenario in ("missing", "size", "manifest", "file"):
            with self.subTest(scenario=scenario):
                entries = [(copy.copy(item), data) for item, data in original]
                if scenario == "missing":
                    entries.pop()
                    expected = "Unexpected archive file count"
                elif scenario == "size":
                    item, data = entries[-1]
                    item.size += 1
                    entries[-1] = (item, data + b"x")
                    expected = "Unexpected uncompressed size"
                else:
                    index = 0 if scenario == "manifest" else 1
                    item, data = entries[index]
                    entries[index] = (item, bytes([data[0] ^ 1]) + data[1:])
                    expected = "Manifest changed" if scenario == "manifest" else "File hash differs"
                content = io.BytesIO()
                with tarfile.open(fileobj=content, mode="w:gz") as target:
                    for item, data in entries:
                        target.addfile(item, io.BytesIO(data))
                self.check_inner_rejection(content.getvalue(), expected)

    def test_recorded_count_mismatch_is_refused(self):
        files = VERIFIER.read_archive(HERE / "frozen-evidence.tar.gz")
        summary = json.loads(files["summary.json"])
        summary["configuredCapturesPerFullPass"] += 1
        files["summary.json"] = json.dumps(summary).encode()
        with self.assertRaisesRegex(ValueError, "Workload captures differ"):
            VERIFIER.verify_receipts(files)


if __name__ == "__main__":
    unittest.main()

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ReplayPreparationTest(unittest.TestCase):
    def test_prepare_from_current_workspace_manifest(self):
        workspace = Path(__file__).resolve().parents[3]
        wrapper = Path(__file__).with_name("prepare-replay.py")
        with tempfile.TemporaryDirectory(prefix="visonaut-replay-test-") as temporary:
            result = subprocess.run(
                [sys.executable, str(wrapper), "--workspace", str(workspace)],
                cwd=temporary,
                env={**os.environ, "TMPDIR": temporary},
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt, _ = json.JSONDecoder().raw_decode(result.stdout)
            replay = Path(receipt["replayWorkspace"]).resolve()
            self.assertTrue(replay.is_relative_to(Path(temporary).resolve()))
            self.assertEqual(receipt["networkRequests"], 0)
            self.assertFalse(receipt["originalResultsModified"])
            for verified_files in receipt["verifiedFiles"].values():
                self.assertGreater(verified_files, 0)
            self.assertEqual(
                json.loads((replay / "package.json").read_text()),
                json.loads((workspace / "package.json").read_text()),
            )


if __name__ == "__main__":
    unittest.main()

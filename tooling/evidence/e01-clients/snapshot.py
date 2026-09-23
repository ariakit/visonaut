"""Copy source to an isolated directory and reproduce the local browser evidence."""

import argparse
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("repository", type=Path)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
root = args.repository.resolve()
destination = args.destination.resolve()
destination.mkdir(exist_ok=False)
for name in ["protocol", "playwright", "compare"]:
    shutil.copytree(root / "packages" / name, destination / "packages" / name,
                    ignore=shutil.ignore_patterns("node_modules", "dist", ".fixture-*"))
for name in ["package.json", "tsconfig.json", "vitest.config.ts"]:
    shutil.copy2(root / name, destination / name)
(destination / "node_modules").symlink_to(root / "node_modules", target_is_directory=True)
for name in ["playwright", "compare"]:
    modules = destination / "packages" / name / "node_modules"
    modules.mkdir()
    for link in (root / "packages" / name / "node_modules").iterdir():
        if link.name == "@ariviso":
            (modules / link.name).mkdir()
            (modules / link.name / "protocol").symlink_to(destination / "packages/protocol", target_is_directory=True)
        else:
            (modules / link.name).symlink_to(link.resolve(), target_is_directory=link.is_dir())
here = Path(__file__).resolve().parent
shutil.copy2(here / "run.mjs", destination / "run.mjs")
shutil.copytree(here / "fixtures", destination / "fixtures")
(destination / "results").mkdir()
tsup = str(root / "node_modules/.bin/tsup")
subprocess.run([tsup], cwd=destination / "packages/playwright", check=True)
subprocess.run([tsup, "src/index.ts", "--format", "esm", "--out-dir", "dist"],
               cwd=destination / "packages/protocol", check=True)
subprocess.run(["node", "run.mjs"], cwd=destination, check=True)

"""Prepare the frozen local probe using an existing repository dependency install."""
import argparse
import json
from pathlib import Path
import shutil
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--repository', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
arguments = parser.parse_args()
repository = arguments.repository.resolve()
output = arguments.output.resolve()
source = Path(__file__).resolve().parent
if not (repository / 'node_modules').is_dir():
    raise SystemExit('Install the repository pinned dependencies first.')
if output.exists() and any(output.iterdir()):
    raise SystemExit('The output directory must be absent or empty.')
output.mkdir(parents=True, exist_ok=True)
with tarfile.open(source / 'frozen-source.tar.gz', 'r:gz') as archive:
    archive.extractall(output, filter='data')
for name in ['worker.mjs', 'comparator.mjs', 'build.mjs', 'run.mjs']:
    shutil.copy2(source / name, output / name)
(output / 'package.json').write_text(json.dumps({'type': 'module', 'private': True}) + '\n')
(output / 'results').mkdir()
(output / 'source/node_modules').symlink_to(repository / 'node_modules', target_is_directory=True)
projects = ['packages/cli', 'packages/protocol', 'packages/service', 'packages/security', 'packages/compare', 'apps/web', 'apps/compare']
for project in projects:
    dependencies = output / 'source' / project / 'node_modules'
    dependencies.mkdir()
    installed = repository / project / 'node_modules'
    if installed.is_dir():
        for dependency in installed.iterdir():
            if dependency.name == '@ariviso':
                continue
            (dependencies / dependency.name).symlink_to(dependency.resolve(), target_is_directory=dependency.is_dir())
    scope = dependencies / '@ariviso'
    scope.mkdir()
    for package in ['protocol', 'service', 'security', 'compare']:
        (scope / package).symlink_to(output / 'source/packages' / package, target_is_directory=True)
print(f'Prepared local probe: {output}')

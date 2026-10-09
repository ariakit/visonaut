# Applies one exact text replacement to a file of the lane folder.
# Usage: python3 small-edit.py <file> <old> <new> [count]
import pathlib
import sys

lane = pathlib.Path(__file__).resolve().parent.parent
target = lane / sys.argv[1]
old, new = sys.argv[2], sys.argv[3]
count = int(sys.argv[4]) if len(sys.argv) > 4 else 1
source = target.read_text()
found = source.count(old)
if found != count:
    raise SystemExit(f"expected {count}, found {found}: {old[:90]}")
target.write_text(source.replace(old, new))
print("replaced", found)

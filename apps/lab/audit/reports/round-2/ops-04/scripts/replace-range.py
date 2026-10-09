# Replaces one range of new-part.html with the content of a file in parts/.
# Usage: python3 replace-range.py <start mark> <end mark> <part file>
# The range starts at the start mark and ends before the end mark.
import pathlib
import sys

lane = pathlib.Path(__file__).resolve().parent.parent
start_mark, end_mark, part_name = sys.argv[1], sys.argv[2], sys.argv[3]
target = lane / "new-part.html"
source = target.read_text()
if source.count(start_mark) != 1 or source.count(end_mark) != 1:
    raise SystemExit("A mark was not found exactly one time.")
start = source.index(start_mark)
end = source.index(end_mark)
if end < start:
    raise SystemExit("The end mark is before the start mark.")
part = (lane / "parts" / part_name).read_text()
target.write_text(source[:start] + part + source[end:])
print(f"replaced {end - start} characters with {len(part)}")

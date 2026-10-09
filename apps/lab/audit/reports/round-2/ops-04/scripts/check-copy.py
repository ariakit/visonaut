# Checks that the lane copy of the record differs from the record only in the part of
# this lane, and that the copy agrees with the two patch files. Read-only.
import json
import pathlib

lane = pathlib.Path(__file__).resolve().parent.parent
record = pathlib.Path(
    "/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel"
    "/apps/lab/audit/content"
)
copy = lane / "content"

changed = []
for file in sorted(record.rglob("*")):
    if not file.is_file():
        continue
    other = copy / file.relative_to(record)
    if not other.exists() or other.read_bytes() != file.read_bytes():
        changed.append(str(file.relative_to(record)))
print("files that differ:", changed)

section = "sections/35-state-checks.html"
before = (record / section).read_text()
after = (copy / section).read_text()
start_mark = '  <h3 id="state-checks-pins">'
end_mark = '  <div data-decision="D-OPS-04"></div>'
print(
    "text before the part is equal:",
    before[: before.index(start_mark)] == after[: after.index(start_mark)],
)
print(
    "text from the placeholder is equal:",
    before[before.index(end_mark) :] == after[after.index(end_mark) :],
)
print("placeholders of D-OPS-04:", after.count('data-decision="D-OPS-04"'))

old_decisions = json.loads((record / "decisions.json").read_text())
new_decisions = json.loads((copy / "decisions.json").read_text())
print(
    "changed decisions:",
    [old["id"] for old, new in zip(old_decisions, new_decisions) if old != new],
    len(old_decisions),
    len(new_decisions),
)
patch = json.loads((lane / "decisions.patch.json").read_text())
by_id = {decision["id"]: decision for decision in new_decisions}
print("decisions agree with the patch:", all(by_id[item["id"]] == item for item in patch))

old_terms = json.loads((record / "terms.json").read_text())
new_terms = json.loads((copy / "terms.json").read_text())
old_names = {term["term"] for term in old_terms}
print("new terms:", [term["term"] for term in new_terms if term["term"] not in old_names])
print(
    "changed terms:",
    [term["term"] for term in new_terms if term["term"] in old_names and term not in old_terms],
)
term_patch = json.loads((lane / "terms.patch.json").read_text())
by_name = {term["term"]: term for term in new_terms}
print("terms agree with the patch:", all(by_name[item["term"]] == item for item in term_patch))

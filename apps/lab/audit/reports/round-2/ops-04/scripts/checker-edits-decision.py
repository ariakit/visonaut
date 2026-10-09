# Checker edit: shorter consequences for options 1 and 2 of D-OPS-04 in
# decisions.patch.json. The patch stays one JSON list with the complete decision.
import json
import pathlib

lane = pathlib.Path(__file__).resolve().parent.parent
target = lane / "decisions.patch.json"
patch = json.loads(target.read_text())
decision = patch[0]
options = {option["id"]: option for option in decision["options"]}

options["no-file-check"]["consequences"] = (
    "Consumer: delete one line, then nothing for each kind of workflow edit. The consumer "
    "keeps the Submit job of 44 lines. Gives up: a pull request can replace the Submit job, "
    "and then code of the pull request counts the changed pixels. A pull request can also "
    "send the no-visual report for itself. Only the review of the pull request is left: the "
    "workflow edit is in its diff. The count of loose settings of D-AUTH-04 is then true only "
    "when the pull request did not replace the Submit job. The same 5 accounts with push "
    "access can already make false screenshots in the capture code (TRUST-03). The least to "
    "build: it deletes code in both repositories and needs one CLI release. Changes the "
    "earlier decisions A02 and D39 (a pinned file of Ariakit holds the list of the required "
    "capture jobs) and contract lines 218 to 230."
)

options["service-workflow"]["consequences"] = (
    "Consumer: one refactor and one rule of 4 lines in renovate.json. The Submit job goes "
    "from 44 lines to 8, and the repository variable goes away. After that, no workflow edit "
    "and no Renovate update needs a service change, and no failure window exists. Keeps: a "
    "pull request cannot replace the Submit job, and it cannot send the no-visual report for "
    "itself. 2 accounts can change the Submit file in ariakit/visonaut. 5 accounts can push "
    "to ariakit/ariakit. Gives up: the service no longer checks the text of the capture steps "
    "and of the other CI jobs. Those steps already run pull request code (TRUST-03). A merged "
    "change of ci.yml can change when the no-visual report is sent. Cost for the service: the "
    "new workflow file, one CLI release, changes in the 7 files that compare a pin, and one "
    "last pin cutover. The package digest line of app.yml (PIPE-05) moves to the service file "
    "or goes away. Changes the earlier decisions A02 and D39 (the service file then holds the "
    "list of the required capture jobs) and contract lines 218 to 230. Not verified in these "
    "two repositories: one run before the cutover must confirm the claim for the branch main."
)

target.write_text(json.dumps(patch, indent=2, ensure_ascii=False) + "\n")
print("done")

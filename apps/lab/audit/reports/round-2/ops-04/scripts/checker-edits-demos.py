# Checker edits of the three situation demos and of the recommendation text in
# new-part.html. Each replacement must match exactly the stated number of times.
import pathlib

lane = pathlib.Path(__file__).resolve().parent.parent
target = lane / "new-part.html"
source = target.read_text()


def replace(old, new, count=1):
    global source
    found = source.count(old)
    if found != count:
        raise SystemExit(f"expected {count}, found {found}: {old[:90]}")
    source = source.replace(old, new)


replace(
    """    Each chart is one situation. Select an option with a button. The text of each option says what
    the consumer does, what the service maintainer does, and what the check shows.""",
    """    Each chart is one situation. Select one option with a button below “Presets”. The text of each
    option says what the consumer does, what the service maintainer does, and what the check shows.
    Outlined bars show today.""",
)

# Situation 1.
replace(
    '"limits": "This is a model. The bars use the measured ranges of 4 pin cutovers and of 4 service pull requests on 2026-10-02 and 2026-10-03, in whole minutes. The review before a merge with the admin bypass is assumed to take the same time as the review of today. The model does not show the runs that started before the merge and fail up to 15 minutes after it.",',
    '"limits": "This is a model. The bars use the measured ranges of 4 pin cutovers and of 4 service pull requests on 2026-10-02 and 2026-10-03, in whole minutes. The time from the end of the capture to the merge is the measured failure window minus 15 minutes. The review before a merge with the admin bypass is assumed to take the same time. Use one option at a time: the checkboxes are the options, and two of them together give no real case. The model does not show the runs that started before the merge and fail up to 15 minutes after it.",',
)
replace(
    """            "label": "Consumer: Submit passes, the check passes, review, merge",
            "lane": "github",
            "duration": [19, 22, 26],
            "after": ["capture"],
            "fact": "measured\"""",
    """            "label": "Consumer: Submit passes, the check passes, review, merge",
            "lane": "github",
            "duration": [19, 22, 26],
            "after": ["capture"],
            "fact": "estimate\"""",
)
replace(
    '"explanation": "Consumer: pushes the edit and merges as for each pull request. Service maintainer: nothing, because app.yml has no pin. Check: the normal Visonaut check of the pull request.",',
    '"explanation": "Consumer: pushes the edit and merges as for each pull request. Service maintainer: nothing, because app.yml has no pin and the build step is not in the service file. Check: the normal Visonaut check of the pull request.",',
)
replace(
    '"explanation": "Consumer: pushes the edit. The capture runs, then the service refuses Submit, because app.yml is not the file of main. An administrator of Ariakit merges with the admin bypass. Service maintainer: nothing. Check: none on this pull request.",',
    '"explanation": "Consumer: pushes the edit. The capture runs, then the service refuses Submit, because app.yml is not the file of main. A repository administrator of Ariakit merges with the admin bypass. Service maintainer: nothing. Check: none on this pull request.",',
)
replace('"label": "4. A02: one small pinned workflow",', '"label": "4. One small pinned workflow",', 3)
replace(
    '"explanation": "The build step is outside the small file, so no pin changes. Consumer: pushes the edit and merges as for each pull request. Service maintainer: nothing. Check: the normal Visonaut check.",',
    '"explanation": "This is the earlier decision A02. The build step is outside the small file, so no pin changes. Consumer: pushes the edit and merges as for each pull request. Service maintainer: nothing. Check: the normal Visonaut check.",',
)

# Situation 2.
replace(
    '"limits": "This is a model, and no such update came since the pins exist. Renovate opens its pull request first, so the first Submit fails. The capture time and the service times are measured values. The 5 minutes for a re-run of Submit with a merge, and for a merge with the admin bypass, are assumptions.",',
    '"limits": "This is a model, and no such update came since the pins exist. Renovate opens its pull request first, so the first Submit fails. The capture time and the service times are measured values. The 5 minutes for a merge, for a re-run of Submit with a merge, and for a merge with the admin bypass are assumptions. Use one option at a time.",',
)
replace(
    """                  "label": "Submit passes, the check passes, merge",
                  "lane": "github",
                  "duration": 5,
                  "after": ["capture"],
                  "fact": "measured\"""",
    """                  "label": "Submit passes, the check passes, merge",
                  "lane": "github",
                  "duration": 5,
                  "after": ["capture"],
                  "fact": "assumption\"""",
    2,
)
replace(
    '"explanation": "Consumer: nothing special. The pull request of Renovate passes alone, because no consumer file has a pin. Service maintainer: nothing for this pull request. The actions inside the Submit job are updated in the service repository, with no consumer change. Check: the normal Visonaut check.",',
    '"explanation": "Consumer: nothing special. The pull request of Renovate passes alone, because no consumer file has a pin. Service maintainer: nothing for this pull request. The actions of the Submit job are in the service file, and their updates are pull requests in the service repository. Check: the normal Visonaut check.",',
)
replace(
    '"explanation": "Consumer: an administrator of Ariakit merges the pull request of Renovate with the admin bypass, after a capture that cannot pass. Service maintainer: nothing. Check: none on this pull request.",',
    '"explanation": "Consumer: a repository administrator of Ariakit merges the pull request of Renovate with the admin bypass, after a capture that cannot pass. Service maintainer: nothing. Check: none on this pull request.",',
)
replace(
    '"explanation": "The same as today. The capture and Submit jobs use the same 4 actions, so the update of Renovate also edits the small file. Service maintainer: pull request, deployment, variable. Check: none until the pin cutover is done.",',
    '"explanation": "The same as today. The capture and Submit jobs use the same actions (checkout, upload-artifact, download-artifact), so the update of Renovate also edits the small file. Service maintainer: pull request, deployment, variable. Check: none until the pin cutover is done.",',
)
replace(
    '"label": "Administrator of Ariakit: review the workflow diff, then merge with the admin bypass",',
    '"label": "Repository administrator of Ariakit: review the workflow diff, then merge with the admin bypass",',
    2,
)

# Situation 3.
replace(
    "The time is the same in each option: the options differ in the answer of the service, which is the text of the second row.\",",
    "The time is the same in each option: the options differ in the answer of the service, which is the text of the second row. Use one option at a time.\",",
)
replace(
    '"explanation": "Service: accepts, because the capture step is a consumer file. The judge is honest: the captures are equal to the baseline, so the count is 0. Check: Visual review passed. Consumer: only the reviewer of the pull request can stop it. The same attack works today through app/package.json, with no workflow edit. An edit of the Submit call is refused in this option.",',
    '"explanation": "Service: accepts, because the service does not check the capture step. The judge is honest: the captures are equal to the baseline, so the count is 0. Check: Visual review passed. Consumer: only the reviewer of the pull request can stop it. The same attack works today with an edit of the script test-visual in app/package.json, and no workflow edit. An edit of the Submit call is refused in this option.",',
)
replace(
    '"explanation": "Service: refuses, as today, because the capture step is in the small pinned file. Check: none. Service maintainer: nothing.",',
    '"explanation": "Service: refuses, as today, because the capture step is in the small pinned file. Check: none. Service maintainer: nothing. The same attack through app/package.json is accepted, as today.",',
)

replace(
    '<th scope="row">4, 5, 6. A hash pin</th>',
    '<th scope="row">4, 5, 6. A pin of the file hash</th>',
)
replace(
    """          False screenshots from the code that the capture step runs: accepted.
          <span data-findings="TRUST-03"></span>""",
    """          False screenshots from the code that the capture step runs, with no workflow edit:
          accepted. <span data-findings="TRUST-03"></span>""",
)

start = source.index(
    """  <p>
    <strong>Recommendation: option 2.</strong>"""
)
source = source[:start] + (lane / "parts" / "recommendation.html").read_text()
target.write_text(source)
print("done")

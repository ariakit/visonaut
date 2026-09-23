# Deployed diagnostic browser evidence

The deployed diagnostic run passed read-only browser checks in Chrome 154.0.8037.44 on 2026-09-22. The browser used the existing synthetic diagnostic session with authorization added only to this origin’s API requests. This is deployed application evidence with real server permission checks; it is not OAuth evidence.

- Run: `7f114089-e7e9-41be-bb3a-977d5fa88eec`.
- The real run API and `/api/me` returned 200. All eight observed image requests returned 200.
- The viewer showed reference, new image, and red pixel differences. At 100%, the 160-pixel image rendered at 160 pixels. At 200%, it rendered at 320 pixels. Fit displayed the complete image.
- The observed evidence states were loading, ready, loading, ready, loading, ready. Keyboard focus stayed on the selected review target through mode changes.
- No console or page errors were recorded. No decision, Undo, recompare, or other state-changing review request was sent. The only POST was normal `/api/review-sessions` setup (201).
- Before and after API snapshots match exactly, including comparison revision 15, baseline revision 1, promotion ID, and both approved variant revisions.

`deployed-readonly-review.webm` is a 32.24-second recording at 1440 × 1280 (806 frames, 25 fps). All decoded frames were reviewed in nine contact sheets. Full frames at 4, 10, 14, and 17 seconds and both final screenshots were also inspected. The initial access-loading screen remains in the recording, followed by the complete review workspace and successful image/zoom interactions. This capture does not measure a performance SLO. An error path was not forced because this pass used real responses and made no review mutations.

The [sanitized receipt](./deployed-review-readonly.json) contains sanitized requests, response status codes, exact deployed asset filenames, the unchanged API state, and artifact SHA-256 hashes. No bearer, credential, request header, or private email is included in these artifacts. The shared diagnostic session file was not changed.

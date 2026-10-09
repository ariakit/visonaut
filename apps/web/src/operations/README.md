# Operations integration

The [current guide](../../../../docs/current-contract.md) owns current requirements and the issue #204 targets. This runbook describes source behavior before the selected retirements. Apply all numbered web D1 migrations in order. Preserve applied migrations as history, including both `0030_*` files and the narrow zero-pixel correction. The live service uses one D1 database, IMAGES, QUARANTINE, and the existing queues. The web Worker owns comparison recovery; the compare Worker consumes work and publishes a status wakeup.

Use named messages on OPERATIONS. A review or completed comparison sends `status`. Trusted Submit sends `ingest`. Cron sends `recovery`. A bounded maintenance step sends a continuation for its own family. A status wakeup runs checks, review links, and promotion without scanning closed history or retention.

```ts
await operationsQueue.send({ kind: "status", comparisonId });
await operationsQueue.send({ kind: "maintenance", family: "history" });
```

D1 identities, conditional writes, leases, and immutable R2 keys control repeat delivery. The [typed runtime defaults](../runtime-defaults.ts) preserve the committed preview and production budgets. Use the existing `VISONAUT_OPERATIONS_BUDGET` JSON string for validated incident overrides. A missing binding or `{}` uses those defaults; a partial object changes only its named fields. Complete objects for the remaining fields and decimal-string values remain supported. Remove the retired export-only `maximumMetadataBytes` and `maximumExportEntries` fields from custom overrides before final export retirement. Unknown fields and invalid values reject the whole override. Operations pages still cannot exceed 1,000 entries. `maximumObjectBytes` bounds one image or metadata page. These limits are separate from database-capacity admission.

## Durable decisions and sealed recovery

The review client admits authorized decisions into D1 work and receives HTTP 202. Admission is separate from a saved verdict. OPERATIONS processes review work even after the browser closes. Keep exact command IDs, predecessor order, actor-specific receipts, failed-predecessor handling, leases/retries, and replay after a crash. Queued or leased review tasks block completion/promotion. Aborting a browser wait does not cancel stored work. Keep this queue when legacy comparison consumers retire. See [review queue](review-queue.ts) and [review API](../api/review.ts).

Keep the current [sealed-run recovery](../api/workflow-materialize.ts). An active sealed run with no comparison can resume from its stored validated local Submit receipt. Keep its eligibility query; missing or invalid receipt evidence must fail closed. This is current recovery work, not a legacy comparison helper.

## Baselines and closed history

New accepted snapshots point to immutable source originals. Promotion reads and hashes each distinct original once per bounded page. It writes no protected image copy. Before promotion starts, D1 pins the snapshot's run and every inherited image owner. A missing or corrupt original blocks promotion. Promotion closes the review at the promotion time. The final GitHub check remains passed. A promoted review is read-only. A correction requires a new complete main capture.

Each new run owns its verified approval. A copied approval records its source decision ID, actor, and exact tuple. Verification still requires the allowed lineage and the exact reference, candidate, rendering identity, policy, engine, and codec. A later edit to the source decision does not revoke a downstream copy. Migration `0024` converts valid active links and clears invalid active links. It preserves closed links as historical evidence.

Rendering identity excludes comparison policy and engine. The converter verifies the original stored profile digest before saving its rendering digest. Required old tuples retain their original JSON beside the converted tuple. Comparison policy, engine, and codec remain in the acceptance tuple; conversion does not change the selected policy.

Closed runs keep their identity, status, all actor decisions, exact tuples, explicit approval eligibility, and a compact audit summary in D1. At the existing 30-day boundary, the history step creates or converts this summary before the byte collector can claim the run. Before this boundary, some non-promoted closed legacy runs can create a read-only comparison from retained native D1 captures. Local-comparison runs cannot reconstruct omitted candidate bytes and reject this request. D05/W06 selects read-only history for every closed run; that target still needs implementation and settlement of outstanding historical work. The operation does not rehydrate old archives. At expiry, the read path serves a terminal summary. It does not rehydrate captures, recompute historical comparisons, or replay archived commands. Owner pins still block byte deletion. A baseline can retain originals after its detailed review has closed.

## Conversion before deployment

The current source removes the one-time source-baseline helper, its maintenance family, and the Deploy `inspect` and `convert` controls. Keep the [historical runner instructions](../../../../docs/history/operations/simplification-cutover.md#one-time-conversion-runner) and dated conversion receipts. Before deployment, verify the exit checks below in each exact environment. Source removal does not establish live readiness. Normal migrations, source promotion, on-demand rendering conversion, native recovery, retention, and `summarizeClosedRuns` remain.

Drain or cancel old workflow attempts before switching to the combined Submit path. Release their obsolete `workflow-rerun:` retention pins only after those attempts are terminal. Do not discard an unfinished attempt merely because its old writer was removed.

The removed `convertSourceBaselines` operation required old protected snapshots to pass original readback. It installed pins for live owners, verified an existing source original or restored it from the protected copy, and verified destination readback. An already deleted source owner could become live only with a one-use verified baseline-conversion receipt. The receipt, source pins, and snapshot switch settled in one transaction. Keep the applied restoration table and trigger as migration history. A run being deleted cannot be restored. Normal byte resurrection remains prohibited. The conversion kept old protected objects.

Keep the legacy archive branch in `summarizeClosedRuns` while retained archives can still need it. Old ready history archives must pass this operation. The converter verifies each archive page and saves resumable progress. It joins saved metadata and decisions only after all pages pass. Row counts, the source revision, decision evidence, and foreign keys must agree before the compact reader is enabled. An incomplete or corrupt conversion retains its source evidence and reports attention. Candidate cursors let later valid records proceed.

Check these counts after conversion and before removing the remaining conversion helpers. Require zero required protected snapshots, zero unconverted expired closed records, and no unresolved conversion failures. Run the checks in both environments. A nonzero count is a cutover gate, not permission to delete the source.

```sql
SELECT COUNT(*) AS required_protected_snapshots
FROM visonaut_snapshots snapshot
WHERE storage_mode='protected'
  AND (reference_eligible=1 OR EXISTS (
    SELECT 1 FROM visonaut_pins WHERE snapshot_id=snapshot.id));

SELECT COUNT(*) AS unconverted_closed_records
FROM visonaut_runs run
WHERE active=0 AND closed_at<=unixepoch()*1000-2592000000
  AND NOT EXISTS (SELECT 1 FROM visonaut_closed_summaries summary
    WHERE summary.run_id=run.id AND summary.state='ready');

SELECT kind,subject_id,code FROM operations_events
WHERE resolved_at IS NULL AND kind IN ('baseline-conversion','history');
PRAGMA foreign_key_check;
```

Legacy backup inventory was read without writes on 2026-09-29. Production retained 12 completed backup metadata sets and 260 ready groups; preview retained 14 completed zero-object sets. The account inventory contained current image/quarantine buckets and unrelated buckets, with no legacy backup bucket. Private metadata exports were saved with restrictive permissions and verified SHA-256 receipts before retiring the backup and restore source. The exports do not recreate missing image objects. Keep these private receipts outside Git. Applied tables and migrations, as well as remote data, remain intact.

## Manual evidence export

D06/W06 stage B is prepared in source. Both product export endpoints and their producer, paging, TAR reader, runtime binding, and export-only budgets are removed. A private request to `POST /api/runs/:runId/export` or `GET /api/exports/:exportId` receives the normal `404 not_found` response. Run history remains available. No replacement report is selected.

The [2026-10-03 selection](../../../../docs/current-contract.md#product-export-endpoint-retirement) permits endpoint retirement before existing exports expire or download leases end. Existing export URLs can stop working at deployment; zero retained building rows, zero unexpired exports, zero active leases, and completed cleanup are not deployment prerequisites. Classify any actual unfinished producer work before removing its dependencies; retained export rows alone do not block endpoint retirement. Preserve any specifically required private evidence, verify export pin ownership, and remove the retired fields from live custom budget overrides. Source preparation does not prove those target checks or deployment.

The remaining [cleanup](exports.ts) serves retained export records and records recovered into an isolated target. Retained pages and export-owned pins can remain after endpoint retirement until ordinary cleanup is eligible. It respects expiry and active leases, deletes only the private export prefix in bounded pages, then releases only the matching export-owned run and snapshot pins. A failed or incomplete page keeps ownership for retry. Baseline, review, manual, and unrelated export pins remain. Export rows and applied migrations stay intact; endpoint retirement requires no forced expiry, deletion, or cleanup dispatch. Shared D1, image/quarantine storage, task and object budgets remain required by native history, recovery, and ordinary image retention.

A code rollback cannot restore expired image objects or revive an expired product download. Use a fresh capture, history readback, and required image checks for recovery.

## Native database recovery

The recovery promise is D1 recovery plus originals that still exist in R2. It does not recreate expired image bytes. Cloudflare Time Travel is automatic, restores D1 in place, and does not clone a database; paid retention is 30 days and free retention is 7 days. See [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and [Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/).

Use this runbook first with a separate diagnostic D1 database and diagnostic R2 storage. Do not point a rehearsal at production. A hosted Time Travel drill requires its own resource and restore authorization.

1. Verify the exact account, environment, D1 UUID, and R2 bindings. Stop HTTP writes, cron, and queue consumers for the target. Save its current bookmark privately.
2. Create a known record in the diagnostic target, save its bookmark, change that record, then restore the saved bookmark. Verify that the record returns. Use a fresh diagnostic database for this sequence; copying production D1 does not copy its bookmark history.
3. Keep the target offline. Apply the current numbered migrations if the rewind precedes them. Run `sanitizeRestoredDatabase` only against this isolated target. It invalidates sessions and account tokens, makes unfinished tasks terminal, and fences old GitHub deliveries. Its existing restore event keeps the latest sanitation time as a cutoff for old staged work, candidate checks, and identity tokens. Keep that event after resolving its secret-rotation alert. Accepted history and old check identities remain evidence; a new capture needs a fresh Plan and a new check generation, even at the same SHA. It does not replay external effects.
4. Page through `inspectRecoveryImages`, retaining each `nextAfterId` until `hasMore` is false. Then page through `inspectRecoveryInventories`, starting with `{ afterId: "", imageIndex: 0 }` and retaining each `nextCursor` until `hasMore` is false. This checks complete inventory documents and required originals that have no D1 capture or image row. Record missing and corrupt originals. Required baseline images must be present and verified; expired historical evidence must show an explicit missing or expired state. Run `PRAGMA foreign_key_check`.
5. Rotate authentication and ingest capability secrets in the target. [Secret rotation](#secret-rotation) describes the effects for production. Keep checks with ambiguous prior external writes fenced until their requests are proven settled. Capture a new complete main run when the old baseline cannot be verified.
6. Verify a new complete capture, history readback, required image checks, and terminal old command links. New exports are retired and are no longer a recovery check. Do not add a replacement report or treat D1 recovery as a restore of missing R2 image bytes. Verify private login if the full diagnostic app is activated. A binding-only drill proves hosted storage and the application recovery functions; it does not prove the deployed HTTP or login paths. Reactivate only the verified target. Keep the previous bookmark and the drill receipt private.

Example commands for the independently selected diagnostic database:

```sh
pnpm exec wrangler d1 time-travel info DIAGNOSTIC_DATABASE
pnpm exec wrangler d1 time-travel restore DIAGNOSTIC_DATABASE --bookmark=VERIFIED_DIAGNOSTIC_BOOKMARK
```

The local recovery test restores an actual SQLite snapshot into a separate database, proves access and work fencing, and detects missing and corrupt R2 originals. Native D1/R2 tests also cover archive conversion and image streams. These tests establish the application procedure. They do not claim a completed hosted Time Travel rewind or a tested in-place production reactivation.

## GitHub App settings

Sign-in and the repository checks use one GitHub App. `GITHUB_APP_ID` in the production variables of the [Wrangler configuration](../../wrangler.jsonc) is its ID. The registration of this App must have the three settings below. This file records the requirement, not the state. Read the settings on the settings page of the App, and read them again after each change of the registration.

| Setting                         | Required value | Place on the settings page of the App                                                                                                           |
| ------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility                      | Private        | Advanced, "Danger zone". A private App shows the button "Make public".                                                                          |
| User-to-server token expiration | On             | Optional Features. The page has the button "Opt-in" or "Opt-out". The documentation does not say which button an App with the setting on shows. |
| Device flow                     | Off            | "Identifying and authorizing users". "Enable Device Flow" has no mark.                                                                          |

The labels of this table are from [Modifying a GitHub App registration](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration) and [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens), read on 2026-10-08.

## Secret rotation

The production Worker `visonaut` has five secrets. `secrets.required` in the production part of the [Wrangler configuration](../../wrangler.jsonc) lists them. Each secret has one accepted value: the service does not accept an old value and a new value at the same time. The preview Worker needs none of these secrets. The Deploy workflow does not read or write them.

Verify the exact Cloudflare account first. Then use these commands from the root of the repository:

```sh
pnpm exec wrangler secret put NAME --name visonaut
pnpm exec wrangler secret list --name visonaut
```

`secret put` asks for the value, or reads it from standard input. It creates a new version of the Worker and deploys it immediately. `secret list` prints only the names. It proves that a name exists, not that a value works: use the readback of the table. These statements are from the Cloudflare pages [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/), read on 2026-10-08. Put no value into a command line, a file of the repository, an issue, or a log.

Three rules for the values:

- `BETTER_AUTH_SECRET`, `CAPABILITY_SECRET`, and `GITHUB_WEBHOOK_SECRET` need at least 32 characters. Use a new random value, for example from `openssl rand -hex 32`.
- `GITHUB_APP_PRIVATE_KEY` must be a PKCS#8 PEM text. GitHub gives a PKCS#1 file. Print the fingerprint of the file and compare it with the fingerprint of the new key on the settings page. Then convert the file, and give the result to `secret put` on standard input.
- Most API requests and most scheduled work read all five secrets. A secret that is absent or empty stops them, also where they do not use that secret. Do not delete a secret to rotate it.

```sh
openssl rsa -in DOWNLOADED_KEY.pem -pubout -outform DER | openssl sha256 -binary | openssl base64
openssl pkcs8 -topk8 -nocrypt -in DOWNLOADED_KEY.pem -out NEW_KEY.pem
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY --name visonaut < NEW_KEY.pem
```

Three secrets have a second value on the settings page of the GitHub App. For a private key, the documentation of GitHub names the part "Key pairs" and the button "New key". For the webhook secret, it names the field "Webhook secret". This file gives no label for the client secret. "Differ" in the table means that the value in the Worker and the value that the other side uses are not the same.

| Secret                   | Second place                 | What fails while the values differ                                                                                                                                                                                                                                                                                 | Order                                                                                                                                                                                                                                                                                                                           | Readback                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | None                         | Each session cookie from before the change stops working. The person gets the answer 401 and signs in again. The Ariakit CI does not use this secret.                                                                                                                                                              | Set the new value. No overlap is possible, so tell the reviewers first if the incident permits it. The change does not delete the session rows in D1. To end each session, delete the rows as a separate action, on an instruction of the maintainer.                                                                           | Sign in on the production origin and open a private page. Load it again: the session stays.                                                                                                                                                                                                                                                        |
| `CAPABILITY_SECRET`      | None                         | Each ingest credential that the service issued before the change stops working. Such a credential lives 10 minutes. An Ariakit CI job that holds one fails with an authentication error (exit code 4 of the CLI). A signed-in person sees no change.                                                               | Set the new value when no Visonaut job of the Ariakit CI runs, if the incident permits the wait. Then run each failed job again.                                                                                                                                                                                                | A capture job and a Submit job of the Ariakit CI that start after the change pass.                                                                                                                                                                                                                                                                 |
| `GITHUB_CLIENT_SECRET`   | The client secret of the App | A new sign-in fails when the browser returns from GitHub. A session that exists continues. The Ariakit CI does not use this secret.                                                                                                                                                                                | 1. Generate a new client secret on the settings page. Do not delete the old one now. 2. Set the new value in the Worker. 3. Make the readback. 4. Delete the old client secret on the settings page. This is the order that GitHub documents. See the limits below the table.                                                   | Sign out, and then sign in again. A page that loads with an existing session does not prove this secret.                                                                                                                                                                                                                                           |
| `GITHUB_APP_PRIVATE_KEY` | "Key pairs"                  | The service signs with the key when it needs a new installation token. From then on, each request that it sends to GitHub as the App fails. A signed-in person gets the answer 503 on private pages. The Ariakit CI requests that need a GitHub read fail. Checks get no update, and received webhook events wait. | 1. Make a new key with "New key" on the settings page. The old key stays valid until you delete it. 2. Compare the fingerprint, convert the file, and set the new value in the Worker. 3. Make the readback. 4. Delete the old key on the settings page, and delete the two key files. In this order, the values do not differ. | Open a private page with a session. A change of the value always causes a new request to GitHub with the key, so a page that loads proves that GitHub accepts the key of the Worker. The fingerprint of step 2 proves that it is the new key.                                                                                                      |
| `GITHUB_WEBHOOK_SECRET`  | "Webhook secret", one value  | The service answers 401 to each webhook delivery, and GitHub records the delivery as failed. The work that an event starts is late. The service asks GitHub to send a failed delivery again at most 5 times, and waits longer each time (5, 10, 20, and 40 minutes).                                               | 1. Make the new value. 2. Save it on the settings page. 3. Set it in the Worker immediately. No overlap is possible, so keep the time between steps 2 and 3 to a few minutes. GitHub comes first, so that each delivery that fails in this time has the new signature.                                                          | On the settings page, open Advanced, "Recent deliveries". Find a delivery that GitHub made after step 3, or redeliver one that GitHub made after step 2: the answer is 202. Do not use a delivery from before step 2 for this test. Later, each delivery that failed has a redelivery with a 2xx answer. Redeliver by hand those that stay failed. |

Limits of this table:

- GitHub permits 25 private keys for one App, and a key is valid until its deletion. The fingerprint command is from the same page ([Managing private keys for GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps), read on 2026-10-08).
- The order "generate, update the app, delete the old one" for a client secret and a private key is from [Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app), read on 2026-10-08. That page does not say that the old client secret stays valid until its deletion, how many client secrets can exist at the same time, or a time limit for the old one. So a sign-in can fail between steps 1 and 2 of that row. Do not wait between steps 1 and 4.
- GitHub does not send a failed delivery again by itself ([Redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks), read on 2026-10-08). That page gives two limits for a redelivery, 7 days in its introduction and 3 days in its steps: use 3 days. It does not say which secret signs a redelivery. The order of the table does not depend on the answer.
- This file has no measured time for how long an instance with the old value can answer after `secret put`. Make the readback a second time after some minutes, and before you delete an old value at GitHub.
- Nobody made a rotation in production with this table. The cells are from the source and from the documentation of GitHub and Cloudflare.

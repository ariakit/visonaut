# Hosted approval reuse, source rejection, and Undo

The September 22, 2026 diagnostic flow records exact approval reuse across a new workflow and its full rerun, supersession of the first attempt, and a completed failure-to-success transition on the active dependent run's actual Ariviso App check. This adds bounded E03 and E06 evidence. It does not complete either gate or authorize launch.

## Runs and exact reuse

| Role                            | Service run                            | GitHub workflow and attempt                                                                       | App check                                                                        |
| ------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Approved source                 | `7f114089-e7e9-41be-bb3a-977d5fa88eec` | [35713469611](https://github.com/ariakit/ariviso-diagnostics/actions/runs/35713469611), attempt 3 | [106710086960](https://github.com/ariakit/ariviso-diagnostics/runs/106710086960) |
| New dependent, later superseded | `59564c70-8706-4a27-803e-86fd4561a258` | [35744613874](https://github.com/ariakit/ariviso-diagnostics/actions/runs/35744613874), attempt 1 | [106804133256](https://github.com/ariakit/ariviso-diagnostics/runs/106804133256) |
| Active full rerun               | `1c3414ed-f934-4b4c-9089-dac42094915a` | Same workflow, attempt 2                                                                          | [106806114582](https://github.com/ariakit/ariviso-diagnostics/runs/106806114582) |

The fixture contains two synthetic Chromium captures. Both new attempts retain the original source decision IDs, `8efa8cd0-54dd-4306-b4f9-a09e66185d01` and `e42b01ab-a2cd-4532-ab82-4131105a0ad5`. Their own `decision_id` values are null. The later D1 snapshot after Undo still contains those exact source references.

The tested merge commit is [`b68da87`](https://github.com/ariakit/ariviso-diagnostics/commit/b68da87fd96aee172a1fa691c5b0cbea9f444d42). The workflow API separately reports caller head [`e1ea980`](https://github.com/ariakit/ariviso-diagnostics/commit/e1ea980c5421ddb86659874456464f894a2324c1) and reusable workflow [`dcf4278`](https://github.com/ariakit/ariviso-diagnostics/commit/dcf42788b6c284a1affb4d2df65954672b04bae0). These are distinct identities. The plan, per-item profile, reference captures, and candidate image digests agree across the saved D1 snapshots.

Independent GitHub GETs confirm six successful capture jobs across the three selected attempts. The new dependent's first attempt uses jobs `106802858084` and `106802857715`; its full rerun uses new jobs `106805660398` and `106805660017`. Each new attempt owns its validated capture images and complete shards. This is a full rerun with reused approval, not failed-job shard inheritance. The old attempt is inactive and `superseded`; the second attempt remains active.

## Reject and Undo observations

The operator rejected only `synthetic/second` on the original approved source. The dependent lost that reused approval and became `needs-review`; `synthetic/first` stayed approved. For example, the dependent model returned:

```json
{ "verdict": null, "source": null }
```

The first iteration is retained as limited evidence. The source rejection occurred at 15:15:20.801 UTC. The private model showed `needs-review`, but the saved App receipt still showed the earlier success. The controller expected a rejected dependent verdict instead of a cleared approval. Its assertion failed, and its shell continued to the already-authorized Undo at 15:16:34.541 UTC before check settlement. This iteration does not establish App-check invalidation.

The second iteration waited for the actual failed check before Undo:

| Observation                                      | UTC          |
| ------------------------------------------------ | ------------ |
| Source Reject, decision revision 12              | 15:17:34.590 |
| Dependent App check completed with failure       | 15:21:22     |
| Poll observed that completed failure             | 15:21:27.923 |
| Private dependent model confirmed `needs-review` | 15:22:07.773 |
| Source Undo, decision revision 13                | 15:22:48.002 |
| Source App check completed with success          | 15:26:17     |
| Dependent App check completed with success       | 15:26:23     |

The final private models show both runs passed and both variants approved. Baseline revision 1 is unchanged. The source command journal retains all four operations from both iterations; its pending command list is empty after both Undos. These observations show eventual invalidation and recovery in this flow. They do not measure a latency bound or prove an in-flight stale-success race.

## Deployment and authentication limits

The review sequence and new dependent attempts used the recorded diagnostic deployment context for [`43552ce`](https://github.com/ariakit/ariviso/commit/43552ce5196448f6dee82da665c5b06863638b08), Git tree `e06628954290ccdbf3792edf5497cdf64af68c09`. The saved build manifest identifies 43 artifacts. Deployment logs record Web version `9ea84f79-9a30-46d4-81ab-5bea048cbd76` and comparator version `09893c22-08b0-4ef1-ba39-6f44ae670298` at 100% traffic, with bindings and crons preserved.

The D1 inspector's source and version fields are controller constants. They are checked against those separate saved deployment records, not treated as values read from D1 or an independent live deployment probe. The commit object verifies the commit-to-tree mapping. Build artifact bodies are omitted, so the local verifier cannot rehash the deployed bundles. The original source workflow captured at 10:29 UTC, before this deployment; its later inspection and review are separate from that earlier capture execution.

Review authentication used an operator-created, one-hour synthetic D1 session and live GitHub repository-permission checks. It does not prove OAuth login. Cleanup was independently recorded at 15:32:08.427 UTC: zero sessions, accounts, and users for the exact fixture identity, with the local session file absent. No credential value is included.

The captures are synthetic cards in `ariakit/ariviso-diagnostics`, using the existing trusted workflow and private bootstrap packages. This is not the full Ariakit capture cycle or public-package release evidence. Automatic webhook delivery, genuine merge-group capture, failed-job inheritance, deterministic stale-send refusal, final-source review, and the other launch requirements retain their separate status. The earlier [state probe](../state-recovery/README.md) remains separate evidence with its own fixture and sender limits.

## Archive and local verification

The [frozen archive and verifier](../../../tooling/evidence/acceptance-reuse/README.md) preserve 39 files: original receipts, the complete four-operation journal, limited first-iteration observations, deployment provenance, and seven independently collected GitHub GET results. Historical JSON, logs, and collection scripts are unchanged inside the archive. No formatter exception is used.

Run from the repository root with a new destination outside the repository:

```sh
python3 -B tooling/evidence/acceptance-reuse/verify.py \
  --out /private/tmp/ariviso-acceptance-reuse-check
```

The verifier checks hashes, safe archive paths, workflow/job identities, image and decision references, supersession, the ordered check transitions, baseline revision, journal completeness, cleanup, and recorded deployment identities. It extracts the original files and writes `VERIFICATION.json`. It makes no network request and runs no collection script. This is a portable receipt check, not a new hosted run or a replay of the mutations. [Curation results](./CURATION.json) record the local checks and their limits.

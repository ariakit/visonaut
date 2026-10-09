---
"@visonaut/web": patch
"@visonaut/security": patch
---

The signed GitHub Actions identity alone proves a CI run

The service now accepts a run from the signed GitHub Actions identity alone. It still checks the issuer, audience, and expiry of the token, the repository and owner IDs, the event, the ref, the run, the attempt, the signed job and its name, the tested commit, and the pull request state.

- **No workflow file comparison.** The service compares no workflow Git blob and reads no workflow file. A pull request that changes `.github/workflows/ci.yml` or `.github/workflows/app.yml` in the consumer repository needs no change of the service.
- **No adapter digest comparison.** The service compares `run.planDigest` and `discovery.executorDigest` with no setting. Each value must still have the form of a SHA-256 digest, and the service stores the value of the request. A Submit of CLI `0.5.4` passes with no change in the consumer repository.
- **Configuration.** `VISONAUT_WORKFLOW_OWNED` now has four fields: `callerWorkflowPath`, `reusableWorkflowPath`, `captureJobName`, and `submitJobName`. The variable `VISONAUT_TRUSTED_EXECUTOR_DIGEST` is removed.
- **Main pushes.** A push to main records its check candidate without a read of the App workflow file. The scheduled pass that retired a main check without the pinned workflow is removed.

Accepted limit: a pull request from an account with push access can replace the Submit job, or send the no-visual report for itself. The workflow edit is in the diff of that pull request.

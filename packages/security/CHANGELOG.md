# @visonaut/security

## 0.0.1

### Patch Changes

- 7185786: Reduced service database calls for a fresh Approve or Reject from seven to three, about 57% fewer calls in the local decision test. Decision saves can reuse a verified GitHub permission for up to 10 seconds and return before the status Queue wakeup completes. Live session checks and atomic decision saves remain required. Repository permission removal can take up to 10 seconds to block another decision.
- 863c4b3: Fixed native database recovery to keep old captures, checks, and webhooks inactive and reject workflow identities issued before restoration. New captures require a fresh Plan and check generation, while accepted history remains available.
- 126436d: Fixed no-visual CI Plan submissions with GitHub job workflow claims that match the trusted caller.
- 896fd8a: Fixed duplicate Visonaut verdicts for new pull request attempts by using one head check with a direct review link. Existing merge checks keep their required verdicts. Signed Submit completion now requests ingestion, and saved review decisions start their durable task without waiting for the shared operations consumer.

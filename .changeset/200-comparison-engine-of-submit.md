---
"@visonaut/web": patch
"@visonaut/service": patch
---

Approvals no longer depend on the comparison engine

The review rows and the decisions no longer record the comparison engine or the image codec. An approval copies to a later run with the same two images, the same rendering profiles, and the same comparison policy, also when the CLI of that run compares with another engine. The engine decides only whether a run flags a pair of images.

The review now shows the CLI version of the Submit in the details of a capture, in place of the engine and the codec. The service stores this version with the run as provenance only, and it checks no list of versions. Submit still accepts the engine and codec names that an earlier CLI sends, and it ignores them.

The rows of runs from before this release keep their engine and codec names. So their approvals do not copy to the rows of later runs, one time: the next run of an open pull request needs a new review of each change that an earlier run of it approved.

# Ariviso

Visual regression capture, comparison, and review for Ariakit.

[Issue #1: Implement Ariviso from the settled project design](https://github.com/ariakit/ariviso/issues/1) is the canonical implementation specification. It includes all 61 design decisions, examples, implementation milestones, and required production evidence. Make approved contract changes in the issue body.

This repository currently contains the design handoff. Product implementation has not started. All production evidence remains **NOT RUN**. Comparator thresholds and numeric performance/cost limits need measured proposals and maintainer approval.

## Design archive

- [Complete revision 9 design and interactive prototypes](docs/design-r9.html)
- [Complete structured revision 9 record](docs/design-r9.json)
- [Design-document verification history](docs/design-verification.md)

Download `docs/design-r9.html`, or clone this repository and open the file in a browser. The file includes its example images, prototypes, term help, decisions, alternatives, and historical notes. It does not need the original chat or a local server.

Revision 9 is a frozen archive. Its old continuation prompt and historical notes do not replace the current issue contract. The former project name was Visuaria. The selected packages are `ariviso` for the CLI and `@ariviso/playwright` for the adapter, with no `@ariviso/cli` alias.

To assign implementation, give the agent issue #1, this repository, and an explicit execution scope. Repository and issue creation alone do not authorize deployment, npm publication, domain registration, changes to Ariakit's required workflow, or external notifications.

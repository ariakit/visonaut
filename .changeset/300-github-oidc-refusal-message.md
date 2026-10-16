---
"visonaut": patch
---

Gave a refusal of the GitHub OIDC token request its own message

When GitHub Actions refuses the OIDC token request, the CLI now says so and tells you to check the `id-token: write` permission of the job. Before, the CLI printed the words of a service refusal and could print an error code and a reference that came from GitHub.

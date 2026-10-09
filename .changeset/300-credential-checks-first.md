---
"@visonaut/web": patch
"@visonaut/security": patch
---

Credential checks before other work

The service now checks the credential of a request before it does other work:

- **Private API routes.** On each private route that the API handler serves, a request with no session cookie and no bearer token gets `401` before any database work.

- **Ingest routes.** A request with no bearer token gets `401` with the code `credential_required` before any database work. This includes Submit.

- **Webhooks.** The service checks the signature of a webhook before it reads the project.

- **Paths.** A shard path with a percent sequence that is not valid gets `400` with the code `invalid_path`.

The service also keeps the signing keys of GitHub between requests, and it keeps the verified login of a user after a refused permission check. A request of the CLI gets the same answer as before, because the CLI sends a bearer token with each request.

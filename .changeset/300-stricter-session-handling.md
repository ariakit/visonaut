---
"@visonaut/web": patch
"@visonaut/security": patch
---

Stricter session handling and private headers

The service now handles a session and a private answer more strictly:

- **A bearer token needs its signature.** `visonaut status` must get `VISONAUT_TOKEN` in the form `<session token>.<signature>`, which is the URL-decoded value of the session cookie.
- **Session headers.** A private answer forwards only `Set-Cookie` from the session headers of the sign-in library, so a renewed session still reaches the browser.
- **Client address.** The sign-in library reads the client address from the `CF-Connecting-IP` header.
- **Private headers.** Each private answer has `Cross-Origin-Resource-Policy: same-origin`, and `/health` has the same private headers as each other private answer.

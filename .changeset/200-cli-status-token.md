---
"visonaut": patch
---

`status` takes the session cookie value

`VISONAUT_TOKEN` has the form `<session token>.<signature>`, which is the value of the session cookie. The service refuses a token without its signature. The help sentence of `status` says so:

- Before: `Status requires VISONAUT_TOKEN, a maintainer session token.`
- After: `Status requires VISONAUT_TOKEN, a maintainer session token with its signature.`

The CLI decodes percent sequences in the value, so you can copy the cookie value from the browser as it is. Before, the CLI refused a value with a `%` character, and you had to decode it by hand.

```sh
# Both values are used as "abc.d+e/f=".
VISONAUT_TOKEN="abc.d%2Be%2Ff%3D" visonaut status --run <service-run-id>
VISONAUT_TOKEN="abc.d+e/f=" visonaut status --run <service-run-id>
```

A sequence that is not valid, such as `abc%zz`, stops the command with exit code `4` before any request. A decoded value with a character that a credential cannot have stops it the same way.

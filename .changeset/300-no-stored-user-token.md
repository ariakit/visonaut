---
"@visonaut/web": patch
"@visonaut/security": patch
---

Stopped storing the GitHub user token of a sign-in. Each sign-in now writes NULL to the `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, and `refreshTokenExpiresAt` columns of its account row, also when the row has values of an earlier sign-in.

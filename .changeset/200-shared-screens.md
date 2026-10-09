---
"@visonaut/web": patch
"@visonaut/security": patch
---

One sign-in page, one no access page, and page titles

The pages that are not a page of the app itself are now the same on each route.

- **Sign-in.** One sign-in page serves each page. It comes with the document when the request has no session, so it needs no script and no request to show. A sign-in returns to the page that the person opened.

- **A failed sign-in.** A sign-in that fails at GitHub returns to the app, and the sign-in page says the reason. Before this update, the person saw an error page of the sign-in library outside the app.

- **Too many attempts.** When the service answers a sign-in with HTTP 429, the sign-in button is off for the time that the service names, and the page says for how long.

- **No access.** One page serves an account with no write access on each route. It names the account when the app knows it, and it has two ways forward: `Use another account` and `Back to GitHub`.

- **Titles.** Each page has its own title: `Queue`, `History`, `Status`, `Pull request #<number>`, and the title of the run, each before `· Visonaut`.

- **Not found.** An unknown address shows a page with the header and a link to the Queue. Before this update, it showed the bare text `Not Found`.

- **Errors.** A page that fails to load or to render shows one error screen with a `Reload` button.

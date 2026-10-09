# Streamed document probe

This folder is the record of one experiment: step 1 of [#269](https://github.com/ariakit/visonaut/issues/269). The question was if a route loader that returns a promise, on a route with `ssr: "data-only"`, makes the Worker send the start of the document first and the run list after it.

The answer is yes in the local runtime. The first bytes of the document do not wait for the run list. Two limits apply. The first bytes had no page shell, because the root route of that commit renders none. And the local runtime holds a compressed body until its end, and nobody measured the compression of the Cloudflare edge. See [Limits](#limits).

## The route of the experiment

[`probe.patch`](probe.patch) is the complete change. It applies to [`db2d5c2`](https://github.com/ariakit/visonaut/commit/db2d5c24742774a897410fe6d1d5e11ec3174f10) and it is not part of the app. Its center is this loader:

```ts
const startRuns = createIsomorphicFn()
  // The handler of `/api/runs` runs in the same process as the document.
  .server(async () => {
    const request = getRequest();
    const response = await handleApi(
      new Request(new URL("/api/runs", request.url), { headers: request.headers }),
      apiBindings(env),
      lifetime,
    );
    return response?.json();
  })
  .client(async () => undefined);

export const Route = createFileRoute("/")({
  ssr: "data-only",
  // No `await`: the document does not wait for this promise.
  loader: () => ({ runs: startRuns() }),
});
```

The local D1 read of the run list takes a few milliseconds. So the patch waits after the read for the time of the search parameter `delay`. This wait takes the place of the slow D1 read of production and makes the order of the bytes visible.

## Run the probe

Check out the commit of the patch first: a later commit moved the route file, so the patch does not apply to it. Use a free port. The local backend keeps its data in `apps/web/.wrangler/state`.

```sh
git apply apps/web/tooling/streamed-document/probe.patch
pnpm --filter @visonaut/web build
VISONAUT_LOCAL_PORT=4391 node apps/web/tooling/local-backend/run.mjs
```

Then, in a second terminal:

```sh
node apps/web/tooling/streamed-document/probe.mjs http://127.0.0.1:4391 1500 identity
node apps/web/tooling/streamed-document/probe.mjs http://127.0.0.1:4391 1500 gzip
node apps/web/tooling/streamed-document/probe.mjs http://127.0.0.1:4391 0 identity
git apply --reverse apps/web/tooling/streamed-document/probe.patch
```

The arguments are the origin, the added wait in milliseconds, and the value of `Accept-Encoding`. Each line of the output is one load of `/`.

## Recorded result

Recorded on 2026-10-09 with the built Worker of [`db2d5c2`](https://github.com/ariakit/visonaut/commit/db2d5c24742774a897410fe6d1d5e11ec3174f10) with the patch, in Miniflare 5.20260921.0-alpha (workerd 1.20260921.1), `@tanstack/react-start` 1.168.57, `@tanstack/react-router` 1.170.38, and React 19.3.0. Each row has 3 loads. The times are from the start of the request, in milliseconds. [`recorded.jsonl`](recorded.jsonl) has each load.

| Request                                    | Added wait | Headers | First body byte | Run list in the body |          End |
| ------------------------------------------ | ---------: | ------: | --------------: | -------------------: | -----------: |
| Session, `Accept-Encoding: identity`       |       1500 | 5 to 23 |         5 to 24 |         1510 to 1534 | 1510 to 1535 |
| No session cookie, `identity`              |       1500 |  3 to 4 |          3 to 4 |         1506 to 1507 | 1506 to 1507 |
| Session, `Accept-Encoding: identity`       |          0 |       4 |               4 |               6 to 7 |       6 to 7 |
| Session, `Accept-Encoding: gzip`           |       1500 |  4 to 5 |    1507 to 1510 |         1507 to 1510 | 1508 to 1510 |
| No session cookie, `Accept-Encoding: gzip` |       1500 |  3 to 4 |            1507 |                 1507 |         1507 |

More facts of the same run:

- The first chunk has 3,603 bytes: the document head, the `<body>` tag, and the start of the first script of the router. It has no visible markup. The run list arrives in a later script of the same document.
- The server read of the run list took 2 to 23 ms with a session (`serverReadMs`). With no session cookie, the handler answered 401 in 0 to 3 ms, before the first D1 read.
- Two checks have no file in this folder. In one load in Chromium, the page hydrated with no hydration error, and the loader data in the browser had the run list. A search of `dist/client` found no code of the API handler, so the `server` half of `createIsomorphicFn` stays out of the client bundle.

## Limits

- **Compression.** With `Accept-Encoding: gzip`, the local runtime sent the headers at once and held the complete body until the run list was ready. Each browser sends this header. In production the Cloudflare edge compresses the document, and this probe did not measure it. Measure the deployed document after the loader of step 4 of #269 is in production, for example with the navigation timing of a browser: `responseStart` against `responseEnd` of the document.
- **The wait is not D1.** The added wait is a timer after a fast local read. It shows the order of the bytes, not the time of a D1 read in production.
- **No page shell.** The root route of that commit renders only the document and its outlet, and a route with `ssr: "data-only"` does not render its component on the server. So the first bytes were the head and the scripts, and no markup that a person sees. The probe did not test a layout route that renders a shell on the server. Step 4 of #269 must show that the markup of the layout route arrives before the run list.
- **The gzip rows show decoded bytes.** The client of the probe decodes the body, so the rows show when decoded bytes arrive, and no file has the raw bytes.

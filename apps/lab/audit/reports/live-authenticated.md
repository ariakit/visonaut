# Live measurements, production, signed-in maintainer (orchestrator)

Method: the maintainer's own Chrome session on https://visonaut.com, 2026-10-05, read-only navigation.
Values come from the Navigation Timing and Resource Timing APIs of the page.
The tab was in a background window (`document.visibilityState === "hidden"`), so paint metrics (FCP, LCP) were not recorded and timer-driven work can be slower than in a visible tab. Network timings are not affected.
"Server wait" is `responseStart - requestStart` of the request. All times are milliseconds from navigation start.

## Dashboard (`/`, `/?view=history`, `/?view=service`)

| Sample                      | Document TTFB | `/api/runs` start | `/api/runs` server wait | `/api/runs` end | `/api/operations` start | `/api/operations` server wait | `/api/operations` end |
| --------------------------- | ------------- | ----------------- | ----------------------- | --------------- | ----------------------- | ----------------------------- | --------------------- |
| `/` first (cold connection) | 523           | n/a               | n/a                     | n/a             | n/a                     | n/a                           | n/a                   |
| `/` 2                       | 90            | 322               | 1967                    | 2290            | 2360                    | 1299                          | 3663                  |
| `/` 3                       | 119           | 359               | 992                     | 1353            | 1432                    | 1204                          | 2638                  |
| `/` 4                       | 41            | 240               | 1077                    | 1318            | 1392                    | 1284                          | 2678                  |
| `/?view=history`            | 77            | 277               | 942                     | 1220            | 1470                    | 1249                          | 2721                  |
| `/?view=service`            | 292           | 595               | 865                     | 1461            | 1527                    | 1216                          | 2744                  |

Facts:

- The document arrives fast (41 to 119 ms warm). The page then shows "Checking access and loading runs…" until `/api/runs` answers.
- `/api/runs` returns 2,285 bytes and takes 0.9 to 2.0 s on the server.
- `/api/operations` starts only after `/api/runs` finishes (serial) and takes 1.2 to 1.3 s more on the server. It returns 554 bytes.
- The page is stable about 2.6 to 3.7 s after navigation start.
- 9 JavaScript files load for `/`; all finished by about 240 ms (from cache, 300 bytes transfer each).

## Run page (`/runs/<id>`), three archived runs of pull request #7746 (626 items, 3,832 variants)

| Sample       | `/api/runs/<id>` start | Server wait | Response end | Transfer size | Decoded size | Content visible |
| ------------ | ---------------------- | ----------- | ------------ | ------------- | ------------ | --------------- |
| run c9b3fae0 | 300                    | 5416        | 6042         | 691,954 B     | n/a          | 7456            |
| run 5f5138d3 | 206                    | 5680        | 6003         | 692,862 B     | 5,331,211 B  | 7756            |
| run 543dd81a | 233                    | 5251        | 5537         | 692,852 B     | 5,974,885 B  | 6676            |

Facts:

- The page shows only "Checking access and loading this run…" for 6.7 to 7.8 s.
- One request carries the whole run model: 5.3 to 6.0 MB of JSON (about 692 KB compressed), with a server wait of 5.3 to 5.7 s.
- The first image request starts only after the model is parsed and rendered (5.8 to 7.4 s) and is then served from cache in about 1 ms.
- After load the sidebar lists 626 items in one "Accepted (626)" section. Item names are long paths such as `ariakit-tailwind-7466/applied-light-week-hover`. Variant chips read "React · Chromium · Light · react-chrome-default-d…".

## Real data notes for design fixtures

- History rows show `#7746 · Pull request` because no pull request title is available; main runs show `Main`.
- Most history rows read "Replaced by a newer run"; main runs read "Passed".
- The header shows "Service attention: 1 unresolved service alert." on every dashboard view.
- The service status page shows: "Database: 5.5 MiB used; 2042.5 MiB before new runs pause. Active captures: 0 of 5."

## Limits

One location, one browser, one day, 3 to 5 samples for each page, background tab. These numbers show the order of magnitude and the request sequence. They are not a performance budget.

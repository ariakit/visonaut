# Visonaut design lab

The lab is a temporary app for judging the design of the Visonaut UI. Round 1 compared several designs of every page and every component of `apps/web`. Round 2 was one design with five open choices: the six pages that the maintainer picked, with the picked parts built into them. The maintainer answered the five choices, so the lab now is the settled design, and no decision is open. It uses the same stack as the app: TanStack Start, Tailwind CSS, `@ariakit/tailwind`, and the Ariakit UI primitives.

The lab has no backend. All data comes from fixtures in `src/fixtures`. Do not deploy it. Remove `apps/lab` when the design decisions are in the product.

## Run

```sh
pnpm --filter @visonaut/lab dev
```

The lab opens at <http://127.0.0.1:4320>.

```sh
pnpm --filter @visonaut/lab typecheck
```

```sh
pnpm --filter @visonaut/lab capture
```

This command makes the pictures of the cards. See [Card pictures](#card-pictures).

## Routes

| Route                                      | Purpose                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `/`                                        | Gallery: the pages and the reference surfaces, with a text filter.                        |
| `/pages/$surface`                          | Page explorer: one variant in a frame at a chosen viewport, or all variants side by side. |
| `/components/$surface`                     | Component explorer: every variant in every scenario on one page.                          |
| `/directions` and `/directions/$direction` | The design direction and its pages.                                                       |
| `/feedback`                                | The settled decisions by round, the continuation prompt, and where feedback is saved.     |
| `/preview/$kind/$surface/$variant`         | One variant alone, without the lab around it.                                             |
| `/primitives`                              | The live examples of `docs/primitives.md`, the guide to the Ariakit UI primitives.        |
| `/dev/fixtures` and `/dev/hooks`           | The data of the lab in the three data modes, and its state hooks.                         |

The bare preview takes these search parameters: `scenario`, `theme`, `brand`, `canvas`, `radius`, `density`, `data`, `all=1` (every scenario of a component), and `still=1` (a picture that takes no focus, for a thumbnail). `$kind` is `page` or `component`. The plural forms also work. Any other value shows a message.

The explorers keep their view in the URL, so a reload and a shared link show the same thing:

- `/` takes `q` (the text filter).
- `/pages/$surface` takes `variant`, `scenario`, `viewport` (`phone`, `tablet`, `laptop`, `desktop`, `wide`, or `fit`), and `compare=1`.
- `/components/$surface` takes `width` (`390`, `768`, or `1280`). A variant section has the anchor `#variant-<variant id>`.

## Folders

```text
src/
  components/ariakit/   Ariakit UI primitives. A copy of upstream in the format of this repository. Do not edit.
  explorations/
    pages/<surface>/<variant>.tsx        Page variants. The variant id is the direction id.
    pages/<surface>/<variant>/           Parts of one page variant.
    components/<surface>/<variant>.tsx   Component variants.
    components/<surface>/parts/          Shared helpers of one component surface.
    kits/<direction>/                    Shared parts of one design direction.
  fixtures/             Data in the shape of production. See docs/fixtures.md.
  lab/
    catalog.ts          The index: the direction, the groups, and the surfaces.
    catalog-*.ts        The pages with their variants, and the reference surfaces.
    types.ts            The types of the catalog and of a variant module.
    record.ts           The record revision, the feedback that it already contains, and the settled decisions.
    card-pictures.ts    The file, the size, and the preview address of each card picture.
    navigation.tsx      LabLink, useLabHref, and usePreview for variant authors.
    registry.tsx        Loading of variant modules, one chunk for each.
    feedback.ts         Feedback rules and the continuation prompt.
    knobs.ts, knobs.css The look controls and their theme tokens.
    ui/                 The lab chrome.
  routes/               One file for each route.
scripts/
  capture-cards.ts      The command that makes the card pictures.
public/
  cards/                The card pictures. The command writes them. Do not edit.
```

## Surfaces

The catalog has two groups, in this order:

| Group     | Surfaces                                                                                                                 | Decision           |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Pages     | `sign-in`, `inbox` (the Queue), `history`, `status`, `pull`, and `review`, each with the one variant `ariakit`           | Settled in round 1 |
| Reference | `status-mark`, `image-states`, `error-state`, and `notice` (Bar states): parts with states that no page scenario reaches | Settled in round 1 |

- A surface with `status: "settled"` shows its pick and takes notes only. A surface without a status is open. The catalog has no open surface now.
- The five choices of round 2 have no surface: `review-bar`, `review-variants`, `inbox-hero`, `pull-scope`, and `row-picture` left the catalog. Each page is the picked form, and no prop selects another one.
- The 15 component surfaces of round 1 that are not in the catalog are built into the pages. `/feedback` says where each pick is now.

## Add a variant

1. Add an entry to the `variants` of a surface: in `src/lab/catalog-components.ts` for a reference surface, or in `src/lab/catalog-page-variants.ts` for a page. The `id` is the file name. A surface with more than one variant is a question to the maintainer: leave out `status: "settled"`, so that the surface is open.
2. Create `src/explorations/pages/<surface id>/<variant id>.tsx` for a page, or `src/explorations/components/<surface id>/<variant id>.tsx` for a component.
3. Default-export a React component that takes `{ scenario }` and renders every scenario of the surface.

```tsx
import { Button } from "../../../components/ariakit/components/button.ariakit.react.tsx";
import { LabLink } from "../../../lab/navigation.tsx";
import type { VariantProps } from "../../../lab/types.ts";

export default function CalmInbox({ scenario }: VariantProps) {
  return <Button render={<LabLink to="review" scenario="changes" />}>Review ({scenario})</Button>;
}
```

A page variant fills the viewport. A component variant renders at its natural size. Each variant loads on demand in its own error boundary. A catalog entry without a file shows "Not built yet", a variant that throws shows the error in its place, and a variant that suspends for more than one second shows "Loading".

A variant module must not import from `src/routes` or `src/router.tsx`. The lab loads the variant modules of a page before it renders that page, and such an import would make the two wait for each other.

`LabLink` links to another page surface and stays in the same design direction. It picks the variant with the same `id` in the target surface, else the first variant of the same direction, else the first variant. `useLabHref` returns the same URL as a string. `usePreview` returns `{ kind, surface, variant, direction, scenario, theme }`.

In a bare preview, the link goes to another bare preview and carries the look. When the target surface has no variant yet, the link keeps the current variant `id`, and the target shows "Not built yet". Inline in the component explorer, the link opens the page explorer of the target surface.

```tsx
const href = useLabHref("review", "changes");
const sameHref = useLabHref({ to: "review", scenario: "changes" });
const getHref = useLabHref();
getHref("history", { scenario: "full" });
```

## How variants load

`src/lab/registry.tsx` finds the variant modules with `import.meta.glob`. Each module is its own chunk.

- A page variant always renders in a bare preview, in a frame or in its own tab. A component variant renders inline in the component explorer, and in a bare preview for the gallery pictures.
- The bare preview route and the component explorer route load their variant modules in the route loader. The first document also waits for them before React takes over the server markup, so a preview does not blink while it loads.
- The wait stops after three seconds. The page then renders, and a variant that is still loading shows "Loading".
- "Try again" renders a variant again after it threw. After a module failed to load, it reloads the document, because the browser does not load a failed module again.

The style sheet is a link in `src/routes/__root.tsx` (`styles.css?url`), not a module import. With a module import, the development server sends a second copy of the Tailwind theme that wins over the lab theme until the client starts, and every page and every frame starts with the wrong font and layout.

## Card pictures

A card of the gallery and of the directions page shows a picture file of its surface. It does not show a live frame, because each live frame is one more app in the page. The page explorer keeps its live frame, and the component explorer still renders each variant live in the page, with no frame. `docs/design/round-4.md` has the measurements.

```sh
pnpm --filter @visonaut/lab capture
pnpm --filter @visonaut/lab capture --origin http://127.0.0.1:4371
```

- **What it needs.** A lab server that runs. The command reads `http://127.0.0.1:4320`, or the origin that you give. It sends GET requests only, through the Playwright of the repository and Chrome.
- **What it makes.** One PNG file for each variant of each surface of the catalog, in the dark theme and in the light theme: `public/cards/<kind>/<surface id>/<variant id>.<theme>.png`. `src/lab/card-pictures.ts` gives the path, the size, and the preview address of a picture to the card and to the command. So a new card needs no second list.
- **What a picture shows.** The first scenario of a page, or each scenario of a reference surface, with the default look and the data mode Decided API.
- **When to run it.** After a change that a card must show: a new surface, a new variant, another first scenario, or a design change of a page. A card shows its page as it was at the last capture. A card with no file shows an empty box.
- **Limits.** The command removes a file of `public/cards` that no card uses. It fails when the pictures together are 3 MB or more. They are 1.1 MB now.
- **Repository.** The pictures are files of the repository tree. Do not add them to `.gitignore`.

## Look controls

The Look menu changes the theme tokens of the lab and of every preview: `theme`, `brand`, `canvas`, `radius`, and `density`. Each control is a `data-*` attribute on the `html` element. `src/lab/knobs.css` maps the attributes to `--color-brand`, `--color-primary`, `--color-canvas`, `--radius`, and `--spacing`. The lab saves the look in local storage and passes it to each preview in the URL.

The picture of a card follows the theme only. It is a file with the default look and the data mode Decided API. The Look menu says so on the pages with cards.

The Look menu also has the control **Data**. It does not change the look. It changes what the fixtures send:

- `decided` (Decided API, the default): the fields that production sends today and the fields that the audit answers add, for example the pull request title and the reason that a run closed.
- `today` (API today): exactly the fields that production sends today.
- `improved` (All proposed fields): every proposed API addition, for example run counts, capture progress, authors, display names, and thumbnails.

The settled design must look right in the `decided` mode. Check each design in the three modes. A design that needs a field of the `improved` mode needs an API change that the audit did not select. `docs/fixtures.md` lists the fields.

The lab saves the data mode under `visonaut-lab:data-r2`. The key is new in round 2, so a browser that saved a mode in round 1 starts with `decided`.

## Feedback

Each surface has one decision, and each decision of the catalog is settled now. The decision panel of a settled surface has the round that settled it, the pick, and the notes field with the note of round 1. It has no options and no marks. The lab keeps the panel of an open surface for a later round: the question, why the lab asks it, one option for each variant, the option "None of these", and a notes field. Each variant of an open surface also takes a like or drop mark and a short note.

- The count in the top bar and on `/feedback` counts only the open decisions. With no open decision, the top bar reads "30 settled", and `/feedback` reads "No open decision".
- `/feedback` has one table for each round: the 5 decisions of round 2 with the pick, what was not picked, and the page that shows the pick now, and the 25 decisions of round 1 with the pick, the note, and the surface that shows the pick now. `settledDecisions` in `src/lab/record.ts` is the source of both. A table of open decisions shows only when the catalog has an open surface.
- Only a pick counts as an answer. Notes and marks do not.
- A note on a settled surface is a comment. When it differs from the record, the decision shows as changed, and the continuation prompt lists it with the state "settled".
- Feedback stays in this browser, in local storage under `visonaut-lab:feedback`. Nothing is sent anywhere.
- **Copy continuation prompt** in the top bar copies a prompt for the next agent session. The prompt lists only the decisions that changed since the record revision in `src/lab/record.ts`. With no change, it lists no decision and says that no decision is open.
- Copying does not start a new round. A new round starts when an agent merges the prompt into the record, sets `INCORPORATED_FEEDBACK` to the merged feedback, and changes `revision` in `src/lab/record.ts`.
- When a picked variant leaves the catalog, the lab keeps the notes, clears the pick, and lists the decision as `OPEN` in the next prompt.
- The lab knows a variant by its `id` only. When the meaning of a variant changes, give it a new `id`, so that a pick of the old meaning becomes open again.

## Catalog text

The catalog has the words of the lab: the question of each surface, what each scenario shows, and the summary, the ideas, and the tradeoffs of each variant. Put a literal between backticks: a key, an identifier, a field name, or a prop. `CatalogText` in `src/lab/ui/catalog-text.tsx` renders it as code. The name of a pick, the name of a data mode, and a label of the page are plain text, with quotation marks where the text needs them. Code that breaks across two lines is hard to read.

- A page explorer shows the ideas and the tradeoffs of the selected variant beside the decision.
- A component explorer has two closed lists: the scenarios of the surface at the top, and "Ideas and tradeoffs" below each variant.
- For a variant of an open surface, the `ideas` are the reasons for the option and the `tradeoffs` are the reasons against it. The explorers name the two lists "For" and "Against".
- The tradeoffs of a page name each place where the page reverses something that the maintainer saw in round 1, each reading of a note or of an audit answer, and what the answers of round 2 did not pick.

## Records

The lab keeps the material behind the designs and behind the audit document:

| Folder                   | Content                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `audit/content`          | The source of the audit document. `audit/AUTHORING.md` says how to change it, and `node audit/build.mjs` builds it. |
| `audit/reports`          | One folder for each audit lane, with the report of the auditor and the report of the verifier.                      |
| `audit/reports/*.json`   | `findings.json` has every finding with the reason of its verdict.                                                   |
| `docs/design/round-2.md` | The plan of round 2, the amendments of the coordinator, and where the lab differs from both.                        |
| `docs/design/round-3.md` | The five answers of round 2, what left the lab with them, and where the removed files are.                          |
| `docs/design/round-4.md` | The two speed answers of the audit: the list with the bar glider only, and the cards with pictures.                 |
| `docs/design/directions` | The brief of each page design of round 1. The seven briefs that are not in the lab are there too.                   |
| `docs/design/components` | The specification of each component surface of round 1. The surfaces that are not in the lab are there too.         |
| `docs/design/reviews`    | The round 1 review of each page design and of each component surface: the scores, the repairs, the open points.     |
| `docs/fixtures.md`       | The data of the lab and its hooks.                                                                                  |
| `docs/primitives.md`     | The guide to the Ariakit UI primitives: the props, the recipes, and the pitfalls.                                   |

The folder `audit` is not on this branch yet. It comes with a later commit, and until then each path in this file and in `docs/design` that starts with `audit/` or with `apps/lab/audit/` names a file that the branch does not have.

## State

Round 4, record revision `r3`. The lab is the settled design: 1 direction with 6 pages, and 4 reference surfaces. No decision is open. `docs/design/round-2.md` has the plan of round 2, `docs/design/round-3.md` has what changed when the maintainer answered its five choices, and `docs/design/round-4.md` has the two changes of round 4. Round 4 merged no lab feedback, so the record keeps revision `r3`.

- **Changed in round 4.** Two answers of the audit about the speed of the lab. The screenshot list of the review page has the bar glider only (D-PERF-01). The cards of the gallery and of the directions page show pictures in place of live frames (D-PERF-03).
- **Last check of round 4.** An independent review made its own builds of the lab before and after the round and ran its own scripts. With the bar glider only, one arrow key recalculates 66 to 122 of the 1,731 elements of the review page with 41 rows, against 1,216 to 1,234 before. The list is equal pixel for pixel in each state but two: the pointer on the selected row (48 to 64 pixels), and a keyboard focus in a folder (the ring is inside the row). The gallery makes 222 requests on the development server, against 3,187 with live frames. Two new captures give 18 and 20 of the 20 picture files byte for byte. The lint, the type check, the build, and the smoke check pass. `docs/design/round-4.md` has each number with its load average. Only Chrome was used.
- **Settled.** 30 decisions. Round 1 settled 25: the 6 pages and 19 parts. Round 2 settled 5: the stage bar (the floating pill), the variant control (the stepper with the cover), the layer of the next run card (brand at 15%), the scope of the pull request page (the waiting page), and the row picture (the row with its picture). `INCORPORATED_FEEDBACK` in `src/lab/record.ts` has the 30 picks and the 5 notes of the maintainer, word for word, and `/feedback` says where each pick is now.
- **Open.** Nothing. A settled surface still takes a note, and a note is a change that the continuation prompt lists.
- **Gone in round 3.** The five choice surfaces, the six options that the maintainer did not pick (the docked bar, the stepper without the cover, the folder tabs, the next run card on a sheet surface, the pull request page with all runs, and the row with the marks only), and the kit parts that only they used: `folder.tsx`, `progress.tsx`, `axis-marks.tsx`, `variants/tabs.tsx`, `Callout`, and the browser and framework icons. `docs/design/round-3.md` has the list.
- **Gone in round 2.** The 15 component surfaces of round 1 whose picks are now parts of the kit are not in `src/explorations/components`, and the kit has no round 1 export left. The catalog of round 1 had 4 directions and 19 component surfaces with 109 variants. The briefs, the specifications, and the reviews of that round are in `docs/design`.
- **Last check of round 3.** The six pages were compared with their pictures from before the removal, pixel by pixel: each scenario in the data mode Decided API, dark and light, at 1440 by 900. `docs/design/round-3.md` has the result. An independent review then took its own pictures, also at 1280 by 800 and in the two other data modes, compared them with the pictures of round 2, and did one complete review of the scenario `changes` with the keys only and with the pointer only. The type check, the lint, and the format check of the lab are clean. Only Chrome was used.
- **Last check of round 2.** Each page, each option of each choice, and each reference surface was loaded in the three data modes and the two themes at 1440 by 900 and 1280 by 800: 924 captures with no console error, no failed request, and no page that scrolls sideways. One reviewer then looked at the whole lab and did one complete review of the scenario `changes` with the keys only and with the pointer only.

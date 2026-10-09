# Visonaut simplification audit

Open [the standalone decision document](./index.html). Revision 6 records all 45 choices, with no open policy decisions. O11 selects preview fixtures without GitHub login. All 44 earlier selections and notes remain unchanged. Each decision keeps its selectable alternatives and working example. The file includes its scripts, styles, Ariakit UI components, and decision data; it works without a network connection. Keep this folder with it to preserve the source references and research evidence.

This audit read Visonaut at [`7e23173`](https://github.com/ariakit/visonaut/commit/7e23173d11b1081f55021ef498e4c5c6d6a08131) and Ariakit at [`fe73331`](https://github.com/ariakit/ariakit/commit/fe73331c833108a7ce18e0df6ba04af9e83776b9) on 29 September 2026. It includes the latest backup retirement. No application behavior, cloud resource, credential, or GitHub content was changed.

[Issue #1](https://github.com/ariakit/visonaut/issues/1) remains the implementation contract until the authorized handoff to the repository contract selected by Q03. [Its snapshot](./contract-issue-1.md) and [all 61 earlier decisions](./prior-r9.json) are preserved. The [local contract and handoff draft](./handoff-draft.md) maps superseded rules, inherited requirements, coordinated work, and evidence gates. It is prepared for review and implementation planning. The local files do not change the issue or the app.

## Use the decision document

Use the sticky **Decisions** menu to jump to any panel. Each panel keeps its options and notes together. The recorded choice card shows an incorporated answer for all 45 decisions. [O11](./index.html#O11) records fixtures without GitHub login. You can change or clear any answer; a cleared decision remains OPEN and keeps all its selectable options. Model controls let you explore alternatives; they do not answer a decision. A recommendation is a label, not a selected answer.

Selections and notes stay in browser-local storage for this document. They reach the agent only when you share the continuation prompt. Use **Copy continuation prompt**, or select the visible preview manually. The prompt contains only feedback changed since the last agent merge. Copying does not advance that baseline.

The complete record is [audit-data.json](./audit-data.json). The raw audit reports, feedback reviews, and compact experiments are in [evidence](./evidence). Browser measurement results are local diagnostic samples, not production speed or cost claims. Live Cloudflare inventory and current billing were not verified because the available Wrangler login had expired. The live GitHub branch rule and Infisical folder metadata were checked; secret names were not available to this session.

## Rebuild

The source imports the repository's copied Ariakit UI components. The app and prototype use `Shell`, `Frame`, `Layer`, `Button`, and Ariakit interaction components. Styling for the document remains local to the artifact. No new application package or dependency was added.

After installing the repository's locked dependencies, run from the repository root:

```sh
pnpm --filter @visonaut/web exec vite build --config ../../docs/simplification-audit/source/vite.config.mjs --configLoader native
node docs/simplification-audit/source/export-portable.mjs
cp docs/simplification-audit/source/dist/standalone.html docs/simplification-audit/index.html
```

The source entry stays at `source/index.html`; the deliverable is the top-level `index.html`. If a separate dependency installation is required, set `VISONAUT_DEPS` to that installation's `apps/web` directory. The audit used the existing locked dependencies without changing their files.

For a local browser URL:

```sh
python3 -m http.server 4319 --bind 127.0.0.1 --directory docs/simplification-audit
```

## Continue after feedback

Load the complete JSON record and the contract snapshot. Merge only the feedback supplied by the user. Keep unchanged decisions and notes. Only explicit selections settle a decision. If notes conflict with a selection, resolve that conflict before treating the choice as settled.

Update `feedbackBaseline` only after the agent incorporates the feedback. Change `feedbackMergedRevision` and the document revision together. Option fingerprints clear a saved selection when that option's meaning changes, while keeping its notes. Rebuild and verify the page after a record change.

Product implementation and GitHub publication remain outside this design continuation unless separately authorized.

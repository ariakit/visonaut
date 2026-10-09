# Authoring guide for the Visonaut audit document

This folder builds one web page: the audit and design record of Visonaut. The engine (`engine/`) renders the page. You write the content (`content/`). You do not need to read the engine code.

Read this file to the end before you write content. The build rejects content that does not follow it, and its messages name the file and the line.

The examples in this guide are the parts of one small document. They agree with each other: the section has the id `load`, the findings are `LOAD-02` and `LOAD-03`, and the decision is `D-LOAD-01`. If you copy every example into a content folder, the build passes.

## Folder map

```text
apps/lab/audit/
  AUTHORING.md          This guide.
  build.mjs             Validates the content and writes the two outputs.
  check.mjs             Opens the outputs in Chrome and checks the behavior.
  engine/               The engine. Do not edit it for content work.
    shell.html            The page frame: sticky bar, index, masthead.
    styles.css            All styles and all color tokens.
    core.js               Logic with no browser: validation, formulas, feedback, the prompt.
    app.js                The browser part.
    core.test.mjs         Tests of core.js.
  content/              The content. This is what you write.
    record.json           Title, revision, date, record location, incorporated feedback.
    decisions.json        Every decision, in document order.
    findings.json         Every finding of the findings table.
    terms.json            The shared definitions for the term tooltips.
    sections/NN-name.html One HTML fragment for each section, in file-name order.
  dist/visonaut-audit.html      Output: the Artifact source. Generated. Not in git.
apps/lab/public/audit/index.html  Output: a standalone copy for local use. Generated.
```

## Commands

Run every command from the repository root.

```sh
# Validate the content and write both outputs.
node apps/lab/audit/build.mjs

# Validate only. Write nothing.
node apps/lab/audit/build.mjs --check

# Also fail when sample content remains. Use this before the document is shared.
node apps/lab/audit/build.mjs --strict

# Build a draft from another content folder into another output folder.
# Use this when several agents work at the same time, so that no agent replaces the shared outputs.
# The content folder needs all four JSON files and the three engine sections.
# The messages name its files as "content/...".
node apps/lab/audit/build.mjs --content <content folder> --out <output folder>

# Check the built page in Chrome: both outputs, at 1440 px and at 400 px.
node apps/lab/audit/check.mjs
node apps/lab/audit/check.mjs --shots <folder>      # Also save screenshots.
node apps/lab/audit/check.mjs --dir <output folder> # Check a draft from "build.mjs --out".
node apps/lab/audit/check.mjs --only artifact       # One output: artifact or standalone.

# Test the engine logic.
node --test apps/lab/audit/engine/core.test.mjs

# Format and lint. The formatter also formats the HTML, JSON, and Markdown files of the content.
pnpm exec oxfmt apps/lab/audit
pnpm exec oxlint apps/lab/audit
```

The lab dev server serves the standalone copy at `http://127.0.0.1:4320/audit/index.html`.

`check.mjs` reads the data from the built page. It does not depend on the sample content. Run it after each content change. Read the screenshots that it saves.

## Rules that come from the Artifact host

The page is published as a Claude Artifact. The host is strict, and it fails without an error message. The build enforces these rules.

- No external file. An image is a data URI with an image type (`data:image/png;base64,` or `data:image/svg+xml;base64,`, then the complete data). Give each image an `alt` text. The build rejects base64 data that is cut or shortened.
- No script and no event attribute (`onclick`) in a section. The one exception is the JSON configuration of a demo.
- No `<style>`, `<link>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<base>`, or `<meta>` in a section.
- A link is `href="#anchor"` or `href="https://..."`. The engine opens an https link in a new tab. A `mailto:` link, a relative path, and a file path do not work. A link to `http://127.0.0.1` or `http://localhost` gives a warning, because it opens only on a computer that runs that server.
- An `id` uses only letters, digits, and `. _ ~ -`. Other characters do not reach the address of the page.
- The page must fit a width of 400 px. Do not set a fixed width. A wide table or code block scrolls in its own box: the engine does that for you.
- Each output must stay below 16 MB. The build prints the sizes.
- Do not write a color value. Every color is a token in `engine/styles.css`. If you must set a color in a `style` attribute, use a token, for example `style="color: var(--text-2)"`.

## Writing style

The reader is an expert maintainer. Use plain words and short sentences. One sentence says one thing. Use the same word for the same thing each time. Say who does what. Do not use an emoji.

Define a term only when the maintainer may not know it. A defined term gets a tooltip at every use, and each tooltip is a keyboard stop. If you define plain words such as "request" or "copy", the page fills with marks.

## Sections

A section is one file in `content/sections/`. The file name is `NN-name.html`: two digits or more, then a name in lower case with hyphens. The sections appear in file-name order. Leave gaps between the numbers.

The file holds exactly one `<section>` element. A comment before it is allowed. The build removes comments.

```html
<!-- A note for other authors. The page does not show it. -->
<section id="load" data-title="Dashboard load">
  <h2>Dashboard load</h2>

  <p class="lead">One or two sentences that say what the section found.</p>

  <p>Text, lists, tables, figures, code, demos, and decision panels.</p>

  <h3 id="load-waterfall">A sub-topic with its own anchor</h3>

  <p>More text.</p>
</section>
```

- `id` is the anchor of the section. It must be unique in the whole page.
- `data-title` is the label in the page index. Keep it short.
- Start with one `<h2>`. Use `<h3>` and `<h4>` below it. Do not use `<h1>`: the page title comes from `record.json`.
- Give an `id` to each heading that another place links to.
- Close every element. `<li>`, `<p>`, `<td>`, and `<tr>` need their end tags.
- A `<p>` cannot hold a block (`<div>`, `<ul>`, `<table>`, `<pre>`, a demo, a decision panel). Close the paragraph first.
- A table part needs its parent: `<td>` and `<th>` in a `<tr>`, a `<tr>` in `<thead>`, `<tbody>`, `<tfoot>`, or `<table>`. A row holds cells only. A browser drops a part that is in another place, so the build rejects it.
- The placeholders `data-decision`, `data-engine`, and `data-demo` go on a `<div>`, not on a `<span>` and not in a `<p>`.
- Write `<`, `>`, and `&` in text and in code as `&lt;`, `&gt;`, and `&amp;`.

### The three engine sections

These files are not samples. Keep them. You can change the heading and the text, and you can change the number in the file name to move the section.

| File                      | Placeholder                                     | What the engine renders                                                     |
| ------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `80-findings.html`        | `<div data-engine="findings-explorer"></div>`   | The findings table with filters, counts, and sortable columns.              |
| `90-decision-record.html` | `<div data-engine="decision-record"></div>`     | Every decision in three groups: open, settled, rejected.                    |
| `95-feedback.html`        | `<div data-engine="continuation-prompt"></div>` | The note about saved feedback, the prompt preview, and the portable record. |

Each placeholder must be in the page exactly one time.

### Sample content

The files `10-summary.html`, `20-dashboard-load.html`, and `30-review-workspace.html` are samples. So is every entry with `"sample": true` in the JSON files, and `record.json` itself. Replace all of it.

A sample section has the attribute `data-sample` on its `<section>`. The page shows a "Sample content" flag for each sample, and the build prints a warning. `build.mjs --strict` fails while any sample remains. Do not put `data-sample` or `"sample": true` on real content.

The numbers in the sample "Dashboard load" section are the measured production facts. Its findings, decisions, and settled answer are examples.

## Text elements and classes

Use plain HTML. These classes are available.

| Class or element       | Use                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `<p class="lead">`     | The first paragraph of a section, in larger text.                                   |
| `<aside class="note">` | A boxed remark, for a limit or a caution. Put `<p>` elements inside.                |
| `<dl class="stats">`   | A row of key numbers. Use it only when the numbers are the point.                   |
| `<div class="cols">`   | Two or more blocks next to each other. They stack at a narrow width.                |
| `class="wide"`         | Lets a paragraph or a list use the full column width. The default is 65 characters. |
| `class="muted"`        | Secondary text.                                                                     |
| `class="small"`        | Smaller text.                                                                       |
| `class="num"`          | On `<td>` and `<th>`: a number column, aligned right.                               |
| `<code>`, `<kbd>`      | Inline code and a key name.                                                         |
| `<details>`            | Text that the reader opens. Put the label in `<summary>`.                           |

```html
<dl class="stats">
  <div>
    <dt>Run list visible</dt>
    <dd>1,720 ms</dd>
    <dd>Typical first visit.</dd>
  </div>
  <div>
    <dt>Round trips before the data</dt>
    <dd>5</dd>
  </div>
</dl>

<aside class="note">
  <p><strong>Limit.</strong> The audit measured one region.</p>
</aside>

<div class="cols">
  <div>
    <h4>Today</h4>
    <p>Text.</p>
  </div>
  <div>
    <h4>Proposed</h4>
    <p>Text.</p>
  </div>
</div>
```

In a `stats` item, the first `<dd>` is the number. A second `<dd>` is a short remark.

### Tables

Write a plain table. The engine puts it in a box that scrolls sideways when the table is wider than the page. Use `<caption>`, `<thead>`, and `scope` on header cells.

```html
<table>
  <caption>
    Where the server wait goes
  </caption>
  <thead>
    <tr>
      <th scope="col">Step</th>
      <th scope="col" class="num">Round trips</th>
      <th scope="col" class="num">Time</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Schema check</th>
      <td class="num">2</td>
      <td class="num">220 ms</td>
    </tr>
  </tbody>
</table>
```

### Figures

```html
<figure>
  <img
    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 720 240'%3E%3Crect width='720' height='240' fill='%23191c22'/%3E%3Crect x='24' y='88' width='132' height='64' rx='4' fill='%233987e5'/%3E%3C/svg%3E"
    width="720"
    height="240"
    alt="What the image shows, in one sentence."
  />
  <figcaption>What the reader must see in the image.</figcaption>
</figure>
```

The example is a small SVG image, written with `%3C` for `<`, `%3E` for `>`, and `%23` for `#`. For a PNG, use `data:image/png;base64,` and then the complete base64 data. Do not shorten the data with `...`: the build rejects it, because a browser shows a broken image.

Set `width` and `height` to the size of the image, so that the page does not move when the image loads. The image never gets wider than the column. An inline `<svg>` in a `<figure>` also works. Color a diagram with `fill="currentColor"` or with a token in a style (`style="fill: var(--text-2)"`), so that it is readable in both themes. A token does not work in a plain `fill` attribute. An image in a data URI cannot use tokens: give it its own background.

A term in the words of an inline `<svg>` (its `<text>` elements) cannot hold a tooltip. The engine adds a line "Terms in the drawing: ..." below the drawing, with one trigger for each term. A caption that already uses the term needs no line. The engine cannot read the words of an `<img>`: name its terms in the caption.

Keep images small. A PNG screenshot at 1440 px can be 300 KB or more as base64. Crop it and reduce it before you inline it.

### Code blocks

```html
<pre><code class="language-ts">
  const [session, user] = await env.DB.batch([
    env.DB.prepare("SELECT id FROM session WHERE token = ?1").bind(token),
    env.DB.prepare("SELECT id, name FROM user WHERE id = ?1").bind(userId),
  ]);
</code></pre>
```

- The class sets the language: `language-ts`, `language-tsx`, `language-sql`, `language-json`, `language-jsonc`, `language-bash`, `language-yaml`, or `language-text`. Another language fails the build.
- You can indent the code with the HTML. The engine removes the indentation that all lines share, and the empty lines at the start and the end.
- Escape `<`, `>`, and `&`. Write `Promise&lt;void&gt;` and `a &amp;&amp; b`.
- The engine adds the language name and a Copy button. The copied text is the source text. Highlighting and term tooltips do not change it.
- highlight.js loads from cdnjs. Without a network the code is plain, and it is still complete.

## Fact labels

The protocol requires that a verified fact is separate from an assumption. Put `data-fact` on the element that holds the claim. The engine adds a visible label in front of it. Each label has a tooltip with its meaning.

| Value        | Label             | Use it for                                                          |
| ------------ | ----------------- | ------------------------------------------------------------------- |
| `measured`   | Measured          | A value that the audit measured on the service or in a browser.     |
| `counted`    | Counted from code | A value that the audit counted in the source code and did not time. |
| `estimate`   | Estimate          | A value calculated from other values.                               |
| `assumption` | Assumption        | A statement that nobody verified.                                   |

```html
<p>
  <span data-fact="measured">The document arrives in 40 to 120 ms.</span>
  <span data-fact="assumption">The schema check is not necessary on a request.</span>
</p>

<ul>
  <li data-fact="counted">3 reads, one after the other.</li>
  <li data-fact="estimate">About 785 ms less with a permission cache.</li>
</ul>
```

`data-fact` works on any element: `<span>`, `<p>`, `<li>`, `<td>`. In a table, put it on the cell: `<td data-fact="counted">3 reads</td>`. A step of a timeline demo and a step of a sequence demo take a `"fact"` field with the same values.

## Findings

### findings.json

A list. Each entry is one row of the findings table.

```json
[
  {
    "id": "LOAD-02",
    "area": "Dashboard",
    "title": "/api/operations starts only after /api/runs ends",
    "kind": "performance",
    "severity": "high",
    "verdict": "confirmed",
    "measured": "1,200 to 1,300 ms more",
    "effort": "S",
    "summary": "The two requests do not need the data of each other, but the page sends them one after the other.",
    "section": "load-waterfall"
  },
  {
    "id": "LOAD-03",
    "area": "Auth",
    "title": "The GitHub permission check runs on each API request",
    "kind": "performance",
    "severity": "high",
    "verdict": "confirmed",
    "measured": "240 to 1,340 ms",
    "effort": "M",
    "summary": "The Worker asks GitHub for the permission of the reviewer on each request.",
    "section": "load"
  }
]
```

| Field      | Value                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`       | Unique and stable. Letters, digits, and `. _ ~ -`. The row has the anchor `#finding-<id>`.                            |
| `area`     | Free text. It is a filter. Use few different values.                                                                  |
| `title`    | One sentence.                                                                                                         |
| `kind`     | Free text. It is a filter. For example `performance`, `bug`, `ux`, `accessibility`, `security`, `cost`, `copy`, `dx`. |
| `severity` | One of `critical`, `high`, `medium`, `low`, `info`.                                                                   |
| `verdict`  | One of `confirmed`, `partly-confirmed`, `judgment`, `not-verified`, `unverifiable`, `refuted`.                        |
| `measured` | `true`, `false`, or a text with the measured value.                                                                   |
| `effort`   | Free text. `XS`, `S`, `S-M`, `M`, `M-L`, `L`, and `XL` sort in that order.                                            |
| `summary`  | One or two sentences. The table shows it below the title.                                                             |
| `section`  | The `id` of the section or of an element in a section that explains the finding. Use `""` when no section does.       |

The table shows 40 rows first and has a "Show all" button. It was tested with 550 rows.

### Finding callouts

Name the findings that support a claim. The engine renders one chip for each identifier, with the severity and the verdict. Each chip links to the row in the findings table.

```html
<!-- Inline, in a sentence: chips only. -->
<p>The requests run one after the other. <span data-findings="LOAD-02"></span></p>

<!-- A block: a "Findings" box with one line for each finding, with its title. -->
<div data-findings="LOAD-02 LOAD-03"></div>
```

Use a `<span>` for chips in a line of text. Any other element becomes the block form. Separate identifiers with a space. An unknown identifier fails the build.

## Term tooltips

### terms.json

```json
[
  {
    "term": "D1 batch",
    "aliases": ["batch", "DB.batch"],
    "definition": "Several SQL statements that the Worker sends to D1 at one time."
  },
  {
    "term": "D1",
    "aliases": [],
    "definition": "The SQL database of Cloudflare that Visonaut uses."
  }
]
```

- `definition` is one or two short sentences in simple words. It is the text of the tooltip.
- `aliases` are other words for the same term. One name can have one definition only.
- `caseSensitive` is optional: `true` or `false`. It replaces the case rule below for the whole entry.

### What the engine does

You do not mark terms in the text. The engine finds every use and adds the tooltip trigger: in text, headings, tables, captions, decision text, demo text, and code.

- The longest name wins. With "D1" and "D1 batch" defined, "D1 batch" is one trigger and "D1" alone is another.
- A name matches whole words only. It also matches a plural that ends in `s` or `es` ("round trips"). Add other forms as aliases ("queries" for "query").
- A name with a digit or with two capital letters or more matches with exact case (`D1`, `DB.batch`, `Better Auth`). Other names ignore case, so "worker" and "Worker" both match "Worker".
- A name inside an identifier does not match. `D1` gets no trigger in the finding `D1-01` or in the decision `D-D1-04`. The rule: no match directly after a capital letter or a digit and a hyphen, and no match directly before a hyphen and a digit. `D1-backed` is still a use of the term.
- A name matches across a line break, and across the tokens of highlighted code.
- A term that crosses an inline element in text (`<em>round</em> trip`) does not match. Use `data-term` for it.
- A term in the words of an inline `<svg>` drawing gets a trigger in a line below the drawing. See "Figures".
- A trigger shows the definition on hover and on keyboard focus. A tap opens it. Escape closes it.
- The page has no glossary and no links to definitions. That is a rule of the protocol.

### Terms in links and controls

A trigger never goes inside a link, a button, a label, or another control. The label stays as it is. When a label has a term, the engine puts a trigger beside it. You do nothing.

| Where the label is                                      | Where the trigger goes                                      |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| An engine control: an option, a toggle, a slider, a tab | A line "Terms in the label: ..." in the text of the control |
| An entry of the Sections index or of the Decisions menu | A line "Terms: ..." below the entry                         |
| A filter of the findings table, also one of its options | A line "Terms in the label: ..." below the filters          |
| A link or a `<summary>` of yours                        | A small "?" mark after it                                   |

The mark is left out when the same paragraph, list item, or table cell already has a trigger for that term.

A section title (`data-title`) and the `short` label of a decision are labels of the index and of the menu. Each term in them adds a line to an entry. Keep these labels short and plain.

### Excluding text and adding a trigger by hand

```html
<!-- No term trigger inside this element. -->
<p data-no-terms>The word batch here is a common word, not the term.</p>

<!-- This element is a trigger for the term "D1", with other words. -->
<p>The reads go to <span data-term="D1">the database</span>.</p>
```

`data-term` names a term or an alias of `terms.json`. An unknown name fails the build. So does `data-term` on or inside a link, a button, a label, or a summary.

## Decisions

### decisions.json

A list. Keep it in document order. The Decisions menu, the decision record, and the prompt follow the order of the panels in the page, also when this list has another order.

```json
[
  {
    "id": "D-LOAD-01",
    "short": "Start both requests together",
    "question": "Should the dashboard start /api/operations at the same time as /api/runs?",
    "context": "Today /api/operations starts only after /api/runs ends. The two requests do not need the data of each other.",
    "options": [
      {
        "id": "parallel",
        "label": "Start both requests together",
        "explanation": "The browser sends both requests when the JavaScript is ready.",
        "consequences": "Both lists are visible about 1,200 ms sooner. D1 and GitHub get two sets of requests at once.",
        "recommended": true
      },
      {
        "id": "keep",
        "label": "Keep the sequence",
        "explanation": "Nothing changes.",
        "consequences": "The operations panel stays about 1,250 ms behind the run list.",
        "recommended": false
      }
    ],
    "evidence": ["LOAD-02"],
    "status": "open",
    "settledAnswer": "",
    "rationale": ""
  }
]
```

| Field           | Value                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`            | Stable for the life of the record, for example `D-LOAD-01`. Never reuse an identifier for another question.     |
| `short`         | The label in the Decisions menu. A few words.                                                                   |
| `question`      | One clear question.                                                                                             |
| `context`       | One or two sentences.                                                                                           |
| `options`       | Two or more. Include the option that changes nothing when it can solve the problem.                             |
| `options[].id`  | Stable. Unique in the decision.                                                                                 |
| `explanation`   | What the option is.                                                                                             |
| `consequences`  | What follows from it: cost, risk, and what the maintainer gives up.                                             |
| `recommended`   | `true` shows the label "Recommended". It never selects the option.                                              |
| `evidence`      | A list of finding identifiers. The panel shows them as chips.                                                   |
| `status`        | The state in the record: `open`, `settled`, or `rejected`. It is separate from the selection of the maintainer. |
| `settledAnswer` | For `settled`: the answer in words. Required. For `rejected`: what stays in place, if anything.                 |
| `rationale`     | Required for `settled` and `rejected`: why. For `open`: what evidence or answer is needed, or `""`.             |

The Decisions menu shows both states of a decision: "Open" or "Answered" for the maintainer, and "settled in the record" or "rejected in the record" when the record has that status.

**When the meaning of an option changes, give the option a new `id`.** The page then clears the saved selection of that option, keeps the notes, shows the decision as Open, and reports it as an `OPEN` update in the next prompt. If you keep the `id`, the page treats the old selection as an answer to the new meaning.

Ask only what the maintainer must decide: product policy, scope, compatibility, or a real tradeoff. Do not ask for a fact that the repository or a small experiment can give.

### Placing a panel

Put the placeholder in the section that explains the tradeoff, after the evidence and the demo. Do not collect the panels at the end.

```html
<div data-findings="LOAD-02"></div>

<div data-decision="D-LOAD-01"></div>
```

- The placeholder is empty. The engine renders the panel: the "Decision" label, the identifier, the question, the context, the evidence, the options as radio inputs, the "Recommended" label, the Open or Answered state, the notes field, and "Clear selection".
- Each decision of `decisions.json` needs exactly one placeholder. A missing one and a second one both fail the build.
- A panel cannot be inside a demo.
- The panel has the anchor `#decision-<id>`, for example `<a href="#decision-D-LOAD-01">D-LOAD-01</a>`.

### record.json

```json
{
  "title": "Visonaut Audit",
  "revision": "r3",
  "date": "2026-10-05",
  "livingRecord": {
    "artifactUrl": "https://claude.ai/code/artifact/...",
    "localPath": "/absolute/path/to/apps/lab/public/audit/index.html",
    "labPath": "apps/lab",
    "sourcePath": "apps/lab/audit"
  },
  "incorporated": {
    "D-LOAD-01": { "selection": "parallel", "notes": "Fine if D1 can take the load." }
  }
}
```

- `title` is the name of the page and of the Artifact. **Do not change it.** The saved feedback of the maintainer is stored under a key that comes from the title.
- `revision` changes each time an agent merges feedback. Any text works: `r1`, `r2`.
- `livingRecord` goes into the continuation prompt, so that the next agent can find the record. `artifactUrl` is empty until the first publish. `sourcePath` is optional.
- `incorporated` is the feedback that the record already has: for each decision, the option `id` that the maintainer selected (or `null`) and the notes. It is the baseline of the feedback round. Leave out a decision that has no feedback. A first revision has `"incorporated": {}`. An entry with notes and no selection is `{ "selection": null, "notes": "Wait for the D1 numbers." }`.
- An entry in `incorporated` shows in the page as the answer of the maintainer, and it counts as answered. Put only an explicit choice of the maintainer there. Never put a recommendation there.

### How a feedback round works

1. The maintainer selects options and writes notes in the page. The page saves them in the browser, with the baseline.
2. The page compares the current feedback with the baseline. The decisions that differ are the feedback round. The continuation prompt lists only these.
3. The maintainer copies the prompt and gives it to an agent. A copy does not change the baseline. The same updates stay in the prompt.
4. The agent merges the updates and publishes a new revision. Only then does the baseline move.

Only an explicit selection of a current option counts as answered. A recommendation does not. Notes alone do not.

### What to do when you get a continuation prompt

1. Load the whole record: `content/record.json`, `content/decisions.json`, and the sections. If you cannot open them, stop. Ask the maintainer for the "Portable copy of the complete record" from the feedback section of the page. Do not rebuild the record from the prompt: the prompt lists only the decisions that changed.
2. For each decision in the prompt, set `incorporated[<id>]` to `{ "selection": <option id or null>, "notes": <the notes> }`. `OPEN` in the prompt is `null`. Do not change a decision that the prompt does not list.
3. If the maintainer selected an option, you can set the decision to `"status": "settled"`, with `settledAnswer` and `rationale`. If a note conflicts with the selection, ask the maintainer. Do not guess. If a note raises a new option, compare it with the current options first.
4. Keep an `OPEN` decision open. Never settle a decision for the maintainer.
5. Change `revision` and `date`.
6. Run the build and the check. Publish the new `dist/visonaut-audit.html` to the same Artifact address.

When the maintainer next opens the page, the browser sees the new revision. It replaces the baseline with the new `incorporated` and keeps the current feedback. What the record now holds leaves the prompt.

Implementation and GitHub publication are not part of a feedback round, unless the maintainer authorizes them separately.

## Demos

A demo is a working example beside the text that it supports. The protocol asks for one for each design explanation and each material tradeoff. Every demo shows its state, has a Reset button, and has a visible label that says it is simulated.

```html
<div data-demo="timeline" id="demo-load-waterfall">
  <script type="application/json">
    { "title": "...", "limits": "..." }
  </script>
</div>
```

- `data-demo` is the type: `timeline`, `calculator`, `compare`, `sequence`, or `viewer`.
- `id` is required and unique. The engine builds the ids of the controls from it, so no other `id` can start with `<demo id>-`.
- The configuration is one `<script type="application/json">` child. It must be valid JSON: double quotes, no comment, no comma after the last item.
- `title` is required.
- `limits` is required: one or two sentences that say what is simulated and what the demo does not show. A demo does not prove the behavior of the product. Say so.
- `label` is optional. The default is "Simulated example". Use "Proposed text" or "Proposed behavior" for a proposal.

Text in a configuration is plain text. It gets term tooltips, but it cannot hold HTML.

### timeline

A request waterfall. Each step has a lane and a duration. A step starts when every step in its `after` list has ended. Steps with the same `after` list run at the same time. The reader turns changes on and off and sees the bars, the totals, and the difference from the baseline.

```html
<div data-demo="timeline" id="demo-load-waterfall">
  <script type="application/json">
    {
      "title": "Dashboard load, first visit of a signed-in reviewer",
      "limits": "This is a model, not a recording. Each bar uses a value from production. The model does not show network variance or a retry.",
      "unit": "ms",
      "baselineLabel": "today",
      "totalLabel": "Both lists visible",
      "milestone": "runs-visible",
      "milestones": [
        { "id": "runs-visible", "label": "Run list visible", "after": ["render-runs"] }
      ],
      "steps": [
        {
          "id": "document",
          "label": "Document (HTML shell)",
          "lane": "worker",
          "duration": [40, 120],
          "fact": "measured"
        },
        {
          "id": "javascript",
          "label": "Load and start the JavaScript",
          "lane": "browser",
          "duration": 160,
          "after": ["document"]
        },
        {
          "id": "session",
          "label": "Session and account, 3 round trips",
          "lane": "d1",
          "duration": 330,
          "after": ["javascript"]
        },
        {
          "id": "permission",
          "label": "GitHub permission check",
          "lane": "github",
          "duration": [240, 1340],
          "after": ["session"],
          "fact": "estimate"
        },
        {
          "id": "runs",
          "label": "Run list, 1 batch",
          "lane": "d1",
          "duration": 110,
          "after": ["permission"]
        },
        {
          "id": "render-runs",
          "label": "Draw the run list",
          "lane": "browser",
          "duration": 30,
          "after": ["runs"]
        },
        {
          "id": "operations",
          "label": "/api/operations",
          "lane": "worker",
          "duration": [1200, 1300],
          "after": ["runs"]
        }
      ],
      "toggles": [
        {
          "id": "cache-permission",
          "label": "Reuse the permission check for 60 seconds",
          "explanation": "The Worker keeps the answer of GitHub for a short time.",
          "effects": [{ "type": "setDuration", "step": "permission", "duration": 5 }]
        },
        {
          "id": "batch-session",
          "label": "Read the session and the account in 1 batch",
          "explanation": "One D1 batch sends the 3 reads in 1 round trip.",
          "effects": [
            { "type": "remove", "steps": ["session"] },
            {
              "type": "addStep",
              "insertAfter": "session",
              "step": {
                "id": "session-batch",
                "label": "Session and account, 1 batch",
                "lane": "d1",
                "duration": 110,
                "after": ["javascript"]
              }
            },
            { "type": "setAfter", "step": "permission", "after": ["session-batch"] }
          ]
        },
        {
          "id": "parallel-operations",
          "label": "Start /api/operations with /api/runs",
          "explanation": "The page sends both requests when the JavaScript is ready.",
          "effects": [{ "type": "setAfter", "step": "operations", "after": ["javascript"] }]
        }
      ],
      "presets": [
        { "id": "today", "label": "Today", "toggles": [] },
        {
          "id": "all",
          "label": "All selected fixes",
          "toggles": ["cache-permission", "batch-session", "parallel-operations"]
        }
      ]
    }
  </script>
</div>
```

| Field              | Value                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `unit`             | The unit of every time. Default `"ms"`.                                                                        |
| `baselineLabel`    | The name of the state with no toggle on. Default `"today"`. It appears in "870 ms sooner than today".          |
| `totalLabel`       | The label of the time when the last step ends. Default `"All steps done"`.                                     |
| `milestones`       | Named moments: `id`, `label`, and `after` (the steps that must have ended). Each one gets a readout.           |
| `milestone`        | The `id` of the milestone that the chart draws as a line. Default: the first milestone.                        |
| `steps[].id`       | Unique in the demo.                                                                                            |
| `steps[].label`    | The name of the step.                                                                                          |
| `steps[].lane`     | One of `browser`, `worker`, `d1`, `r2`, `github`, `queue`, `container`, `other`. Each lane has its own color.  |
| `steps[].duration` | A number, a range `[low, high]`, or `[low, typical, high]`. The typical value of a range of two is the middle. |
| `steps[].after`    | The steps that must end first. Leave it out for a step that starts at 0.                                       |
| `steps[].fact`     | Optional fact label: `measured`, `counted`, `estimate`, or `assumption`.                                       |
| `toggles[]`        | A checkbox with `id`, `label`, `explanation`, and `effects`. All four are required.                            |
| `presets[]`        | A button that sets a list of toggles: `id`, `label`, `toggles`. An empty list is the baseline.                 |

The `id` of a toggle and the `id` of a preset use letters, digits, and `. _ ~ -` only, with no space. The engine puts them in the ids of the controls. `toggles`, `presets`, and `milestones` are optional. A timeline with no toggle is a fixed chart with no control area.

The effects of a toggle:

| Effect                                                       | What it does                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `{ "type": "remove", "steps": ["a", "b"] }`                  | Removes steps. A step that waited for a removed step now waits for what the removed step waited for.     |
| `{ "type": "setDuration", "step": "a", "duration": 5 }`      | Sets a duration. A range is allowed.                                                                     |
| `{ "type": "scaleDuration", "step": "a", "factor": 0.5 }`    | Multiplies a duration.                                                                                   |
| `{ "type": "setAfter", "step": "a", "after": ["b"] }`        | Changes what a step waits for.                                                                           |
| `{ "type": "addStep", "step": { ... }, "insertAfter": "a" }` | Adds a step. `insertAfter` sets its row. Without it, the row goes after the last step that it waits for. |

- The effects of the toggles that are on apply in the order of the `toggles` list, not in the order of the clicks.
- An effect on a step that is absent does nothing. That lets one toggle change a step that another toggle adds.
- When a step has a range, the demo shows a "Fast, Typical, Slow" control.
- List the steps in the order of the baseline. The rows keep this order.
- The build schedules the baseline, each toggle alone, and all toggles together. A loop of dependencies fails the build.

### calculator

Sliders and formulas. Use it for a tradeoff between numbers.

```html
<div data-demo="calculator" id="demo-permission-cache">
  <script type="application/json">
    {
      "title": "Permission cache: GitHub calls against stale access",
      "limits": "These are formulas, not measurements. They assume that each reviewer sends requests at an even rate.",
      "inputs": [
        {
          "id": "lifetime",
          "label": "Cache lifetime",
          "unit": "s",
          "min": 0,
          "max": 600,
          "step": 15,
          "value": 60,
          "hint": "0 means no cache."
        },
        {
          "id": "requests",
          "label": "API requests in one hour",
          "min": 60,
          "max": 3000,
          "step": 60,
          "value": 600
        },
        {
          "id": "reviewers",
          "label": "Active reviewers",
          "min": 1,
          "max": 20,
          "step": 1,
          "value": 3
        }
      ],
      "outputs": [
        {
          "id": "calls",
          "label": "GitHub calls in one hour",
          "formula": "min(requests, reviewers * ceil(3600 / max(lifetime, 1)))",
          "unit": "calls"
        },
        {
          "id": "saved",
          "label": "Calls that the cache removes",
          "formula": "requests - calls",
          "unit": "calls"
        },
        {
          "id": "stale",
          "label": "Longest time that a removed reviewer keeps access",
          "formula": "lifetime",
          "unit": "s",
          "note": "This is the cost of the cache."
        }
      ]
    }
  </script>
</div>
```

| Field                 | Value                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `inputs[].id`         | A name of letters, digits, and `_` that starts with a letter. Formulas use it.                       |
| `inputs[].label`      | The label of the slider.                                                                             |
| `inputs[].min`, `max` | The ends of the slider. Required. `max` is `min` plus a whole number of steps.                       |
| `inputs[].value`      | The start value: `min` plus a whole number of steps, not above `max`. Required. Reset returns to it. |
| `inputs[].step`       | Default 1. The number of decimals of the step is the number of decimals shown.                       |
| `inputs[].unit`       | Optional. Shown after the number.                                                                    |
| `inputs[].hint`       | Optional. One sentence below the slider.                                                             |
| `outputs[].id`        | A name. A later output can use it in its formula.                                                    |
| `outputs[].formula`   | Numbers, names, `+ - * /`, parentheses, and `min`, `max`, `round`, `ceil`, `floor`. Nothing else.    |
| `outputs[].unit`      | Optional.                                                                                            |
| `outputs[].precision` | The number of decimals shown. Default 0.                                                             |
| `outputs[].note`      | Optional. One sentence below the result.                                                             |

`min` and `max` take one value or more. A formula cannot compare or branch: build a limit with `min` and `max`. A result that is not a number, such as a division by zero, shows "Not defined". So does each later output that uses it.

A slider moves only in whole steps from `min`. With `"min": 0` and `"step": 15`, the value 50 is not possible: the slider would show 45 and the text would say 50. The build rejects such a value.

### compare

A switch over two or more panels of your HTML: current against proposed text, or two layouts of a small element.

```html
<div data-demo="compare" id="demo-loading-copy">
  <script type="application/json">
    {
      "title": "Loading text of the dashboard",
      "label": "Proposed text",
      "limits": "The proposed text is not in the product. The example shows the words only, not the layout.",
      "badge": "words"
    }
  </script>
  <div data-panel="Current">
    <p>Checking access and loading runs…</p>
  </div>
  <div data-panel="Proposed">
    <p>Loading the run list.</p>
    <p class="muted">After 2 seconds: GitHub is slow to confirm your access.</p>
  </div>
</div>
```

- Each direct child with `data-panel` is one panel. The value is its label. Two panels or more are required.
- The first panel is the reference. The state line compares the badge of the shown panel with the badge of the first.
- `"badge": "words"` counts the words of each panel for you.
- For another number, leave out `badge`, put `data-badge="212"` on each panel, and set `"badgeUnit": "KB"`.
- The reader can show all panels next to each other.
- A panel can hold any content of a section, but not a decision panel and not another demo.

### sequence

A numbered list that the reader steps through. Use it for the order of requests or of steps in a flow.

```html
<div data-demo="sequence" id="demo-runs-sequence">
  <script type="application/json">
    {
      "title": "One /api/runs request on the server",
      "limits": "The order comes from the code. The times are typical values from production.",
      "unit": "ms",
      "interval": 1600,
      "steps": [
        {
          "label": "Read the session cookie",
          "lane": "worker",
          "cost": 1,
          "description": "The Worker reads the cookie from the request."
        },
        {
          "label": "Read the session",
          "lane": "d1",
          "cost": 110,
          "fact": "measured",
          "description": "One round trip."
        },
        {
          "label": "Ask GitHub for the permission",
          "lane": "github",
          "cost": 790,
          "fact": "estimate",
          "description": "The longest step."
        }
      ]
    }
  </script>
</div>
```

| Field                 | Value                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| `unit`                | The unit of `cost`. Optional.                                                       |
| `interval`            | The time between steps when the reader presses Play, in milliseconds. Default 1800. |
| `steps[].label`       | Required.                                                                           |
| `steps[].description` | The text that shows when the step is the current one.                               |
| `steps[].lane`        | Optional. The same lanes as the timeline.                                           |
| `steps[].cost`        | Optional number. The state line adds the costs up to the current step.              |
| `steps[].fact`        | Optional fact label.                                                                |

The number of each step is a button that shows that step. Previous, Next, and Play do the same in order. A list of more than about ten steps scrolls in its own box, so that the description stays beside the current step. With one step, Play is off.

### viewer

A comparison of two images in five modes: side by side, overlay with an opacity slider, swipe with a divider that the reader drags, blink, and diff highlight.

```html
<div data-demo="viewer" id="demo-comparison-modes">
  <script type="application/json">
    {
      "title": "Five ways to compare two images",
      "limits": "The two images are drawings, not captures from production.",
      "labels": { "before": "Baseline", "after": "Candidate" },
      "modes": ["side-by-side", "overlay", "swipe", "blink", "diff"],
      "mode": "side-by-side",
      "alt": "A panel to assign a reviewer. In the candidate, the selected row is 2 pixels lower."
    }
  </script>
  <svg data-image="before" viewBox="0 0 400 240">
    <rect width="400" height="240" fill="#f4f5f7" />
    <rect x="60" y="110" width="280" height="28" rx="4" fill="#e6effc" />
  </svg>
  <svg data-image="after" viewBox="0 0 400 240">
    <rect width="400" height="240" fill="#f4f5f7" />
    <rect x="60" y="112" width="280" height="28" rx="4" fill="#e6effc" />
  </svg>
</div>
```

- The two images are inline `<svg>` children with `data-image="before"` and `data-image="after"`. Each needs a `viewBox`. The viewer takes the size of each image from it.
- Give both images the same `viewBox` when the two captures have the same size. When the sizes differ, the viewer keeps one scale for both, puts each image at the top left corner, and names both sizes in the state line. The diff mode counts the area that only one image covers as changed.
- An image shows a screen, so it uses color values, not tokens. Draw a background rectangle.
- Do not use an `id`, a `<style>`, an external font, or an `<image>` with an external address in the images. Set `font-family` to a system font stack on the `<svg>`.
- To compare two PNG captures, wrap each one: `<svg data-image="before" viewBox="0 0 800 480"><image width="800" height="480" href="data:image/png;base64,(the complete data)" /></svg>`. Use the pixel size of the capture in the `viewBox`, in `width`, and in `height`.
- `labels` are the names of the two images. The defaults are "Baseline" and "Candidate".
- `modes` is the list of modes to offer. The default is all five. `mode` is the first mode. The default is the first of `modes`.
- `alt` says what the images show and how they differ. A screen reader reads it.
- The diff mode draws both images, compares the pixels, and reports the share that differs. Small differences at soft edges do not count.
- Blink does not start by itself. The automatic swap is 0.8 seconds, below the limit for flashing content.

## Anchors

| Anchor           | Target                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| `#<section id>`  | A section. For the engine sections: `#findings`, `#record`, `#feedback`. |
| `#<your id>`     | Any element with an `id` in a section.                                   |
| `#decision-<id>` | A decision panel, for example `#decision-D-LOAD-01`.                     |
| `#finding-<id>`  | A row of the findings table. The engine clears a filter that hides it.   |
| `#top`           | The top of the page.                                                     |

An `id` of yours must not start with `decision-`, `finding-`, `findings-`, `term-definition-`, `code-copy-`, or with the `id` of a demo and a hyphen. The engine uses these. A link to an anchor that does not exist fails the build.

Every jump stops below the sticky bar and moves keyboard focus to the target.

## Attribute reference

| Attribute       | Where                        | Meaning                                                           |
| --------------- | ---------------------------- | ----------------------------------------------------------------- |
| `id`            | `<section>`, any element     | The anchor.                                                       |
| `data-title`    | `<section>`                  | The label in the page index. Required.                            |
| `data-sample`   | `<section>`                  | Marks a sample section. Remove it from real content.              |
| `data-engine`   | An empty `<div>`             | `findings-explorer`, `decision-record`, or `continuation-prompt`. |
| `data-decision` | An empty `<div>`             | The `id` of the decision that the engine renders here.            |
| `data-findings` | `<span>` or a block element  | Finding identifiers, with spaces between them.                    |
| `data-fact`     | Any element                  | `measured`, `counted`, `estimate`, or `assumption`.               |
| `data-term`     | An inline element            | Makes the element a tooltip trigger for the named term.           |
| `data-no-terms` | Any element                  | No term trigger inside this element.                              |
| `data-demo`     | A `<div>` with an `id`       | The demo type.                                                    |
| `data-panel`    | A child of a compare demo    | The label of the panel.                                           |
| `data-badge`    | A child of a compare demo    | A number for the panel.                                           |
| `data-image`    | An `<svg>` child of a viewer | `before` or `after`.                                              |

## What the build checks

The build fails, and writes nothing, for each of these:

- A JSON file that is missing or not valid.
- A section file without exactly one `<section>`, a section without `id` or `data-title`, or text outside the section.
- An element without its end tag, an end tag that does not match, or a block inside a `<p>`.
- A table part outside its parent, for example a `<td>` outside a `<tr>`, or another element directly in a row.
- A placeholder (`data-decision`, `data-engine`, `data-demo`) on an element that is not a `<div>`.
- A duplicate `id`, an `id` with other characters, or an `id` with a prefix of the engine.
- A link to an anchor that does not exist. A link that is not an anchor and not https.
- An image that is not a data URI, that has no image type, that has base64 data that is cut or shortened, or that has no `alt`. An `<image>` in an SVG with an external address. A script, a style element, or an event attribute.
- A code block with a language that the engine does not support.
- An unknown decision identifier in `data-decision` or in `incorporated`. A decision panel placed two times or never.
- A decision without two options. An option without `id`, `label`, `explanation`, or `consequences`. A settled decision without `settledAnswer`. A settled or rejected decision without `rationale`.
- A finding with an unknown `severity` or `verdict`, a duplicate finding `id`, or a `section` that is not an anchor. An unknown finding in `data-findings` or in `evidence`.
- A term without a definition, or one name in two entries. An unknown name in `data-term`.
- A demo without `id`, `title`, or `limits`, with JSON that is not valid, or with a configuration mistake. The message names the field. Examples: a toggle `id` with a space, a slider `value` that is not a whole number of steps from `min`, a formula with an unknown name, a loop of steps.
- An engine placeholder that is missing or placed two times.
- An output above 16 MB.

The build warns, and still writes the outputs, for sample content, an empty `artifactUrl`, a section without `<h2>`, a code block without a language, a color value in a `style` attribute, and an `incorporated` selection that is not a current option.

## Limits

- A term does not match across an inline element in text. Use `data-term`.
- The engine cannot read the words in an `<img>`. Name the terms of such an image in its caption.
- The label mark does not go away when a label changes and no longer has the term.
- Each term use is a keyboard stop, as the protocol requires. A page with many defined terms has many stops.
- The web fonts come from Google Fonts. Without a network the page uses the system fonts.
- The diff mode of the viewer needs a browser that can draw an inline SVG to a canvas. If it cannot, the state line says so.
- Saved feedback stays in one browser. It does not move to another device. The maintainer shares it with the continuation prompt.
- The generated `apps/lab/public/audit/index.html` does not pass `oxfmt --check`. It needs an ignore entry in `.oxfmtrc.jsonc`. `dist/` is already ignored.

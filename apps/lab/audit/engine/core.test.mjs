// Tests of the engine logic that needs no browser.
// Run: node --test apps/lab/audit/engine/core.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildContinuationPrompt,
  buildRecordExport,
  compareFindings,
  compileFormula,
  compileTerms,
  countAnswered,
  evaluateCalculator,
  getChangedDecisions,
  getDecisionStatus,
  matchesFindingFilters,
  pickDuration,
  reconcileFeedback,
  resolveTimeline,
  validateDemoConfig,
  withNotes,
  withSelection,
} from "./core.js";

function evaluate(formula, values = {}) {
  return compileFormula(formula).evaluate(new Map(Object.entries(values)));
}

test("a formula follows the usual order of operations", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("10 - 4 - 3"), 3);
  assert.equal(evaluate("-2 * -3"), 6);
  assert.equal(evaluate("8 / 4 / 2"), 1);
  assert.equal(evaluate(".5 + 1.25"), 1.75);
});

test("a formula reads names and calls the five functions", () => {
  assert.equal(evaluate("min(a, b, 7)", { a: 9, b: 4 }), 4);
  assert.equal(evaluate("max(a, 1)", { a: 0 }), 1);
  assert.equal(evaluate("round(2.5) + ceil(2.1) + floor(2.9)"), 8);
  assert.deepEqual(compileFormula("a * min(b, c)").names, ["a", "b", "c"]);
  assert.ok(Number.isNaN(evaluate("missing + 1")));
});

test("a formula that is not valid gives a plain error", () => {
  assert.throws(() => compileFormula("1 +"), /ends too early/);
  assert.throws(() => compileFormula("sqrt(4)"), /not a function/);
  assert.throws(() => compileFormula("1 ; 2"), /Unexpected character/);
  assert.throws(() => compileFormula("(1 + 2"), /Expected "\)"/);
  assert.throws(() => compileFormula("1 2"), /Unexpected "2"/);
  assert.throws(() => compileFormula("round(1, 2)"), /wrong number of values/);
  assert.throws(() => compileFormula(""), /empty/);
});

test("a calculator output can use an earlier output, and a division by zero is not a number", () => {
  const config = {
    outputs: [
      { id: "double", formula: "value * 2" },
      { id: "more", formula: "double + 1" },
      { id: "broken", formula: "1 / (value - value)" },
    ],
  };
  assert.deepEqual(evaluateCalculator(config, new Map([["value", 4]])), [
    { id: "double", value: 8 },
    { id: "more", value: 9 },
    { id: "broken", value: null },
  ]);
});

test("a duration is a number, a range, or a range with a typical value", () => {
  assert.equal(pickDuration(30, "high"), 30);
  assert.equal(pickDuration([40, 120], "low"), 40);
  assert.equal(pickDuration([40, 120], "typical"), 80);
  assert.equal(pickDuration([40, 120], "high"), 120);
  assert.equal(pickDuration([40, 50, 120], "typical"), 50);
});

const timeline = {
  title: "Test",
  limits: "A test timeline with enough words.",
  steps: [
    { id: "a", label: "A", lane: "browser", duration: 100 },
    { id: "b", label: "B", lane: "worker", duration: 50, after: ["a"] },
    { id: "c", label: "C", lane: "d1", duration: [20, 60], after: ["b"] },
    { id: "d", label: "D", lane: "github", duration: 30, after: ["b"] },
    { id: "e", label: "E", lane: "browser", duration: 10, after: ["c", "d"] },
  ],
  milestones: [{ id: "done", label: "Done", after: ["e"] }],
  toggles: [
    {
      id: "skip-b",
      label: "Skip B",
      explanation: "Removes B.",
      effects: [{ type: "remove", steps: ["b"] }],
    },
    {
      id: "parallel",
      label: "Start D with A",
      explanation: "D does not wait.",
      effects: [{ type: "setAfter", step: "d", after: [] }],
    },
    {
      id: "faster",
      label: "Faster C",
      explanation: "C takes half the time and a new step runs after it.",
      effects: [
        { type: "scaleDuration", step: "c", factor: 0.5 },
        { type: "setDuration", step: "a", duration: 10 },
        { type: "addStep", step: { id: "f", label: "F", lane: "r2", duration: 5, after: ["c"] } },
      ],
    },
  ],
};

function timesOf(result) {
  return Object.fromEntries(
    result.steps
      .filter((step) => step.start != null)
      .map((step) => [step.id, [step.start, step.end]]),
  );
}

test("timeline steps start when their dependencies end, and equal dependencies run together", () => {
  const result = resolveTimeline(timeline);
  assert.deepEqual(timesOf(result), {
    a: [0, 100],
    b: [100, 150],
    c: [150, 190],
    d: [150, 180],
    e: [190, 200],
  });
  assert.equal(result.total, 200);
  assert.deepEqual(result.milestones, [{ id: "done", label: "Done", time: 200 }]);
  assert.equal(resolveTimeline(timeline, { scenario: "high" }).total, 220);
});

test("a removed step passes its dependencies to the steps that waited for it", () => {
  const result = resolveTimeline(timeline, { toggles: ["skip-b"] });
  assert.deepEqual(timesOf(result), { a: [0, 100], c: [100, 140], d: [100, 130], e: [140, 150] });
  const removed = result.steps.find((step) => step.id === "b");
  assert.equal(removed.removed, true);
  assert.equal(removed.start, null);
});

test("toggles change dependencies, scale and set durations, and add steps", () => {
  const parallel = resolveTimeline(timeline, { toggles: ["parallel"] });
  assert.deepEqual(timesOf(parallel).d, [0, 30]);
  const faster = resolveTimeline(timeline, { toggles: ["faster"] });
  assert.deepEqual(timesOf(faster), {
    a: [0, 10],
    b: [10, 60],
    c: [60, 80],
    f: [80, 85],
    d: [60, 90],
    e: [90, 100],
  });
  const absent = resolveTimeline(timeline).steps.find((step) => step.id === "f");
  assert.equal(absent.present, false);
});

test("a dependency loop is an error with the names of the steps", () => {
  const loop = {
    ...timeline,
    steps: [
      { id: "a", label: "A", lane: "browser", duration: 1, after: ["b"] },
      { id: "b", label: "B", lane: "browser", duration: 1, after: ["a"] },
    ],
    milestones: [],
    toggles: [],
  };
  assert.throws(() => resolveTimeline(loop), /loop: a > b > a/);
  assert.ok(validateDemoConfig("timeline", loop).some((message) => message.includes("loop")));
});

test("a demo configuration with a mistake gives messages", () => {
  assert.deepEqual(validateDemoConfig("timeline", timeline), []);
  assert.match(validateDemoConfig("chart", {})[0], /does not exist/);
  assert.ok(
    validateDemoConfig("timeline", { ...timeline, limits: "" }).some((message) =>
      message.includes('"limits"'),
    ),
  );
  const badLane = { ...timeline, steps: [{ id: "a", label: "A", lane: "cdn", duration: 1 }] };
  assert.ok(
    validateDemoConfig("timeline", badLane).some((message) => message.includes('lane "cdn"')),
  );
  const badEffect = {
    ...timeline,
    toggles: [
      { id: "x", label: "X", explanation: "X.", effects: [{ type: "remove", steps: ["nope"] }] },
    ],
  };
  assert.ok(
    validateDemoConfig("timeline", badEffect).some((message) => message.includes('"nope"')),
  );
  const calculator = {
    title: "Test",
    limits: "A test calculator with enough words.",
    inputs: [{ id: "a", label: "A", min: 0, max: 10, value: 5 }],
    outputs: [{ id: "b", label: "B", formula: "a * c" }],
  };
  assert.ok(
    validateDemoConfig("calculator", calculator).some((message) => message.includes('"c"')),
  );
  assert.deepEqual(
    validateDemoConfig("viewer", { title: "T", limits: "Limits of the test.", modes: ["zoom"] })
      .length,
    1,
  );
});

const terms = compileTerms([
  { term: "D1", definition: "The database." },
  { term: "D1 batch", aliases: ["batch", "DB.batch"], definition: "Several statements." },
  { term: "round trip", aliases: ["database round trip"], definition: "A request and its answer." },
  { term: "Worker", definition: "A program on the network." },
  { term: "bus", definition: "A test word for plurals." },
]);

function matched(text) {
  return terms
    .find(text)
    .map((match) => [text.slice(match.start, match.end), terms.entries[match.entry].term]);
}

test("the longest term wins, and a shorter term matches alone", () => {
  assert.deepEqual(matched("One D1 batch and then D1 alone."), [
    ["D1 batch", "D1 batch"],
    ["D1", "D1"],
  ]);
  assert.deepEqual(matched("6 database round trips and 1 round trip"), [
    ["database round trips", "round trip"],
    ["round trip", "round trip"],
  ]);
});

test("terms match plurals, sentence starts, and line breaks, but not parts of words", () => {
  assert.deepEqual(matched("Workers and a worker"), [
    ["Workers", "Worker"],
    ["worker", "Worker"],
  ]);
  assert.deepEqual(matched("Round\n      trips cost time"), [["Round\n      trips", "round trip"]]);
  assert.deepEqual(matched("two buses"), [["buses", "bus"]]);
  assert.deepEqual(matched("networker, business, and batched"), []);
  assert.deepEqual(matched("await env.DB.batch([])"), [["DB.batch", "D1 batch"]]);
});

test("a name inside an identifier is not a use of the term", () => {
  assert.deepEqual(matched("See D1-01, D-D1-04, and the row D1-014."), []);
  assert.deepEqual(matched("The decision D-WORKER-02 and the finding BUS-7."), []);
  assert.deepEqual(matched("A D1-backed store, and a store on D1."), [
    ["D1", "D1"],
    ["D1", "D1"],
  ]);
  assert.deepEqual(matched("D1 - the database"), [["D1", "D1"]]);
});

test("a name with a digit or two capitals keeps its case", () => {
  assert.deepEqual(matched("d1 is not D1"), [["D1", "D1"]]);
  assert.deepEqual(matched("db.batch"), [["batch", "D1 batch"]]);
  assert.equal(terms.lookUp("database round trip").term, "round trip");
  assert.equal(terms.lookUp("WORKER").term, "Worker");
  assert.equal(terms.lookUp("nothing"), null);
});

const decisions = [
  {
    id: "D-1",
    question: "First question?",
    status: "open",
    options: [
      { id: "a", label: "Option A", recommended: true },
      { id: "b", label: "Option B" },
    ],
  },
  {
    id: "D-2",
    question: "Second question?",
    status: "settled",
    settledAnswer: "Option C",
    rationale: "A reason.",
    options: [
      { id: "c", label: "Option C" },
      { id: "d", label: "Option D" },
    ],
  },
  {
    id: "D-3",
    question: "Third question?",
    status: "open",
    options: [
      { id: "e", label: "Option E" },
      { id: "f", label: "Option F" },
    ],
  },
];
const record = {
  title: "Test record",
  revision: "r2",
  date: "2026-10-05",
  livingRecord: { artifactUrl: "", localPath: "/tmp/record.html", labPath: "apps/lab" },
  incorporated: { "D-2": { selection: "c", notes: "Recorded note." } },
};

function promptOf(state) {
  return buildContinuationPrompt({ record, decisions, state });
}

test("a browser without saved feedback starts from the incorporated feedback", () => {
  const state = reconcileFeedback({ record, decisions });
  assert.equal(state.revision, "r2");
  assert.equal(countAnswered(state, decisions), 1);
  assert.deepEqual(getChangedDecisions(state, decisions), []);
  assert.match(promptOf(state), /No decision changed in this feedback round \(0 of 3\)/);
  assert.match(promptOf(state), /- Artifact: not published yet/);
  assert.match(promptOf(state), /- Local file: \/tmp\/record\.html/);
});

test("only a selection of a current option counts as answered", () => {
  let state = reconcileFeedback({ record, decisions });
  state = withNotes(state, "D-1", "A note without a selection.");
  assert.equal(countAnswered(state, decisions), 1);
  assert.equal(getDecisionStatus(state, decisions[0]).answered, false);
  state = withSelection(state, "D-1", "b");
  assert.equal(countAnswered(state, decisions), 2);
  assert.equal(getDecisionStatus(state, decisions[0]).notes, "A note without a selection.");
});

test("the prompt lists only the decisions that changed, with OPEN for a cleared selection", () => {
  let state = reconcileFeedback({ record, decisions });
  state = withSelection(state, "D-1", "a");
  let prompt = promptOf(state);
  assert.match(prompt, /Decisions updated in this feedback round \(1 of 3\)/);
  assert.match(
    prompt,
    /D-1: First question\?\nAnswer: Option A \(option `a`\)\nAnswer in the living record: OPEN\nNotes: none/,
  );
  assert.doesNotMatch(prompt, /D-2: /);
  assert.doesNotMatch(prompt, /D-3: /);

  state = withSelection(state, "D-2", null);
  state = withNotes(state, "D-3", "First line.\nSecond line.");
  prompt = promptOf(state);
  assert.match(
    prompt,
    /D-2: Second question\?\nAnswer: OPEN\nReason: the maintainer cleared the selection\.\nAnswer in the living record: Option C \(option `c`\)\nNotes: Recorded note\./,
  );
  assert.match(
    prompt,
    /D-3: Third question\?\nAnswer: OPEN\nAnswer in the living record: OPEN\nNotes:\n {2}First line\.\n {2}Second line\./,
  );

  // The same answer as the record is not a change.
  state = withSelection(state, "D-2", "c");
  assert.doesNotMatch(promptOf(state), /D-2: /);
  // Spaces at the ends of notes are not a change.
  state = withNotes(reconcileFeedback({ record, decisions }), "D-2", "  Recorded note.\n");
  assert.deepEqual(getChangedDecisions(state, decisions), []);
});

test("the baseline stays for one revision and is replaced by the next", () => {
  let state = reconcileFeedback({ record, decisions });
  state = withSelection(state, "D-1", "a");
  const reloaded = reconcileFeedback({ stored: state, record, decisions });
  assert.deepEqual(reloaded.baseline, state.baseline);
  assert.deepEqual(
    getChangedDecisions(reloaded, decisions).map((decision) => decision.id),
    ["D-1"],
  );

  // An agent merged the answer and published revision r3.
  const next = {
    ...record,
    revision: "r3",
    incorporated: { ...record.incorporated, "D-1": { selection: "a", notes: "" } },
  };
  const merged = reconcileFeedback({ stored: state, record: next, decisions });
  assert.equal(merged.revision, "r3");
  assert.deepEqual(merged.current, state.current);
  assert.deepEqual(getChangedDecisions(merged, decisions), []);
});

test("a selection that is no longer an option is cleared, keeps its notes, and is an OPEN update", () => {
  const stored = {
    revision: "r1",
    baseline: {},
    current: {
      "D-1": { selection: "gone", notes: "Keep me." },
      "D-2": { selection: "c", notes: "Recorded note." },
    },
  };
  const state = reconcileFeedback({ stored, record, decisions });
  const status = getDecisionStatus(state, decisions[0]);
  assert.equal(status.answered, false);
  assert.equal(status.notes, "Keep me.");
  assert.deepEqual(status.stale, { selection: "gone", revision: "r2" });
  assert.equal(countAnswered(state, decisions), 1);
  assert.match(
    promptOf(state),
    /D-1: First question\?\nAnswer: OPEN\nReason: the earlier selection `gone` is no longer an option in revision r2\./,
  );
  // The mark lasts for the revision that cleared the selection.
  const later = reconcileFeedback({
    stored: state,
    record: {
      ...record,
      revision: "r3",
      incorporated: { ...record.incorporated, "D-1": { notes: "Keep me." } },
    },
    decisions,
  });
  assert.equal(getDecisionStatus(later, decisions[0]).stale, null);
  assert.deepEqual(getChangedDecisions(later, decisions), []);
});

test("a record that holds an old option makes the decision an OPEN update", () => {
  const old = { ...record, incorporated: { "D-1": { selection: "removed-option", notes: "" } } };
  const state = reconcileFeedback({ record: old, decisions });
  assert.equal(countAnswered(state, decisions), 0);
  assert.match(
    buildContinuationPrompt({ record: old, decisions, state }),
    /D-1: First question\?\nAnswer: OPEN\nReason: the earlier selection `removed-option`/,
  );
});

test("the portable copy holds every decision", () => {
  const state = withSelection(reconcileFeedback({ record, decisions }), "D-1", "b");
  const text = buildRecordExport({ record, decisions, state });
  for (const decision of decisions) {
    assert.ok(text.includes(`${decision.id}: ${decision.question}`));
  }
  assert.match(
    text,
    /Answer of the maintainer now: Option B \(option `b`\) \(changed in this feedback round\)/,
  );
  assert.match(text, /Status in the record: Settled: Option C/);
  assert.match(text, /- `a`: Option A \(recommended\)/);
});

test("the portable copy holds the context, the evidence, and what each option means", () => {
  const complete = [
    {
      id: "D-9",
      question: "A question?",
      context: "Why the question exists.",
      status: "open",
      evidence: ["F-1", "F-2"],
      options: [
        { id: "a", label: "Option A", explanation: "What A is.", consequences: "What A costs." },
        { id: "b", label: "Option B", explanation: "What B is.", consequences: "What B costs." },
      ],
    },
  ];
  const state = reconcileFeedback({ record: { ...record, incorporated: {} }, decisions: complete });
  const text = buildRecordExport({ record, decisions: complete, state });
  assert.match(
    text,
    /D-9: A question\?\nContext: Why the question exists\.\nStatus in the record: Open/,
  );
  assert.match(text, /Evidence: F-1, F-2/);
  assert.match(
    text,
    /- `a`: Option A\n {2}What it is: What A is\.\n {2}Consequences: What A costs\./,
  );
});

test("the prompt says what to do when the living record cannot be opened", () => {
  const prompt = promptOf(reconcileFeedback({ record, decisions }));
  assert.match(prompt, /If you cannot open it, stop and ask the maintainer for the "Portable copy/);
  assert.match(prompt, /Do not rebuild the record from this prompt\./);
});

test("a toggle id and a preset id must be safe in an element id", () => {
  const unsafe = {
    ...timeline,
    toggles: [
      {
        id: "skip it",
        label: "Skip",
        explanation: "Skips.",
        effects: [{ type: "setDuration", step: timeline.steps[0].id, duration: 1 }],
      },
    ],
    presets: [{ id: "all on", label: "All", toggles: ["skip it"] }],
  };
  const messages = validateDemoConfig("timeline", unsafe);
  assert.ok(messages.some((message) => message.startsWith('Toggle "skip it" needs an "id" of')));
  assert.ok(messages.some((message) => message.startsWith('Preset "all on" needs an "id" of')));
});

test("a slider value and a slider end must be a whole number of steps from the start", () => {
  const make = (input) => ({
    title: "Test",
    limits: "A test calculator with enough words.",
    inputs: [{ id: "a", label: "A", ...input }],
    outputs: [{ id: "b", label: "B", formula: "a" }],
  });
  assert.deepEqual(
    validateDemoConfig("calculator", make({ min: 0, max: 600, step: 15, value: 60 })),
    [],
  );
  assert.deepEqual(
    validateDemoConfig("calculator", make({ min: 0, max: 1, step: 0.05, value: 0.25 })),
    [],
  );
  assert.deepEqual(
    validateDemoConfig("calculator", make({ min: 240, max: 1340, step: 10, value: 790 })),
    [],
  );
  assert.match(
    validateDemoConfig("calculator", make({ min: 0, max: 90, step: 15, value: 50 }))[0],
    /a "value" that the slider cannot show/,
  );
  assert.match(
    validateDemoConfig("calculator", make({ min: 0, max: 100, step: 15, value: 45 }))[0],
    /a "max" that the slider cannot reach/,
  );
});

test("findings filter by field and by words, and sort by a set order", () => {
  const rows = [
    {
      id: "A-2",
      title: "Slow query",
      summary: "",
      area: "D1",
      kind: "performance",
      severity: "low",
      verdict: "confirmed",
      measured: true,
      effort: "M",
    },
    {
      id: "A-10",
      title: "Missing label",
      summary: "A button",
      area: "Review",
      kind: "accessibility",
      severity: "critical",
      verdict: "refuted",
      measured: false,
      effort: "S",
    },
  ];
  assert.equal(matchesFindingFilters(rows[0], { area: "D1", text: "slow QUERY" }), true);
  assert.equal(matchesFindingFilters(rows[0], { area: "Review" }), false);
  assert.equal(matchesFindingFilters(rows[1], { text: "button label" }), true);
  assert.ok(compareFindings(rows[1], rows[0], "severity") < 0);
  assert.ok(compareFindings(rows[0], rows[1], "id") < 0);
  assert.ok(compareFindings(rows[1], rows[0], "effort") < 0);
  assert.ok(compareFindings(rows[0], rows[1], "measured") < 0);
});

// The logic of the audit document that needs no browser: vocabularies, the
// formula evaluator, the timeline scheduler, term matching, feedback rules,
// and the continuation prompt.
//
// build.mjs imports this module to validate content. It also inlines the
// module into the page in front of app.js, with the `export` keywords removed.
// Keep every export a plain declaration at the start of a line.

export const SEVERITIES = new Map([
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["info", "Info"],
]);

export const VERDICTS = new Map([
  ["confirmed", "Confirmed"],
  ["partly-confirmed", "Partly confirmed"],
  ["judgment", "Judgment"],
  ["not-verified", "Not verified"],
  ["unverifiable", "Cannot be verified"],
  ["refuted", "Refuted"],
]);

export const DECISION_STATUSES = new Map([
  ["open", "Open"],
  ["settled", "Settled"],
  ["rejected", "Rejected"],
]);

export const LANES = new Map([
  ["browser", "Browser"],
  ["worker", "Worker"],
  ["d1", "D1"],
  ["r2", "R2"],
  ["github", "GitHub"],
  ["queue", "Queue"],
  ["container", "Container"],
  ["other", "Other"],
]);

/** The fact labels. Each definition is the tooltip text of the label. */
export const FACT_KINDS = new Map([
  [
    "measured",
    {
      label: "Measured",
      definition: "The audit measured this value on the running service or in a browser.",
    },
  ],
  [
    "counted",
    {
      label: "Counted from code",
      definition: "The audit counted this value in the source code. It did not time it.",
    },
  ],
  [
    "estimate",
    {
      label: "Estimate",
      definition: "The audit calculated this value from other values. It did not measure it.",
    },
  ],
  [
    "assumption",
    {
      label: "Assumption",
      definition: "The audit did not verify this statement. Treat it as open until it is checked.",
    },
  ],
]);

/** Code block classes and the highlight.js grammar for each. */
export const CODE_LANGUAGES = new Map([
  ["ts", { label: "TypeScript", grammar: "typescript" }],
  ["tsx", { label: "TSX", grammar: "typescript" }],
  ["sql", { label: "SQL", grammar: "sql" }],
  ["json", { label: "JSON", grammar: "json" }],
  ["jsonc", { label: "JSON with comments", grammar: "json" }],
  ["bash", { label: "Shell", grammar: "bash" }],
  ["yaml", { label: "YAML", grammar: "yaml" }],
  ["text", { label: "Text", grammar: null }],
]);

export const DEMO_TYPES = ["timeline", "calculator", "compare", "sequence", "viewer"];

export const VIEWER_MODES = new Map([
  ["side-by-side", "Side by side"],
  ["overlay", "Overlay"],
  ["swipe", "Swipe"],
  ["blink", "Blink"],
  ["diff", "Diff highlight"],
]);

export const TIMELINE_SCENARIOS = new Map([
  ["low", "Fast"],
  ["typical", "Typical"],
  ["high", "Slow"],
]);

/** The placeholders that the engine fills. Each one goes in the page one time. */
export const ENGINE_BLOCKS = ["findings-explorer", "decision-record", "continuation-prompt"];

const EFFORT_ORDER = ["XS", "S", "S-M", "M", "M-L", "L", "XL"];

// An id that is safe in an element id and in a page address: letters,
// digits, and . _ ~ - only. A space would break a list of ids such as
// aria-describedby.
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

function isRecord(value) {
  if (typeof value !== "object") return false;
  if (value == null) return false;
  return !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// ---------------------------------------------------------------------------
// Formulas

const FORMULA_FUNCTIONS = new Map([
  ["min", { minimum: 1, maximum: Infinity, apply: (values) => Math.min(...values) }],
  ["max", { minimum: 1, maximum: Infinity, apply: (values) => Math.max(...values) }],
  ["round", { minimum: 1, maximum: 1, apply: ([value]) => Math.round(value) }],
  ["ceil", { minimum: 1, maximum: 1, apply: ([value]) => Math.ceil(value) }],
  ["floor", { minimum: 1, maximum: 1, apply: ([value]) => Math.floor(value) }],
]);

function tokenizeFormula(source) {
  const tokens = [];
  // One number, one name, or one operator character, after optional spaces.
  const pattern = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/(),]))/y;
  let index = 0;
  while (index < source.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) {
      const rest = source.slice(index).trim();
      if (!rest) break;
      throw new Error(`Unexpected character "${rest[0]}" in the formula "${source}".`);
    }
    const [, number, name, operator] = match;
    if (number != null) {
      tokens.push({ type: "number", value: Number(number) });
    } else if (name != null) {
      tokens.push({ type: "name", value: name });
    } else {
      tokens.push({ type: "operator", value: operator });
    }
    index = pattern.lastIndex;
  }
  return tokens;
}

/**
 * Compiles a formula over named numbers. The grammar has numbers, names,
 * `+ - * /`, parentheses, and the functions min, max, round, ceil, and floor.
 * It never runs author text as code. Throws an error with a plain message
 * when the formula is not valid.
 */
export function compileFormula(source) {
  if (!isNonEmptyString(source)) {
    throw new Error("The formula is empty.");
  }
  const tokens = tokenizeFormula(source);
  const names = new Set();
  let position = 0;

  const peek = () => tokens[position];
  const isOperator = (value) => {
    const token = peek();
    return token?.type === "operator" && token.value === value;
  };
  const expectOperator = (value) => {
    if (!isOperator(value)) {
      throw new Error(`Expected "${value}" in the formula "${source}".`);
    }
    position += 1;
  };

  const parseArguments = () => {
    const parsed = [];
    if (isOperator(")")) {
      return parsed;
    }
    parsed.push(parseSum());
    while (isOperator(",")) {
      position += 1;
      parsed.push(parseSum());
    }
    return parsed;
  };

  const parseCall = (name) => {
    const definition = FORMULA_FUNCTIONS.get(name);
    if (!definition) {
      throw new Error(`"${name}" is not a function. Use min, max, round, ceil, or floor.`);
    }
    expectOperator("(");
    const parsed = parseArguments();
    expectOperator(")");
    if (parsed.length < definition.minimum || parsed.length > definition.maximum) {
      throw new Error(`The function ${name} has the wrong number of values in "${source}".`);
    }
    return (values) => definition.apply(parsed.map((argument) => argument(values)));
  };

  const parsePrimary = () => {
    const token = peek();
    if (!token) {
      throw new Error(`The formula "${source}" ends too early.`);
    }
    position += 1;
    if (token.type === "number") {
      return () => token.value;
    }
    if (token.type === "name") {
      if (isOperator("(")) {
        return parseCall(token.value);
      }
      names.add(token.value);
      return (values) => values.get(token.value) ?? Number.NaN;
    }
    if (token.value === "(") {
      const inner = parseSum();
      expectOperator(")");
      return inner;
    }
    throw new Error(`Unexpected "${token.value}" in the formula "${source}".`);
  };

  const parseUnary = () => {
    if (isOperator("-")) {
      position += 1;
      const operand = parseUnary();
      return (values) => -operand(values);
    }
    return parsePrimary();
  };

  const parseProduct = () => {
    let left = parseUnary();
    while (isOperator("*") || isOperator("/")) {
      const divide = peek().value === "/";
      position += 1;
      const first = left;
      const second = parseUnary();
      left = divide
        ? (values) => first(values) / second(values)
        : (values) => first(values) * second(values);
    }
    return left;
  };

  // The parsers above call parseSum for nested expressions. That is safe: no
  // parser runs before this declaration.
  const parseSum = () => {
    let left = parseProduct();
    while (isOperator("+") || isOperator("-")) {
      const subtract = peek().value === "-";
      position += 1;
      const first = left;
      const second = parseProduct();
      left = subtract
        ? (values) => first(values) - second(values)
        : (values) => first(values) + second(values);
    }
    return left;
  };

  const evaluate = parseSum();
  if (position < tokens.length) {
    throw new Error(`Unexpected "${tokens[position].value}" in the formula "${source}".`);
  }
  return { names: [...names], evaluate };
}

/**
 * Evaluates the outputs of a calculator in order. An output can use the
 * inputs and the outputs before it. A result that is not a finite number
 * (for example a division by zero) is `null`.
 */
export function evaluateCalculator(config, inputValues) {
  const values = new Map(inputValues);
  const results = [];
  for (const output of config.outputs) {
    const result = compileFormula(output.formula).evaluate(values);
    const value = Number.isFinite(result) ? result : null;
    values.set(output.id, value ?? Number.NaN);
    results.push({ id: output.id, value });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Timeline

function isValidDuration(duration) {
  if (typeof duration === "number") {
    return Number.isFinite(duration) && duration >= 0;
  }
  if (!Array.isArray(duration)) return false;
  if (duration.length !== 2 && duration.length !== 3) return false;
  let previous = 0;
  for (const value of duration) {
    if (typeof value !== "number") return false;
    if (!Number.isFinite(value)) return false;
    if (value < previous) return false;
    previous = value;
  }
  return true;
}

/**
 * Picks one number from a duration. A duration is a number, a range
 * `[low, high]`, or `[low, typical, high]`. The typical value of a range of
 * two numbers is the middle.
 */
export function pickDuration(duration, scenario) {
  if (typeof duration === "number") {
    return duration;
  }
  const low = duration[0] ?? 0;
  const high = duration[duration.length - 1] ?? low;
  if (scenario === "low") {
    return low;
  }
  if (scenario === "high") {
    return high;
  }
  if (duration.length === 3) {
    return duration[1] ?? low;
  }
  return Math.round((low + high) / 2);
}

function scaleDuration(duration, factor) {
  if (typeof duration === "number") {
    return Math.round(duration * factor);
  }
  return duration.map((value) => Math.round(value * factor));
}

function listAddedSteps(config) {
  const added = [];
  for (const toggle of config.toggles ?? []) {
    for (const effect of toggle.effects ?? []) {
      if (effect.type !== "addStep") continue;
      if (!isRecord(effect.step)) continue;
      added.push({ step: effect.step, insertAfter: effect.insertAfter });
    }
  }
  return added;
}

/**
 * Lists every step that the timeline can show, in display order: the base
 * steps, and each step that a toggle adds. An added step goes after
 * `insertAfter`, else after the last step that it waits for.
 */
export function listTimelineSteps(config) {
  const order = config.steps.map((step) => ({ ...step, added: false }));
  for (const { step, insertAfter } of listAddedSteps(config)) {
    if (order.some((item) => item.id === step.id)) continue;
    const anchors = insertAfter ? [insertAfter] : (step.after ?? []);
    let index = -1;
    for (const anchor of anchors) {
      index = Math.max(
        index,
        order.findIndex((item) => item.id === anchor),
      );
    }
    const entry = { ...step, added: true };
    if (index === -1) {
      order.push(entry);
    } else {
      order.splice(index + 1, 0, entry);
    }
  }
  return order;
}

export function hasDurationRange(config) {
  const durations = config.steps.map((step) => step.duration);
  for (const toggle of config.toggles ?? []) {
    for (const effect of toggle.effects ?? []) {
      if (effect.type === "setDuration") {
        durations.push(effect.duration);
      }
      if (effect.type === "addStep") {
        durations.push(effect.step?.duration);
      }
    }
  }
  return durations.some((duration) => Array.isArray(duration));
}

function applyTimelineEffect(steps, effect) {
  if (effect.type === "remove") {
    for (const id of effect.steps ?? []) {
      const step = steps.get(id);
      if (step) {
        step.removed = true;
      }
    }
    return;
  }
  if (effect.type === "addStep") {
    const step = effect.step;
    steps.set(step.id, { ...step, after: [...(step.after ?? [])], removed: false });
    return;
  }
  // The other effects change one step. A step that is absent (another toggle
  // adds it) makes the effect do nothing.
  const step = steps.get(effect.step);
  if (!step) return;
  if (effect.type === "setDuration") {
    step.duration = effect.duration;
  }
  if (effect.type === "scaleDuration") {
    step.duration = scaleDuration(step.duration, effect.factor);
  }
  if (effect.type === "setAfter") {
    step.after = [...effect.after];
  }
}

/**
 * Schedules the steps of a timeline. A step starts when every step in its
 * `after` list has ended. Steps with the same dependencies run in parallel.
 * A removed step passes its own dependencies to the steps that waited for it,
 * so the chain stays connected. Throws when the steps form a loop.
 */
export function resolveTimeline(config, { toggles = [], scenario = "typical" } = {}) {
  const active = new Set(toggles);
  const steps = new Map();
  for (const step of config.steps) {
    steps.set(step.id, { ...step, after: [...(step.after ?? [])], removed: false });
  }
  for (const toggle of config.toggles ?? []) {
    if (!active.has(toggle.id)) continue;
    for (const effect of toggle.effects ?? []) {
      applyTimelineEffect(steps, effect);
    }
  }

  const expandDependencies = (ids, trail) => {
    const result = [];
    for (const id of ids) {
      const step = steps.get(id);
      if (!step) continue;
      if (!step.removed) {
        result.push(id);
        continue;
      }
      if (trail.has(id)) continue;
      trail.add(id);
      result.push(...expandDependencies(step.after, trail));
    }
    return result;
  };

  const ends = new Map();
  const starts = new Map();
  const visiting = [];
  const schedule = (id) => {
    const known = ends.get(id);
    if (known != null) {
      return known;
    }
    if (visiting.includes(id)) {
      throw new Error(`The steps wait for each other in a loop: ${[...visiting, id].join(" > ")}.`);
    }
    visiting.push(id);
    const step = steps.get(id);
    let start = 0;
    for (const dependency of expandDependencies(step.after, new Set())) {
      start = Math.max(start, schedule(dependency));
    }
    visiting.pop();
    const end = start + pickDuration(step.duration, scenario);
    starts.set(id, start);
    ends.set(id, end);
    return end;
  };

  let total = 0;
  for (const [id, step] of steps) {
    if (step.removed) continue;
    total = Math.max(total, schedule(id));
  }

  const scheduled = listTimelineSteps(config).map((item) => {
    const step = steps.get(item.id);
    if (!step) {
      return { ...item, present: false, removed: false, start: null, end: null, duration: null };
    }
    if (step.removed) {
      return { ...item, present: true, removed: true, start: null, end: null, duration: null };
    }
    const start = starts.get(item.id) ?? 0;
    const end = ends.get(item.id) ?? 0;
    return {
      ...item,
      label: step.label,
      lane: step.lane,
      present: true,
      removed: false,
      start,
      end,
      duration: end - start,
    };
  });

  const milestones = (config.milestones ?? []).map((milestone) => {
    let time = 0;
    for (const dependency of expandDependencies(milestone.after ?? [], new Set())) {
      time = Math.max(time, ends.get(dependency) ?? 0);
    }
    return { id: milestone.id, label: milestone.label, time };
  });

  return { steps: scheduled, milestones, total };
}

function validateTimelineStep(step, where, errors) {
  if (!isRecord(step)) {
    errors.push(`${where} must be an object.`);
    return;
  }
  if (!isNonEmptyString(step.id)) {
    errors.push(`${where} needs an "id".`);
  }
  if (!isNonEmptyString(step.label)) {
    errors.push(`${where} needs a "label".`);
  }
  if (!LANES.has(step.lane)) {
    errors.push(
      `${where} has the lane "${step.lane}". Use one of: ${[...LANES.keys()].join(", ")}.`,
    );
  }
  if (!isValidDuration(step.duration)) {
    errors.push(
      `${where} needs a "duration": a number, [low, high], or [low, typical, high], not negative and in rising order.`,
    );
  }
  if (step.after != null && !Array.isArray(step.after)) {
    errors.push(`${where} has an "after" that is not a list.`);
  }
}

function validateTimelineEffect({ effect, where, known, errors }) {
  const requireStep = (id) => {
    if (known.has(id)) return;
    errors.push(`${where} names the step "${id}", which does not exist.`);
  };
  if (!isRecord(effect)) {
    errors.push(`${where} must be an object.`);
    return;
  }
  if (effect.type === "remove") {
    if (!Array.isArray(effect.steps) || !effect.steps.length) {
      errors.push(`${where} needs a "steps" list.`);
      return;
    }
    effect.steps.forEach(requireStep);
    return;
  }
  if (effect.type === "setDuration") {
    requireStep(effect.step);
    if (!isValidDuration(effect.duration)) {
      errors.push(`${where} needs a valid "duration".`);
    }
    return;
  }
  if (effect.type === "scaleDuration") {
    requireStep(effect.step);
    if (typeof effect.factor !== "number" || !(effect.factor >= 0)) {
      errors.push(`${where} needs a "factor" that is zero or more.`);
    }
    return;
  }
  if (effect.type === "setAfter") {
    requireStep(effect.step);
    if (!Array.isArray(effect.after)) {
      errors.push(`${where} needs an "after" list.`);
      return;
    }
    effect.after.forEach(requireStep);
    return;
  }
  if (effect.type === "addStep") {
    validateTimelineStep(effect.step, `${where} step`, errors);
    if (effect.insertAfter != null) {
      requireStep(effect.insertAfter);
    }
    for (const id of effect.step?.after ?? []) {
      requireStep(id);
    }
    return;
  }
  errors.push(
    `${where} has the type "${effect.type}". Use remove, setDuration, scaleDuration, setAfter, or addStep.`,
  );
}

function validateTimeline(config, errors) {
  if (!Array.isArray(config.steps) || !config.steps.length) {
    errors.push('A timeline needs a "steps" list.');
    return;
  }
  const known = new Set();
  config.steps.forEach((step, index) => {
    validateTimelineStep(step, `Step ${index + 1}`, errors);
    if (known.has(step?.id)) {
      errors.push(`The step id "${step.id}" is used two times.`);
    }
    known.add(step?.id);
  });
  if (config.toggles != null && !Array.isArray(config.toggles)) {
    errors.push('"toggles" must be a list.');
    return;
  }
  for (const { step } of listAddedSteps(config)) {
    if (known.has(step.id) && config.steps.some((item) => item.id === step.id)) {
      errors.push(`A toggle adds the step "${step.id}", but a base step has the same id.`);
    }
    known.add(step.id);
  }
  for (const step of config.steps) {
    for (const id of step?.after ?? []) {
      if (!known.has(id)) {
        errors.push(`The step "${step.id}" waits for "${id}", which does not exist.`);
      }
    }
  }
  const toggleIds = new Set();
  for (const toggle of config.toggles ?? []) {
    const where = `Toggle "${toggle?.id}"`;
    if (!isNonEmptyString(toggle?.id)) {
      errors.push('Each toggle needs an "id".');
    } else if (!SAFE_ID_PATTERN.test(toggle.id)) {
      errors.push(
        `${where} needs an "id" of letters, digits, and . _ ~ - only. The engine uses it in the id of the checkbox.`,
      );
    }
    if (toggleIds.has(toggle?.id)) {
      errors.push(`The toggle id "${toggle.id}" is used two times.`);
    }
    toggleIds.add(toggle?.id);
    if (!isNonEmptyString(toggle?.label)) {
      errors.push(`${where} needs a "label".`);
    }
    if (!isNonEmptyString(toggle?.explanation)) {
      errors.push(`${where} needs an "explanation".`);
    }
    if (!Array.isArray(toggle?.effects) || !toggle.effects.length) {
      errors.push(`${where} needs an "effects" list.`);
      continue;
    }
    toggle.effects.forEach((effect, index) => {
      validateTimelineEffect({ effect, where: `${where}, effect ${index + 1}`, known, errors });
    });
  }
  const presetIds = new Set();
  for (const preset of config.presets ?? []) {
    if (!isNonEmptyString(preset?.id)) {
      errors.push('Each preset needs an "id".');
    } else if (!SAFE_ID_PATTERN.test(preset.id)) {
      errors.push(
        `Preset "${preset.id}" needs an "id" of letters, digits, and . _ ~ - only. The engine uses it in the id of the button.`,
      );
    }
    if (presetIds.has(preset?.id)) {
      errors.push(`The preset id "${preset.id}" is used two times.`);
    }
    presetIds.add(preset?.id);
    if (!isNonEmptyString(preset?.label)) {
      errors.push(`Preset "${preset?.id}" needs a "label".`);
    }
    for (const id of preset?.toggles ?? []) {
      if (!toggleIds.has(id)) {
        errors.push(`Preset "${preset.id}" names the toggle "${id}", which does not exist.`);
      }
    }
  }
  const milestoneIds = new Set();
  for (const milestone of config.milestones ?? []) {
    if (!isNonEmptyString(milestone?.id)) {
      errors.push('Each milestone needs an "id".');
    }
    milestoneIds.add(milestone?.id);
    if (!isNonEmptyString(milestone?.label)) {
      errors.push(`Milestone "${milestone?.id}" needs a "label".`);
    }
    if (!Array.isArray(milestone?.after) || !milestone.after.length) {
      errors.push(`Milestone "${milestone?.id}" needs an "after" list of steps.`);
      continue;
    }
    for (const id of milestone.after) {
      if (!known.has(id)) {
        errors.push(`Milestone "${milestone.id}" names the step "${id}", which does not exist.`);
      }
    }
  }
  if (config.milestone != null && !milestoneIds.has(config.milestone)) {
    errors.push(`"milestone" names "${config.milestone}", which is not in "milestones".`);
  }
  if (errors.length) return;
  // Schedule the baseline, each toggle alone, and all toggles together, so
  // that a dependency loop fails the build and not the page.
  const allToggles = [...toggleIds];
  const combinations = [[], allToggles, ...allToggles.map((id) => [id])];
  for (const toggles of combinations) {
    try {
      resolveTimeline(config, { toggles });
    } catch (error) {
      errors.push(`With the toggles [${toggles.join(", ")}]: ${error.message}`);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Demo configuration

/** Tells whether a distance is a whole number of steps. Decimal steps are not exact. */
function isWholeNumberOfSteps(distance, step) {
  const steps = distance / step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

function validateCalculator(config, errors) {
  if (!Array.isArray(config.inputs) || !config.inputs.length) {
    errors.push('A calculator needs an "inputs" list.');
    return;
  }
  if (!Array.isArray(config.outputs) || !config.outputs.length) {
    errors.push('A calculator needs an "outputs" list.');
    return;
  }
  const names = new Set();
  const checkId = (id, where) => {
    if (typeof id !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
      errors.push(`${where} needs an "id" of letters, digits, and "_" that starts with a letter.`);
      return;
    }
    if (FORMULA_FUNCTIONS.has(id)) {
      errors.push(`${where} uses the function name "${id}" as its id.`);
    }
    if (names.has(id)) {
      errors.push(`The id "${id}" is used two times.`);
    }
  };
  config.inputs.forEach((input, index) => {
    const where = `Input ${index + 1}`;
    checkId(input?.id, where);
    names.add(input?.id);
    if (!isNonEmptyString(input?.label)) {
      errors.push(`${where} needs a "label".`);
    }
    const numbers = [input?.min, input?.max, input?.value];
    if (numbers.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      errors.push(`${where} needs the numbers "min", "max", and "value".`);
      return;
    }
    if (input.min >= input.max) {
      errors.push(`${where} needs a "min" below its "max".`);
    }
    if (input.value < input.min || input.value > input.max) {
      errors.push(`${where} has a "value" outside "min" and "max".`);
    }
    if (input.step != null && !(input.step > 0)) {
      errors.push(`${where} needs a "step" above zero.`);
      return;
    }
    // A slider moves only to "min" plus a whole number of steps. Another
    // value would show one number in the text and another on the slider.
    const step = input.step ?? 1;
    if (!isWholeNumberOfSteps(input.value - input.min, step)) {
      errors.push(
        `${where} has a "value" that the slider cannot show. Use "min" plus a whole number of steps of ${step}.`,
      );
    }
    if (!isWholeNumberOfSteps(input.max - input.min, step)) {
      errors.push(
        `${where} has a "max" that the slider cannot reach. Use "min" plus a whole number of steps of ${step}.`,
      );
    }
  });
  config.outputs.forEach((output, index) => {
    const where = `Output ${index + 1}`;
    checkId(output?.id, where);
    if (!isNonEmptyString(output?.label)) {
      errors.push(`${where} needs a "label".`);
    }
    try {
      const formula = compileFormula(output?.formula);
      for (const name of formula.names) {
        if (!names.has(name)) {
          errors.push(`${where} uses "${name}", which is not an input or an earlier output.`);
        }
      }
    } catch (error) {
      errors.push(`${where}: ${error.message}`);
    }
    names.add(output?.id);
  });
}

function validateSequence(config, errors) {
  if (!Array.isArray(config.steps) || !config.steps.length) {
    errors.push('A sequence needs a "steps" list.');
    return;
  }
  config.steps.forEach((step, index) => {
    const where = `Step ${index + 1}`;
    if (!isNonEmptyString(step?.label)) {
      errors.push(`${where} needs a "label".`);
    }
    if (step?.lane != null && !LANES.has(step.lane)) {
      errors.push(
        `${where} has the lane "${step.lane}". Use one of: ${[...LANES.keys()].join(", ")}.`,
      );
    }
    if (step?.cost != null && !(typeof step.cost === "number" && step.cost >= 0)) {
      errors.push(`${where} needs a "cost" that is zero or more.`);
    }
  });
}

function validateViewer(config, errors) {
  const modes = config.modes ?? [...VIEWER_MODES.keys()];
  if (!Array.isArray(modes) || !modes.length) {
    errors.push('"modes" must be a list with one mode or more.');
    return;
  }
  for (const mode of modes) {
    if (!VIEWER_MODES.has(mode)) {
      errors.push(
        `The mode "${mode}" does not exist. Use one of: ${[...VIEWER_MODES.keys()].join(", ")}.`,
      );
    }
  }
  if (config.mode != null && !modes.includes(config.mode)) {
    errors.push(`"mode" is "${config.mode}", which is not in "modes".`);
  }
}

/**
 * Checks one demo configuration. Returns a list of plain messages, empty
 * when the configuration is valid. The build fails on these messages, and
 * the page shows them in place of a demo that cannot run.
 */
export function validateDemoConfig(type, config) {
  const errors = [];
  if (!DEMO_TYPES.includes(type)) {
    return [`The demo type "${type}" does not exist. Use one of: ${DEMO_TYPES.join(", ")}.`];
  }
  if (!isRecord(config)) {
    return ["The configuration must be a JSON object."];
  }
  if (!isNonEmptyString(config.title)) {
    errors.push('The demo needs a "title".');
  }
  if (!isNonEmptyString(config.limits)) {
    errors.push(
      'The demo needs "limits": one or two sentences that say what is simulated and what it does not show.',
    );
  }
  if (type === "timeline") {
    validateTimeline(config, errors);
  }
  if (type === "calculator") {
    validateCalculator(config, errors);
  }
  if (type === "sequence") {
    validateSequence(config, errors);
  }
  if (type === "viewer") {
    validateViewer(config, errors);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Terms

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A name with a digit or with more than one capital letter is matched with
 * exact case (D1, R2, GitHub App). Other names ignore case, so that a term
 * also matches at the start of a sentence.
 */
function isCaseSensitiveName(name) {
  if (/\d/.test(name)) return true;
  const capitals = name.match(/\p{Lu}/gu);
  return (capitals?.length ?? 0) > 1;
}

function normalizeTermName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function buildTermPattern(names, flags) {
  if (!names.length) return null;
  const alternatives = [...names]
    // The longest name comes first, so that "D1 batch" wins over "D1".
    .sort((first, second) => second.length - first.length)
    .map((name) => {
      const body = escapeRegExp(name).replace(/ /g, "\\s+");
      // A name that ends in a letter or a digit also matches a plain plural.
      const plural = /[\p{L}\p{N}]$/u.test(name) ? "(?:es|s)?" : "";
      return `${body}${plural}`;
    });
  // The lookarounds keep a match from starting or ending inside a word. They
  // also keep it out of an identifier: "D1" is not a use of the term in the
  // finding "D1-01" or in the decision "D-D1-04". An identifier joins a
  // capital letter or a digit to the name with a hyphen, or the name to a
  // digit. "D1-backed" is still a use.
  const source = `(?<![\\p{L}\\p{N}_])(?<![\\p{Lu}\\p{N}]-)(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])(?!-\\p{N})`;
  return new RegExp(source, flags);
}

function lookUpTermName(names, text) {
  const exact = names.get(text);
  if (exact != null) {
    return exact;
  }
  if (text.endsWith("s")) {
    const singular = names.get(text.slice(0, -1));
    if (singular != null) {
      return singular;
    }
  }
  if (text.endsWith("es")) {
    const singular = names.get(text.slice(0, -2));
    if (singular != null) {
      return singular;
    }
  }
  return null;
}

/**
 * Prepares the shared definitions for matching. `find(text)` returns the
 * matches in text order, never overlapping, with the longest name first at
 * each position. `lookUp(name)` returns the entry of one term or alias.
 */
export function compileTerms(terms) {
  const entries = terms.map((term, index) => ({
    index,
    term: normalizeTermName(term.term),
    definition: term.definition,
  }));
  const exactNames = new Map();
  const looseNames = new Map();
  terms.forEach((term, index) => {
    const override = typeof term.caseSensitive === "boolean" ? term.caseSensitive : null;
    for (const raw of [term.term, ...(term.aliases ?? [])]) {
      const name = normalizeTermName(raw);
      if (!name) continue;
      if (override ?? isCaseSensitiveName(name)) {
        exactNames.set(name, index);
      } else {
        looseNames.set(name.toLowerCase(), index);
      }
    }
  });
  const matchers = [
    { pattern: buildTermPattern([...exactNames.keys()], "gu"), names: exactNames, fold: false },
    { pattern: buildTermPattern([...looseNames.keys()], "giu"), names: looseNames, fold: true },
  ];

  const find = (text) => {
    const found = [];
    for (const { pattern, names, fold } of matchers) {
      if (!pattern) continue;
      for (const match of text.matchAll(pattern)) {
        const normalized = normalizeTermName(match[0]);
        const index = lookUpTermName(names, fold ? normalized.toLowerCase() : normalized);
        if (index == null) continue;
        found.push({ start: match.index, end: match.index + match[0].length, entry: index });
      }
    }
    found.sort((first, second) => first.start - second.start || second.end - first.end);
    const result = [];
    let cursor = 0;
    for (const item of found) {
      if (item.start < cursor) continue;
      result.push(item);
      cursor = item.end;
    }
    return result;
  };

  const lookUp = (name) => {
    const normalized = normalizeTermName(name);
    const index = exactNames.get(normalized) ?? looseNames.get(normalized.toLowerCase());
    if (index == null) return null;
    return entries[index] ?? null;
  };

  return { entries, find, lookUp };
}

// ---------------------------------------------------------------------------
// Findings

function rank(order, value) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

const naturalOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Describes the "measured" field: `true`, `false`, or a text with the value. */
export function describeMeasured(measured) {
  if (measured === true) {
    return "Measured";
  }
  if (typeof measured === "string" && measured.trim()) {
    return measured.trim();
  }
  return "Not measured";
}

export function isMeasured(measured) {
  if (measured === true) return true;
  return typeof measured === "string" && measured.trim() !== "";
}

/** Compares two findings by one column. Severity, verdict, and effort have a set order. */
export function compareFindings(first, second, key) {
  if (key === "severity") {
    const order = [...SEVERITIES.keys()];
    return rank(order, first.severity) - rank(order, second.severity);
  }
  if (key === "verdict") {
    const order = [...VERDICTS.keys()];
    return rank(order, first.verdict) - rank(order, second.verdict);
  }
  if (key === "effort") {
    return (
      rank(EFFORT_ORDER, first.effort) - rank(EFFORT_ORDER, second.effort) ||
      naturalOrder.compare(String(first.effort ?? ""), String(second.effort ?? ""))
    );
  }
  if (key === "measured") {
    return Number(isMeasured(second.measured)) - Number(isMeasured(first.measured));
  }
  return naturalOrder.compare(String(first[key] ?? ""), String(second[key] ?? ""));
}

/** Tells whether a finding passes the filters. An empty filter passes all. */
export function matchesFindingFilters(finding, filters) {
  for (const key of ["area", "severity", "kind", "verdict"]) {
    const wanted = filters[key];
    if (wanted && finding[key] !== wanted) return false;
  }
  const words = (filters.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [finding.id, finding.title, finding.summary, finding.area, finding.kind]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// ---------------------------------------------------------------------------
// Feedback

/** Feedback is saved in the browser under this key. One key for each document. */
export function getStorageKey(record) {
  const slug = String(record.title ?? "document")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}:feedback`;
}

function normalizeFeedbackEntry(entry) {
  const result = { selection: null, notes: "" };
  if (!isRecord(entry)) {
    return result;
  }
  if (isNonEmptyString(entry.selection)) {
    result.selection = entry.selection;
  }
  if (typeof entry.notes === "string") {
    result.notes = entry.notes;
  }
  const stale = entry.stale;
  if (isRecord(stale) && isNonEmptyString(stale.selection) && isNonEmptyString(stale.revision)) {
    result.stale = { selection: stale.selection, revision: stale.revision };
  }
  return result;
}

function normalizeFeedbackState(state) {
  const result = {};
  if (!isRecord(state)) {
    return result;
  }
  for (const [id, entry] of Object.entries(state)) {
    result[id] = normalizeFeedbackEntry(entry);
  }
  return result;
}

/** Reads one decision without matching inherited keys such as `constructor`. */
export function getFeedbackEntry(state, id) {
  if (!Object.hasOwn(state, id)) {
    return { selection: null, notes: "" };
  }
  return state[id];
}

/** Parses saved feedback. Returns nothing when the text is not saved feedback. */
export function parseStoredFeedback(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  if (!isRecord(value)) return;
  if (!isNonEmptyString(value.revision)) return;
  return {
    revision: value.revision,
    baseline: normalizeFeedbackState(value.baseline),
    current: normalizeFeedbackState(value.current),
  };
}

/**
 * Aligns saved feedback with the document.
 *
 * The baseline is the feedback that the record already contains. It is saved
 * with the feedback and stays the same while the revision is the same. A new
 * revision replaces the baseline with the new "incorporated" feedback and
 * keeps the current feedback.
 *
 * A selection that is not a current option is cleared. The notes stay, and
 * the entry keeps the old selection as `stale` for this revision, so that the
 * next prompt reports the decision as OPEN.
 */
export function reconcileFeedback({ stored, record, decisions }) {
  const incorporated = normalizeFeedbackState(record.incorporated);
  const baseline = stored?.revision === record.revision ? stored.baseline : incorporated;
  const current = { ...(stored ? stored.current : incorporated) };
  for (const decision of decisions) {
    const entry = getFeedbackEntry(current, decision.id);
    if (entry.stale && entry.stale.revision !== record.revision) {
      // An earlier revision cleared this selection, and a later one merged it.
      current[decision.id] = { selection: entry.selection, notes: entry.notes };
    }
    if (entry.selection == null) continue;
    if (decision.options.some((option) => option.id === entry.selection)) continue;
    current[decision.id] = {
      selection: null,
      notes: entry.notes,
      stale: { selection: entry.selection, revision: record.revision },
    };
  }
  return { revision: record.revision, baseline, current };
}

function getActiveStale(state, entry) {
  if (entry.selection != null) return null;
  if (entry.stale?.revision !== state.revision) return null;
  return entry.stale;
}

/**
 * Tells whether a decision differs from the baseline in this feedback round.
 * Notes compare without the spaces at their ends. A stale selection counts
 * only in the revision that cleared it: a later revision has merged it.
 */
export function isDecisionChanged(state, id) {
  const current = getFeedbackEntry(state.current, id);
  const baseline = getFeedbackEntry(state.baseline, id);
  if (current.selection !== baseline.selection) return true;
  if (current.notes.trim() !== baseline.notes.trim()) return true;
  return getActiveStale(state, current) != null;
}

/**
 * The state of one decision. Only an explicit selection of a current option
 * counts as answered. Notes and recommendations do not.
 */
export function getDecisionStatus(state, decision) {
  const entry = getFeedbackEntry(state.current, decision.id);
  const option = decision.options.find((item) => item.id === entry.selection) ?? null;
  return {
    answered: option != null,
    option,
    notes: entry.notes,
    stale: option ? null : getActiveStale(state, entry),
    changed: isDecisionChanged(state, decision.id),
  };
}

export function countAnswered(state, decisions) {
  return decisions.filter((decision) => getDecisionStatus(state, decision).answered).length;
}

export function getChangedDecisions(state, decisions) {
  return decisions.filter((decision) => isDecisionChanged(state, decision.id));
}

/** Returns a new state with one selection changed. `null` clears it. Notes stay. */
export function withSelection(state, id, selection) {
  const entry = getFeedbackEntry(state.current, id);
  const next = { selection, notes: entry.notes };
  // A cleared selection keeps the stale mark, so the reason stays in the prompt.
  if (selection == null && entry.stale) {
    next.stale = entry.stale;
  }
  return { ...state, current: { ...state.current, [id]: next } };
}

/** Returns a new state with the notes of one decision changed. The selection stays. */
export function withNotes(state, id, notes) {
  const entry = getFeedbackEntry(state.current, id);
  return { ...state, current: { ...state.current, [id]: { ...entry, notes } } };
}

// ---------------------------------------------------------------------------
// Continuation prompt

function describeAnswer(decision, selection) {
  const option = decision.options.find((item) => item.id === selection);
  if (!option) {
    return "OPEN";
  }
  return `${option.label} (option \`${option.id}\`)`;
}

function describeNotes(notes) {
  const text = notes.trim();
  if (!text) {
    return ["Notes: none"];
  }
  if (!text.includes("\n")) {
    return [`Notes: ${text}`];
  }
  return ["Notes:", ...text.split("\n").map((line) => `  ${line}`)];
}

function describeOpenReason(state, decision) {
  const current = getFeedbackEntry(state.current, decision.id);
  const baseline = getFeedbackEntry(state.baseline, decision.id);
  if (current.selection != null) return null;
  const stale = getActiveStale(state, current);
  if (stale) {
    return `Reason: the earlier selection \`${stale.selection}\` is no longer an option in revision ${state.revision}. The maintainer has not confirmed a current option.`;
  }
  if (baseline.selection == null) return null;
  if (!decision.options.some((option) => option.id === baseline.selection)) {
    return `Reason: the selection in the living record, \`${baseline.selection}\`, is no longer an option. The maintainer has not confirmed a current option.`;
  }
  return "Reason: the maintainer cleared the selection.";
}

function describeDecisionUpdate(state, decision) {
  const current = getFeedbackEntry(state.current, decision.id);
  const baseline = getFeedbackEntry(state.baseline, decision.id);
  const lines = [
    `${decision.id}: ${decision.question}`,
    `Answer: ${describeAnswer(decision, current.selection)}`,
  ];
  const reason = describeOpenReason(state, decision);
  if (reason) {
    lines.push(reason);
  }
  const recorded = decision.options.some((option) => option.id === baseline.selection)
    ? describeAnswer(decision, baseline.selection)
    : "OPEN";
  lines.push(`Answer in the living record: ${recorded}`);
  lines.push(...describeNotes(current.notes));
  return lines.join("\n");
}

/**
 * Builds the handoff text for the next agent. It lists only the decisions
 * that differ from the baseline. It never changes the baseline.
 */
export function buildContinuationPrompt({ record, decisions, state }) {
  const changed = getChangedDecisions(state, decisions);
  const total = decisions.length;
  const location = record.livingRecord ?? {};
  const updates = changed.length
    ? [
        `Decisions updated in this feedback round (${changed.length} of ${total}). The other decisions did not change and are not listed.`,
        "",
        changed.map((decision) => describeDecisionUpdate(state, decision)).join("\n\n"),
      ]
    : [
        `No decision changed in this feedback round (0 of ${total}). The living record already has the complete feedback.`,
      ];
  const recordLines = [
    `- Title: ${record.title}`,
    `- Revision: ${record.revision}${record.date ? ` (${record.date})` : ""}`,
    `- Artifact: ${location.artifactUrl || "not published yet"}`,
    `- Local file: ${location.localPath || "not set"}`,
    `- Lab path: ${location.labPath || "not set"}`,
  ];
  if (location.sourcePath) {
    recordLines.push(
      `- Source: ${location.sourcePath} (decisions: content/decisions.json, incorporated feedback: content/record.json)`,
    );
  }
  return [
    `Continue the design review of "${record.title}".`,
    "",
    "Living record",
    ...recordLines,
    "",
    ...updates,
    "",
    "Instructions",
    '1. Load the complete living record before you change anything. It has the full state of every decision. If you cannot open it, stop and ask the maintainer for the "Portable copy of the complete record" from the feedback section of the document. Do not rebuild the record from this prompt.',
    "2. Merge the updates above into the living record. Preserve every decision that is not listed here, settled or open.",
    "3. Treat only an explicit maintainer choice as a decision. A recommendation is not a decision. Notes give context and are not decisions.",
    "4. Keep every OPEN item open. Do not settle it for the maintainer.",
    "5. If a note conflicts with the selected answer, ask the maintainer to resolve the conflict.",
    "6. If a note raises a new alternative, compare it with the current options before you change the design.",
    "7. Continue the design within the authorized scope. Implementation and GitHub publication are out of scope unless the maintainer authorizes them separately.",
    '8. After the merge, set "incorporated" in the record to the merged feedback, change the revision, rebuild the document, and update the artifact and the local file. This starts the next feedback round.',
  ].join("\n");
}

/**
 * Builds a portable copy of the complete record: every decision with its
 * context, its options with what each one is and what follows from it, the
 * answer in the record, and the current answer and notes. It is for an agent
 * that cannot open the living record. The continuation prompt stays short
 * and does not repeat it.
 */
export function buildRecordExport({ record, decisions, state }) {
  const blocks = decisions.map((decision) => {
    const current = getFeedbackEntry(state.current, decision.id);
    const baseline = getFeedbackEntry(state.baseline, decision.id);
    const status = DECISION_STATUSES.get(decision.status) ?? decision.status;
    const isRecorded = decision.options.some((option) => option.id === baseline.selection);
    const changed = isDecisionChanged(state, decision.id)
      ? " (changed in this feedback round)"
      : "";
    const lines = [`${decision.id}: ${decision.question}`];
    if (decision.context) {
      lines.push(`Context: ${decision.context}`);
    }
    lines.push(
      `Status in the record: ${status}${decision.settledAnswer ? `: ${decision.settledAnswer}` : ""}`,
    );
    if (decision.rationale) {
      lines.push(`Rationale: ${decision.rationale}`);
    }
    if (decision.evidence?.length) {
      lines.push(`Evidence: ${decision.evidence.join(", ")}`);
    }
    lines.push("Options:");
    for (const option of decision.options) {
      lines.push(
        `- \`${option.id}\`: ${option.label}${option.recommended ? " (recommended)" : ""}`,
      );
      if (option.explanation) {
        lines.push(`  What it is: ${option.explanation}`);
      }
      if (option.consequences) {
        lines.push(`  Consequences: ${option.consequences}`);
      }
    }
    lines.push(
      `Answer in the living record: ${isRecorded ? describeAnswer(decision, baseline.selection) : "OPEN"}`,
      `Answer of the maintainer now: ${describeAnswer(decision, current.selection)}${changed}`,
      ...describeNotes(current.notes),
    );
    return lines.join("\n");
  });
  const date = record.date ? ` (${record.date})` : "";
  return [
    `Complete decision record of "${record.title}", revision ${record.revision}${date}.`,
    "This copy holds every decision. Use it only if you cannot open the living record. The continuation prompt lists the decisions that changed.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

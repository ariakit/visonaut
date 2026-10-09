// The browser part of the audit document. It reads the data that build.mjs
// puts in the page and turns the section fragments into the live document:
// decision panels, examples, the findings explorer, term tooltips, and the
// feedback bar.
//
// build.mjs removes the import below and puts core.js in front of this file
// inside one function scope.
import {
  CODE_LANGUAGES,
  DECISION_STATUSES,
  FACT_KINDS,
  LANES,
  SEVERITIES,
  TIMELINE_SCENARIOS,
  VERDICTS,
  VIEWER_MODES,
  buildContinuationPrompt,
  buildRecordExport,
  compareFindings,
  compileTerms,
  countAnswered,
  describeMeasured,
  evaluateCalculator,
  getChangedDecisions,
  getDecisionStatus,
  getStorageKey,
  hasDurationRange,
  listTimelineSteps,
  matchesFindingFilters,
  parseStoredFeedback,
  reconcileFeedback,
  resolveTimeline,
  validateDemoConfig,
  withNotes,
  withSelection,
} from "./core.js";

const root = document.getElementById("doc");
const data = JSON.parse(document.getElementById("audit-data").textContent);
const terms = compileTerms(data.terms);
const findingsById = new Map(data.findings.map((finding) => [finding.id, finding]));
const decisionsById = new Map(data.decisions.map((decision) => [decision.id, decision]));

const FONT_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";

// Elements that must not hold a term tooltip trigger: controls, links, and
// content that is not prose.
const NO_TERMS_SELECTOR = [
  "a",
  "button",
  "label",
  "input",
  "select",
  "textarea",
  "option",
  "summary",
  '[role="button"]',
  '[role="tab"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[contenteditable]:not([contenteditable="false"])',
  "script",
  "style",
  "svg",
  "math",
  "canvas",
  "[data-no-terms]",
  ".term",
].join(",");

// Controls with a text label. A term in such a label gets a trigger beside
// the control, because the label itself stays unchanged. The labels of a
// select are the texts of its options.
const LABEL_CONTROL_SELECTOR =
  'a[href], button, label, summary, select, [role="tab"], [role="button"]';

// A drawing in the text. Its words cannot hold a trigger, so its terms get
// triggers in a line below it. The images of a viewer demo show a screen and
// are not part of the text.
const DRAWING_SELECTOR = "main svg:not([data-image])";

const TEXT_BLOCK_SELECTOR =
  "p, li, td, th, dd, dt, figcaption, caption, blockquote, h1, h2, h3, h4, h5, h6, div, section, nav";

// ---------------------------------------------------------------------------
// DOM helpers

function create(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (value === false) continue;
    if (name === "class") {
      element.className = value;
    } else if (name === "text") {
      element.textContent = value;
    } else if (value === true) {
      element.setAttribute(name, "");
    } else {
      element.setAttribute(name, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    if (child === false) continue;
    element.append(child);
  }
  return element;
}

/** Sets text only when it differs, so that an unchanged update makes no DOM change. */
function setText(element, text) {
  if (element.textContent === text) return;
  element.textContent = text;
}

function setHidden(element, hidden) {
  if (element.hidden === hidden) return;
  element.hidden = hidden;
}

/**
 * Replaces the children of an element. It leaves out `null`, `undefined`,
 * and `false`, which the DOM method would print as text.
 */
function setChildren(element, ...children) {
  element.replaceChildren(...children.flat().filter((child) => child != null && child !== false));
}

function formatNumber(value, precision = 0) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

function plural(count, singular, many = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : many}`;
}

/**
 * Copies text to the clipboard. Resolves to `false` when the browser blocks
 * the copy, so that the caller can show the text for a manual copy.
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Feedback store

function createFeedbackStore() {
  const key = getStorageKey(data.record);
  const listeners = new Set();
  let saved = true;

  const reconcile = (stored) => {
    return reconcileFeedback({ stored, record: data.record, decisions: data.decisions });
  };
  const read = () => {
    try {
      const text = window.localStorage.getItem(key);
      if (!text) return;
      return parseStoredFeedback(text);
    } catch {
      saved = false;
    }
  };
  let state = reconcile(read());
  const write = () => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
      saved = true;
    } catch {
      saved = false;
    }
  };
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const set = (next) => {
    state = next;
    write();
    notify();
  };
  // Saves the baseline with the feedback. After a revision change, this is
  // the moment when the new baseline replaces the old one.
  write();

  // Another tab of the same document changed the feedback.
  window.addEventListener("storage", (event) => {
    if (event.key !== key) return;
    if (!event.newValue) return;
    const stored = parseStoredFeedback(event.newValue);
    if (!stored) return;
    state = reconcile(stored);
    notify();
  });

  return {
    getState: () => state,
    isSaved: () => saved,
    select: (id, selection) => set(withSelection(state, id, selection)),
    note: (id, notes) => set(withNotes(state, id, notes)),
    subscribe: (listener) => {
      listeners.add(listener);
    },
  };
}

// ---------------------------------------------------------------------------
// Terms and tooltips

const definitions = new Map();

/**
 * Keeps one hidden description for each definition in use. A trigger points
 * to it with aria-describedby. The store is not a glossary: it is never
 * rendered.
 */
function registerDefinition(key, name, definition) {
  const known = definitions.get(key);
  if (known) {
    return known;
  }
  const id = `term-definition-${definitions.size + 1}`;
  document.getElementById("term-definitions").append(create("span", { id, text: definition }));
  const entry = { id, name, definition };
  definitions.set(key, entry);
  return entry;
}

function registerTerm(index) {
  const entry = terms.entries[index];
  if (!entry) return null;
  const key = `term:${index}`;
  registerDefinition(key, entry.term, entry.definition);
  return key;
}

function makeTrigger(element, key, focusable = true) {
  element.classList.add("term");
  element.dataset.termKey = key;
  if (!focusable) return;
  element.tabIndex = 0;
  element.setAttribute("aria-describedby", definitions.get(key).id);
}

function isTextNode(node) {
  return node.nodeType === 3;
}

function isElement(node) {
  return node.nodeType === 1;
}

function getElement(node) {
  return isElement(node) ? node : node.parentElement;
}

function collectTextNodes(container) {
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest(NO_TERMS_SELECTOR)) continue;
    nodes.push(node);
  }
  return nodes;
}

/**
 * Wraps each term in a run of text nodes. The run is one text node in prose.
 * In a code block it is every text node of the block, so that a term still
 * matches when the syntax highlighter splits it into tokens. The text of the
 * run does not change.
 */
function annotateRun(nodes) {
  const text = nodes.map((node) => node.data).join("");
  if (!text.trim()) return;
  const matches = terms.find(text);
  if (!matches.length) return;
  // Work from the end, so that a split never moves an offset that is still
  // needed.
  let offset = text.length;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const nodeEnd = offset;
    const nodeStart = offset - node.data.length;
    offset = nodeStart;
    for (let j = matches.length - 1; j >= 0; j--) {
      const match = matches[j];
      if (match.end <= nodeStart) break;
      if (match.start >= nodeEnd) continue;
      const key = registerTerm(match.entry);
      if (!key) continue;
      const start = Math.max(match.start, nodeStart) - nodeStart;
      const end = Math.min(match.end, nodeEnd) - nodeStart;
      const piece = node.splitText(start);
      piece.splitText(end - start);
      const trigger = create("span");
      // A term that crosses several tokens has one focus stop, at its start.
      makeTrigger(trigger, key, match.start >= nodeStart);
      piece.before(trigger);
      trigger.append(piece);
    }
  }
}

function annotateElement(element) {
  if (element.matches(NO_TERMS_SELECTOR)) return;
  if (element.localName === "pre") {
    annotateRun(collectTextNodes(element));
    return;
  }
  for (const child of [...element.childNodes]) {
    if (isTextNode(child)) {
      annotateRun([child]);
    } else if (isElement(child)) {
      annotateElement(child);
    }
  }
}

/** Adds tooltip triggers to every term under a node. Safe to run again. */
function annotateTerms(node) {
  if (!terms.entries.length) return;
  const element = getElement(node);
  if (!element) return;
  if (!root.contains(element)) return;
  const block = element.closest("pre");
  if (block) {
    if (block.closest(NO_TERMS_SELECTOR)) return;
    annotateRun(collectTextNodes(block));
    return;
  }
  if (element.closest(NO_TERMS_SELECTOR)) return;
  if (isTextNode(node)) {
    annotateRun([node]);
    return;
  }
  annotateElement(node);
}

/** Turns an author element with `data-term` into a trigger for that term. */
function setupExplicitTerms() {
  for (const element of root.querySelectorAll("[data-term]")) {
    const entry = terms.lookUp(element.dataset.term);
    if (!entry) continue;
    const key = registerTerm(entry.index);
    makeTrigger(element, key);
  }
}

function hasTrigger(container, key) {
  return container.querySelector(`.term[data-term-key="${key}"]`) != null;
}

function addSlotTrigger(slot, key, lead = "Terms in the label: ") {
  const entry = definitions.get(key);
  const trigger = create("span", { text: entry.name });
  makeTrigger(trigger, key);
  if (slot.childNodes.length) {
    slot.append(", ", trigger);
  } else {
    slot.append(lead, trigger);
  }
}

function createTermMark(key) {
  const entry = definitions.get(key);
  const mark = create(
    "span",
    { class: "term-mark" },
    create("span", { "aria-hidden": "true", text: "?" }),
    create("span", { class: "visually-hidden", text: `Explain ${entry.name}` }),
  );
  makeTrigger(mark, key);
  return mark;
}

/**
 * Reads the label of a control with a space between its parts. In
 * `textContent`, two parts that touch read as one word, and a term at the
 * edge of a part would not match.
 */
function getLabelText(control) {
  const parts = [];
  const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    parts.push(walker.currentNode.data);
  }
  return parts.join(" ");
}

/**
 * Gives each term in a control label a trigger beside the control. The label
 * keeps its text and its accessible name. An engine control puts the trigger
 * in its description (`data-term-slot`). Other controls get a small "?" mark
 * after them. A block that already explains the term needs no second trigger.
 */
function ensureLabelTerms(control) {
  if (!terms.entries.length) return;
  if (control.closest("[data-no-terms], pre, .term")) return;
  const matches = terms.find(getLabelText(control));
  if (!matches.length) return;
  const scope = control.closest("[data-term-scope]");
  const slot = scope?.querySelector("[data-term-slot]");
  const block =
    scope ?? control.parentElement?.closest(TEXT_BLOCK_SELECTOR) ?? control.parentElement;
  if (!block) return;
  // What follows a summary is hidden while its details element is closed, so
  // the mark of a summary goes after the details element.
  let anchor = control.localName === "summary" ? (control.parentElement ?? control) : control;
  for (const index of new Set(matches.map((match) => match.entry))) {
    const key = registerTerm(index);
    if (!key) continue;
    if (hasTrigger(block, key)) continue;
    if (slot) {
      // A slot can set its own first words, for example "Terms: " in a menu.
      addSlotTrigger(slot, key, slot.dataset.termSlot || undefined);
      continue;
    }
    // Each mark goes after the one before it, so the marks keep the order of
    // the terms in the label.
    const mark = createTermMark(key);
    anchor.after(mark);
    anchor = mark;
  }
}

function getDrawingText(drawing) {
  return [...drawing.querySelectorAll("text")].map((text) => text.textContent).join(" ");
}

function getDrawingBlock(drawing) {
  return drawing.closest("figure") ?? drawing.parentElement;
}

/**
 * Gives each term in the words of a drawing a trigger in a line below the
 * drawing. A caption that already explains the term needs no second trigger.
 */
function ensureDrawingTerms(drawing) {
  if (drawing.closest(`[data-no-terms], .viewer-display, ${LABEL_CONTROL_SELECTOR}`)) return;
  const matches = terms.find(getDrawingText(drawing));
  if (!matches.length) return;
  const block = getDrawingBlock(drawing);
  if (!block) return;
  let slot = null;
  for (const index of new Set(matches.map((match) => match.entry))) {
    const key = registerTerm(index);
    if (!key) continue;
    if (hasTrigger(block, key)) continue;
    if (!slot) {
      slot = create("p", { class: "term-slot drawing-terms" });
      if (block.localName === "figure") {
        block.append(slot);
      } else {
        drawing.after(slot);
      }
    }
    addSlotTrigger(slot, key, "Terms in the drawing: ");
  }
}

function ensureDrawingTermsIn(container) {
  if (!terms.entries.length) return;
  for (const drawing of container.querySelectorAll(DRAWING_SELECTOR)) {
    ensureDrawingTerms(drawing);
  }
}

function ensureLabelTermsIn(node) {
  const element = getElement(node);
  if (!element) return;
  if (!root.contains(element)) return;
  const control = element.closest(LABEL_CONTROL_SELECTOR);
  if (control) {
    ensureLabelTerms(control);
    return;
  }
  if (!isElement(node)) return;
  for (const item of node.querySelectorAll(LABEL_CONTROL_SELECTOR)) {
    ensureLabelTerms(item);
  }
}

/**
 * Keeps tooltips complete when the page changes after load: an example that
 * renders again, a filter that shows other rows, or code that is highlighted
 * late.
 */
function observeTerms() {
  const options = { childList: true, subtree: true, characterData: true };
  const observer = new MutationObserver((records) => {
    // The changes below must not start this callback again.
    observer.disconnect();
    const nodes = new Set();
    for (const record of records) {
      if (record.type === "characterData") {
        nodes.add(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        // A code block is annotated as a whole, one time for all its tokens.
        nodes.add(getElement(node)?.closest("pre") ?? node);
      }
    }
    for (const node of nodes) {
      if (node.isConnected) {
        annotateTerms(node);
      }
    }
    for (const node of nodes) {
      if (node.isConnected) {
        ensureLabelTermsIn(node);
      }
    }
    observer.observe(root, options);
  });
  observer.observe(root, options);
}

function setupTooltips() {
  const tooltip = document.getElementById("term-tooltip");
  const name = create("span", { class: "tooltip-term" });
  const definition = create("span");
  tooltip.append(name, definition);
  let openTrigger = null;
  // "hover" closes when the pointer leaves. "focus" and "press" stay open
  // until focus moves, Escape, or a press outside.
  let openReason = null;
  let pressedTrigger = null;
  let pressedWasOpen = false;
  let showTimer = 0;
  let hideTimer = 0;

  const findTrigger = (target) => {
    if (!target) return null;
    if (!isElement(target)) return null;
    return target.closest(".term[data-term-key]");
  };

  const hide = () => {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    openTrigger?.removeAttribute("data-open");
    openTrigger = null;
    openReason = null;
    tooltip.hidden = true;
  };

  const place = () => {
    if (!openTrigger) return;
    const box = openTrigger.getClientRects()[0] ?? openTrigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    if (box.bottom < 0 || box.top > viewportHeight) {
      hide();
      return;
    }
    const margin = 8;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const centered = box.left + box.width / 2 - width / 2;
    const left = Math.max(margin, Math.min(centered, viewportWidth - width - margin));
    const above = box.top - height - 6;
    const top = above >= margin ? above : box.bottom + 6;
    tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  const show = (trigger, reason) => {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    const entry = definitions.get(trigger.dataset.termKey);
    if (!entry) return;
    openTrigger?.removeAttribute("data-open");
    openTrigger = trigger;
    openReason = reason;
    trigger.setAttribute("data-open", "");
    setText(name, entry.name);
    setText(definition, entry.definition);
    tooltip.hidden = false;
    place();
  };

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    if (tooltip.contains(event.target)) {
      window.clearTimeout(hideTimer);
      return;
    }
    const trigger = findTrigger(event.target);
    if (!trigger) return;
    window.clearTimeout(hideTimer);
    if (trigger === openTrigger) return;
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(trigger, "hover"), 120);
  });

  document.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse") return;
    if (!findTrigger(event.target) && !tooltip.contains(event.target)) return;
    window.clearTimeout(showTimer);
    if (openReason !== "hover") return;
    // A short delay lets the pointer move from the term onto the tooltip.
    hideTimer = window.setTimeout(hide, 180);
  });

  document.addEventListener("focusin", (event) => {
    const trigger = findTrigger(event.target);
    if (trigger) {
      show(trigger, "focus");
    }
  });

  document.addEventListener("focusout", (event) => {
    if (findTrigger(event.target) !== openTrigger) return;
    if (openReason === "hover") return;
    hide();
  });

  // A press toggles the tooltip, so that touch works without hover. Focus
  // arrives between pointerdown and click and opens the tooltip, so the
  // toggle uses the state from before the press.
  document.addEventListener(
    "pointerdown",
    (event) => {
      pressedTrigger = findTrigger(event.target);
      pressedWasOpen =
        pressedTrigger != null && pressedTrigger === openTrigger && openReason !== "hover";
      if (pressedTrigger) return;
      if (tooltip.contains(event.target)) return;
      hide();
    },
    true,
  );

  document.addEventListener("click", (event) => {
    const trigger = findTrigger(event.target);
    if (!trigger) return;
    if (trigger === pressedTrigger && pressedWasOpen) {
      hide();
      return;
    }
    show(trigger, "press");
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      if (!openTrigger) return;
      hide();
      // Escape closes only the tooltip, not an open menu behind it.
      event.stopImmediatePropagation();
    },
    true,
  );

  window.addEventListener("scroll", place, { passive: true, capture: true });
  window.addEventListener("resize", place);
}

// ---------------------------------------------------------------------------
// Content: tables, facts, findings, code

function getSections() {
  return [...root.querySelectorAll("main > section[id]")];
}

function createSampleFlag(text) {
  return create("span", { class: "sample-flag", "data-no-terms": true, text });
}

/** Marks content that is still a sample, so that nobody reads it as a result. */
function markSamples() {
  for (const section of root.querySelectorAll("main > section[data-sample]")) {
    section.prepend(create("p", {}, createSampleFlag("Sample content. Replace this section.")));
  }
  const parts = [];
  if (data.record.sample) {
    parts.push("the record");
  }
  for (const [name, items] of [
    ["decisions", data.decisions],
    ["findings", data.findings],
    ["terms", data.terms],
  ]) {
    if (items.some((item) => item.sample)) {
      parts.push(name);
    }
  }
  if (!parts.length) return;
  document
    .getElementById("top")
    .append(
      create("p", {}, createSampleFlag(`This revision has sample data: ${parts.join(", ")}.`)),
    );
}

/** An external link opens in a new tab. The Artifact host needs that. */
function setupExternalLinks() {
  for (const link of root.querySelectorAll('main a[href^="http"]')) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.classList.add("external");
  }
}

/**
 * Makes a horizontal scroll area usable with a keyboard, but only while its
 * content is wider than the area. A fitting area gets no extra focus stop.
 */
function watchOverflow(scroller, label) {
  const update = () => {
    const overflows = scroller.scrollWidth > scroller.clientWidth + 1;
    if (overflows) {
      scroller.tabIndex = 0;
      scroller.setAttribute("role", "region");
      scroller.setAttribute("aria-label", label);
    } else {
      scroller.removeAttribute("tabindex");
      scroller.removeAttribute("role");
      scroller.removeAttribute("aria-label");
    }
  };
  new ResizeObserver(update).observe(scroller);
}

function wrapTables() {
  for (const table of root.querySelectorAll("main table")) {
    if (table.parentElement.classList.contains("table-scroll")) continue;
    const wrapper = create("div", { class: "table-scroll" });
    table.before(wrapper);
    wrapper.append(table);
    const caption = table.querySelector("caption")?.textContent.trim();
    watchOverflow(wrapper, caption ? `Table: ${caption}` : "Table. Scroll sideways to read it.");
  }
}

function createFactTag(kind) {
  const fact = FACT_KINDS.get(kind);
  const key = `fact:${kind}`;
  registerDefinition(key, fact.label, fact.definition);
  const tag = create("span", { class: "fact-tag", text: fact.label });
  makeTrigger(tag, key);
  return tag;
}

function setupFacts() {
  for (const element of root.querySelectorAll("[data-fact]")) {
    if (!FACT_KINDS.has(element.dataset.fact)) continue;
    element.prepend(createFactTag(element.dataset.fact));
  }
}

function createSeverity(severity) {
  return create(
    "span",
    { class: "severity", "data-severity": severity },
    create(
      "span",
      { class: "severity-glyph", "aria-hidden": "true" },
      create("i"),
      create("i"),
      create("i"),
      create("i"),
    ),
    create("span", { text: SEVERITIES.get(severity) ?? severity }),
  );
}

function createFindingChip(id) {
  const finding = findingsById.get(id);
  if (!finding) {
    return create("span", { class: "chip" }, create("span", { class: "chip-id", text: id }));
  }
  return create(
    "a",
    { class: "chip", href: `#finding-${finding.id}` },
    create("span", { class: "chip-id", text: finding.id }),
    createSeverity(finding.severity),
    create("span", {
      class: "chip-verdict",
      text: VERDICTS.get(finding.verdict) ?? finding.verdict,
    }),
  );
}

function setupFindingCallouts() {
  for (const element of root.querySelectorAll("[data-findings]")) {
    const ids = element.dataset.findings.split(/\s+/).filter(Boolean);
    if (element.localName === "span") {
      element.append(create("span", { class: "chips" }, ids.map(createFindingChip)));
      continue;
    }
    element.classList.add("findings-callout");
    const list = create("ul", { class: "finding-list" });
    for (const id of ids) {
      const title = findingsById.get(id)?.title ?? "This finding is not in the findings table.";
      list.append(create("li", {}, createFindingChip(id), create("span", { text: title })));
    }
    element.append(create("p", { class: "eyebrow", text: "Findings" }), list);
  }
}

const codeSources = new WeakMap();

/** Removes the indentation that every line of a code block shares. */
function dedent(text) {
  const lines = text
    .replace(/^\s*\n/, "")
    .replace(/\s+$/, "")
    .split("\n");
  let indent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    indent = Math.min(indent, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(indent)) {
    return lines.join("\n");
  }
  return lines.map((line) => line.slice(indent)).join("\n");
}

function renderCode(code) {
  const { source, grammar } = codeSources.get(code);
  const highlighter = window.hljs;
  if (!highlighter || !grammar) {
    setText(code, source);
    return;
  }
  try {
    // highlight.js escapes the source, so its output is safe markup.
    code.innerHTML = highlighter.highlight(source, {
      language: grammar,
      ignoreIllegals: true,
    }).value;
  } catch {
    setText(code, source);
  }
}

function renderAllCode() {
  for (const code of root.querySelectorAll("pre > code")) {
    if (codeSources.has(code)) {
      renderCode(code);
    }
  }
}

function setupCodeBlocks() {
  let count = 0;
  for (const code of root.querySelectorAll("main pre > code")) {
    count += 1;
    const pre = code.parentElement;
    const className = [...code.classList].find((name) => name.startsWith("language-"));
    const language = CODE_LANGUAGES.get(className?.slice(9)) ?? CODE_LANGUAGES.get("text");
    const source = dedent(code.textContent);
    codeSources.set(code, { source, grammar: language.grammar });
    const status = create("span", { class: "code-status", role: "status" });
    const button = create("button", {
      type: "button",
      class: "button button-quiet button-small",
      id: `code-copy-${count}`,
      text: "Copy",
    });
    button.addEventListener("click", async () => {
      const copied = await copyText(source);
      if (copied) {
        setText(status, "Copied.");
      } else {
        // The copy was blocked. Select the code so that one key press copies it.
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        setText(
          status,
          "The browser blocked the copy. The code is selected: press Ctrl+C or Cmd+C.",
        );
      }
      window.setTimeout(() => setText(status, ""), 6000);
    });
    const wrapper = create(
      "div",
      { class: "code" },
      create(
        "div",
        { class: "code-head", "data-no-terms": true },
        create("span", { text: language.label }),
        status,
        button,
      ),
    );
    pre.before(wrapper);
    wrapper.append(pre);
    watchOverflow(pre, `${language.label} code. Scroll sideways to read it.`);
    renderCode(code);
  }
  if (window.hljs) return;
  // The highlighter loads without blocking the page. Until it arrives, and
  // when it cannot load, the code stays plain and complete.
  document.getElementById("highlight-script")?.addEventListener("load", renderAllCode);
}

// ---------------------------------------------------------------------------
// Decisions

function getHeadingLevels(placeholders) {
  const levels = new Map();
  for (const placeholder of placeholders) {
    let level = 2;
    const section = placeholder.closest("section");
    for (const heading of section?.querySelectorAll("h2, h3, h4, h5") ?? []) {
      // A heading inside an example belongs to the example, not to the section.
      if (heading.closest("[data-demo]")) continue;
      // 4 is DOCUMENT_POSITION_FOLLOWING: the placeholder comes after the heading.
      const isBefore = heading.compareDocumentPosition(placeholder) & 4;
      if (!isBefore) break;
      level = Number(heading.localName.slice(1));
    }
    levels.set(placeholder, Math.min(level + 1, 6));
  }
  return levels;
}

function createStateBadge() {
  const label = create("span");
  const changed = create("span", {
    class: "state-changed",
    text: "Changed in this round",
    hidden: true,
  });
  const badge = create(
    "span",
    { class: "decision-state" },
    create("span", { class: "state-dot", "aria-hidden": "true" }),
    label,
  );
  const update = (status) => {
    badge.dataset.answered = String(status.answered);
    setText(label, status.answered ? "Answered" : "Open");
    setHidden(changed, !status.changed);
  };
  return { badge, changed, update };
}

/** The lines that say what the record holds for a settled or rejected decision. */
function createRecordNote(decision) {
  const status = DECISION_STATUSES.get(decision.status) ?? decision.status;
  const line = (label, text) => {
    return create("p", {}, create("span", { class: "option-detail-label", text: label }), text);
  };
  return create(
    "div",
    { class: "decision-record" },
    line("In the record", decision.settledAnswer ? `${status}: ${decision.settledAnswer}` : status),
    decision.rationale && line("Rationale", decision.rationale),
  );
}

function renderDecisionPanel({ decision, level, store }) {
  const panelId = `decision-${decision.id}`;
  const questionId = `${panelId}-question`;
  const state = createStateBadge();
  const stale = create("p", { class: "decision-stale", hidden: true });
  const inputs = [];
  const selectedTags = [];

  const options = create("div", {
    class: "options",
    role: "radiogroup",
    "aria-labelledby": questionId,
  });
  for (const option of decision.options) {
    const inputId = `${panelId}-option-${option.id}`;
    const detailId = `${inputId}-detail`;
    const input = create("input", {
      type: "radio",
      name: panelId,
      id: inputId,
      value: option.id,
      "aria-describedby": detailId,
    });
    input.addEventListener("change", () => {
      if (input.checked) {
        store.select(decision.id, option.id);
      }
    });
    const selectedTag = create("span", {
      class: "tag-selected",
      text: "Your answer",
      hidden: true,
    });
    inputs.push(input);
    selectedTags.push(selectedTag);
    options.append(
      create(
        "div",
        { class: "option", "data-term-scope": true },
        input,
        create(
          "div",
          { class: "option-title" },
          create("label", { for: inputId, text: option.label }),
          option.recommended && create("span", { class: "tag-recommended", text: "Recommended" }),
          selectedTag,
        ),
        create(
          "div",
          { class: "option-detail", id: detailId },
          option.recommended && create("span", { class: "visually-hidden", text: "Recommended." }),
          create("p", { text: option.explanation }),
          create(
            "p",
            {},
            create("span", { class: "option-detail-label", text: "Consequences" }),
            option.consequences,
          ),
          create("span", { class: "term-slot", "data-term-slot": true }),
        ),
      ),
    );
  }

  const notesId = `${panelId}-notes`;
  const notes = create("textarea", {
    class: "input",
    id: notesId,
    rows: 3,
    "aria-describedby": `${notesId}-help`,
  });
  notes.addEventListener("input", () => store.note(decision.id, notes.value));

  const clear = create("button", {
    type: "button",
    class: "button button-small",
    id: `${panelId}-clear`,
    text: "Clear selection",
  });
  clear.addEventListener("click", () => {
    store.select(decision.id, null);
    // The button is now disabled, so focus moves to the first option.
    inputs[0]?.focus();
  });
  const saved = create("span", { role: "status" });

  const evidence = decision.evidence?.length
    ? create(
        "div",
        { class: "decision-evidence" },
        create("span", { class: "eyebrow", text: "Evidence" }),
        create("span", { class: "chips" }, decision.evidence.map(createFindingChip)),
      )
    : null;

  const panel = create(
    "div",
    { class: "decision", id: panelId, role: "group", "aria-labelledby": questionId, tabindex: -1 },
    create(
      "div",
      { class: "decision-head" },
      create("span", { class: "decision-label", text: "Decision" }),
      create("span", { class: "decision-id", text: decision.id }),
      decision.sample && createSampleFlag("Sample decision"),
      state.changed,
      state.badge,
    ),
    create(
      "div",
      { class: "decision-body" },
      create(`h${level}`, { class: "decision-question", id: questionId, text: decision.question }),
      decision.context && create("p", { class: "decision-context", text: decision.context }),
      decision.status !== "open" && createRecordNote(decision),
      evidence,
      stale,
      options,
      create(
        "div",
        { class: "field decision-notes" },
        create("label", { class: "field-label", for: notesId, text: `Notes for ${decision.id}` }),
        notes,
        create("p", {
          class: "small muted",
          id: `${notesId}-help`,
          text: "You can add notes without a selection. Notes alone do not count as an answer.",
        }),
      ),
      create("div", { class: "decision-foot" }, clear, saved),
    ),
  );

  const update = () => {
    const status = getDecisionStatus(store.getState(), decision);
    state.update(status);
    inputs.forEach((input, index) => {
      const checked = input.value === status.option?.id;
      input.checked = checked;
      setHidden(selectedTags[index], !checked);
    });
    clear.disabled = !status.answered;
    setHidden(stale, !status.stale);
    if (status.stale) {
      setText(
        stale,
        `Your earlier selection (${status.stale.selection}) is not an option in this revision. The decision is open again. Your notes are kept. Select a current option to answer it.`,
      );
    }
    // A change from another tab must not replace the text that is being typed.
    if (document.activeElement !== notes && notes.value !== status.notes) {
      notes.value = status.notes;
    }
    setText(
      saved,
      store.isSaved()
        ? "Saved in this browser."
        : "Not saved: this browser blocks local storage. Copy the prompt before you close the page.",
    );
  };
  update();
  store.subscribe(update);
  return panel;
}

function setupDecisions(store) {
  const placeholders = [...root.querySelectorAll("[data-decision]")];
  const levels = getHeadingLevels(placeholders);
  for (const placeholder of placeholders) {
    const decision = decisionsById.get(placeholder.dataset.decision);
    if (!decision) {
      placeholder.replaceWith(
        create("p", {
          class: "demo-error",
          text: `The decision "${placeholder.dataset.decision}" is not in decisions.json.`,
        }),
      );
      continue;
    }
    const panel = renderDecisionPanel({ decision, level: levels.get(placeholder) ?? 3, store });
    placeholder.replaceWith(panel);
  }
  sortDecisionsByPage();
}

/**
 * Puts the decisions in the order of their panels in the page. The Decisions
 * menu, the decision record, and the prompt all read this list, so they
 * follow the document also when decisions.json has another order.
 */
function sortDecisionsByPage() {
  const positions = new Map();
  for (const panel of root.querySelectorAll(".decision[id]")) {
    positions.set(panel.id, positions.size);
  }
  const positionOf = (decision) => positions.get(`decision-${decision.id}`) ?? positions.size;
  data.decisions.sort((first, second) => positionOf(first) - positionOf(second));
}

// ---------------------------------------------------------------------------
// Demos

/**
 * Builds the frame that every demo shares: the label that says it is
 * simulated, the title, the limits, the body, the state line, and Reset.
 */
function createDemoFrame(host, config) {
  const id = host.id;
  const titleId = `${id}-title`;
  const body = create("div", { class: "demo-body" });
  const state = create("p", { class: "demo-state", id: `${id}-state` });
  const reset = create("button", {
    type: "button",
    class: "button button-small",
    id: `${id}-reset`,
    text: "Reset",
  });
  host.classList.add("demo");
  host.setAttribute("role", "group");
  host.setAttribute("aria-labelledby", titleId);
  host.replaceChildren(
    create(
      "div",
      { class: "demo-head" },
      create("span", { class: "demo-label", text: config.label ?? "Simulated example" }),
      create("p", { class: "demo-title", id: titleId, text: config.title }),
      create("p", { class: "demo-limits", text: config.limits }),
    ),
    body,
    create("div", { class: "demo-foot" }, state, reset),
  );
  const setState = (text) => {
    state.replaceChildren(create("strong", { text: "State: " }), text);
  };
  return { id, body, reset, setState };
}

function createLaneTag(lane) {
  return create(
    "span",
    { class: "timeline-lane", "data-lane": lane },
    create("i", { class: "lane-swatch", "aria-hidden": "true" }),
    LANES.get(lane) ?? lane,
  );
}

function createCheck({ id, label, detail }) {
  const detailId = `${id}-detail`;
  const input = create("input", { type: "checkbox", id, "aria-describedby": detailId });
  const element = create(
    "div",
    { class: "check", "data-term-scope": true },
    input,
    create("label", { for: id, text: label }),
    create(
      "div",
      { class: "check-detail", id: detailId },
      create("span", { text: detail }),
      create("span", { class: "term-slot", "data-term-slot": true }),
    ),
  );
  return { element, input };
}

function createControlGroup(legend, ...children) {
  return create(
    "fieldset",
    { class: "control-group", "data-term-scope": true },
    create("legend", { class: "eyebrow", text: legend }),
    children,
    create("span", { class: "term-slot", "data-term-slot": true }),
  );
}

/** Picks a round tick distance that gives five intervals or fewer. */
function chooseTickStep(maximum) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(maximum, 1)));
  for (const factor of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5]) {
    const step = factor * magnitude;
    if (maximum / step <= 5) {
      return step;
    }
  }
  return 10 * magnitude;
}

function renderTimeline(host, config) {
  const frame = createDemoFrame(host, config);
  const unit = config.unit ?? "ms";
  const baselineName = config.baselineLabel ?? "today";
  const toggles = config.toggles ?? [];
  const presets = config.presets ?? [];
  const milestones = config.milestones ?? [];
  const primaryMilestone = config.milestone ?? milestones[0]?.id ?? null;
  const active = new Set();
  let scenario = "typical";

  const formatTime = (value) => `${formatNumber(value)} ${unit}`;

  const readouts = create("div", { class: "readouts" });
  const readoutItems = [];
  const addReadout = (key, label) => {
    const value = create("span", { class: "readout-value" });
    const delta = create("span", { class: "readout-delta" });
    readouts.append(
      create(
        "div",
        { class: "readout" },
        create("span", { class: "readout-label", text: label }),
        value,
        delta,
      ),
    );
    readoutItems.push({ key, value, delta });
  };
  for (const milestone of milestones) {
    addReadout(milestone.id, milestone.label);
  }
  addReadout("@total", config.totalLabel ?? "All steps done");

  const presetButtons = presets.map((preset) => {
    const button = create("button", {
      type: "button",
      class: "button button-small",
      id: `${frame.id}-preset-${preset.id}`,
      "aria-pressed": "false",
      text: preset.label,
    });
    button.addEventListener("click", () => {
      active.clear();
      for (const id of preset.toggles ?? []) {
        active.add(id);
      }
      update();
    });
    return { preset, button };
  });

  const scenarioInputs = [...TIMELINE_SCENARIOS].map(([value, label]) => {
    const id = `${frame.id}-scenario-${value}`;
    const input = create("input", { type: "radio", name: `${frame.id}-scenario`, id, value });
    input.addEventListener("change", () => {
      scenario = value;
      update();
    });
    return {
      value,
      input,
      element: create("label", { class: "inline-check", for: id }, input, label),
    };
  });

  const toggleChecks = toggles.map((toggle) => {
    const check = createCheck({
      id: `${frame.id}-toggle-${toggle.id}`,
      label: toggle.label,
      detail: toggle.explanation,
    });
    check.input.addEventListener("change", () => {
      if (check.input.checked) {
        active.add(toggle.id);
      } else {
        active.delete(toggle.id);
      }
      update();
    });
    return { toggle, input: check.input, element: check.element };
  });

  const controls = create("div", { class: "timeline-controls" });
  if (presets.length) {
    controls.append(
      createControlGroup(
        "Presets",
        create(
          "div",
          { class: "segmented" },
          presetButtons.map((item) => item.button),
        ),
      ),
    );
  }
  if (hasDurationRange(config)) {
    controls.append(
      createControlGroup(
        "Speed of the steps that have a measured range",
        create(
          "div",
          { class: "segmented" },
          scenarioInputs.map((item) => item.element),
        ),
      ),
    );
  }
  if (toggles.length) {
    controls.append(
      create(
        "fieldset",
        { class: "control-group" },
        create("legend", { class: "eyebrow", text: "Changes to try" }),
        create(
          "div",
          { class: "timeline-toggles" },
          toggleChecks.map((item) => item.element),
        ),
      ),
    );
  }

  const axis = create("div", { class: "timeline-axis", "aria-hidden": "true" });
  const chart = create(
    "div",
    { class: "timeline-chart" },
    create("div", { class: "timeline-row timeline-axis-row" }, create("div"), axis),
  );
  const rows = listTimelineSteps(config).map((step) => {
    const label = create("span", { class: "timeline-step", text: step.label });
    const lane = create("span");
    const time = create("span");
    const was = create("span", { class: "timeline-was" });
    const bar = create("i", { class: "timeline-bar" });
    const ghost = create("i", { class: "timeline-ghost" });
    const mark = create("i", { class: "timeline-mark" });
    const ghostMark = create("i", { class: "timeline-mark timeline-mark-ghost" });
    const element = create(
      "div",
      { class: "timeline-row" },
      create(
        "div",
        { class: "timeline-info" },
        label,
        create(
          "span",
          { class: "timeline-meta" },
          lane,
          FACT_KINDS.has(step.fact) &&
            create("span", { "data-fact": step.fact }, createFactTag(step.fact)),
          time,
        ),
        was,
      ),
      create(
        "div",
        { class: "timeline-track", "aria-hidden": "true" },
        ghostMark,
        ghost,
        bar,
        mark,
      ),
    );
    chart.append(element);
    return { id: step.id, element, label, lane, time, was, bar, ghost, mark, ghostMark };
  });

  const usedLanes = [...LANES.keys()].filter((lane) => {
    return listTimelineSteps(config).some((step) => step.lane === lane);
  });
  const legend = create(
    "ul",
    { class: "timeline-legend" },
    usedLanes.map((lane) => create("li", {}, createLaneTag(lane))),
    create(
      "li",
      {},
      create("i", { class: "lane-swatch lane-swatch-ghost", "aria-hidden": "true" }),
      `Outline: ${baselineName}`,
    ),
    primaryMilestone &&
      create(
        "li",
        {},
        create("i", { class: "lane-swatch lane-swatch-mark", "aria-hidden": "true" }),
        `Line: ${milestones.find((milestone) => milestone.id === primaryMilestone)?.label ?? ""}`,
      ),
  );

  frame.body.append(readouts);
  // A chart with no preset, no range, and no toggle has no control area.
  if (controls.childNodes.length) {
    frame.body.append(controls);
  }
  frame.body.append(chart, legend);

  const describeDelta = (current, baseline) => {
    const difference = current - baseline;
    if (difference === 0) {
      return { text: `Same as ${baselineName}`, direction: "same" };
    }
    if (difference < 0) {
      return {
        text: `${formatTime(-difference)} sooner than ${baselineName}`,
        direction: "better",
      };
    }
    return { text: `${formatTime(difference)} later than ${baselineName}`, direction: "worse" };
  };

  const getReadoutTime = (result, key) => {
    if (key === "@total") {
      return result.total;
    }
    return result.milestones.find((milestone) => milestone.id === key)?.time ?? 0;
  };

  const update = () => {
    const current = resolveTimeline(config, { toggles: [...active], scenario });
    const baseline = resolveTimeline(config, { toggles: [], scenario });
    const baselineSteps = new Map(baseline.steps.map((step) => [step.id, step]));
    const maximum = Math.max(current.total, baseline.total, 1);
    const tickStep = chooseTickStep(maximum);
    const domain = Math.ceil(maximum / tickStep) * tickStep;
    const percent = (value) => `${(value / domain) * 100}%`;

    chart.style.setProperty("--ticks", String(Math.round(domain / tickStep)));
    const ticks = [];
    for (let value = 0; value <= domain; value += tickStep) {
      const tick = create("span", { class: "timeline-tick", text: formatNumber(value) });
      tick.style.left = percent(value);
      ticks.push(tick);
    }
    axis.replaceChildren(...ticks);

    for (const item of readoutItems) {
      const time = getReadoutTime(current, item.key);
      const delta = describeDelta(time, getReadoutTime(baseline, item.key));
      item.value.replaceChildren(
        formatNumber(time),
        create("span", { class: "readout-unit", text: unit }),
      );
      setText(item.delta, delta.text);
      item.delta.dataset.direction = delta.direction;
    }

    const markTime = primaryMilestone ? getReadoutTime(current, primaryMilestone) : null;
    const ghostMarkTime = primaryMilestone ? getReadoutTime(baseline, primaryMilestone) : null;

    current.steps.forEach((step, index) => {
      const row = rows[index];
      if (!row) return;
      const before = baselineSteps.get(step.id);
      const hadBar = before != null && before.present && !before.removed;
      setHidden(row.element, !step.present);
      if (!step.present) return;
      setText(row.label, step.label);
      row.lane.replaceChildren(createLaneTag(step.lane));
      row.bar.dataset.lane = step.lane;
      row.element.dataset.state = step.removed ? "removed" : "active";
      setHidden(row.bar, step.removed);
      if (!step.removed) {
        row.bar.style.left = percent(step.start);
        row.bar.style.width = percent(step.duration);
      }
      const moved =
        hadBar && (step.removed || before.start !== step.start || before.end !== step.end);
      setHidden(row.ghost, !moved);
      if (moved) {
        row.ghost.style.left = percent(before.start);
        row.ghost.style.width = percent(before.duration);
      }
      setHidden(row.mark, markTime == null);
      setHidden(row.ghostMark, ghostMarkTime == null || ghostMarkTime === markTime);
      if (markTime != null) {
        row.mark.style.left = percent(markTime);
      }
      if (ghostMarkTime != null) {
        row.ghostMark.style.left = percent(ghostMarkTime);
      }

      // The second line says how the step differs from the baseline.
      const was = hadBar
        ? `${baselineName}: ${formatNumber(before.start)} to ${formatTime(before.end)}`
        : "added by a selected change";
      setText(row.was, moved || !hadBar ? was : "");
      if (step.removed) {
        setText(row.time, "removed");
        return;
      }
      setText(
        row.time,
        `${formatNumber(step.start)} to ${formatTime(step.end)} · takes ${formatTime(step.duration)}`,
      );
    });

    for (const { toggle, input } of toggleChecks) {
      input.checked = active.has(toggle.id);
    }
    for (const { value, input } of scenarioInputs) {
      input.checked = value === scenario;
    }
    for (const { preset, button } of presetButtons) {
      const wanted = preset.toggles ?? [];
      const matches = wanted.length === active.size && wanted.every((id) => active.has(id));
      button.setAttribute("aria-pressed", String(matches));
    }

    const on = toggles.filter((toggle) => active.has(toggle.id)).map((toggle) => toggle.label);
    const parts = [];
    if (on.length) {
      parts.push(`${on.length} of ${plural(toggles.length, "change")} on (${on.join("; ")})`);
    } else if (toggles.length) {
      parts.push(`no change on, this is ${baselineName}`);
    } else {
      parts.push(`${plural(rows.length, "step")}, this chart has no change to try`);
    }
    if (hasDurationRange(config)) {
      parts.push(`${TIMELINE_SCENARIOS.get(scenario).toLowerCase()} speed`);
    }
    frame.setState(parts.join(" · "));
  };

  frame.reset.addEventListener("click", () => {
    active.clear();
    scenario = "typical";
    update();
  });
  update();
}

function countDecimals(value) {
  const text = String(value);
  const point = text.indexOf(".");
  return point === -1 ? 0 : text.length - point - 1;
}

function renderCalculator(host, config) {
  const frame = createDemoFrame(host, config);
  const values = new Map(config.inputs.map((input) => [input.id, input.value]));

  const formatInput = (input) => {
    const precision = countDecimals(input.step ?? 1);
    const number = formatNumber(values.get(input.id), precision);
    return input.unit ? `${number} ${input.unit}` : number;
  };

  const sliders = config.inputs.map((input) => {
    const id = `${frame.id}-input-${input.id}`;
    const hintId = `${id}-hint`;
    const range = create("input", {
      type: "range",
      id,
      min: input.min,
      max: input.max,
      step: input.step ?? 1,
      value: input.value,
      "aria-describedby": hintId,
    });
    const readout = create("output", { for: id });
    range.addEventListener("input", () => {
      values.set(input.id, Number(range.value));
      update();
    });
    const element = create(
      "div",
      { class: "slider", "data-term-scope": true },
      create("label", { for: id, text: input.label }),
      readout,
      range,
      create(
        "div",
        { class: "slider-hint", id: hintId },
        input.hint && create("span", { text: input.hint }),
        create("span", { class: "term-slot", "data-term-slot": true }),
      ),
    );
    return { input, range, readout, element };
  });

  const inputIds = sliders.map((slider) => slider.range.id).join(" ");
  const outputs = config.outputs.map((output) => {
    const value = create("output", {
      class: "readout-value",
      id: `${frame.id}-output-${output.id}`,
      for: inputIds,
    });
    const element = create(
      "div",
      { class: "readout" },
      create("span", { class: "readout-label", text: output.label }),
      value,
      output.note && create("span", { class: "readout-note", text: output.note }),
    );
    return { output, value, element };
  });

  frame.body.append(
    create(
      "div",
      { class: "calculator" },
      create(
        "div",
        { class: "calculator-inputs" },
        sliders.map((slider) => slider.element),
      ),
      create(
        "div",
        { class: "calculator-outputs" },
        outputs.map((item) => item.element),
      ),
    ),
  );

  const update = () => {
    for (const slider of sliders) {
      slider.range.value = String(values.get(slider.input.id));
      setText(slider.readout, formatInput(slider.input));
    }
    const results = new Map(
      evaluateCalculator(config, values).map((result) => [result.id, result.value]),
    );
    for (const { output, value } of outputs) {
      const result = results.get(output.id);
      if (result == null) {
        value.replaceChildren("Not defined");
        continue;
      }
      setChildren(
        value,
        formatNumber(result, output.precision ?? 0),
        output.unit && create("span", { class: "readout-unit", text: output.unit }),
      );
    }
    const changed = sliders.filter((slider) => values.get(slider.input.id) !== slider.input.value);
    frame.setState(
      changed.length
        ? `changed: ${changed.map((slider) => `${slider.input.label} ${formatInput(slider.input)}`).join("; ")}`
        : "the start values",
    );
  };

  frame.reset.addEventListener("click", () => {
    for (const input of config.inputs) {
      values.set(input.id, input.value);
    }
    update();
  });
  update();
}

function countWords(element) {
  return element.textContent.trim().split(/\s+/).filter(Boolean).length;
}

function renderCompare(host, config) {
  const sources = [...host.querySelectorAll(":scope > [data-panel]")];
  const frame = createDemoFrame(host, config);
  const unit = config.badge === "words" ? "words" : (config.badgeUnit ?? "");
  let selected = 0;
  let showAll = false;

  const panels = sources.map((source, index) => {
    const label = source.dataset.panel;
    const badge = config.badge === "words" ? countWords(source) : Number(source.dataset.badge);
    const hasBadge = config.badge === "words" || source.dataset.badge != null;
    const badgeText = hasBadge ? `${formatNumber(badge)}${unit ? ` ${unit}` : ""}` : null;
    const tabId = `${frame.id}-tab-${index}`;
    const panelId = `${frame.id}-panel-${index}`;
    const tab = create(
      "button",
      { type: "button", class: "button", role: "tab", id: tabId, "aria-controls": panelId },
      label,
      badgeText && create("span", { class: "compare-badge", text: badgeText }),
    );
    const heading = create(
      "p",
      { class: "compare-panel-label", "data-no-terms": true },
      create("span", { class: "eyebrow", text: label }),
      badgeText && create("span", { text: badgeText }),
    );
    source.removeAttribute("data-panel");
    source.removeAttribute("data-badge");
    source.classList.add("compare-panel");
    source.id = panelId;
    source.setAttribute("role", "tabpanel");
    source.setAttribute("aria-labelledby", tabId);
    source.tabIndex = 0;
    source.prepend(heading);
    return { label, badge: hasBadge ? badge : null, badgeText, tab, heading, element: source };
  });

  const select = (index, focus = false) => {
    selected = (index + panels.length) % panels.length;
    update();
    if (focus) {
      panels[selected].tab.focus();
    }
  };
  panels.forEach((panel, index) => {
    panel.tab.addEventListener("click", () => select(index));
    panel.tab.addEventListener("keydown", (event) => {
      const moves = {
        ArrowRight: index + 1,
        ArrowLeft: index - 1,
        Home: 0,
        End: panels.length - 1,
      };
      if (!Object.hasOwn(moves, event.key)) return;
      event.preventDefault();
      select(moves[event.key], true);
    });
  });

  const allInput = create("input", { type: "checkbox", id: `${frame.id}-all` });
  allInput.addEventListener("change", () => {
    showAll = allInput.checked;
    update();
  });
  const panelList = create(
    "div",
    { class: "compare-panels" },
    panels.map((panel) => panel.element),
  );
  frame.body.append(
    create(
      "div",
      { class: "compare-switch", "data-term-scope": true },
      create(
        "div",
        { class: "segmented", role: "tablist", "aria-label": config.title },
        panels.map((panel) => panel.tab),
      ),
      create("label", { class: "inline-check", for: allInput.id }, allInput, "Show all panels"),
      create("span", { class: "term-slot", "data-term-slot": true }),
    ),
    panelList,
  );

  const update = () => {
    allInput.checked = showAll;
    panelList.dataset.all = String(showAll);
    panels.forEach((panel, index) => {
      const isSelected = index === selected;
      panel.tab.setAttribute("aria-selected", String(isSelected));
      panel.tab.tabIndex = isSelected ? 0 : -1;
      setHidden(panel.element, !showAll && !isSelected);
      setHidden(panel.heading, !showAll);
    });
    const current = panels[selected];
    const first = panels[0];
    const parts = [showAll ? `all ${panels.length} panels shown` : `showing "${current.label}"`];
    if (current.badgeText) {
      parts.push(`${current.label}: ${current.badgeText}`);
    }
    if (current !== first && current.badge != null && first.badge != null) {
      const difference = current.badge - first.badge;
      const amount = `${formatNumber(Math.abs(difference))}${unit ? ` ${unit}` : ""}`;
      if (difference === 0) {
        parts.push(`the same as "${first.label}"`);
      } else {
        parts.push(`${amount} ${difference < 0 ? "fewer" : "more"} than "${first.label}"`);
      }
    }
    frame.setState(parts.join(" · "));
  };

  frame.reset.addEventListener("click", () => {
    selected = 0;
    showAll = false;
    update();
  });
  update();
}

function renderSequence(host, config) {
  const frame = createDemoFrame(host, config);
  const unit = config.unit ?? "";
  const steps = config.steps;
  const hasCost = steps.some((step) => step.cost != null);
  const totalCost = steps.reduce((sum, step) => sum + (step.cost ?? 0), 0);
  // A time between steps that leaves room to read one description.
  const interval = config.interval ?? 1800;
  let current = 0;
  let timer = 0;

  const formatCost = (value) => `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;

  const items = steps.map((step, index) => {
    // The number is the control that shows the step. The row itself is not a
    // control, so the text of the step can hold term triggers.
    const number = create("button", {
      type: "button",
      class: "sequence-number",
      id: `${frame.id}-step-${index + 1}`,
      "aria-label": `Show step ${index + 1}`,
      text: String(index + 1),
    });
    number.addEventListener("click", () => {
      stop();
      current = index;
      update();
    });
    return create(
      "li",
      { class: "sequence-step" },
      number,
      create("span", { text: step.label }),
      create(
        "span",
        { class: "sequence-step-meta" },
        step.lane && createLaneTag(step.lane),
        FACT_KINDS.has(step.fact) &&
          create("span", { "data-fact": step.fact }, createFactTag(step.fact)),
        step.cost != null && create("span", { text: formatCost(step.cost) }),
      ),
    );
  });

  const progress = create("i");
  const title = create("p", { class: "sequence-description-title" });
  const description = create("p");
  const previous = create("button", {
    type: "button",
    class: "button button-small",
    id: `${frame.id}-previous`,
    text: "Previous",
  });
  const next = create("button", {
    type: "button",
    class: "button button-small",
    id: `${frame.id}-next`,
    text: "Next",
  });
  const play = create("button", {
    type: "button",
    class: "button button-small",
    id: `${frame.id}-play`,
    text: "Play",
  });

  const list = create("ol", { class: "sequence-steps", id: `${frame.id}-steps` }, items);
  frame.body.append(
    create(
      "div",
      { class: "sequence" },
      list,
      create(
        "div",
        { class: "sequence-detail" },
        create("div", { class: "sequence-progress", "aria-hidden": "true" }, progress),
        create("div", { class: "sequence-description", "aria-live": "polite" }, title, description),
        create("div", { class: "sequence-buttons" }, previous, next, play),
      ),
    ),
  );

  const stop = () => {
    window.clearInterval(timer);
    timer = 0;
  };

  // A long list scrolls inside its own box, so that the description and the
  // buttons stay beside it. This moves the list only, never the page.
  const keepCurrentInView = () => {
    const item = items[current];
    if (!item) return;
    if (list.scrollHeight <= list.clientHeight) return;
    const box = list.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    if (row.top < box.top) {
      list.scrollTop -= box.top - row.top;
    } else if (row.bottom > box.bottom) {
      list.scrollTop += row.bottom - box.bottom;
    }
  };

  const update = () => {
    const step = steps[current];
    items.forEach((item, index) => {
      if (index === current) {
        item.setAttribute("aria-current", "step");
      } else {
        item.removeAttribute("aria-current");
      }
      item.dataset.state = index < current ? "done" : "todo";
    });
    keepCurrentInView();
    setText(title, `Step ${current + 1} of ${steps.length}: ${step.label}`);
    setText(description, step.description ?? "");
    previous.disabled = current === 0;
    next.disabled = current === steps.length - 1;
    // One step has nothing to play.
    play.disabled = steps.length < 2;
    setText(play, timer ? "Pause" : "Play");
    const used = steps.slice(0, current + 1).reduce((sum, item) => sum + (item.cost ?? 0), 0);
    progress.style.width = `${((current + 1) / steps.length) * 100}%`;
    const parts = [`step ${current + 1} of ${steps.length}`];
    if (hasCost) {
      parts.push(`${formatCost(used)} of ${formatCost(totalCost)} used`);
    }
    parts.push(timer ? "playing" : "paused");
    frame.setState(parts.join(" · "));
  };

  previous.addEventListener("click", () => {
    stop();
    current = Math.max(0, current - 1);
    update();
  });
  next.addEventListener("click", () => {
    stop();
    current = Math.min(steps.length - 1, current + 1);
    update();
  });
  play.addEventListener("click", () => {
    if (timer) {
      stop();
      update();
      return;
    }
    if (current === steps.length - 1) {
      current = 0;
    }
    timer = window.setInterval(() => {
      if (current >= steps.length - 1) {
        stop();
      } else {
        current += 1;
        if (current === steps.length - 1) {
          stop();
        }
      }
      update();
    }, interval);
    update();
  });
  frame.reset.addEventListener("click", () => {
    stop();
    current = 0;
    update();
  });
  update();
}

function getSvgSize(svg) {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0 && box.height > 0) {
    return { width: box.width, height: box.height };
  }
  const width = Number.parseFloat(svg.getAttribute("width"));
  const height = Number.parseFloat(svg.getAttribute("height"));
  if (width > 0 && height > 0) {
    return { width, height };
  }
  return { width: 320, height: 200 };
}

/**
 * Draws an inline SVG at its own size, at the top left corner of a canvas,
 * and returns the pixels of the canvas. The canvas can be larger than the
 * image: the area that the image does not cover stays empty.
 */
function rasterizeSvg(svg, own, canvasSize) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(own.width));
  clone.setAttribute("height", String(own.height));
  const source = new XMLSerializer().serializeToString(clone);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      try {
        const canvas = create("canvas", { width: canvasSize.width, height: canvasSize.height });
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, own.width, own.height);
        resolve(context.getImageData(0, 0, canvasSize.width, canvasSize.height));
      } catch (error) {
        reject(error);
      }
    });
    image.addEventListener("error", () => reject(new Error("The image did not load.")));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });
}

/** Reads a color token as red, green, and blue numbers. */
function readTokenColor(element, token) {
  const probe = create("span", { hidden: true });
  probe.style.color = `var(${token})`;
  element.append(probe);
  const color = window.getComputedStyle(probe).color;
  probe.remove();
  const channels =
    color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number) ?? [];
  return [channels[0] ?? 255, channels[1] ?? 0, channels[2] ?? 255];
}

function renderViewer(host, config) {
  const before = host.querySelector(':scope > svg[data-image="before"]');
  const after = host.querySelector(':scope > svg[data-image="after"]');
  const frame = createDemoFrame(host, config);
  const modes = config.modes ?? [...VIEWER_MODES.keys()];
  const startMode = config.mode ?? modes[0];
  const labels = {
    before: config.labels?.before ?? "Baseline",
    after: config.labels?.after ?? "Candidate",
  };
  const sizes = { before: getSvgSize(before), after: getSvgSize(after) };
  // The stage holds both images at one scale. When the sizes differ, each
  // image starts at the top left corner, as two captures of a page that
  // grew do.
  const size = {
    width: Math.max(sizes.before.width, sizes.after.width),
    height: Math.max(sizes.before.height, sizes.after.height),
  };
  const sameSize =
    sizes.before.width === sizes.after.width && sizes.before.height === sizes.after.height;
  // The diff compares pixels at two times the drawn size, so thin lines count.
  const toPixels = (box) => ({
    width: Math.round(box.width * 2),
    height: Math.round(box.height * 2),
  });
  const pixels = toPixels(size);
  const describeSize = (box) => `${formatNumber(box.width)} × ${formatNumber(box.height)}`;
  const sizeNote = sameSize
    ? ""
    : ` · the sizes differ: ${labels.before} ${describeSize(sizes.before)}, ${labels.after} ${describeSize(sizes.after)}`;
  let mode = startMode;
  let opacity = 50;
  let split = 50;
  let showAfter = false;
  let auto = false;
  let timer = 0;
  let diff = null;
  let diffRequest = 0;

  // Styles are set as properties, not as a style attribute: a strict content
  // security policy can refuse the attribute.
  const cloneImage = (svg, own) => {
    const clone = svg.cloneNode(true);
    clone.removeAttribute("data-image");
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.setAttribute("aria-hidden", "true");
    clone.style.width = `${(own.width / size.width) * 100}%`;
    clone.style.height = `${(own.height / size.height) * 100}%`;
    return clone;
  };
  const createStage = () => {
    const stage = create("div", { class: "viewer-stage" });
    stage.style.aspectRatio = `${size.width} / ${size.height}`;
    stage.style.maxWidth = `${size.width * 2}px`;
    return stage;
  };

  const modeButtons = modes.map((value) => {
    const button = create("button", {
      type: "button",
      class: "button button-small",
      id: `${frame.id}-mode-${value}`,
      "aria-pressed": "false",
      text: VIEWER_MODES.get(value),
    });
    button.addEventListener("click", () => {
      mode = value;
      update();
    });
    return { value, button };
  });

  const createRange = (name, label) => {
    const id = `${frame.id}-${name}`;
    const input = create("input", { type: "range", id, min: 0, max: 100, step: 1 });
    const readout = create("output", { for: id });
    const element = create(
      "div",
      { class: "viewer-option" },
      create("label", { for: id, text: label }),
      readout,
      input,
    );
    return { input, readout, element };
  };
  const opacityControl = createRange(
    "opacity",
    `Opacity of the ${labels.after.toLowerCase()} image`,
  );
  const splitControl = createRange("split", "Divider position");
  opacityControl.input.addEventListener("input", () => {
    opacity = Number(opacityControl.input.value);
    update();
  });
  splitControl.input.addEventListener("input", () => {
    split = Number(splitControl.input.value);
    update();
  });

  const swap = create("button", {
    type: "button",
    class: "button button-small",
    id: `${frame.id}-swap`,
  });
  const autoInput = create("input", { type: "checkbox", id: `${frame.id}-auto` });
  const blinkControl = create(
    "div",
    { class: "segmented" },
    swap,
    create(
      "label",
      { class: "inline-check", for: autoInput.id },
      autoInput,
      "Swap every 0.8 seconds",
    ),
  );
  const display = create("div", { class: "viewer-display" });
  const description = `${labels.before} and ${labels.after} images. ${config.alt ?? ""}`.trim();
  display.setAttribute("role", "img");
  display.setAttribute("aria-label", description);

  frame.body.append(
    create(
      "div",
      { class: "viewer-controls", "data-term-scope": true },
      create(
        "fieldset",
        { class: "control-group" },
        create("legend", { class: "eyebrow", text: "Comparison mode" }),
        create(
          "div",
          { class: "segmented" },
          modeButtons.map((item) => item.button),
        ),
      ),
      opacityControl.element,
      splitControl.element,
      blinkControl,
      create("span", { class: "term-slot", "data-term-slot": true }),
    ),
    display,
  );

  const stopBlink = () => {
    window.clearInterval(timer);
    timer = 0;
  };

  const requestDiff = async () => {
    diffRequest += 1;
    const request = diffRequest;
    try {
      const [first, second] = await Promise.all([
        rasterizeSvg(before, toPixels(sizes.before), pixels),
        rasterizeSvg(after, toPixels(sizes.after), pixels),
      ]);
      const [red, green, blue] = readTokenColor(host, "--diff-mark");
      const image = new ImageData(pixels.width, pixels.height);
      let changed = 0;
      for (let i = 0; i < first.data.length; i += 4) {
        const delta =
          Math.abs(first.data[i] - second.data[i]) +
          Math.abs(first.data[i + 1] - second.data[i + 1]) +
          Math.abs(first.data[i + 2] - second.data[i + 2]) +
          Math.abs(first.data[i + 3] - second.data[i + 3]);
        // Small differences are soft edges, not content. They are not counted.
        if (delta <= 48) continue;
        changed += 1;
        image.data[i] = red;
        image.data[i + 1] = green;
        image.data[i + 2] = blue;
        image.data[i + 3] = 255;
      }
      if (request !== diffRequest) return;
      diff = { image, ratio: changed / (pixels.width * pixels.height) };
    } catch {
      if (request !== diffRequest) return;
      diff = { image: null, ratio: null };
    }
    if (mode === "diff") {
      update();
    }
  };

  // The parts of the current display that change without a rebuild. A drag
  // of the divider must keep the same stage element, or the pointer is lost.
  let view = null;

  const buildDisplay = () => {
    view = { mode, diff };
    display.dataset.mode = mode;
    if (mode === "side-by-side") {
      const frames = [
        [labels.before, before, sizes.before],
        [labels.after, after, sizes.after],
      ].map(([label, svg, own]) => {
        const stage = createStage();
        stage.append(create("div", { class: "viewer-layer" }, cloneImage(svg, own)));
        return create(
          "div",
          { class: "viewer-frame" },
          create("span", { class: "viewer-caption", text: label }),
          stage,
        );
      });
      display.replaceChildren(create("div", { class: "viewer-pair" }, frames));
      return;
    }
    const stage = createStage();
    const lower = create("div", { class: "viewer-layer" }, cloneImage(before, sizes.before));
    const upper = create("div", { class: "viewer-layer" }, cloneImage(after, sizes.after));
    stage.append(lower, upper);
    view.lower = lower;
    view.upper = upper;
    if (mode === "swipe") {
      stage.dataset.swipe = "";
      view.divider = create("i", { class: "viewer-divider" });
      stage.append(
        view.divider,
        create("span", { class: "viewer-corner viewer-corner-start", text: labels.before }),
        create("span", { class: "viewer-corner viewer-corner-end", text: labels.after }),
      );
      const drag = (event) => {
        const box = stage.getBoundingClientRect();
        const ratio = (event.clientX - box.left) / box.width;
        split = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
        update();
      };
      stage.addEventListener("pointerdown", (event) => {
        stage.setPointerCapture(event.pointerId);
        drag(event);
      });
      stage.addEventListener("pointermove", (event) => {
        if (stage.hasPointerCapture(event.pointerId)) {
          drag(event);
        }
      });
    }
    if (mode === "blink") {
      view.corner = create("span", { class: "viewer-corner viewer-corner-start" });
      stage.append(view.corner);
    }
    if (mode === "diff") {
      // The candidate stays visible but dim, so that the marks have context.
      lower.remove();
      upper.dataset.dim = "";
      if (diff?.image) {
        const canvas = create("canvas", { width: pixels.width, height: pixels.height });
        canvas.getContext("2d").putImageData(diff.image, 0, 0);
        stage.append(create("div", { class: "viewer-layer" }, canvas));
      }
    }
    display.replaceChildren(stage);
  };

  const showDisplay = () => {
    const stale = view?.mode !== mode || (mode === "diff" && view.diff !== diff);
    if (stale) {
      buildDisplay();
    }
    if (mode === "overlay") {
      view.upper.style.opacity = String(opacity / 100);
    }
    if (mode === "swipe") {
      // Each side shows one image only, also where the other image is larger.
      view.lower.style.clipPath = `inset(0 ${100 - split}% 0 0)`;
      view.upper.style.clipPath = `inset(0 0 0 ${split}%)`;
      view.divider.style.left = `${split}%`;
    }
    if (mode === "blink") {
      setHidden(view.lower, showAfter);
      setHidden(view.upper, !showAfter);
      setText(view.corner, showAfter ? labels.after : labels.before);
    }
  };

  const describeState = () => {
    const name = VIEWER_MODES.get(mode);
    if (mode === "overlay") {
      return `${name} · ${labels.after.toLowerCase()} image at ${opacity}% opacity`;
    }
    if (mode === "swipe") {
      return `${name} · divider at ${split}% from the left`;
    }
    if (mode === "blink") {
      const shown = showAfter ? labels.after : labels.before;
      return `${name} · showing ${shown.toLowerCase()} · automatic swap ${auto ? "on" : "off"}`;
    }
    if (mode === "diff") {
      if (!diff) {
        return `${name} · comparing the pixels`;
      }
      if (diff.ratio == null) {
        return `${name} · this browser cannot compare the pixels`;
      }
      return `${name} · ${formatNumber(diff.ratio * 100, 1)}% of the pixels differ`;
    }
    return name;
  };

  const update = () => {
    if (mode !== "blink" || !auto) {
      stopBlink();
    }
    if (mode === "diff" && !diff) {
      requestDiff();
    }
    for (const { value, button } of modeButtons) {
      button.setAttribute("aria-pressed", String(value === mode));
    }
    setHidden(opacityControl.element, mode !== "overlay");
    setHidden(splitControl.element, mode !== "swipe");
    setHidden(blinkControl, mode !== "blink");
    opacityControl.input.value = String(opacity);
    splitControl.input.value = String(split);
    setText(opacityControl.readout, `${opacity}%`);
    setText(splitControl.readout, `${split}%`);
    setText(swap, `Show the ${(showAfter ? labels.before : labels.after).toLowerCase()} image`);
    autoInput.checked = auto;
    showDisplay();
    frame.setState(`${describeState()}${sizeNote}`);
  };

  swap.addEventListener("click", () => {
    showAfter = !showAfter;
    update();
  });
  autoInput.addEventListener("change", () => {
    auto = autoInput.checked;
    stopBlink();
    if (auto) {
      // 0.8 seconds is slow enough to stay below three flashes each second.
      timer = window.setInterval(() => {
        showAfter = !showAfter;
        update();
      }, 800);
    }
    update();
  });
  frame.reset.addEventListener("click", () => {
    stopBlink();
    mode = startMode;
    opacity = 50;
    split = 50;
    showAfter = false;
    auto = false;
    update();
  });
  // The diff mark has another color in the light theme.
  new MutationObserver(() => {
    diff = null;
    if (mode === "diff") {
      update();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  update();
}

const DEMO_RENDERERS = new Map([
  ["timeline", renderTimeline],
  ["calculator", renderCalculator],
  ["compare", renderCompare],
  ["sequence", renderSequence],
  ["viewer", renderViewer],
]);

function showDemoError(host, messages) {
  host.classList.add("demo");
  host.replaceChildren(
    create(
      "div",
      { class: "demo-error", role: "alert" },
      create("strong", { text: `This example cannot run (${host.id || "no id"}).` }),
      create(
        "ul",
        {},
        messages.map((message) => create("li", { text: message })),
      ),
    ),
  );
}

function getDemoErrors(host, type, config) {
  const errors = validateDemoConfig(type, config);
  if (!host.id) {
    errors.push('The demo element needs an "id".');
  }
  if (type === "compare" && host.querySelectorAll(":scope > [data-panel]").length < 2) {
    errors.push("A compare demo needs two or more child elements with data-panel.");
  }
  if (type === "viewer") {
    for (const name of ["before", "after"]) {
      if (host.querySelector(`:scope > svg[data-image="${name}"]`)) continue;
      errors.push(`A viewer demo needs a child <svg data-image="${name}">.`);
    }
  }
  return errors;
}

function setupDemos() {
  for (const host of root.querySelectorAll("[data-demo]")) {
    const type = host.dataset.demo;
    const script = host.querySelector(':scope > script[type="application/json"]');
    let config;
    try {
      config = JSON.parse(script?.textContent ?? "");
    } catch (error) {
      showDemoError(host, [`The configuration is not valid JSON: ${error.message}`]);
      continue;
    }
    const errors = getDemoErrors(host, type, config);
    if (errors.length) {
      showDemoError(host, errors);
      continue;
    }
    try {
      DEMO_RENDERERS.get(type)(host, config);
    } catch (error) {
      showDemoError(host, [error.message]);
    }
  }
}

// ---------------------------------------------------------------------------
// Findings explorer

// The number of rows shown before "Show all". It keeps a long table short
// enough to scroll past.
const FINDING_ROW_LIMIT = 40;

const FINDING_COLUMNS = [
  { key: "id", label: "ID" },
  { key: "title", label: "Finding" },
  { key: "area", label: "Area" },
  { key: "kind", label: "Kind" },
  { key: "severity", label: "Severity" },
  { key: "verdict", label: "Verdict" },
  { key: "measured", label: "Measured" },
  { key: "effort", label: "Effort" },
];

function createFindingRow(finding) {
  // "section" can name a section or an element inside one.
  const target = finding.section ? document.getElementById(finding.section) : null;
  const sectionTitle = target?.closest("main > section")?.dataset.title;
  const cell = (column, label, ...children) => {
    return create("td", { "data-column": column, "data-label": label }, children);
  };
  return create(
    "tr",
    { id: `finding-${finding.id}`, tabindex: -1 },
    cell("id", null, create("span", { class: "finding-id", text: finding.id })),
    cell(
      "title",
      null,
      create("span", { class: "finding-title", text: finding.title }),
      finding.summary && create("span", { class: "finding-summary", text: finding.summary }),
      sectionTitle &&
        create("a", {
          class: "finding-link",
          href: `#${finding.section}`,
          text: `Section: ${sectionTitle}`,
        }),
    ),
    cell("area", "Area", finding.area),
    cell("kind", "Kind", finding.kind),
    cell("severity", null, createSeverity(finding.severity)),
    cell("verdict", null, VERDICTS.get(finding.verdict) ?? finding.verdict),
    cell("measured", "Measured", describeMeasured(finding.measured)),
    cell("effort", "Effort", finding.effort ?? ""),
  );
}

function setupFindingsExplorer() {
  const placeholder = root.querySelector('[data-engine="findings-explorer"]');
  if (!placeholder) return null;
  const findings = data.findings;
  const filters = { text: "", area: "", severity: "", kind: "", verdict: "" };
  const sort = { key: "", descending: false };
  let showAll = false;

  const rows = new Map(findings.map((finding) => [finding.id, createFindingRow(finding)]));
  const body = create("tbody", {}, [...rows.values()]);

  const search = create("input", {
    type: "search",
    class: "input",
    id: "findings-filter-text",
    placeholder: "Words in the ID, title, or summary",
    autocomplete: "off",
  });
  search.addEventListener("input", () => {
    filters.text = search.value;
    update();
  });

  const createSelect = (key, label, values) => {
    const id = `findings-filter-${key}`;
    const select = create(
      "select",
      { class: "input", id },
      create("option", { value: "", text: "All" }),
    );
    for (const [value, text] of values) {
      const count = findings.filter((finding) => finding[key] === value).length;
      select.append(create("option", { value, text: `${text} (${count})` }));
    }
    select.addEventListener("change", () => {
      filters[key] = select.value;
      update();
    });
    return {
      key,
      select,
      element: create(
        "div",
        { class: "field" },
        create("label", { class: "field-label", for: id, text: label }),
        select,
      ),
    };
  };
  const distinct = (key) => {
    const values = [...new Set(findings.map((finding) => finding[key]).filter(Boolean))];
    return values
      .sort((first, second) => first.localeCompare(second))
      .map((value) => [value, value]);
  };
  const known = (key, vocabulary) => {
    return [...vocabulary].filter(([value]) => findings.some((finding) => finding[key] === value));
  };
  const selects = [
    createSelect("area", "Area", distinct("area")),
    createSelect("severity", "Severity", known("severity", SEVERITIES)),
    createSelect("kind", "Kind", distinct("kind")),
    createSelect("verdict", "Verdict", known("verdict", VERDICTS)),
  ];

  const count = create("p", { id: "findings-count", role: "status" });
  const reset = create("button", {
    type: "button",
    class: "button button-small",
    id: "findings-reset",
    text: "Reset filters and order",
  });
  const sortSelect = create(
    "select",
    { class: "input", id: "findings-sort" },
    create("option", { value: "", text: "Document order" }),
    FINDING_COLUMNS.map((column) => create("option", { value: column.key, text: column.label })),
  );
  sortSelect.addEventListener("change", () => {
    sort.key = sortSelect.value;
    sort.descending = false;
    update();
  });

  const headers = FINDING_COLUMNS.map((column) => {
    const button = create(
      "button",
      { type: "button", class: "sort-button", id: `findings-sort-${column.key}` },
      column.label,
      create("span", { class: "sort-arrow", "aria-hidden": "true" }),
    );
    button.addEventListener("click", () => {
      sort.descending = sort.key === column.key && !sort.descending;
      sort.key = column.key;
      update();
    });
    return { column, element: create("th", { scope: "col", "aria-sort": "none" }, button) };
  });

  const table = create(
    "table",
    { class: "explorer-table" },
    create("caption", { class: "visually-hidden", text: "Verified findings" }),
    create(
      "thead",
      {},
      create(
        "tr",
        {},
        headers.map((header) => header.element),
      ),
    ),
    body,
  );
  const scroller = create("div", { class: "table-scroll" }, table);
  watchOverflow(scroller, "Findings table. Scroll sideways to read it.");
  const empty = create("p", {
    class: "explorer-empty",
    text: "No finding matches these filters. Reset the filters to see every finding.",
    hidden: true,
  });
  const more = create("button", { type: "button", class: "button", id: "findings-more" });
  more.addEventListener("click", () => {
    showAll = !showAll;
    update();
  });
  const moreRow = create("div", { class: "explorer-more" }, more);

  const explorer = create(
    "div",
    { class: "explorer engine-block", id: "findings-explorer" },
    findings.some((finding) => finding.sample) &&
      create("p", {}, createSampleFlag("Some rows are sample findings. Replace findings.json.")),
    create(
      "div",
      { class: "explorer-filters", "data-term-scope": true },
      create(
        "div",
        { class: "field explorer-search" },
        create("label", { class: "field-label", for: search.id, text: "Find in the findings" }),
        search,
      ),
      selects.map((item) => item.element),
      create("span", { class: "term-slot", "data-term-slot": true }),
    ),
    create(
      "div",
      { class: "explorer-status" },
      count,
      create(
        "div",
        { class: "explorer-sort" },
        create("label", { class: "field-label", for: sortSelect.id, text: "Order" }),
        sortSelect,
      ),
      reset,
    ),
    scroller,
    empty,
    moreRow,
  );

  let lastOrder = "";
  const update = () => {
    const matching = findings.filter((finding) => matchesFindingFilters(finding, filters));
    if (sort.key) {
      const direction = sort.descending ? -1 : 1;
      matching.sort((first, second) => direction * compareFindings(first, second, sort.key));
    }
    // Rows move only when the order changes. A filter only hides rows.
    const order = `${sort.key}:${sort.descending}`;
    if (order !== lastOrder) {
      lastOrder = order;
      const sorted = sort.key
        ? [...findings].sort((first, second) => {
            return (sort.descending ? -1 : 1) * compareFindings(first, second, sort.key);
          })
        : findings;
      body.append(...sorted.map((finding) => rows.get(finding.id)));
    }
    const visible = new Set(
      (showAll ? matching : matching.slice(0, FINDING_ROW_LIMIT)).map((finding) => finding.id),
    );
    for (const [id, row] of rows) {
      setHidden(row, !visible.has(id));
    }
    for (const { column, element } of headers) {
      const state =
        sort.key === column.key ? (sort.descending ? "descending" : "ascending") : "none";
      element.setAttribute("aria-sort", state);
    }
    sortSelect.value = sort.key;
    search.value = filters.text;
    for (const { key, select } of selects) {
      select.value = filters[key];
    }
    count.replaceChildren(
      create("strong", { text: formatNumber(visible.size) }),
      ` of ${plural(findings.length, "finding")} shown`,
      matching.length !== findings.length
        ? ` · ${formatNumber(matching.length)} match the filters`
        : "",
    );
    setHidden(scroller, matching.length === 0);
    setHidden(empty, matching.length !== 0);
    setHidden(moreRow, matching.length <= FINDING_ROW_LIMIT);
    setText(
      more,
      showAll ? `Show the first ${FINDING_ROW_LIMIT} only` : `Show all ${matching.length} findings`,
    );
  };

  const resetAll = () => {
    filters.text = "";
    for (const { key } of selects) {
      filters[key] = "";
    }
    sort.key = "";
    sort.descending = false;
    update();
  };
  reset.addEventListener("click", resetAll);

  placeholder.replaceWith(explorer);
  update();

  /** Makes one finding row visible, for a link that points to it. */
  const reveal = (id) => {
    const row = rows.get(id);
    if (!row) return;
    if (!row.hidden) return;
    const finding = findingsById.get(id);
    if (!matchesFindingFilters(finding, filters)) {
      resetAll();
    }
    if (row.hidden) {
      showAll = true;
      update();
    }
  };
  return { reveal };
}

// ---------------------------------------------------------------------------
// Decision record and continuation prompt

function setupDecisionRecord(store) {
  const placeholder = root.querySelector('[data-engine="decision-record"]');
  if (!placeholder) return;
  const updates = [];
  const block = create("div", { class: "engine-block", id: "decision-record-list" });
  const groups = [
    ["open", "Open decisions"],
    ["settled", "Settled decisions"],
    ["rejected", "Rejected decisions"],
  ];
  for (const [status, title] of groups) {
    const decisions = data.decisions.filter((decision) => decision.status === status);
    const list = create("ul", { class: "record-list" });
    for (const decision of decisions) {
      const state = createStateBadge();
      const answer = create("p");
      const notes = create("p", { class: "small muted" });
      const recommended = decision.options
        .filter((option) => option.recommended)
        .map((option) => option.label);
      const recordLines = [];
      if (status === "open") {
        recordLines.push(
          recommended.length
            ? `Open. Recommended: ${recommended.join("; ")}.`
            : "Open. No recommendation yet.",
        );
      } else {
        recordLines.push(
          decision.settledAnswer
            ? `${DECISION_STATUSES.get(status)}: ${decision.settledAnswer}`
            : `${DECISION_STATUSES.get(status)}.`,
        );
      }
      list.append(
        create(
          "li",
          { class: "record-item" },
          create(
            "div",
            { class: "record-grid" },
            create(
              "div",
              {},
              create("a", {
                class: "finding-id",
                href: `#decision-${decision.id}`,
                text: decision.id,
              }),
              create("p", { class: "record-question", text: decision.question }),
            ),
            create(
              "div",
              {},
              create("span", { class: "record-label", text: "In the record" }),
              recordLines.map((line) => create("p", { text: line })),
              decision.rationale && create("p", { class: "muted", text: decision.rationale }),
            ),
            create(
              "div",
              {},
              create("span", { class: "record-label", text: "Your answer now" }),
              create("div", { class: "decision-evidence" }, state.badge, state.changed),
              answer,
              notes,
            ),
          ),
        ),
      );
      updates.push(() => {
        const current = getDecisionStatus(store.getState(), decision);
        state.update(current);
        setText(answer, current.option ? current.option.label : "No option selected.");
        setText(notes, current.notes.trim() ? "Has notes." : "No notes.");
      });
    }
    block.append(
      create(
        "div",
        { class: "record-group" },
        create(
          "p",
          { class: "record-group-title" },
          title,
          create("span", { class: "record-count", text: String(decisions.length) }),
        ),
        decisions.length
          ? list
          : create("p", { class: "record-empty", text: "None in this revision." }),
      ),
    );
  }
  const update = () => {
    for (const run of updates) {
      run();
    }
  };
  placeholder.replaceWith(block);
  update();
  store.subscribe(update);
}

function setupPrompt(store) {
  const getPrompt = () => {
    return buildContinuationPrompt({
      record: data.record,
      decisions: data.decisions,
      state: store.getState(),
    });
  };
  const barStatus = document.getElementById("bar-status");
  const fallback = document.getElementById("copy-fallback");
  const fallbackText = document.getElementById("copy-fallback-text");
  const fallbackHelp = document.getElementById("copy-fallback-help");
  let statusTimer = 0;

  const announce = (text) => {
    window.clearTimeout(statusTimer);
    setText(barStatus, text);
    statusTimer = window.setTimeout(() => setText(barStatus, ""), 8000);
  };
  const closeFallback = () => {
    setHidden(fallback, true);
  };
  const describeUpdates = () => {
    const changed = getChangedDecisions(store.getState(), data.decisions);
    if (!changed.length) {
      return "It says that no decision changed in this round.";
    }
    return `It has ${plural(changed.length, "updated decision")}: ${changed.map((decision) => decision.id).join(", ")}.`;
  };

  const copy = async ({ button, text, name, copiedMessage }) => {
    const copied = await copyText(text);
    if (copied) {
      closeFallback();
      announce(copiedMessage);
      return;
    }
    // The browser blocked the copy. Show the text, selected, for a manual copy.
    fallbackText.value = text;
    setText(document.getElementById("copy-fallback-title"), `Copy the ${name} by hand`);
    setText(
      fallbackHelp,
      `The browser blocked the copy. The ${name} is selected below. Press Ctrl+C or Cmd+C to copy it.`,
    );
    setHidden(fallback, false);
    fallbackText.focus();
    fallbackText.select();
    fallbackText.scrollTop = 0;
    announce(`The browser blocked the copy. Copy the selected ${name} by hand.`);
    fallback.dataset.opener = button.id;
  };
  const copyPrompt = (button) => {
    return copy({
      button,
      text: getPrompt(),
      name: "prompt",
      copiedMessage: `Prompt copied. ${describeUpdates()} Share it with the agent to continue.`,
    });
  };

  document.getElementById("copy-prompt-button").addEventListener("click", (event) => {
    copyPrompt(event.currentTarget);
  });
  document.getElementById("copy-fallback-close").addEventListener("click", () => {
    closeFallback();
    document.getElementById(fallback.dataset.opener ?? "")?.focus();
  });
  fallback.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeFallback();
    document.getElementById(fallback.dataset.opener ?? "")?.focus();
  });

  const placeholder = root.querySelector('[data-engine="continuation-prompt"]');
  if (!placeholder) return;
  const summary = create("p", { class: "prompt-summary", id: "prompt-summary" });
  const preview = create("textarea", {
    class: "input prompt-text",
    id: "prompt-text",
    rows: 20,
    readonly: true,
    spellcheck: "false",
  });
  const secondCopy = create("button", {
    type: "button",
    class: "button button-primary",
    id: "copy-prompt-button-preview",
    text: "Copy continuation prompt",
  });
  secondCopy.addEventListener("click", () => copyPrompt(secondCopy));
  const selectAll = create("button", {
    type: "button",
    class: "button",
    id: "select-prompt-button",
    text: "Select the prompt text",
  });
  selectAll.addEventListener("click", () => {
    preview.focus();
    preview.select();
  });
  const storageNote = create("p", { class: "storage-note", id: "storage-note" });

  // The prompt names the record by its location. This copy is for an agent
  // that cannot open that location.
  const getExport = () => {
    return buildRecordExport({
      record: data.record,
      decisions: data.decisions,
      state: store.getState(),
    });
  };
  const exportText = create("textarea", {
    class: "input prompt-text",
    id: "record-export-text",
    rows: 12,
    readonly: true,
    spellcheck: "false",
  });
  const exportCopy = create("button", {
    type: "button",
    class: "button",
    id: "copy-record-button",
    text: "Copy the complete record",
  });
  exportCopy.addEventListener("click", () => {
    copy({
      button: exportCopy,
      text: getExport(),
      name: "record",
      copiedMessage: "Complete record copied. Give it to the agent with the prompt.",
    });
  });
  const portable = create(
    "details",
    { class: "prompt-portable", id: "record-export" },
    create("summary", { text: "Portable copy of the complete record" }),
    create("p", {
      class: "small muted",
      text: "The prompt points to the record by its artifact link and its file path. If the agent cannot open them, give it this copy with the prompt. It holds every decision, also the ones that did not change.",
    }),
    create("div", { class: "prompt-actions" }, exportCopy),
    create(
      "div",
      { class: "field", "data-no-terms": true },
      create("label", { class: "field-label", for: exportText.id, text: "Complete record" }),
      exportText,
    ),
  );

  const block = create(
    "div",
    { class: "prompt engine-block" },
    storageNote,
    summary,
    create("div", { class: "prompt-actions" }, secondCopy, selectAll),
    create(
      "div",
      { class: "field", "data-no-terms": true },
      create("label", {
        class: "field-label",
        for: preview.id,
        text: "Continuation prompt preview",
      }),
      preview,
    ),
    portable,
  );
  const update = () => {
    const state = store.getState();
    const changed = getChangedDecisions(state, data.decisions);
    preview.value = getPrompt();
    exportText.value = getExport();
    setText(
      summary,
      changed.length
        ? `This feedback round has ${plural(changed.length, "updated decision")}: ${changed.map((decision) => decision.id).join(", ")}. The prompt lists only these.`
        : "No decision changed in this feedback round. The prompt says so.",
    );
    setText(
      storageNote,
      store.isSaved()
        ? "Your selections and notes are saved in this browser only, in local storage. They reach the agent only when you copy the continuation prompt and share it. A copy does not change what is saved: the same updates stay in the prompt until an agent merges them and publishes a new revision."
        : "This browser blocks local storage, so your selections and notes are not saved. They are lost when you close or reload the page. Copy the continuation prompt and share it before you leave.",
    );
  };
  placeholder.replaceWith(block);
  update();
  store.subscribe(update);
}

// ---------------------------------------------------------------------------
// Navigation

const menus = [];

function setupMenu(button, panel) {
  const getItems = () => [...panel.querySelectorAll("a[href], button")];
  const isOpen = () => !panel.hidden;
  const close = (focusButton = false) => {
    if (!isOpen()) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (focusButton) {
      button.focus();
    }
  };
  const open = (focusFirst = false) => {
    for (const menu of menus) {
      if (menu.close !== close) {
        menu.close();
      }
    }
    document.getElementById("copy-fallback").hidden = true;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    if (focusFirst) {
      getItems()[0]?.focus();
    }
  };
  menus.push({ close });

  button.addEventListener("click", (event) => {
    if (isOpen()) {
      close();
      return;
    }
    // A click with no pointer press comes from Enter or Space. Focus then
    // moves into the menu. Without that, the next Tab goes to the control
    // after the button, not to the first entry.
    open(event.detail === 0);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    open(true);
  });
  panel.addEventListener("keydown", (event) => {
    const items = getItems();
    const index = items.indexOf(document.activeElement);
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
    if (!Object.hasOwn(moves, event.key)) return;
    event.preventDefault();
    items[(moves[event.key] + items.length) % items.length]?.focus();
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("a[href]")) {
      close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!isOpen()) return;
    close(panel.contains(document.activeElement) || document.activeElement === button);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!isOpen()) return;
    if (panel.contains(event.target)) return;
    if (button.contains(event.target)) return;
    close();
  });
  // Focus that leaves the menu with Tab closes it.
  panel.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (!next) return;
    if (panel.contains(next)) return;
    if (next === button) return;
    close();
  });
}

function setupNavigation(store) {
  const sections = getSections();
  const decisionSections = new Map();
  for (const decision of data.decisions) {
    const section = document.getElementById(`decision-${decision.id}`)?.closest("main > section");
    if (section) {
      decisionSections.set(decision.id, section.id);
    }
  }
  const updates = [];

  // One row of an index: the link, and a line for the terms of its label.
  // The line keeps the triggers outside the link and keeps the rows aligned.
  const createRow = (link) => {
    return create(
      "li",
      { "data-term-scope": true },
      link,
      create("span", { class: "term-slot", "data-term-slot": "Terms: " }),
    );
  };

  const createSectionLinks = (linkClass, metaClass) => {
    return sections.map((section) => {
      const meta = create("span", { class: metaClass });
      const link = create(
        "a",
        { class: linkClass, href: `#${section.id}` },
        create("span", { text: section.dataset.title }),
        meta,
      );
      const decisions = data.decisions.filter(
        (decision) => decisionSections.get(decision.id) === section.id,
      );
      if (decisions.length) {
        updates.push(() => {
          const answered = countAnswered(store.getState(), decisions);
          setText(meta, `${answered} / ${decisions.length} answered`);
        });
      }
      return { section, link, item: createRow(link) };
    });
  };

  const sidebarLinks = createSectionLinks("sidebar-link", "sidebar-meta");
  document.getElementById("sidebar").append(
    create("p", { class: "eyebrow", text: "Sections" }),
    create(
      "ul",
      { class: "sidebar-list" },
      sidebarLinks.map((entry) => entry.item),
    ),
  );

  const menuLinks = createSectionLinks("menu-item", "menu-item-meta");
  const sectionsMenu = document.getElementById("sections-menu");
  sectionsMenu.append(
    create(
      "ul",
      { class: "menu-list" },
      menuLinks.map((entry) => entry.item),
    ),
  );
  setupMenu(document.getElementById("sections-button"), sectionsMenu);

  const decisionsMenu = document.getElementById("decisions-menu");
  const decisionItems = data.decisions.map((decision) => {
    const state = create("span");
    const meta = create(
      "span",
      { class: "menu-item-meta menu-item-state" },
      create("span", { class: "state-dot", "aria-hidden": "true" }),
      state,
    );
    const link = create(
      "a",
      { class: "menu-item menu-item-decision", href: `#decision-${decision.id}` },
      create("span", { class: "menu-item-id", text: decision.id }),
      create("span", { class: "menu-item-label", text: decision.short ?? decision.question }),
      meta,
    );
    // The state in the record is separate from the answer of the maintainer.
    const recorded =
      decision.status === "open"
        ? null
        : `${(DECISION_STATUSES.get(decision.status) ?? decision.status).toLowerCase()} in the record`;
    updates.push(() => {
      const status = getDecisionStatus(store.getState(), decision);
      const parts = [status.answered ? "Answered" : "Open"];
      if (status.changed) {
        parts.push("changed");
      }
      if (recorded) {
        parts.push(recorded);
      }
      meta.dataset.answered = String(status.answered);
      setText(state, parts.join(" · "));
    });
    return createRow(link);
  });
  decisionsMenu.append(
    decisionItems.length
      ? create("ul", { class: "menu-list" }, decisionItems)
      : create("p", { class: "menu-heading", text: "This revision has no decisions." }),
  );
  setupMenu(document.getElementById("decisions-button"), decisionsMenu);

  const count = document.getElementById("answered-count");
  const mastheadCount = create("dd");
  const createMeta = (label, value) => {
    return create("div", {}, create("dt", { text: label }), value);
  };
  if (data.record.date) {
    document
      .getElementById("masthead-meta")
      .append(createMeta("Date", create("dd", { text: data.record.date })));
  }
  document
    .getElementById("masthead-meta")
    .append(
      createMeta("Findings", create("dd", { text: formatNumber(data.findings.length) })),
      createMeta("Decisions", mastheadCount),
    );
  updates.push(() => {
    const answered = countAnswered(store.getState(), data.decisions);
    const total = data.decisions.length;
    count.replaceChildren(create("strong", { text: `${answered} / ${total}` }), " answered");
    setText(mastheadCount, `${answered} / ${total} answered`);
  });

  const update = () => {
    for (const run of updates) {
      run();
    }
  };
  update();
  store.subscribe(update);

  // Mark the section that is at the top of the reading area.
  const bar = document.getElementById("bar");
  const sidebar = document.getElementById("sidebar");
  let frameRequest = 0;
  let marked = null;
  // A long index scrolls inside the sidebar. This moves the sidebar only,
  // never the page, so that the marked link stays in view.
  const keepMarkedLinkInView = () => {
    const index = sidebarLinks.findIndex((entry) => entry.section === marked);
    // At the top of the page and in the first section, the index shows its
    // start, with its heading.
    if (index <= 0) {
      sidebar.scrollTop = 0;
      return;
    }
    const link = sidebarLinks[index]?.link;
    if (!link) return;
    if (sidebar.scrollHeight <= sidebar.clientHeight) return;
    const box = sidebar.getBoundingClientRect();
    const row = link.getBoundingClientRect();
    if (row.top < box.top) {
      sidebar.scrollTop -= box.top - row.top;
    } else if (row.bottom > box.bottom) {
      sidebar.scrollTop += row.bottom - box.bottom;
    }
  };
  const markCurrentSection = () => {
    frameRequest = 0;
    const line = bar.getBoundingClientRect().bottom + 32;
    let current = null;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= line) {
        current = section;
      }
    }
    if (current === marked) return;
    marked = current;
    for (const entry of [...sidebarLinks, ...menuLinks]) {
      if (entry.section === current) {
        entry.link.setAttribute("aria-current", "location");
      } else {
        entry.link.removeAttribute("aria-current");
      }
    }
    keepMarkedLinkInView();
  };
  const requestMark = () => {
    if (frameRequest) return;
    frameRequest = window.requestAnimationFrame(markCurrentSection);
  };
  window.addEventListener("scroll", requestMark, { passive: true });
  window.addEventListener("resize", requestMark);
  markCurrentSection();
}

const flash = { element: null, timer: 0 };

/**
 * Shows a short outline at the target of a jump. A section is taller than
 * the screen, so its heading gets the outline. One outline shows at a time.
 */
function flashTarget(target) {
  window.clearTimeout(flash.timer);
  flash.element?.classList.remove("target-flash");
  const heading = target.matches("main > section") ? target.querySelector(":scope > h2") : null;
  flash.element = heading ?? target;
  flash.element.classList.add("target-flash");
  // Long enough to see where the jump went, short enough to be gone when
  // the reader starts to read.
  flash.timer = window.setTimeout(() => {
    flash.element?.classList.remove("target-flash");
    flash.element = null;
  }, 1600);
}

/**
 * Jumps to an element by id, below the sticky bar, and moves focus there.
 * Returns `false` when the page has no such element.
 */
function goTo(id, explorer) {
  if (id.startsWith("finding-")) {
    explorer?.reveal(id.slice(8));
  }
  const target = document.getElementById(id);
  if (!target) return false;
  if (!root.contains(target)) return false;
  // A target inside a closed details element has no position. Open it first.
  let details = target.closest("details");
  while (details) {
    details.open = true;
    details = details.parentElement?.closest("details") ?? null;
  }
  target.scrollIntoView({ block: "start", behavior: "auto" });
  if (!target.matches("a[href], button, input, select, textarea, [tabindex]")) {
    target.tabIndex = -1;
  }
  target.focus({ preventScroll: true });
  flashTarget(target);
  try {
    window.history.replaceState(null, "", `#${id}`);
  } catch {
    // The host frame can refuse a history change. The jump still worked.
  }
  return true;
}

function setupAnchors(explorer) {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    if (!isElement(event.target)) return;
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = decodeURIComponent(link.getAttribute("href").slice(1));
    if (!id) return;
    if (goTo(id, explorer)) {
      event.preventDefault();
    }
  });
  const fromHash = () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) {
      goTo(id, explorer);
    }
  };
  window.addEventListener("hashchange", fromHash);
  if (!window.location.hash) return;
  // The targets exist only after the engine has rendered. Jump again when the
  // fonts have loaded, because they change the height of the text above.
  window.requestAnimationFrame(fromHash);
  document.fonts?.ready.then(fromHash);
}

/**
 * Reports the state of the term rules, for check.mjs. Every list must be
 * empty: no trigger inside a control, no term without a trigger, no label
 * term without a trigger beside it, and no code block with changed text.
 */
function checkTerms() {
  const insideControls = [];
  for (const trigger of root.querySelectorAll(".term")) {
    const control = trigger.parentElement.closest(
      `${LABEL_CONTROL_SELECTOR}, input, select, textarea`,
    );
    if (control) {
      insideControls.push(trigger.textContent);
    }
  }
  const missed = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest(`${NO_TERMS_SELECTOR}, pre`)) continue;
    if (terms.find(node.data).length) {
      missed.push(node.data.trim().slice(0, 80));
    }
  }
  const uncoveredLabels = [];
  for (const control of root.querySelectorAll(LABEL_CONTROL_SELECTOR)) {
    if (control.closest("[data-no-terms], pre, .term")) continue;
    const scope = control.closest("[data-term-scope]");
    const block =
      scope ?? control.parentElement?.closest(TEXT_BLOCK_SELECTOR) ?? control.parentElement;
    const label = getLabelText(control);
    for (const match of terms.find(label)) {
      if (hasTrigger(block, `term:${match.entry}`)) continue;
      uncoveredLabels.push(label.trim().slice(0, 80));
    }
  }
  const uncoveredDrawings = [];
  for (const drawing of root.querySelectorAll(DRAWING_SELECTOR)) {
    if (drawing.closest(`[data-no-terms], .viewer-display, ${LABEL_CONTROL_SELECTOR}`)) continue;
    const block = getDrawingBlock(drawing);
    const text = getDrawingText(drawing);
    for (const match of terms.find(text)) {
      if (block && hasTrigger(block, `term:${match.entry}`)) continue;
      uncoveredDrawings.push(text.trim().slice(0, 80));
    }
  }
  const changedCode = [];
  for (const code of root.querySelectorAll("pre > code")) {
    const source = codeSources.get(code)?.source;
    if (source != null && code.textContent !== source) {
      changedCode.push(source.slice(0, 80));
    }
  }
  return {
    triggers: root.querySelectorAll(".term").length,
    insideControls,
    missed,
    uncoveredLabels,
    uncoveredDrawings,
    changedCode,
  };
}

function watchBarHeight() {
  const bar = document.getElementById("bar");
  // The value goes on the root element, because the scroll padding of the
  // page reads it there.
  const update = () => {
    document.documentElement.style.setProperty(
      "--bar-height",
      `${Math.ceil(bar.getBoundingClientRect().height)}px`,
    );
  };
  new ResizeObserver(update).observe(bar);
  update();
}

function loadFonts() {
  document.head.append(create("link", { rel: "stylesheet", href: FONT_STYLESHEET }));
}

function start() {
  const started = performance.now();
  loadFonts();
  watchBarHeight();
  const store = createFeedbackStore();
  markSamples();
  setupExternalLinks();
  setupExplicitTerms();
  setupFacts();
  setupFindingCallouts();
  setupDecisions(store);
  setupDemos();
  const explorer = setupFindingsExplorer();
  setupDecisionRecord(store);
  setupPrompt(store);
  wrapTables();
  setupCodeBlocks();
  setupNavigation(store);
  // One pass over the finished page. The observer covers later changes.
  const termsStarted = performance.now();
  annotateTerms(root);
  ensureLabelTermsIn(root);
  ensureDrawingTermsIn(root);
  const termsEnded = performance.now();
  observeTerms();
  setupTooltips();
  setupAnchors(explorer);
  // check.mjs waits for the attribute below and reads this report. The
  // times are in milliseconds: the whole start, and the term pass in it.
  window.visonautAudit = {
    checkTerms,
    timings: {
      start: Math.round(performance.now() - started),
      terms: Math.round(termsEnded - termsStarted),
    },
  };
  root.dataset.ready = "true";
}

start();

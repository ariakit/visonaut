#!/usr/bin/env node
// Builds the Visonaut audit document from the engine and the content files.
//
//   node apps/lab/audit/build.mjs            Validate, then write both outputs.
//   node apps/lab/audit/build.mjs --check    Validate only. Write nothing.
//   node apps/lab/audit/build.mjs --strict   Also fail when sample content remains.
//   node apps/lab/audit/build.mjs --content <dir> --out <dir>
//                                            Read another content folder and
//                                            write both outputs to one folder.
//                                            For a draft that must not replace
//                                            the shared outputs.
//
// Outputs:
//   dist/visonaut-audit.html       The Artifact source: no doctype, html, head,
//                                  or body. It starts with <title> and <style>.
//   ../public/audit/index.html     A standalone copy for local use.
//   With --out <dir>: <dir>/visonaut-audit.html and <dir>/index.html.
//
// The script has no dependencies. See AUTHORING.md for the content formats.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODE_LANGUAGES,
  DECISION_STATUSES,
  DEMO_TYPES,
  ENGINE_BLOCKS,
  FACT_KINDS,
  SEVERITIES,
  VERDICTS,
  compileTerms,
  validateDemoConfig,
} from "./engine/core.js";

const here = dirname(fileURLToPath(import.meta.url));
const enginePath = join(here, "engine");

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const contentOption = readOption("--content");
const outOption = readOption("--out");
const contentPath = contentOption ? resolve(contentOption) : join(here, "content");
const artifactFile = outOption
  ? join(resolve(outOption), "visonaut-audit.html")
  : join(here, "dist", "visonaut-audit.html");
const standaloneFile = outOption
  ? join(resolve(outOption), "index.html")
  : join(here, "..", "public", "audit", "index.html");

// The Artifact host loads scripts only from a short list of hosts. The
// integrity value is the SHA-512 of this exact file.
const HIGHLIGHT_SCRIPT = {
  src: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js",
  integrity:
    "sha512-EBLzUL8XLl+va/zAsmXwS7Z2B1F9HUHkZwyS/VKwh3S7T/U0nF4BaU29EP/ZSf6zgiIxYAnKLu6bJ8dqpmX5uw==",
};

// The Artifact host refuses a page above 16 MB.
const SIZE_LIMIT = 16 * 1024 * 1024;

// Letters, digits, and . _ ~ - are the only characters that reach
// location.hash in the Artifact host.
const ANCHOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

// The engine makes ids with these prefixes. An author id must not use them.
const RESERVED_ID_PREFIXES = [
  "decision-",
  "finding-",
  "findings-",
  "term-definition-",
  "code-copy-",
];

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

// A browser ends an open <p> when one of these starts. The result is never
// what the author wrote, so the build rejects it.
const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

// The parents that a part of a table can have. A browser moves or drops a
// part that is in another place, and it does so without a message.
const TABLE_PARENTS = new Map([
  ["caption", ["table"]],
  ["colgroup", ["table"]],
  ["col", ["colgroup"]],
  ["thead", ["table"]],
  ["tbody", ["table"]],
  ["tfoot", ["table"]],
  ["tr", ["thead", "tbody", "tfoot", "table"]],
  ["td", ["tr"]],
  ["th", ["tr"]],
]);

// The children that these parts of a table can have.
const TABLE_CHILDREN = new Map([
  ["table", ["caption", "colgroup", "thead", "tbody", "tfoot", "tr"]],
  ["thead", ["tr"]],
  ["tbody", ["tr"]],
  ["tfoot", ["tr"]],
  ["tr", ["td", "th"]],
]);

// The engine replaces these placeholders with a block, so each one is a <div>.
const PLACEHOLDER_ATTRIBUTES = ["data-decision", "data-engine", "data-demo"];

const FORBIDDEN_ELEMENTS = new Map([
  ["style", "Use the engine classes. A style element can break the theme tokens."],
  ["link", "The page cannot load external files."],
  ["iframe", "The Artifact host blocks embedded pages."],
  ["object", "The Artifact host blocks embedded content."],
  ["embed", "The Artifact host blocks embedded content."],
  ["form", "Use the engine widgets. A form has nowhere to submit."],
  ["base", "A base element changes every link of the page."],
  ["meta", "The page head belongs to the host."],
  ["title", "The title comes from record.json."],
]);

function isRecord(value) {
  if (typeof value !== "object") return false;
  if (value == null) return false;
  return !Array.isArray(value);
}

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeEntities(text) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Collects the problems of one build. An error fails the build. A warning does not. */
function createReport() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    error: (where, message) => errors.push(`${where}: ${message}`),
    warn: (where, message) => warnings.push(`${where}: ${message}`),
  };
}

/** Names a file in a message: "content/..." also for a draft folder of --content. */
function describeFile(file) {
  const inContent = relative(contentPath, file);
  if (!inContent.startsWith("..")) {
    return `content/${inContent}`;
  }
  return relative(here, file);
}

function readText(file, report) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    report.error(describeFile(file), "The file is missing.");
    return "";
  }
}

function readJson(file, report) {
  const text = readText(file, report);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    report.error(describeFile(file), `The file is not valid JSON. ${error.message}`);
    return null;
  }
}

/**
 * Checks the data URI of an image. A shortened or cut payload gives a broken
 * image in the page and no message, so the build rejects it.
 */
function describeImageDataProblem(source) {
  const match = source.match(/^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/);
  if (!match) {
    return 'The data URI has no "," between its type and its data.';
  }
  const [, type, parameters, payload] = match;
  if (!type.startsWith("image/")) {
    return `The data URI has the type "${type}". Use an image type, for example image/png or image/svg+xml.`;
  }
  if (!payload.trim()) {
    return "The data URI has no data.";
  }
  if (!parameters.split(";").includes("base64")) return null;
  const data = payload.replace(/\s+/g, "");
  // Base64 has letters, digits, "+", and "/", in groups of four characters
  // with "=" as filler at the end.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
    return 'The base64 data of the image is not complete. Do not shorten it, for example with "...".';
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML fragments

function parseAttributes(source) {
  const attributes = new Map();
  // name, then an optional value in double quotes, single quotes, or bare.
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, double, single, bare] = match;
    attributes.set(name.toLowerCase(), decodeEntities(double ?? single ?? bare ?? ""));
  }
  return attributes;
}

/**
 * Reads an HTML fragment into a tree of elements. The reader is strict where
 * a browser is forgiving: every element needs its end tag, and a paragraph
 * cannot hold a block. A fragment that passes renders as it is written.
 */
function parseFragment(source, file, report) {
  const rootNode = { name: "#root", attributes: new Map(), children: [], parent: null, line: 1 };
  const elements = [];
  const comments = [];
  let current = rootNode;
  let foreignDepth = 0;
  // A comment, an end tag, or a start tag with its attributes.
  const pattern =
    /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  const lineAt = (index) => source.slice(0, index).split("\n").length;
  const where = (index) => `${file}:${lineAt(index)}`;

  let match;
  while ((match = pattern.exec(source))) {
    const [whole, endName, startName, attributeSource, selfClosing] = match;
    if (whole.startsWith("<!--")) {
      comments.push({ start: match.index, end: pattern.lastIndex });
      continue;
    }
    if (endName) {
      const name = endName.toLowerCase();
      if (current === rootNode || current.name !== name) {
        const open =
          current === rootNode
            ? "nothing is open"
            : `<${current.name}> from line ${current.line} is open`;
        report.error(where(match.index), `Unexpected </${name}>: ${open}.`);
        // Recover when the tag closes an ancestor, so that one mistake gives one message.
        let ancestor = current;
        while (ancestor !== rootNode && ancestor.name !== name) {
          ancestor = ancestor.parent;
        }
        if (ancestor !== rootNode) {
          current = ancestor.parent;
        }
        continue;
      }
      if (name === "svg" || name === "math") {
        foreignDepth -= 1;
      }
      current.end = pattern.lastIndex;
      current = current.parent;
      continue;
    }
    const name = startName.toLowerCase();
    const element = {
      name,
      attributes: parseAttributes(attributeSource),
      children: [],
      parent: current,
      line: lineAt(match.index),
      start: match.index,
      end: pattern.lastIndex,
      content: "",
    };
    current.children.push(element);
    elements.push(element);
    if (BLOCK_ELEMENTS.has(name) && foreignDepth === 0) {
      let ancestor = current;
      while (ancestor !== rootNode) {
        if (ancestor.name === "p") {
          report.error(
            where(match.index),
            `<${name}> is inside the <p> from line ${ancestor.line}. A browser ends the paragraph there. Close the paragraph first.`,
          );
          break;
        }
        ancestor = ancestor.parent;
      }
    }
    if (VOID_ELEMENTS.has(name)) continue;
    if (selfClosing) {
      if (foreignDepth === 0 && name !== "svg") {
        report.error(
          where(match.index),
          `<${name} /> does not close an HTML element. Write </${name}>.`,
        );
      }
      continue;
    }
    if (name === "script" || name === "style" || name === "textarea") {
      // The content of these elements is text, also when it looks like tags.
      const close = source.toLowerCase().indexOf(`</${name}`, pattern.lastIndex);
      if (close === -1) {
        report.error(where(match.index), `<${name}> has no end tag.`);
        break;
      }
      element.content = source.slice(pattern.lastIndex, close);
      pattern.lastIndex = source.indexOf(">", close) + 1;
      element.end = pattern.lastIndex;
      continue;
    }
    if (name === "svg" || name === "math") {
      foreignDepth += 1;
    }
    current = element;
  }
  while (current !== rootNode) {
    report.error(`${file}:${current.line}`, `<${current.name}> has no end tag.`);
    current = current.parent;
  }
  return { root: rootNode, elements, comments };
}

function removeComments(source, comments) {
  let result = "";
  let cursor = 0;
  for (const comment of comments) {
    result += source.slice(cursor, comment.start);
    cursor = comment.end;
  }
  return result + source.slice(cursor);
}

function hasAncestor(element, test) {
  let ancestor = element.parent;
  while (ancestor) {
    if (test(ancestor)) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

function validateDemoElement({ element, file, report, demoIds }) {
  const where = `${file}:${element.line}`;
  const type = element.attributes.get("data-demo");
  const id = element.attributes.get("id");
  if (!id) {
    report.error(where, 'A demo needs an "id". The engine builds the ids of its controls from it.');
  } else {
    demoIds.push(id);
  }
  if (hasAncestor(element, (ancestor) => ancestor.attributes.has("data-demo"))) {
    report.error(where, "A demo cannot be inside another demo. Put it beside the other demo.");
  }
  if (!DEMO_TYPES.includes(type)) {
    report.error(
      where,
      `The demo type "${type}" does not exist. Use one of: ${DEMO_TYPES.join(", ")}.`,
    );
    return;
  }
  const scripts = element.children.filter((child) => child.name === "script");
  if (scripts.length !== 1) {
    report.error(
      where,
      'A demo needs one child <script type="application/json"> with its configuration.',
    );
    return;
  }
  let config;
  try {
    config = JSON.parse(scripts[0].content);
  } catch (error) {
    report.error(
      `${file}:${scripts[0].line}`,
      `The demo configuration is not valid JSON. ${error.message}`,
    );
    return;
  }
  for (const message of validateDemoConfig(type, config)) {
    report.error(`${where} (demo "${id}")`, message);
  }
  if (type === "compare") {
    const panels = element.children.filter((child) => child.attributes.has("data-panel"));
    if (panels.length < 2) {
      report.error(where, "A compare demo needs two or more child elements with data-panel.");
    }
    for (const panel of panels) {
      if (!isText(panel.attributes.get("data-panel"))) {
        report.error(`${file}:${panel.line}`, "data-panel needs the label of the panel.");
      }
      const badge = panel.attributes.get("data-badge");
      if (badge != null && !Number.isFinite(Number(badge))) {
        report.error(`${file}:${panel.line}`, `data-badge must be a number, not "${badge}".`);
      }
    }
  }
  if (type === "viewer") {
    for (const name of ["before", "after"]) {
      const image = element.children.find((child) => {
        return child.name === "svg" && child.attributes.get("data-image") === name;
      });
      if (!image) {
        report.error(where, `A viewer demo needs a child <svg data-image="${name}">.`);
      } else if (!image.attributes.has("viewbox")) {
        report.error(
          `${file}:${image.line}`,
          "The image needs a viewBox. The viewer takes its size from it.",
        );
      }
    }
  }
}

/**
 * Checks that a part of a table is where a browser accepts it. A cell
 * outside a row loses its element, and a block inside a row moves out of
 * the table.
 */
function checkTableStructure(element, where, report) {
  const parent = element.parent?.name;
  const parents = TABLE_PARENTS.get(element.name);
  if (parents && !parents.includes(parent)) {
    report.error(
      where,
      `<${element.name}> must be a child of <${parents.join("> or <")}>. Here it is in <${parent === "#root" ? "no element" : parent}>, and a browser drops it.`,
    );
  }
  const children = TABLE_CHILDREN.get(parent);
  if (children && !children.includes(element.name)) {
    report.error(
      where,
      `<${element.name}> cannot be a child of <${parent}>. A browser moves it out of the table. Put it in a cell.`,
    );
  }
}

/** Checks one section fragment and collects what the page-level checks need. */
function inspectSection({ source, file, report, context }) {
  const parsed = parseFragment(source, file, report);
  const roots = parsed.root.children;
  const section = roots[0];
  if (roots.length !== 1 || section?.name !== "section") {
    report.error(
      file,
      "A section file must hold exactly one <section> element and nothing beside it.",
    );
    return parsed;
  }
  const outside = source.slice(0, section.start) + source.slice(section.end);
  if (outside.replace(/<!--[\s\S]*?-->/g, "").trim()) {
    report.error(file, "Text outside the <section> element is not allowed.");
  }
  if (!section.attributes.get("id")) {
    report.error(file, 'The <section> needs an "id".');
  }
  if (!isText(section.attributes.get("data-title"))) {
    report.error(file, 'The <section> needs a "data-title": the label in the page index.');
  }
  if (!parsed.elements.some((element) => element.name === "h2")) {
    report.warn(file, "The section has no <h2> heading.");
  }
  if (section.attributes.has("data-sample")) {
    context.samples.push(`section ${file}`);
  }

  for (const element of parsed.elements) {
    const where = `${file}:${element.line}`;
    const attributes = element.attributes;
    const forbidden = FORBIDDEN_ELEMENTS.get(element.name);
    // An inline SVG can hold a <title>: it is the accessible name of the image.
    const isImageTitle =
      element.name === "title" && hasAncestor(element, (ancestor) => ancestor.name === "svg");
    if (forbidden && !isImageTitle) {
      report.error(where, `<${element.name}> is not allowed in a section. ${forbidden}`);
    }
    if (element.name === "section" && element !== section) {
      report.error(where, "A section cannot hold another <section>. Use headings.");
    }
    if (element.name === "h1") {
      report.error(where, "The page has one <h1>, from record.json. Start a section with <h2>.");
    }
    checkTableStructure(element, where, report);
    for (const name of PLACEHOLDER_ATTRIBUTES) {
      if (attributes.has(name) && element.name !== "div") {
        report.error(
          where,
          `${name} is on a <${element.name}>. Put it on a <div>: the engine renders a block in its place.`,
        );
      }
    }

    const id = attributes.get("id");
    if (attributes.has("id")) {
      if (!ANCHOR_PATTERN.test(id)) {
        report.error(
          where,
          `The id "${id}" must use only letters, digits, and . _ ~ - so that a link can reach it.`,
        );
      }
      const prefix = RESERVED_ID_PREFIXES.find((item) => id.startsWith(item));
      if (prefix) {
        report.error(where, `The id "${id}" starts with "${prefix}", which the engine uses.`);
      }
      const first = context.ids.get(id);
      if (first) {
        report.error(where, `The id "${id}" is already used at ${first}.`);
      } else {
        context.ids.set(id, where);
      }
    }

    const href = attributes.get("href");
    if (href?.startsWith("#") && href.length > 1) {
      context.anchors.push({ id: href.slice(1), where });
    }
    if (element.name === "a" && href && /^(?:mailto|tel|sms|javascript):/i.test(href)) {
      report.error(
        where,
        `The link "${href}" does not work in the Artifact host. Show the address as text.`,
      );
    }
    if (element.name === "a" && href && !href.startsWith("#") && !href.startsWith("https://")) {
      if (/^http:\/\/(?:127\.0\.0\.1|localhost)[:/]/.test(href)) {
        report.warn(
          where,
          `The link "${href}" opens only on a computer that runs that local server. Say so in the text.`,
        );
      } else {
        report.error(
          where,
          `The link "${href}" is not an anchor of this page and not an https address. A relative path or a file path does not open from the Artifact.`,
        );
      }
    }

    if (element.name === "img") {
      const source = attributes.get("src") ?? "";
      if (!source.startsWith("data:")) {
        report.error(where, "An image must be a data URI. The page cannot load external images.");
      } else {
        const problem = describeImageDataProblem(source);
        if (problem) {
          report.error(where, problem);
        }
      }
      if (!attributes.has("alt")) {
        report.error(where, 'An image needs an "alt" text. Use alt="" only for decoration.');
      }
    }
    // An <image> in an inline SVG, for example a PNG capture in a viewer demo.
    if (element.name === "image") {
      const source = attributes.get("href") ?? attributes.get("xlink:href") ?? "";
      if (!source.startsWith("data:")) {
        report.error(
          where,
          "An <image> in an SVG must have a data URI in href. The page cannot load external images.",
        );
      } else {
        const problem = describeImageDataProblem(source);
        if (problem) {
          report.error(where, problem);
        }
      }
    }
    for (const name of ["src", "srcset", "poster"]) {
      const value = attributes.get(name);
      if (value && /^(?:https?:)?\/\//i.test(value)) {
        report.error(
          where,
          `${name}="${value.slice(0, 60)}" loads an external file. Inline it as a data URI.`,
        );
      }
    }
    for (const name of attributes.keys()) {
      if (name.startsWith("on")) {
        report.error(where, `The attribute ${name} runs a script. A section cannot run scripts.`);
      }
    }
    const style = attributes.get("style");
    if (style && /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab)a?\(/i.test(style)) {
      report.warn(
        where,
        "The style attribute has a color value. Use a token, for example var(--text-2).",
      );
    }

    if (element.name === "script") {
      const inDemo = element.parent?.attributes.has("data-demo");
      if (attributes.get("type") !== "application/json" || !inDemo) {
        report.error(
          where,
          'The only script that a section can hold is <script type="application/json"> as a child of a demo.',
        );
      }
    }

    if (element.name === "code" && element.parent?.name === "pre") {
      const language = (attributes.get("class") ?? "")
        .split(/\s+/)
        .find((name) => name.startsWith("language-"));
      if (!language) {
        report.warn(
          where,
          `The code block has no language class. Use one of: ${[...CODE_LANGUAGES.keys()].map((name) => `language-${name}`).join(", ")}.`,
        );
      } else if (!CODE_LANGUAGES.has(language.slice(9))) {
        report.error(
          where,
          `"${language}" is not supported. Use one of: ${[...CODE_LANGUAGES.keys()].map((name) => `language-${name}`).join(", ")}.`,
        );
      }
    }

    if (attributes.has("data-decision")) {
      const decision = attributes.get("data-decision");
      context.placements.push({ id: decision, where });
      if (hasAncestor(element, (ancestor) => ancestor.attributes.has("data-demo"))) {
        report.error(where, "A decision panel cannot be inside a demo. Put it beside the demo.");
      }
      if (element.children.length) {
        report.error(
          where,
          "The decision placeholder must be empty. The engine renders the panel.",
        );
      }
    }
    if (attributes.has("data-findings")) {
      const ids = attributes.get("data-findings").split(/\s+/).filter(Boolean);
      if (!ids.length) {
        report.error(where, "data-findings needs one finding id or more.");
      }
      for (const finding of ids) {
        context.findingReferences.push({ id: finding, where });
      }
    }
    if (attributes.has("data-fact") && !FACT_KINDS.has(attributes.get("data-fact"))) {
      report.error(
        where,
        `data-fact="${attributes.get("data-fact")}" does not exist. Use one of: ${[...FACT_KINDS.keys()].join(", ")}.`,
      );
    }
    if (attributes.has("data-term")) {
      context.termReferences.push({ name: attributes.get("data-term"), where });
      const control = ["a", "button", "label", "summary"].find((name) => {
        return element.name === name || hasAncestor(element, (ancestor) => ancestor.name === name);
      });
      if (control) {
        report.error(
          where,
          `data-term is inside a <${control}>. A term trigger cannot be inside a link or a control. Put it in the text beside it.`,
        );
      }
    }
    if (attributes.has("data-engine")) {
      const block = attributes.get("data-engine");
      if (!ENGINE_BLOCKS.includes(block)) {
        report.error(
          where,
          `data-engine="${block}" does not exist. Use one of: ${ENGINE_BLOCKS.join(", ")}.`,
        );
      }
      context.engineBlocks.push({ block, where });
    }
    if (attributes.has("data-demo")) {
      validateDemoElement({ element, file, report, demoIds: context.demoIds });
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Data files

function validateTerms(terms, report) {
  const file = "content/terms.json";
  if (!Array.isArray(terms)) {
    report.error(file, "The file must hold a list of terms.");
    return [];
  }
  const names = new Map();
  terms.forEach((term, index) => {
    const where = `${file} [${index}]${isText(term?.term) ? ` "${term.term}"` : ""}`;
    if (!isRecord(term) || !isText(term.term)) {
      report.error(where, 'Each entry needs a "term".');
      return;
    }
    if (!isText(term.definition)) {
      report.error(where, 'The term has no "definition".');
    }
    if (term.aliases != null && !Array.isArray(term.aliases)) {
      report.error(where, '"aliases" must be a list.');
      return;
    }
    for (const name of [term.term, ...(term.aliases ?? [])]) {
      if (!isText(name)) {
        report.error(where, "An alias is empty.");
        continue;
      }
      const key = name.trim().replace(/\s+/g, " ").toLowerCase();
      const first = names.get(key);
      if (first != null) {
        report.error(
          where,
          `The name "${name}" is also in entry [${first}]. Each name can have one definition.`,
        );
      }
      names.set(key, index);
    }
  });
  return terms.filter((term) => isRecord(term) && isText(term.term) && isText(term.definition));
}

function validateFindings(findings, report) {
  const file = "content/findings.json";
  if (!Array.isArray(findings)) {
    report.error(file, "The file must hold a list of findings.");
    return [];
  }
  const ids = new Set();
  findings.forEach((finding, index) => {
    const where = `${file} [${index}]${isText(finding?.id) ? ` ${finding.id}` : ""}`;
    if (!isRecord(finding) || !isText(finding.id)) {
      report.error(where, 'Each finding needs an "id".');
      return;
    }
    if (!ANCHOR_PATTERN.test(finding.id)) {
      report.error(where, "The id must use only letters, digits, and . _ ~ -.");
    }
    if (ids.has(finding.id)) {
      report.error(where, "The id is used two times.");
    }
    ids.add(finding.id);
    for (const key of ["area", "title", "kind", "summary"]) {
      if (!isText(finding[key])) {
        report.error(where, `The finding needs "${key}".`);
      }
    }
    if (!SEVERITIES.has(finding.severity)) {
      report.error(
        where,
        `"severity" is "${finding.severity}". Use one of: ${[...SEVERITIES.keys()].join(", ")}.`,
      );
    }
    if (!VERDICTS.has(finding.verdict)) {
      report.error(
        where,
        `"verdict" is "${finding.verdict}". Use one of: ${[...VERDICTS.keys()].join(", ")}.`,
      );
    }
    if (typeof finding.measured !== "boolean" && typeof finding.measured !== "string") {
      report.error(where, '"measured" must be true, false, or a text with the measured value.');
    }
    if (finding.effort != null && typeof finding.effort !== "string") {
      report.error(where, '"effort" must be a text, for example "S", "M", or "L".');
    }
    if (finding.section != null && typeof finding.section !== "string") {
      report.error(where, '"section" must be the id of an element in a section, or empty.');
    }
  });
  return findings.filter((finding) => isRecord(finding) && isText(finding.id));
}

function validateDecisions(decisions, findingIds, report) {
  const file = "content/decisions.json";
  if (!Array.isArray(decisions)) {
    report.error(file, "The file must hold a list of decisions.");
    return [];
  }
  const ids = new Set();
  decisions.forEach((decision, index) => {
    const where = `${file} [${index}]${isText(decision?.id) ? ` ${decision.id}` : ""}`;
    if (!isRecord(decision) || !isText(decision.id)) {
      report.error(where, 'Each decision needs an "id".');
      return;
    }
    if (!ANCHOR_PATTERN.test(decision.id)) {
      report.error(where, "The id must use only letters, digits, and . _ ~ -.");
    }
    if (ids.has(decision.id)) {
      report.error(where, "The id is used two times.");
    }
    ids.add(decision.id);
    if (!isText(decision.short)) {
      report.error(where, 'The decision needs "short": the label in the Decisions menu.');
    }
    if (!isText(decision.question)) {
      report.error(where, 'The decision needs a "question".');
    }
    if (!isText(decision.context)) {
      report.warn(where, 'The decision has no "context".');
    }
    if (!DECISION_STATUSES.has(decision.status)) {
      report.error(
        where,
        `"status" is "${decision.status}". Use one of: ${[...DECISION_STATUSES.keys()].join(", ")}.`,
      );
    }
    if (decision.status === "settled" && !isText(decision.settledAnswer)) {
      report.error(where, 'A settled decision needs "settledAnswer".');
    }
    if (decision.status !== "open" && !isText(decision.rationale)) {
      report.error(where, `A ${decision.status} decision needs a "rationale".`);
    }
    if (decision.status === "open" && isText(decision.settledAnswer)) {
      report.warn(where, 'An open decision has a "settledAnswer". The page does not show it.');
    }
    if (!Array.isArray(decision.options) || decision.options.length < 2) {
      report.error(where, "The decision has no options. A decision needs two options or more.");
      decision.options = Array.isArray(decision.options) ? decision.options : [];
    }
    const optionIds = new Set();
    decision.options.forEach((option, optionIndex) => {
      const optionWhere = `${where}, option ${optionIndex + 1}`;
      if (!isRecord(option) || !isText(option.id)) {
        report.error(optionWhere, 'The option needs an "id".');
        return;
      }
      if (!ANCHOR_PATTERN.test(option.id)) {
        report.error(optionWhere, "The id must use only letters, digits, and . _ ~ -.");
      }
      if (optionIds.has(option.id)) {
        report.error(optionWhere, `The id "${option.id}" is used two times.`);
      }
      optionIds.add(option.id);
      for (const key of ["label", "explanation", "consequences"]) {
        if (!isText(option[key])) {
          report.error(optionWhere, `The option needs "${key}".`);
        }
      }
      if (option.recommended != null && typeof option.recommended !== "boolean") {
        report.error(optionWhere, '"recommended" must be true or false.');
      }
    });
    if (decision.evidence != null && !Array.isArray(decision.evidence)) {
      report.error(where, '"evidence" must be a list of finding ids.');
      decision.evidence = [];
    }
    for (const finding of decision.evidence ?? []) {
      if (!findingIds.has(finding)) {
        report.error(
          where,
          `"evidence" names the finding "${finding}", which is not in findings.json.`,
        );
      }
    }
  });
  return decisions.filter((decision) => isRecord(decision) && isText(decision.id));
}

function validateRecord(record, decisions, report) {
  const file = "content/record.json";
  if (!isRecord(record)) {
    report.error(file, "The file must hold one object.");
    return;
  }
  for (const key of ["title", "revision", "date"]) {
    if (!isText(record[key])) {
      report.error(file, `The record needs "${key}".`);
    }
  }
  if (isText(record.date) && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    report.warn(file, `"date" is "${record.date}". Use the form 2026-10-05.`);
  }
  const location = record.livingRecord;
  if (!isRecord(location)) {
    report.error(file, 'The record needs "livingRecord" with artifactUrl, localPath, and labPath.');
  } else {
    if (!isText(location.localPath)) {
      report.error(file, '"livingRecord.localPath" is empty. The next agent needs it.');
    }
    if (!isText(location.labPath)) {
      report.warn(file, '"livingRecord.labPath" is empty.');
    }
    if (!isText(location.artifactUrl)) {
      report.warn(file, '"livingRecord.artifactUrl" is empty. Set it after the first publish.');
    }
  }
  if (record.incorporated == null) {
    record.incorporated = {};
  }
  if (!isRecord(record.incorporated)) {
    report.error(file, '"incorporated" must be an object: decision id to { selection, notes }.');
    return;
  }
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  for (const [id, entry] of Object.entries(record.incorporated)) {
    const where = `${file} incorporated.${id}`;
    const decision = byId.get(id);
    if (!decision) {
      report.error(where, "This decision identifier is not in decisions.json.");
      continue;
    }
    if (!isRecord(entry)) {
      report.error(where, "The entry must be { selection, notes }.");
      continue;
    }
    if (entry.selection != null && typeof entry.selection !== "string") {
      report.error(where, '"selection" must be an option id or null.');
    }
    if (entry.notes != null && typeof entry.notes !== "string") {
      report.error(where, '"notes" must be a text.');
    }
    if (
      isText(entry.selection) &&
      !decision.options.some((option) => option.id === entry.selection)
    ) {
      report.warn(
        where,
        `The selection "${entry.selection}" is not a current option. The page shows the decision as Open and puts an OPEN update in the next prompt.`,
      );
    }
  }
}

function findSamples({ record, decisions, terms, findings }) {
  const samples = [];
  if (record?.sample) {
    samples.push("content/record.json");
  }
  for (const [name, items] of [
    ["decisions.json", decisions],
    ["terms.json", terms],
    ["findings.json", findings],
  ]) {
    const count = items.filter((item) => item.sample).length;
    if (count) {
      samples.push(`${count} of ${items.length} entries in content/${name}`);
    }
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Engine checks

/** A rule after the token blocks must take every color from a token. */
function checkStyleColors(styles, report) {
  const end = styles.indexOf("/* tokens:end */");
  if (end === -1) {
    report.error("engine/styles.css", "The marker /* tokens:end */ is missing.");
    return;
  }
  const rules = styles.slice(end).replace(/\/\*[\s\S]*?\*\//g, "");
  // The value of each declaration, up to its semicolon.
  for (const match of rules.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    const [, property, value] = match;
    const literal = value.match(
      /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)a?\(|\b(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i,
    );
    if (!literal) continue;
    report.error(
      "engine/styles.css",
      `"${property}: ${value.trim()}" has the color value "${literal[0]}". Use a token.`,
    );
  }
}

function buildPageScript(report) {
  const core = readText(join(enginePath, "core.js"), report).replace(/^export /gm, "");
  const app = readText(join(enginePath, "app.js"), report).replace(
    // The one import of app.js: the names that core.js exports.
    /^import\s*\{[^}]*\}\s*from\s*"\.\/core\.js";\n/m,
    "",
  );
  const script = `(() => {\n"use strict";\n${core}\n${app}})();`;
  if (/^(?:import|export)\s/m.test(script)) {
    report.error("engine", "The page script still has an import or export statement.");
  }
  if (/<\/script/i.test(script)) {
    report.error(
      "engine",
      'The page script holds the text "</script", which ends the script element.',
    );
  }
  return script;
}

function fillShell(shell, values) {
  // The comment at the top of shell.html documents the tokens. It is removed.
  const body = shell.replace(/^<!--[\s\S]*?-->\s*/, "");
  return body.replace(/\{\{(\w+)\}\}/g, (whole, name) => {
    if (!Object.hasOwn(values, name)) {
      return whole;
    }
    return values[name];
  });
}

// ---------------------------------------------------------------------------
// Build

function build() {
  const report = createReport();
  const flags = new Set(process.argv.slice(2));

  const record = readJson(join(contentPath, "record.json"), report);
  const terms = validateTerms(readJson(join(contentPath, "terms.json"), report) ?? [], report);
  const findings = validateFindings(
    readJson(join(contentPath, "findings.json"), report) ?? [],
    report,
  );
  const findingIds = new Set(findings.map((finding) => finding.id));
  const decisions = validateDecisions(
    readJson(join(contentPath, "decisions.json"), report) ?? [],
    findingIds,
    report,
  );
  validateRecord(record, decisions, report);

  const shell = readText(join(enginePath, "shell.html"), report);
  const styles = readText(join(enginePath, "styles.css"), report);
  checkStyleColors(styles, report);
  const script = buildPageScript(report);

  // Ids of the shell are taken before any section is read.
  const context = {
    ids: new Map(),
    anchors: [],
    placements: [],
    findingReferences: [],
    termReferences: [],
    engineBlocks: [],
    demoIds: [],
    samples: findSamples({ record, decisions, terms, findings }),
  };
  for (const match of shell.matchAll(/\sid="([^"]+)"/g)) {
    context.ids.set(match[1], "engine/shell.html");
  }

  const sectionsPath = join(contentPath, "sections");
  let sectionFiles = [];
  try {
    sectionFiles = readdirSync(sectionsPath)
      .filter((name) => name.endsWith(".html"))
      .sort((first, second) => first.localeCompare(second, "en", { numeric: true }));
  } catch {
    report.error("content/sections", "The folder is missing.");
  }
  if (!sectionFiles.length) {
    report.error("content/sections", "The folder has no section files.");
  }
  const sections = sectionFiles.map((name) => {
    const file = `content/sections/${name}`;
    if (!/^\d{2,}-[a-z0-9-]+\.html$/.test(name)) {
      report.warn(file, "Name a section file NN-name.html, for example 20-dashboard-load.html.");
    }
    const source = readText(join(sectionsPath, name), report);
    const parsed = inspectSection({ source, file, report, context });
    return removeComments(source, parsed.comments).trim();
  });

  // Checks that need every section.
  for (const id of context.demoIds) {
    for (const [other, where] of context.ids) {
      if (other.startsWith(`${id}-`)) {
        report.error(
          where,
          `The id "${other}" starts with the demo id "${id}-", which the engine uses for the demo controls.`,
        );
      }
    }
  }
  const placed = new Map();
  for (const { id, where } of context.placements) {
    if (!decisions.some((decision) => decision.id === id)) {
      report.error(
        where,
        `data-decision="${id}" is an unknown decision identifier. It is not in decisions.json.`,
      );
      continue;
    }
    const first = placed.get(id);
    if (first) {
      report.error(
        where,
        `The decision panel ${id} is placed two times. The first is at ${first}.`,
      );
    }
    placed.set(id, where);
  }
  for (const decision of decisions) {
    if (!placed.has(decision.id)) {
      report.error(
        "content/decisions.json",
        `The decision ${decision.id} has no panel. Put <div data-decision="${decision.id}"></div> in the section that explains it.`,
      );
    }
  }
  for (const { id, where } of context.findingReferences) {
    if (!findingIds.has(id)) {
      report.error(where, `data-findings names "${id}", which is not in findings.json.`);
    }
  }
  const matcher = compileTerms(terms);
  for (const { name, where } of context.termReferences) {
    if (!matcher.lookUp(name)) {
      report.error(where, `data-term="${name}" is not a term or an alias in terms.json.`);
    }
  }
  for (const block of ENGINE_BLOCKS) {
    const uses = context.engineBlocks.filter((item) => item.block === block);
    if (uses.length === 0) {
      report.error(
        "content/sections",
        `No section holds <div data-engine="${block}"></div>. The page needs it one time.`,
      );
    }
    if (uses.length > 1) {
      report.error(
        uses[1].where,
        `data-engine="${block}" is placed two times. The first is at ${uses[0].where}.`,
      );
    }
  }
  const targets = new Set(context.ids.keys());
  for (const id of placed.keys()) {
    targets.add(`decision-${id}`);
  }
  for (const id of findingIds) {
    targets.add(`finding-${id}`);
  }
  for (const { id, where } of context.anchors) {
    if (!targets.has(id)) {
      report.error(where, `The link "#${id}" is a broken internal anchor. No element has this id.`);
    }
  }
  for (const finding of findings) {
    if (!finding.section) continue;
    if (!targets.has(finding.section)) {
      report.error(
        `content/findings.json ${finding.id}`,
        `"section" is "${finding.section}". No element has this id.`,
      );
    }
  }
  if (context.samples.length) {
    const message = `Sample content remains: ${context.samples.join("; ")}.`;
    if (flags.has("--strict")) {
      report.error("content", message);
    } else {
      report.warn("content", `${message} Replace it before the document is shared.`);
    }
  }

  const title = escapeHtml(record?.title ?? "");
  const data = {
    record,
    decisions,
    terms,
    findings,
  };
  // "<" is escaped so that no text in the data can end the script element.
  const dataJson = JSON.stringify(data).replaceAll("<", "\\u003c");
  const body = [
    fillShell(shell, {
      title,
      revision: escapeHtml(record?.revision ?? ""),
      sections: sections.join("\n\n"),
    }).trim(),
    `<script type="application/json" id="audit-data">${dataJson}</script>`,
    `<script async id="highlight-script" src="${HIGHLIGHT_SCRIPT.src}" integrity="${HIGHLIGHT_SCRIPT.integrity}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
    `<script>\n${script}\n</script>`,
  ].join("\n");

  const artifact = [`<title>${title}</title>`, `<style>\n${styles}</style>`, body, ""].join("\n");
  // The standalone copy adds what the Artifact host adds: the document
  // skeleton and the host reset, so that both outputs render the same.
  const standalone = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${title}</title>`,
    '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Crect width=%2716%27 height=%2716%27 rx=%273%27 fill=%27%23191c22%27/%3E%3Cpath d=%27M4 4.5 8 12l4-7.5%27 fill=%27none%27 stroke=%27%2389c3ff%27 stroke-width=%272%27/%3E%3C/svg%3E">',
    "<style>",
    ":root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }",
    "body { margin: 0; font: 14px/1.5 system-ui, sans-serif; }",
    "img { max-width: 100%; }",
    "[hidden] { display: none !important; }",
    "</style>",
    `<style>\n${styles}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");

  for (const [name, output] of [
    ["dist/visonaut-audit.html", artifact],
    ["public/audit/index.html", standalone],
  ]) {
    const size = Buffer.byteLength(output);
    if (size > SIZE_LIMIT) {
      report.error(
        name,
        `The file is ${formatBytes(size)}. The Artifact host accepts 16 MB or less.`,
      );
    }
  }
  // The Artifact host scans only the start of the file for the title.
  if (!artifact.startsWith("<title>")) {
    report.error(
      "dist/visonaut-audit.html",
      "The Artifact source must start with the title element.",
    );
  }

  for (const message of report.warnings) {
    console.warn(`warning  ${message}`);
  }
  if (report.errors.length) {
    for (const message of report.errors) {
      console.error(`error    ${message}`);
    }
    console.error(
      `\nThe build failed: ${report.errors.length} error(s), ${report.warnings.length} warning(s). No file was written.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `content  ${sections.length} sections, ${decisions.length} decisions, ${findings.length} findings, ${terms.length} terms, ${context.demoIds.length} demos`,
  );
  console.log(
    `engine   styles ${formatBytes(Buffer.byteLength(styles))}, script ${formatBytes(Buffer.byteLength(script))}, data ${formatBytes(Buffer.byteLength(dataJson))}`,
  );
  if (flags.has("--check")) {
    console.log(`checked  ${report.warnings.length} warning(s). No file was written (--check).`);
    return;
  }
  mkdirSync(dirname(artifactFile), { recursive: true });
  mkdirSync(dirname(standaloneFile), { recursive: true });
  writeFileSync(artifactFile, artifact);
  writeFileSync(standaloneFile, standalone);
  const limit = formatBytes(SIZE_LIMIT);
  console.log(`wrote    ${artifactFile}  ${formatBytes(Buffer.byteLength(artifact))} of ${limit}`);
  console.log(`wrote    ${standaloneFile}  ${formatBytes(Buffer.byteLength(standalone))}`);
}

build();

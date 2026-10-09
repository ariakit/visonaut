#!/usr/bin/env node
// Browser checks for the built audit document. Run the build first.
//
//   node apps/lab/audit/check.mjs                 Check both outputs, wide and narrow.
//   node apps/lab/audit/check.mjs --shots <dir>   Also save screenshots to <dir>.
//   node apps/lab/audit/check.mjs --only artifact Check one output: artifact or standalone.
//   node apps/lab/audit/check.mjs --dir <dir>     Check the outputs of "build.mjs --out <dir>".
//
// The script serves the two outputs from a local server. It wraps the
// Artifact source in a copy of the host skeleton (doctype, metas, and a light
// reset), so that the check sees what the Artifact host shows. It uses
// Playwright from the repository root and the installed Chrome.
//
// The checks do not depend on the sample content. They read the data from
// the built page and use the first decision, the first term, and the first
// demo of each type that they find.
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getChangedDecisions, getFeedbackEntry, reconcileFeedback } from "./engine/core.js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "..", "package.json"));
const { chromium } = require("@playwright/test");

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const directory = readOption("--dir");
const outputs = directory
  ? {
      artifact: join(resolve(directory), "visonaut-audit.html"),
      standalone: join(resolve(directory), "index.html"),
    }
  : {
      artifact: join(here, "dist", "visonaut-audit.html"),
      standalone: join(here, "..", "public", "audit", "index.html"),
    };
const viewports = {
  wide: { width: 1440, height: 900, touch: false },
  narrow: { width: 400, height: 800, touch: true },
};
const hostSkeleton = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}",
  "body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#faf9f5;color:#1f1e1d}",
  "img{max-width:100%}[hidden]{display:none!important}</style></head><body>",
].join("");

// A content security policy like the one of the Artifact host: scripts from
// a short list of hosts, style sheets from Google Fonts, images as data, and
// no other request. A page that breaks it logs an error, and the check fails.
const hostPolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function startServer() {
  const server = createServer((request, response) => {
    const send = (body, headers = {}) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
      response.end(body);
    };
    if (request.url?.startsWith("/standalone")) {
      send(readFileSync(outputs.standalone, "utf8"));
      return;
    }
    if (request.url?.startsWith("/artifact")) {
      send(`${hostSkeleton}${readFileSync(outputs.artifact, "utf8")}</body></html>`, {
        "content-security-policy": hostPolicy,
      });
      return;
    }
    // The browser asks for a favicon. An empty answer keeps the console clean.
    response.writeHead(request.url === "/favicon.ico" ? 204 : 404);
    response.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** The relative luminance of a CSS rgb() color, from 0 (black) to 1 (white). */
function luminance(color) {
  const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const [red, green, blue] = channels.map((value) => {
    const share = value / 255;
    return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function runChecks({ browser, url, target, viewportName, shots }) {
  const viewport = viewports[viewportName];
  const results = [];
  const problems = [];
  const label = `${target} ${viewportName}`;

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.touch,
    isMobile: viewport.touch,
    // The Artifact run uses a light system setting: the document must still
    // open dark, because dark is its first theme.
    colorScheme: target === "artifact" ? "light" : "dark",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("requestfailed", (request) => problems.push(`request failed: ${request.url()}`));

  const check = async (name, run) => {
    try {
      const note = await run();
      results.push({ name, ok: true, note });
    } catch (error) {
      results.push({ name, ok: false, note: error.message.split("\n")[0] });
    }
  };
  const open = async () => {
    await page.goto(url, { waitUntil: "load" });
    await page.locator("#doc[data-ready]").waitFor({ timeout: 10000 });
  };
  const shot = async (name, locator) => {
    if (!shots) return;
    // Bars and marks move for 240 ms after a change. Wait until they are at rest.
    await page.waitForTimeout(350);
    const path = join(shots, `${target}-${viewportName}-${name}.png`);
    if (locator) {
      await locator.screenshot({ path });
    } else {
      await page.screenshot({ path });
    }
  };
  const stored = () => {
    return page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => name.endsWith(":feedback"));
      return key ? JSON.parse(localStorage.getItem(key)) : null;
    });
  };
  const store = (value) => {
    return page.evaluate((next) => {
      const key = Object.keys(localStorage).find((name) => name.endsWith(":feedback"));
      localStorage.setItem(key, JSON.stringify(next));
    }, value);
  };
  const prompt = () => page.locator("#prompt-text").inputValue();
  const countText = async () => (await page.locator("#answered-count").innerText()).trim();
  const barBottom = () => {
    return page.evaluate(() => document.getElementById("bar").getBoundingClientRect().bottom);
  };
  const press = async (locator) => {
    if (viewport.touch) {
      await locator.tap();
    } else {
      await locator.click();
    }
  };
  // The element is below the sticky bar and inside the viewport.
  const expectUncovered = async (selector) => {
    const top = await page.evaluate((target) => {
      return document.querySelector(target).getBoundingClientRect().top;
    }, selector);
    const bottom = await barBottom();
    expect(top >= bottom - 1, `${selector} is under the sticky bar (top ${top}, bar ${bottom})`);
    expect(top < viewport.height, `${selector} is below the viewport (top ${top})`);
  };

  await open();
  // The data that the build put in the page drives the checks. The decisions
  // are in the order of their panels in the page: that is the order that the
  // Decisions menu must have, also when decisions.json has another order.
  const { record, decisions, findings, terms } = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("audit-data").textContent);
    const panels = [...document.querySelectorAll(".decision[id]")].map((panel) => panel.id);
    const positionOf = (decision) => {
      const index = panels.indexOf(`decision-${decision.id}`);
      return index === -1 ? panels.length : index;
    };
    data.decisions.sort((first, second) => positionOf(first) - positionOf(second));
    return data;
  });
  const initial = reconcileFeedback({ record, decisions });
  const initialChanged = getChangedDecisions(initial, decisions).map((decision) => decision.id);
  const getRecorded = (decision) => getFeedbackEntry(initial.baseline, decision.id).selection;
  const isAnswered = (decision) => {
    return decision.options.some((option) => option.id === getRecorded(decision));
  };
  const answeredAtStart = decisions.filter(isAnswered).length;
  const openDecisions = decisions.filter((decision) => !isAnswered(decision));
  const first = openDecisions[0];
  const second = openDecisions[1];
  const incorporated = decisions.find(isAnswered);

  // ------------------------------------------------------------- Page

  await check("loads without an error", async () => {
    await page.waitForTimeout(600);
    const errors = problems.filter((problem) => !problem.includes("fonts.g"));
    expect(errors.length === 0, errors.join(" | "));
    const title = await page.title();
    expect(title === record.title, `the title is "${title}"`);
  });

  await check("opens in the dark theme, and is light with data-theme=light", async () => {
    const read = () => {
      return page.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(document.getElementById("doc")).color,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      }));
    };
    const dark = await read();
    expect(luminance(dark.background) < 0.05, `the first background is ${dark.background}`);
    expect(dark.scheme === "dark", `color-scheme is ${dark.scheme}`);
    await shot("top");
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    const light = await read();
    expect(luminance(light.background) > 0.85, `the light background is ${light.background}`);
    expect(luminance(light.text) < 0.1, `the light text is ${light.text}`);
    expect(light.scheme === "light", `color-scheme is ${light.scheme}`);
    if (shots) {
      await page.screenshot({
        path: join(shots, `${target}-${viewportName}-light-full.png`),
        fullPage: true,
      });
    }
    await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    if (shots) {
      await page.screenshot({
        path: join(shots, `${target}-${viewportName}-dark-full.png`),
        fullPage: true,
      });
    }
  });

  await check("has no horizontal page scroll and keeps a 16 px gutter", async () => {
    const layout = await page.evaluate(() => {
      const main = document.getElementById("main").getBoundingClientRect();
      const wide = [];
      for (const element of document.querySelectorAll("#main *")) {
        const box = element.getBoundingClientRect();
        if (box.width === 0) continue;
        if (box.right <= document.documentElement.clientWidth + 0.5) continue;
        // Content of a scroll area can be wider than the page.
        let scroller = element.parentElement;
        let contained = false;
        while (scroller && scroller.id !== "main") {
          const overflow = getComputedStyle(scroller).overflowX;
          if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") {
            contained = true;
          }
          scroller = scroller.parentElement;
        }
        if (!contained) {
          wide.push(`${element.localName}.${element.className}`);
        }
      }
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        left: main.left,
        right: document.documentElement.clientWidth - main.right,
        wide: wide.slice(0, 5),
      };
    });
    expect(layout.scrollWidth <= layout.clientWidth, `the page is ${layout.scrollWidth} px wide`);
    expect(layout.left >= 16, `the left gutter is ${layout.left} px`);
    expect(layout.right >= 16, `the right gutter is ${layout.right} px`);
    expect(layout.wide.length === 0, `wider than the page: ${layout.wide.join(", ")}`);
  });

  await check("gives each form control a unique id", async () => {
    const report = await page.evaluate(() => {
      const missing = [...document.querySelectorAll("#doc input, #doc select, #doc textarea")]
        .filter((control) => !control.id)
        .map((control) => control.outerHTML.slice(0, 80));
      const seen = new Set();
      const repeated = new Set();
      for (const element of document.querySelectorAll("[id]")) {
        if (seen.has(element.id)) {
          repeated.add(element.id);
        }
        seen.add(element.id);
      }
      return { missing, repeated: [...repeated] };
    });
    expect(report.missing.length === 0, `no id: ${report.missing.join(" | ")}`);
    expect(report.repeated.length === 0, `repeated ids: ${report.repeated.join(", ")}`);
  });

  await check("keeps the sticky bar and its controls visible while scrolling", async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const top = await page.evaluate(
      () => document.getElementById("bar").getBoundingClientRect().top,
    );
    expect(Math.abs(top) < 1, `the bar is at ${top} px`);
    for (const id of ["copy-prompt-button", "decisions-button", "answered-count"]) {
      expect(await page.locator(`#${id}`).isVisible(), `#${id} is not visible`);
    }
    expect(
      (await page.locator("#copy-prompt-button").innerText()).trim() === "Copy continuation prompt",
      "the copy label changed",
    );
    expect(
      (await page.locator("#decisions-button").innerText()).trim() === "Decisions",
      "the menu label changed",
    );
    expect(/^\d+ \/ \d+ answered$/.test(await countText()), `the count is "${await countText()}"`);
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  // -------------------------------------------------------- Decisions

  await check("renders each decision one time, with nothing preselected", async () => {
    for (const decision of decisions) {
      const panel = page.locator(`[id="decision-${decision.id}"]`);
      expect((await panel.count()) === 1, `${decision.id} has ${await panel.count()} panels`);
      expect(
        (await panel.locator(".decision-label").innerText()).trim().toLowerCase() === "decision",
        "no Decision label",
      );
      expect(
        (await panel.locator(".decision-id").innerText()).trim() === decision.id,
        "no identifier",
      );
      expect(
        (await panel.locator('input[type="radio"]').count()) === decision.options.length,
        "wrong option count",
      );
      const checked = await panel.locator('input[type="radio"]:checked').count();
      expect(
        checked === (isAnswered(decision) ? 1 : 0),
        `${decision.id} has ${checked} checked options at start`,
      );
      const recommended = decision.options.filter((option) => option.recommended).length;
      expect(
        (await panel.locator(".tag-recommended").count()) === recommended,
        "wrong Recommended labels",
      );
      const state = (await panel.locator(".decision-state").innerText()).trim();
      expect(
        state === (isAnswered(decision) ? "Answered" : "Open"),
        `${decision.id} state is "${state}"`,
      );
      expect((await panel.locator("textarea").count()) === 1, "no notes field");
      for (const option of decision.options) {
        const detail = await panel
          .locator(`[id="decision-${decision.id}-option-${option.id}-detail"]`)
          .innerText();
        expect(detail.includes(option.explanation.slice(0, 20)), `${option.id} has no explanation`);
        expect(detail.toLowerCase().includes("consequences"), `${option.id} has no consequences`);
      }
    }
    expect(
      (await countText()) === `${answeredAtStart} / ${decisions.length} answered`,
      `the count is "${await countText()}"`,
    );
    return `${decisions.length} panels`;
  });

  await check("starts with a prompt that has no update beyond the record", async () => {
    const text = await prompt();
    expect(text.includes(record.title), "the title is missing");
    expect(text.includes(`Revision: ${record.revision}`), "the revision is missing");
    expect(text.includes(record.livingRecord.localPath), "the local path is missing");
    expect(text.includes(`Lab path: ${record.livingRecord.labPath}`), "the lab path is missing");
    expect(
      text.includes(`Artifact: ${record.livingRecord.artifactUrl || "not published yet"}`),
      "the artifact URL is missing",
    );
    if (initialChanged.length === 0) {
      expect(
        text.includes("No decision changed in this feedback round"),
        "the prompt lists updates at start",
      );
    }
    for (const phrase of [
      "Load the complete living record",
      "Preserve every decision that is not listed",
      "only an explicit maintainer choice",
      "Keep every OPEN item open",
      "ask the maintainer to resolve the conflict",
      "compare it with the current options",
      "GitHub publication are out of scope",
    ]) {
      expect(text.includes(phrase), `the instruction "${phrase}" is missing`);
    }
  });

  if (first) {
    const option = first.options[0];
    const other = first.options[1];
    const panel = page.locator(`[id="decision-${first.id}"]`);
    const radio = page.locator(`[id="decision-${first.id}-option-${option.id}"]`);
    const notes = page.locator(`[id="decision-${first.id}-notes"]`);

    await check("counts a selection and puts it in the prompt", async () => {
      await radio.check();
      expect(
        (await countText()) === `${answeredAtStart + 1} / ${decisions.length} answered`,
        `the count is "${await countText()}"`,
      );
      expect(
        (await panel.locator(".decision-state").innerText()).trim() === "Answered",
        "the panel is not Answered",
      );
      const text = await prompt();
      expect(text.includes(`${first.id}: ${first.question}`), "the question is missing");
      expect(
        text.includes(`Answer: ${option.label} (option \`${option.id}\`)`),
        "the answer is missing",
      );
      for (const decision of decisions) {
        if (decision.id === first.id) continue;
        if (initialChanged.includes(decision.id)) continue;
        expect(
          !text.includes(`${decision.id}: `),
          `${decision.id} did not change but is in the prompt`,
        );
      }
      await shot("decision", panel);
    });

    await check("keeps notes when another option is selected", async () => {
      await notes.fill("Check note A. Keep this.");
      await page.locator(`[id="decision-${first.id}-option-${other.id}"]`).check();
      expect((await notes.inputValue()) === "Check note A. Keep this.", "the notes changed");
      const text = await prompt();
      expect(text.includes(`Answer: ${other.label}`), "the new answer is missing");
      expect(text.includes("Notes: Check note A. Keep this."), "the notes are missing");
    });
  }

  if (second) {
    await check("does not count notes alone as an answer", async () => {
      const before = await countText();
      await page.locator(`[id="decision-${second.id}-notes"]`).fill("Check note B.");
      expect((await countText()) === before, "notes changed the count");
      const state = await page.locator(`[id="decision-${second.id}"] .decision-state`).innerText();
      expect(state.trim() === "Open", `the state is "${state}"`);
      const text = await prompt();
      expect(text.includes(`${second.id}: ${second.question}`), "the decision is missing");
      expect(text.includes("Answer: OPEN"), "OPEN is missing");
      expect(text.includes("Notes: Check note B."), "the notes are missing");
    });
  }

  if (first) {
    const other = first.options[1];
    await check("keeps selections, notes, and the baseline across a reload", async () => {
      const before = { prompt: await prompt(), count: await countText(), stored: await stored() };
      await open();
      expect(
        await page.locator(`[id="decision-${first.id}-option-${other.id}"]`).isChecked(),
        "the selection is lost",
      );
      expect(
        (await page.locator(`[id="decision-${first.id}-notes"]`).inputValue()) ===
          "Check note A. Keep this.",
        "the notes are lost",
      );
      expect((await countText()) === before.count, "the count changed");
      expect((await prompt()) === before.prompt, "the prompt changed");
      const after = await stored();
      expect(
        JSON.stringify(after.baseline) === JSON.stringify(before.stored.baseline),
        "the baseline changed",
      );
      expect(after.revision === record.revision, "the saved revision is wrong");
    });

    await check(
      "copies the prompt from the sticky bar without a change to the baseline",
      async () => {
        const before = await stored();
        const expected = await prompt();
        await press(page.locator("#copy-prompt-button"));
        await page.waitForTimeout(150);
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied === expected, "the copied text is not the preview text");
        expect(
          (await page.locator("#bar-status").innerText()).includes("Prompt copied"),
          "no copy message",
        );
        const after = await stored();
        expect(
          JSON.stringify(after) === JSON.stringify(before),
          "the copy changed the saved feedback",
        );
        await open();
        expect(
          (await prompt()) === expected,
          "the updates left the prompt after a copy and a reload",
        );
      },
    );

    await check("reports a cleared selection as OPEN", async () => {
      await page.locator(`[id="decision-${first.id}-clear"]`).click();
      expect(
        (await countText()) === `${answeredAtStart} / ${decisions.length} answered`,
        `the count is "${await countText()}"`,
      );
      expect(
        (await page.locator(`[id="decision-${first.id}"] input:checked`).count()) === 0,
        "an option is still checked",
      );
      const text = await prompt();
      const block = text.slice(text.indexOf(`${first.id}: `));
      expect(
        block.startsWith(`${first.id}: ${first.question}\nAnswer: OPEN`),
        "the decision is not OPEN in the prompt",
      );
      expect(block.includes("Notes: Check note A. Keep this."), "the notes are missing");
      await open();
      expect(
        (await countText()) === `${answeredAtStart} / ${decisions.length} answered`,
        "the count changed after a reload",
      );
    });
  }

  if (incorporated) {
    await check("reports a cleared answer of the record as OPEN with its reason", async () => {
      await page.locator(`[id="decision-${incorporated.id}-clear"]`).click();
      const text = await prompt();
      const block = text.slice(text.indexOf(`${incorporated.id}: `));
      expect(
        block.startsWith(`${incorporated.id}: ${incorporated.question}\nAnswer: OPEN`),
        "not OPEN in the prompt",
      );
      expect(block.includes("the maintainer cleared the selection"), "the reason is missing");
      const state = await page
        .locator(`[id="decision-${incorporated.id}"] .decision-state`)
        .innerText();
      expect(state.trim() === "Open", `the state is "${state}"`);
      // Select the recorded option again: the decision leaves the prompt.
      const selection = getRecorded(incorporated);
      await page.locator(`[id="decision-${incorporated.id}-option-${selection}"]`).check();
      expect(
        !(await prompt()).includes(`${incorporated.id}: `),
        "an unchanged decision is in the prompt",
      );
    });
  }

  await check("shows the prompt for a manual copy when the clipboard rejects", async () => {
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("blocked"));
    });
    const expected = await prompt();
    await press(page.locator("#copy-prompt-button"));
    const fallback = page.locator("#copy-fallback");
    await fallback.waitFor({ state: "visible", timeout: 3000 });
    const field = await page.evaluate(() => {
      const text = document.getElementById("copy-fallback-text");
      return {
        value: text.value,
        selected: text.selectionStart === 0 && text.selectionEnd === text.value.length,
        focused: document.activeElement === text,
        readOnly: text.readOnly,
      };
    });
    expect(field.value === expected, "the fallback text is not the prompt");
    expect(field.selected, "the text is not selected");
    expect(field.focused, "the text field does not have focus");
    await shot("copy-fallback");
    await page.locator("#copy-fallback-close").click();
    expect(await fallback.isHidden(), "the fallback did not close");
    await open();
  });

  if (first) {
    await check(
      "replaces the baseline when the revision changes, and keeps the feedback",
      async () => {
        const saved = await stored();
        saved.revision = "an-older-revision";
        saved.baseline = { [first.id]: { selection: first.options[0].id, notes: "old baseline" } };
        await store(saved);
        await open();
        const after = await stored();
        expect(after.revision === record.revision, "the revision was not updated");
        expect(
          JSON.stringify(after.baseline) === JSON.stringify(initial.baseline),
          "the baseline is not the incorporated feedback",
        );
        expect(
          after.current[first.id]?.notes === "Check note A. Keep this.",
          "the current feedback was lost",
        );
      },
    );

    await check("clears a selection that is no longer an option, and keeps its notes", async () => {
      const saved = await stored();
      saved.current[first.id] = {
        selection: "an-option-that-is-gone",
        notes: "Notes that must stay.",
      };
      await store(saved);
      await open();
      const panel = page.locator(`[id="decision-${first.id}"]`);
      expect(
        (await panel.locator(".decision-state").innerText()).trim() === "Open",
        "the decision is not Open",
      );
      expect(
        await panel.locator(".decision-stale").isVisible(),
        "no notice about the old selection",
      );
      expect(
        (await panel.locator("textarea").inputValue()) === "Notes that must stay.",
        "the notes are lost",
      );
      expect(
        (await countText()) === `${answeredAtStart} / ${decisions.length} answered`,
        "the old selection counts as an answer",
      );
      const text = await prompt();
      const block = text.slice(text.indexOf(`${first.id}: `));
      expect(
        block.startsWith(`${first.id}: ${first.question}\nAnswer: OPEN`),
        "not OPEN in the prompt",
      );
      expect(block.includes("is no longer an option"), "the reason is missing");
      await shot("stale", panel);
    });
  }

  // ------------------------------------------------------------- Menus

  await check("opens the Decisions menu with the keyboard and jumps below the bar", async () => {
    const button = page.locator("#decisions-button");
    const menu = page.locator("#decisions-menu");
    await button.focus();
    await page.keyboard.press("Enter");
    expect(await menu.isVisible(), "the menu did not open");
    const items = menu.locator("a");
    expect(
      (await items.count()) === decisions.length,
      `the menu has ${await items.count()} entries`,
    );
    for (let i = 0; i < decisions.length; i++) {
      const text = await items.nth(i).innerText();
      expect(text.includes(decisions[i].id), `entry ${i + 1} is not ${decisions[i].id}`);
      expect(/Open|Answered/.test(text), `entry ${i + 1} has no status`);
    }
    await shot("decisions-menu");
    await page.keyboard.press("Escape");
    expect(await menu.isHidden(), "Escape did not close the menu");
    expect(
      await button.evaluate((element) => document.activeElement === element),
      "focus did not return",
    );
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    expect(await menu.isHidden(), "the menu stayed open after a choice");
    const last = decisions[decisions.length - 1];
    await expectUncovered(`[id="decision-${last.id}"]`);
    const focused = await page.evaluate(
      (id) => document.activeElement?.id === id,
      `decision-${last.id}`,
    );
    expect(focused, "focus did not move to the panel");
  });

  await check("opens the Decisions menu with a press and reaches the first panel", async () => {
    await press(page.locator("#decisions-button"));
    const menu = page.locator("#decisions-menu");
    expect(await menu.isVisible(), "the menu did not open");
    await press(menu.locator("a").first());
    expect(await menu.isHidden(), "the menu stayed open");
    await expectUncovered(`[id="decision-${decisions[0].id}"]`);
  });

  await check("keeps the page index reachable", async () => {
    const sections = await page
      .locator("main > section[id]")
      .evaluateAll((list) => list.map((item) => item.id));
    if (viewportName === "wide") {
      expect(await page.locator("#sidebar").isVisible(), "the sidebar is hidden");
      expect(
        (await page.locator("#sidebar a").count()) === sections.length,
        "the sidebar misses sections",
      );
      await page.locator("#sidebar a").last().click();
    } else {
      expect(await page.locator("#sidebar").isHidden(), "the sidebar shows at a narrow width");
      await press(page.locator("#sections-button"));
      const menu = page.locator("#sections-menu");
      expect(await menu.isVisible(), "the Sections menu did not open");
      expect((await menu.locator("a").count()) === sections.length, "the menu misses sections");
      await shot("sections-menu");
      await press(menu.locator("a").last());
    }
    await expectUncovered(`[id="${sections[sections.length - 1]}"]`);
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  if (decisions.length) {
    await check("opens at the anchor of a link to a decision", async () => {
      const last = decisions[decisions.length - 1];
      // Leave the page first, so that the link loads the document again.
      await page.goto("about:blank");
      await page.goto(`${url}#decision-${last.id}`, { waitUntil: "load" });
      await page.locator("#doc[data-ready]").waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      await expectUncovered(`[id="decision-${last.id}"]`);
      await open();
    });
  }

  // ---------------------------------------------------------- Tooltips

  await check("follows the term rules for every occurrence", async () => {
    const report = await page.evaluate(() => window.visonautAudit.checkTerms());
    expect(
      report.insideControls.length === 0,
      `triggers inside controls: ${report.insideControls.join(" | ")}`,
    );
    expect(report.missed.length === 0, `terms without a trigger: ${report.missed.join(" | ")}`);
    expect(
      report.uncoveredLabels.length === 0,
      `label terms without a trigger beside them: ${report.uncoveredLabels.join(" | ")}`,
    );
    expect(
      report.uncoveredDrawings.length === 0,
      `drawing terms without a trigger below the drawing: ${report.uncoveredDrawings.join(" | ")}`,
    );
    expect(
      report.changedCode.length === 0,
      `code with changed text: ${report.changedCode.join(" | ")}`,
    );
    const clickable = await page.evaluate(() => {
      const found = [];
      for (const trigger of document.querySelectorAll("#doc .term")) {
        let ancestor = trigger.parentElement;
        while (ancestor && ancestor.id !== "doc") {
          if (getComputedStyle(ancestor).cursor === "pointer") {
            found.push(`${trigger.textContent} in <${ancestor.localName}>`);
            break;
          }
          ancestor = ancestor.parentElement;
        }
      }
      return [...new Set(found)].slice(0, 5);
    });
    expect(
      clickable.length === 0,
      `triggers inside an element that takes a press: ${clickable.join(" | ")}`,
    );
    // The "?" mark of a link stays on the line where the link ends.
    const stranded = await page.evaluate(() => {
      const found = [];
      for (const mark of document.querySelectorAll("#doc a + .term-mark")) {
        const lines = mark.previousElementSibling.getClientRects();
        const last = lines[lines.length - 1];
        const box = mark.getBoundingClientRect();
        if (!last || box.width === 0) continue;
        if (box.top > last.bottom - 2) {
          found.push(mark.previousElementSibling.textContent.trim().slice(0, 40));
        }
      }
      return found;
    });
    expect(
      stranded.length === 0,
      `a "?" mark is on another line than its link: ${stranded.join(" | ")}`,
    );
    const glossary = await page.evaluate(() => {
      const store = document.getElementById("term-definitions");
      return {
        rendered: store.getClientRects().length > 0,
        links: document.querySelectorAll('a[href*="term-definition"]').length,
        inCode: document.querySelectorAll("pre .term-mark, pre .fact-tag").length,
      };
    });
    expect(!glossary.rendered, "the definitions are rendered as a glossary");
    expect(glossary.links === 0, "a link points to a definition");
    expect(glossary.inCode === 0, "a code block has an added mark");
    if (terms.length) {
      expect(report.triggers > 0, "the page has terms but no trigger");
    }
    return `${report.triggers} triggers`;
  });

  if (terms.length) {
    const trigger = page.locator("main p .term[data-term-key^='term:']:visible").first();
    const tooltip = page.locator("#term-tooltip");
    const definition = async () => {
      const key = await trigger.getAttribute("data-term-key");
      return terms[Number(key.slice(5))].definition;
    };

    await check("shows a tooltip on keyboard focus and closes it with Escape", async () => {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      expect(await tooltip.isVisible(), "focus did not show the tooltip");
      expect(
        (await tooltip.innerText()).includes(await definition()),
        "the tooltip has another text",
      );
      const described = await trigger.evaluate((element) => {
        return document.getElementById(element.getAttribute("aria-describedby"))?.textContent;
      });
      expect(
        described === (await definition()),
        "aria-describedby does not point to the definition",
      );
      await shot("tooltip");
      await page.keyboard.press("Escape");
      expect(await tooltip.isHidden(), "Escape did not close the tooltip");
      await trigger.evaluate((element) => element.blur());
    });

    if (viewport.touch) {
      await check("opens a tooltip with a tap, without hover", async () => {
        await trigger.tap();
        expect(await tooltip.isVisible(), "a tap did not show the tooltip");
        await trigger.tap();
        expect(await tooltip.isHidden(), "a second tap did not close the tooltip");
        await trigger.tap();
        expect(await tooltip.isVisible(), "a third tap did not show the tooltip again");
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator(".masthead .eyebrow").tap();
        expect(await tooltip.isHidden(), "a tap outside did not close the tooltip");
      });
    } else {
      await check("shows a tooltip on hover and hides it when the pointer leaves", async () => {
        await trigger.hover();
        await tooltip.waitFor({ state: "visible", timeout: 2000 });
        expect(
          (await tooltip.innerText()).includes(await definition()),
          "the tooltip has another text",
        );
        await page.mouse.move(2, viewport.height - 2);
        await tooltip.waitFor({ state: "hidden", timeout: 2000 });
      });
    }
  }

  // --------------------------------------------------------------- Code

  await check("highlights code and copies the unchanged source", async () => {
    const blocks = await page.locator("main pre > code").count();
    if (blocks === 0) {
      return "no code blocks";
    }
    const loaded = await page
      .waitForFunction(() => Boolean(window.hljs), null, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    expect(loaded, "highlight.js did not load. The code is plain. Check the network.");
    await page.waitForTimeout(100);
    const tokens = await page
      .locator('main pre > code:not(.language-text) [class^="hljs-"]')
      .count();
    expect(tokens > 0, "no code token has a highlight class");
    const code = page.locator("main pre > code").first();
    const text = await code.evaluate((element) => element.textContent);
    await page.locator(".code button").first().click();
    await page.waitForTimeout(150);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied === text, "the copied code is not the shown code");
    const report = await page.evaluate(() => window.visonautAudit.checkTerms());
    expect(report.changedCode.length === 0, "highlighting changed the code text");
    expect(
      report.missed.length === 0,
      `terms without a trigger after highlighting: ${report.missed.join(" | ")}`,
    );
    await shot("code", page.locator(".code").first());
    return `${blocks} blocks, ${tokens} tokens`;
  });

  // -------------------------------------------------------------- Demos

  const demoState = (id) => page.locator(`[id="${id}-state"]`).innerText();
  const demos = await page.locator("[data-demo]").evaluateAll((list) => {
    return list.map((item) => ({ id: item.id, type: item.dataset.demo }));
  });

  await check("labels each demo as simulated, with limits, a state, and Reset", async () => {
    expect((await page.locator(".demo-error").count()) === 0, "a demo shows a configuration error");
    for (const demo of demos) {
      const host = page.locator(`[id="${demo.id}"]`);
      expect(
        (await host.locator(".demo-label").innerText()).trim().length > 0,
        `${demo.id} has no label`,
      );
      expect(
        (await host.locator(".demo-limits").innerText()).trim().length > 20,
        `${demo.id} has no limits`,
      );
      expect((await demoState(demo.id)).startsWith("State:"), `${demo.id} has no state`);
      expect(
        (await host.locator(`[id="${demo.id}-reset"]`).count()) === 1,
        `${demo.id} has no Reset`,
      );
    }
    return `${demos.length} demos`;
  });

  const interactions = {
    timeline: async (demo, host) => {
      const total = host.locator(".readout-value").last();
      const before = await total.innerText();
      await host.locator('.timeline-toggles input[type="checkbox"]').first().check();
      expect((await host.locator(".timeline-row").count()) > 1, "no rows");
      await host.locator('.timeline-toggles input[type="checkbox"]').last().check();
      const after = await total.innerText();
      expect(after !== before, "the total did not change");
      const preset = host.locator(".segmented button").last();
      if (await preset.count()) {
        await preset.click();
        expect(
          (await preset.getAttribute("aria-pressed")) === "true",
          "the preset is not marked as on",
        );
      }
      await shot(`demo-${demo.id}`, host);
    },
    calculator: async (demo, host) => {
      const output = host.locator("output.readout-value").first();
      const before = await host.locator(".calculator-outputs").innerText();
      const range = host.locator('input[type="range"]').first();
      await range.focus();
      await page.keyboard.press("End");
      expect(
        (await host.locator(".calculator-outputs").innerText()) !== before,
        "the outputs did not change",
      );
      expect((await output.innerText()).trim().length > 0, "an output is empty");
      await shot(`demo-${demo.id}`, host);
    },
    compare: async (demo, host) => {
      const tabs = host.locator('[role="tab"]');
      await tabs.nth(1).click();
      expect(
        (await tabs.nth(1).getAttribute("aria-selected")) === "true",
        "the second tab is not selected",
      );
      expect(
        await host.locator('[role="tabpanel"]').nth(0).isHidden(),
        "the first panel is still visible",
      );
      expect(
        await host.locator('[role="tabpanel"]').nth(1).isVisible(),
        "the second panel is hidden",
      );
      await tabs.nth(1).focus();
      await page.keyboard.press("ArrowLeft");
      expect(
        (await tabs.nth(0).getAttribute("aria-selected")) === "true",
        "the arrow key did not move the tab",
      );
      await page.keyboard.press("ArrowRight");
      await host.locator(`[id="${demo.id}-all"]`).check();
      expect(
        (await host.locator('[role="tabpanel"]:visible').count()) === (await tabs.count()),
        "not all panels show",
      );
      await shot(`demo-${demo.id}`, host);
    },
    sequence: async (demo, host) => {
      await host.locator(`[id="${demo.id}-next"]`).click();
      expect((await demoState(demo.id)).includes("step 2 of"), "Next did not move to step 2");
      expect((await host.locator('[aria-current="step"]').count()) === 1, "no highlighted step");
      await host.locator(`[id="${demo.id}-previous"]`).click();
      expect((await demoState(demo.id)).includes("step 1 of"), "Previous did not go back");
      await host.locator(`[id="${demo.id}-play"]`).click();
      expect((await demoState(demo.id)).includes("playing"), "Play did not start");
      await page.waitForFunction(
        (id) => !document.getElementById(`${id}-state`).textContent.includes("step 1 of"),
        demo.id,
        { timeout: 8000 },
      );
      await host.locator(`[id="${demo.id}-play"]`).click();
      expect((await demoState(demo.id)).includes("paused"), "Pause did not stop");
      await shot(`demo-${demo.id}`, host);
    },
    viewer: async (demo, host) => {
      const modes = await host
        .locator(".viewer-controls .segmented button[aria-pressed]")
        .evaluateAll((list) => {
          return list.map((item) => ({ id: item.id, label: item.textContent }));
        });
      for (const mode of modes) {
        await host.locator(`[id="${mode.id}"]`).click();
        expect(
          (await demoState(demo.id)).includes(mode.label),
          `the state does not name ${mode.label}`,
        );
        if (mode.id.endsWith("-swipe")) {
          const range = host.locator(`[id="${demo.id}-split"]`);
          await range.focus();
          await page.keyboard.press("ArrowRight");
          expect(
            (await demoState(demo.id)).includes("51%"),
            "the divider did not move with the keyboard",
          );
          const stage = host.locator(".viewer-stage");
          const box = await stage.boundingBox();
          await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 4 });
          await page.mouse.up();
          expect(
            (await demoState(demo.id)).includes("25%"),
            `a drag did not move the divider: ${await demoState(demo.id)}`,
          );
        }
        if (mode.id.endsWith("-overlay")) {
          const range = host.locator(`[id="${demo.id}-opacity"]`);
          await range.focus();
          await page.keyboard.press("Home");
          expect((await demoState(demo.id)).includes("0% opacity"), "the opacity did not change");
        }
        if (mode.id.endsWith("-blink")) {
          const before = await demoState(demo.id);
          await host.locator(`[id="${demo.id}-swap"]`).click();
          expect((await demoState(demo.id)) !== before, "the swap did not change the image");
        }
        if (mode.id.endsWith("-diff")) {
          await page.waitForFunction(
            (id) =>
              /pixels differ|cannot compare/.test(
                document.getElementById(`${id}-state`).textContent,
              ),
            demo.id,
            { timeout: 8000 },
          );
          expect(
            (await demoState(demo.id)).includes("pixels differ"),
            `no pixel result: ${await demoState(demo.id)}`,
          );
        }
        await shot(`demo-${demo.id}-${mode.id.slice(demo.id.length + 6)}`, host);
      }
    },
  };

  for (const type of Object.keys(interactions)) {
    const demo = demos.find((item) => item.type === type);
    if (!demo) continue;
    await check(`${type} demo: changes its state and resets`, async () => {
      const host = page.locator(`[id="${demo.id}"]`);
      await host.scrollIntoViewIfNeeded();
      const initialState = await demoState(demo.id);
      await interactions[type](demo, host);
      expect((await demoState(demo.id)) !== initialState, "the state line did not change");
      await host.locator(`[id="${demo.id}-reset"]`).click();
      expect(
        (await demoState(demo.id)) === initialState,
        `Reset left the state "${await demoState(demo.id)}"`,
      );
    });
  }

  // ----------------------------------------------------------- Findings

  if (findings.length) {
    const visibleRows = () => page.locator("#findings-explorer tbody tr:visible").count();
    await check("filters, counts, and sorts the findings", async () => {
      const limit = Math.min(findings.length, 40);
      expect((await visibleRows()) === limit, `${await visibleRows()} rows at start`);
      const last = findings[findings.length - 1];
      await page.locator("#findings-filter-text").fill(last.id);
      const matches = findings.filter((finding) => {
        return [finding.id, finding.title, finding.summary, finding.area, finding.kind]
          .join(" ")
          .toLowerCase()
          .includes(last.id.toLowerCase());
      }).length;
      expect(
        (await visibleRows()) === Math.min(matches, 40),
        `the text filter shows ${await visibleRows()} rows`,
      );
      expect(
        (await page.locator("#findings-count").innerText()).includes(
          `of ${findings.length} finding`,
        ),
        "the count is wrong",
      );
      await page.locator("#findings-reset").click();
      for (const key of ["area", "severity", "kind", "verdict"]) {
        const value = findings[0][key];
        await page.locator(`#findings-filter-${key}`).selectOption(value);
        const wanted = findings.filter((finding) => finding[key] === value).length;
        expect(
          (await visibleRows()) === Math.min(wanted, 40),
          `the ${key} filter shows ${await visibleRows()} rows`,
        );
        await page.locator(`#findings-filter-${key}`).selectOption("");
      }
      if (viewportName === "wide") {
        const header = page.locator("#findings-sort-severity");
        await header.click();
        expect(
          (await header.locator("xpath=..").getAttribute("aria-sort")) === "ascending",
          "aria-sort is not ascending",
        );
        const order = ["critical", "high", "medium", "low", "info"];
        const top = await page
          .locator("#findings-explorer tbody tr:visible .severity")
          .first()
          .getAttribute("data-severity");
        const highest = order.find((severity) =>
          findings.some((finding) => finding.severity === severity),
        );
        expect(top === highest, `the first row is ${top}, not ${highest}`);
        await header.click();
        expect(
          (await header.locator("xpath=..").getAttribute("aria-sort")) === "descending",
          "aria-sort is not descending",
        );
      } else {
        await page.locator("#findings-sort").selectOption("severity");
      }
      await shot("findings", page.locator("#findings-explorer"));
      await page.locator("#findings-reset").click();
      expect((await visibleRows()) === limit, "Reset did not show the rows again");
    });

    await check("follows a finding chip to its row, also when a filter hides the row", async () => {
      const chip = page.locator('main a.chip[href^="#finding-"]').first();
      if ((await chip.count()) === 0) {
        return "no finding chips";
      }
      const id = (await chip.getAttribute("href")).slice(9);
      const finding = findings.find((item) => item.id === id);
      const hiding = findings.find((item) => item.severity !== finding.severity);
      if (hiding) {
        await page.locator("#findings-filter-severity").selectOption(hiding.severity);
        expect(
          await page.locator(`[id="finding-${id}"]`).isHidden(),
          "the filter did not hide the row",
        );
      }
      await chip.scrollIntoViewIfNeeded();
      await press(chip);
      expect(await page.locator(`[id="finding-${id}"]`).isVisible(), "the row is hidden");
      await expectUncovered(`[id="finding-${id}"]`);
    });
  }

  await check("shows every decision in the decision record", async () => {
    const list = page.locator("#decision-record-list");
    for (const decision of decisions) {
      expect(
        (await list.locator(`a[href="#decision-${decision.id}"]`).count()) === 1,
        `${decision.id} is not in the record`,
      );
    }
    const titles = await list.locator(".record-group-title").allInnerTexts();
    expect(titles.length === 3, "the record does not have the three groups");
    await shot("record", list);
    await shot("prompt", page.locator(".prompt"));
  });

  await check("offers a portable copy of the complete record", async () => {
    await page.locator("#record-export > summary").click();
    const text = await page.locator("#record-export-text").inputValue();
    for (const decision of decisions) {
      expect(text.includes(`${decision.id}: ${decision.question}`), `${decision.id} is missing`);
    }
    await page.locator("#copy-record-button").click();
    await page.waitForTimeout(150);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied === text, "the copied record is not the shown record");
  });

  await check("opens each external link in a new tab", async () => {
    const links = await page.locator('main a[href^="http"]').evaluateAll((list) => {
      return list.map((link) => ({ href: link.href, target: link.target, rel: link.rel }));
    });
    for (const link of links) {
      expect(link.target === "_blank", `${link.href} does not open in a new tab`);
      expect(link.rel.includes("noopener"), `${link.href} has no rel="noopener"`);
    }
    return `${links.length} external links`;
  });

  await check("ends without a console error", async () => {
    const errors = problems.filter((problem) => !problem.includes("fonts.g"));
    expect(errors.length === 0, errors.join(" | "));
    const fonts = problems.filter((problem) => problem.includes("fonts.g"));
    return fonts.length ? "the web fonts did not load; the fallback fonts are in use" : undefined;
  });

  await context.close();
  return { label, results };
}

async function main() {
  const only = readOption("--only");
  const shots = readOption("--shots");
  if (shots) {
    mkdirSync(shots, { recursive: true });
  }
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch({ channel: "chrome" });
  let failed = 0;
  try {
    for (const target of Object.keys(outputs)) {
      if (only && only !== target) continue;
      for (const viewportName of Object.keys(viewports)) {
        const { label, results } = await runChecks({
          browser,
          url: `http://127.0.0.1:${port}/${target}/`,
          target,
          viewportName,
          shots,
        });
        console.log(`\n${label}`);
        for (const result of results) {
          if (!result.ok) {
            failed += 1;
          }
          const note = result.note ? `  (${result.note})` : "";
          console.log(`  ${result.ok ? "pass" : "FAIL"}  ${result.name}${note}`);
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exitCode = failed ? 1 : 0;
}

await main();

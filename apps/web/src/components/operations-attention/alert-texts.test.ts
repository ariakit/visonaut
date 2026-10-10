import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  alertTexts,
  getAlertText,
  getGuideUrl,
  guideParts,
  type AlertText,
} from "./alert-texts.ts";

const guide = readFileSync(new URL("../../operations/README.md", import.meta.url), "utf8");

/** The words of each kind, and of each code that has its own words. */
function eachText() {
  const texts: [string, AlertText][] = [];
  for (const [kind, { codes, ...text }] of Object.entries(alertTexts)) {
    texts.push([kind, text]);
    for (const [code, words] of Object.entries(codes ?? {})) {
      texts.push([`${kind}: ${code}`, { ...text, ...words }]);
    }
  }
  return texts;
}

it("has a heading in the operations guide for each part that an alert links to", () => {
  for (const [anchor, heading] of Object.entries(guideParts)) {
    expect(guide).toContain(`\n## ${heading}\n`);
    // GitHub makes the anchor from the heading.
    expect(heading.toLowerCase().replaceAll(" ", "-")).toBe(anchor);
  }
  expect(getGuideUrl("locked-check")).toBe(
    "https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md#locked-check",
  );
});

it("names the guide only in the words of an alert that has a procedure in the guide", () => {
  const withGuide: string[] = [];
  for (const [name, text] of eachText()) {
    expect([name, /guide/i.test(text.action)]).toEqual([name, text.guide != null]);
    if (text.guide) {
      withGuide.push(name);
      expect(text.action).toContain(`“${guideParts[text.guide]}”`);
    }
  }
  expect(withGuide).toEqual(["check-delivery: ambiguous", "restore"]);
});

it("gives each alert a title and a sentence of what to do", () => {
  for (const [name, text] of eachText()) {
    expect([name, text.title.length > 0, text.action.endsWith(".")]).toEqual([name, true, true]);
  }
});

it("uses the words of a code, then of the kind, then the general words", () => {
  expect(getAlertText("check-delivery", "ambiguous")).toMatchObject({
    title: "A GitHub check needs attention",
    guide: "locked-check",
  });
  expect(getAlertText("check-delivery", "exhausted").guide).toBeUndefined();
  expect(getAlertText("promotion", "step-failed").title).toBe("The promotion step failed");
  expect(getAlertText("promotion", "state-changed").title).toBe(
    "A baseline update needs attention",
  );
  expect(getAlertText("backup", "backup-failed").title).toBe("A service alert needs attention");
  // A name of the object prototype is not a kind and not a code.
  expect(getAlertText("constructor", "x").title).toBe("A service alert needs attention");
  expect(getAlertText("promotion", "constructor").title).toBe("A baseline update needs attention");
});

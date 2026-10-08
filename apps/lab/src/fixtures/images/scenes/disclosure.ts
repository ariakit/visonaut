import { canvas, icon, panel, separator } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { text } from "../svg.ts";

const width = 640;
const height = 400;
const extraLineHeight = 22;
const changedHeight = height + extraLineHeight;
const cardX = 80;
const cardY = 40;
const cardWidth = 480;
const rowHeight = 52;

const questions = [
  "What is Ariakit?",
  "How do I install it?",
  "Does it work with my styles?",
  "Is it accessible?",
  "Can I use it with Solid?",
];

const answer = [
  "Ariakit is an open source library with unstyled components",
  "and hooks for building accessible web apps.",
];
const extraLine = "It works with React and Solid.";

/**
 * A list of disclosures with the first one expanded. The answer gains a line,
 * so the page and the screenshot grow taller.
 */
export const disclosureScene: SceneDefinition = {
  id: "disclosure",
  title: "Disclosure",
  size: "medium",
  width,
  height,
  changedHeight,
  change: { kind: "size", summary: "The expanded content is one line taller." },
  regions: [{ x: 0, y: 0, width, height: changedHeight }],
  density: 1,
  render({ palette, changed }) {
    const lines = changed ? [...answer, extraLine] : answer;
    const contentHeight = lines.length * 22 + 16;
    const cardHeight = rowHeight * questions.length + contentHeight;
    let result =
      canvas(palette, width, changed ? changedHeight : height) +
      panel(palette, { x: cardX, y: cardY, width: cardWidth, height: cardHeight });
    let y = cardY;
    questions.forEach((question, index) => {
      const expanded = index === 0;
      if (index > 0) {
        result += separator(palette, cardX + 1, y, cardWidth - 2);
      }
      result +=
        icon({
          name: expanded ? "chevronDown" : "chevronRight",
          x: cardX + 18,
          y: y + rowHeight / 2 - 8,
          color: palette.muted,
        }) +
        text({
          x: cardX + 46,
          y: y + rowHeight / 2,
          value: question,
          fill: palette.text,
          size: 15,
          weight: 500,
        });
      y += rowHeight;
      if (!expanded) return;
      lines.forEach((line, lineIndex) => {
        result += text({
          x: cardX + 46,
          y: y + 7 + lineIndex * 22,
          value: line,
          fill: palette.muted,
        });
      });
      y += contentHeight;
    });
    return result;
  },
};

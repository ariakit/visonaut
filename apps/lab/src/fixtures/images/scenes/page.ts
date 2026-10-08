import { button, canvas, icon, input, mix, panel, separator, textWidth } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { circle, element, rect, text } from "../svg.ts";

const width = 1280;
const height = 720;
const sidebarWidth = 248;
const mainX = 296;
const tocX = 992;

const guideLinks = ["Introduction", "Installation", "Styling", "Composition"];
const componentLinks = [
  "Button",
  "Checkbox",
  "Combobox",
  "Dialog",
  "Disclosure",
  "Menu",
  "Popover",
];
const inlineLinkX = mainX + Math.round(textWidth("Read the ", 15));
const inlineLinkWidth = Math.round(textWidth("getting started guide", 15)) + 2;

const cards = [
  { title: "Styling", description: "Use any styling solution with data attributes." },
  { title: "Composition", description: "Combine components with the render prop." },
];

/**
 * A documentation page with a header, a sidebar, and a table of contents. The
 * link color changes in five separate places.
 */
export const pageScene: SceneDefinition = {
  id: "page",
  title: "Documentation page",
  size: "wide",
  width,
  height,
  change: { kind: "color", summary: "The link color changed across the page." },
  regions: [
    { x: tocX - 2, y: 121, width: 132, height: 22 },
    { x: 20, y: 150, width: 208, height: 32 },
    { x: inlineLinkX - 2, y: 318, width: inlineLinkWidth + 6, height: 24 },
    { x: mainX + 18, y: 591, width: 104, height: 22 },
    { x: mainX + 346, y: 591, width: 104, height: 22 },
  ],
  density: 0.3,
  render({ palette, changed }) {
    const link = changed ? mix(palette.link, "#b0309a", 0.55) : palette.link;
    let result =
      canvas(palette, width, height) +
      // Header.
      circle({ x: 44, y: 28, radius: 11, fill: palette.primary }) +
      text({ x: 64, y: 28, value: "Ariakit", fill: palette.text, size: 16, weight: 700 });
    let navX = 160;
    for (const label of ["Components", "Examples", "Guide", "Blog"]) {
      result += text({
        x: navX,
        y: 28,
        value: label,
        fill: label === "Guide" ? palette.text : palette.muted,
        weight: 500,
      });
      navX += textWidth(label, 14, 500) + 28;
    }
    result +=
      input(palette, { x: 904, y: 10, width: 232, height: 36, placeholder: "Search" }) +
      icon({ name: "search", x: 1108, y: 20, color: palette.faint }) +
      button(palette, { x: 1152, y: 10, width: 96, label: "Sign in" }) +
      separator(palette, 0, 56, width) +
      // Sidebar.
      rect({ x: sidebarWidth, y: 57, width: 1, height: height - 57, fill: palette.border }) +
      text({
        x: 32,
        y: 96,
        value: "GETTING STARTED",
        fill: palette.faint,
        size: 11,
        weight: 600,
        spacing: 0.6,
      });
    guideLinks.forEach((label, index) => {
      const y = 134 + index * 32;
      const active = label === "Installation";
      if (active) {
        result += rect({
          x: 20,
          y: y - 16,
          width: 208,
          height: 32,
          radius: 8,
          fill: palette.forced ? palette.surface : mix(palette.canvas, link, 0.12),
          stroke: palette.forced ? palette.border : undefined,
        });
      }
      result += text({
        x: 32,
        y,
        value: label,
        fill: active ? link : palette.muted,
        weight: active ? 500 : 400,
      });
    });
    result += text({
      x: 32,
      y: 292,
      value: "COMPONENTS",
      fill: palette.faint,
      size: 11,
      weight: 600,
      spacing: 0.6,
    });
    componentLinks.forEach((label, index) => {
      result += text({ x: 32, y: 330 + index * 32, value: label, fill: palette.muted });
    });
    // Main column.
    result +=
      text({ x: mainX, y: 98, value: "Guide", fill: palette.muted, size: 13 }) +
      icon({ name: "chevronRight", x: mainX + 40, y: 91, color: palette.faint, size: 14 }) +
      text({ x: mainX + 60, y: 98, value: "Installation", fill: palette.text, size: 13 }) +
      text({ x: mainX, y: 146, value: "Installation", fill: palette.text, size: 34, weight: 700 }) +
      text({
        x: mainX,
        y: 198,
        value: "Add Ariakit to a React or Solid project in a few minutes. The package",
        fill: palette.muted,
        size: 17,
      }) +
      text({
        x: mainX,
        y: 224,
        value: "ships unstyled, accessible components that work with any styles.",
        fill: palette.muted,
        size: 17,
      }) +
      text({
        x: mainX,
        y: 286,
        value: "Install the package",
        fill: palette.text,
        size: 21,
        weight: 600,
      }) +
      // One text element keeps the natural word spacing around the link.
      element(
        "text",
        { x: mainX, y: 335.25, "font-size": 15, fill: palette.text },
        "Read the " +
          element(
            "tspan",
            { fill: link, "text-decoration": "underline" },
            "getting started guide",
          ) +
          " before you install the package.",
      ) +
      rect({
        x: mainX,
        y: 362,
        width: 648,
        height: 56,
        radius: 10,
        fill: palette.subtle,
        stroke: palette.border,
      }) +
      text({
        x: mainX + 20,
        y: 390,
        value: "npm install @ariakit/react",
        fill: palette.text,
        mono: true,
      }) +
      text({ x: mainX, y: 472, value: "Next steps", fill: palette.text, size: 21, weight: 600 });
    cards.forEach((card, index) => {
      const x = mainX + index * 328;
      result +=
        panel(palette, { x, y: 504, width: 320, height: 124 }) +
        text({ x: x + 20, y: 534, value: card.title, fill: palette.text, size: 16, weight: 600 }) +
        text({ x: x + 20, y: 562, value: card.description, fill: palette.muted, size: 13 }) +
        text({ x: x + 20, y: 602, value: "Learn more", fill: link, weight: 500 }) +
        icon({ name: "arrowRight", x: x + 98, y: 594, color: link });
    });
    // Table of contents.
    result +=
      text({ x: tocX, y: 98, value: "On this page", fill: palette.text, size: 13, weight: 600 }) +
      text({ x: tocX, y: 132, value: "Install the package", fill: link, size: 13, weight: 500 }) +
      text({ x: tocX, y: 162, value: "Next steps", fill: palette.muted, size: 13 }) +
      text({ x: tocX, y: 192, value: "Troubleshooting", fill: palette.muted, size: 13 });
    return result;
  },
};

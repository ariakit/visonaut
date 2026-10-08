import { button, canvas, checkbox, input, panel, radio, separator } from "../kit.ts";
import { getPalette } from "../palette.ts";
import type { Palette } from "../palette.ts";
import type { SceneDefinition } from "../scene.ts";
import { rect, text } from "../svg.ts";

const width = 800;
const height = 1600;
const columnX = 120;
const columnWidth = 560;
const halfWidth = (columnWidth - 16) / 2;
const shift = 2;

interface FieldOptions {
  label: string;
  value?: string;
  placeholder?: string;
  helper?: string;
  chevron?: boolean;
  prefix?: string;
  /** Extra input height. The regression uses it on one field. */
  grow?: number;
}

interface FormLayout {
  body: string;
  /** The bottom edge of the Email input in the baseline image. */
  shiftStart: number;
  /** The bottom edge of the last element in the current image. */
  contentBottom: number;
}

const plans = [
  { name: "Hobby", price: "Free" },
  { name: "Pro", price: "$12 per month" },
  { name: "Team", price: "$48 per month" },
];

function layoutForm(palette: Palette, changed: boolean): FormLayout {
  let body = canvas(palette, width, height);
  let y = 72;
  let shiftStart = 0;

  const field = (x: number, fieldWidth: number, options: FieldOptions) => {
    const inputHeight = 40 + (options.grow ?? 0);
    let result =
      text({ x, y: y + 9, value: options.label, fill: palette.text, weight: 500 }) +
      input(palette, {
        x,
        y: y + 26,
        width: fieldWidth,
        height: inputHeight,
        value: options.value,
        placeholder: options.placeholder,
        chevron: options.chevron,
        prefix: options.prefix,
      });
    let used = 26 + inputHeight;
    if (options.helper) {
      result += text({
        x,
        y: y + used + 16,
        value: options.helper,
        fill: palette.muted,
        size: 13,
      });
      used += 26;
    }
    body += result;
    return used;
  };
  const row = (fields: FieldOptions[]) => {
    const fieldWidth = fields.length === 2 ? halfWidth : columnWidth;
    let tallest = 0;
    fields.forEach((options, index) => {
      tallest = Math.max(tallest, field(columnX + index * (halfWidth + 16), fieldWidth, options));
    });
    y += tallest + 20;
  };
  const section = (title: string, description: string) => {
    body +=
      separator(palette, columnX, y, columnWidth) +
      text({ x: columnX, y: y + 38, value: title, fill: palette.text, size: 18, weight: 600 }) +
      text({ x: columnX, y: y + 62, value: description, fill: palette.muted });
    y += 92;
  };

  body +=
    text({
      x: columnX,
      y,
      value: "Create your account",
      fill: palette.text,
      size: 30,
      weight: 700,
    }) +
    text({
      x: columnX,
      y: y + 36,
      value: "It takes about two minutes. You can change everything later.",
      fill: palette.muted,
      size: 15,
    });
  y += 72;

  section("Profile", "This information appears on your public profile.");
  row([
    { label: "First name", value: "Diego" },
    { label: "Last name", value: "Haz" },
  ]);
  // The Email input is where the regression starts: it grows by two pixels,
  // so everything under it moves down.
  shiftStart = y + 26 + 40;
  row([
    {
      label: "Email",
      value: "haz@example.com",
      helper: "We only use it for account notices.",
      grow: changed ? shift : 0,
    },
  ]);
  row([{ label: "Username", value: "haz", prefix: "ariakit.org/" }]);

  section("Address", "We use it to calculate taxes on paid plans.");
  row([{ label: "Street address", value: "221 Larkin Street" }]);
  row([
    { label: "City", value: "San Francisco" },
    { label: "State", value: "California", chevron: true },
  ]);
  row([
    { label: "ZIP code", value: "94102" },
    { label: "Country", value: "United States", chevron: true },
  ]);

  section("Plan", "Pick the plan that fits your team.");
  plans.forEach((plan, index) => {
    const cardWidth = (columnWidth - 32) / 3;
    const x = columnX + index * (cardWidth + 16);
    const selected = index === 1;
    body +=
      rect({
        x,
        y,
        width: cardWidth,
        height: 76,
        radius: 10,
        fill: palette.surface,
        stroke: selected ? palette.primary : palette.borderStrong,
        strokeWidth: selected ? 2 : 1,
      }) +
      radio(palette, { x: x + 14, y: y + 14, checked: selected }) +
      text({ x: x + 42, y: y + 23, value: plan.name, fill: palette.text, weight: 500 }) +
      text({ x: x + 42, y: y + 48, value: plan.price, fill: palette.muted, size: 13 });
  });
  y += 76 + 24;
  for (const [index, label] of ["Send me product updates", "Send me security alerts"].entries()) {
    body +=
      checkbox(palette, { x: columnX, y, checked: index === 0 }) +
      text({ x: columnX + 30, y: y + 9, value: label, fill: palette.text });
    y += 34;
  }
  y += 10;

  section("Payment", "Your card is charged at the end of the trial.");
  row([{ label: "Card number", placeholder: "1234 1234 1234 1234" }]);
  row([
    { label: "Expiry date", placeholder: "MM / YY" },
    { label: "Security code", placeholder: "CVC" },
  ]);

  y += 8;
  body +=
    panel(palette, { x: columnX, y, width: columnWidth, height: 68, fill: palette.subtle }) +
    text({
      x: columnX + 20,
      y: y + 34,
      value: "You can cancel at any time.",
      fill: palette.muted,
    }) +
    button(palette, { x: columnX + 300, y: y + 16, width: 84, label: "Cancel" }) +
    button(palette, {
      x: columnX + 396,
      y: y + 16,
      width: 144,
      label: "Create account",
      kind: "primary",
    });
  y += 68;

  return { body, shiftStart, contentBottom: y };
}

const measured = layoutForm(getPalette({ scheme: "light" }), true);

/**
 * A long account form. One input grows by two pixels, so every element under
 * it moves down. The change covers most of the image.
 */
export const formScene: SceneDefinition = {
  id: "form",
  title: "Account form",
  size: "tall",
  width,
  height,
  change: {
    kind: "shift",
    summary: "The Email input is 2 pixels taller, so the form under it moved down.",
  },
  regions: [
    {
      // The region starts at the top of the Email input. The text in the
      // input moves too, because it stays centered in the taller input.
      x: columnX,
      y: measured.shiftStart - 40,
      width: columnWidth,
      height: measured.contentBottom - measured.shiftStart + 40,
    },
  ],
  density: 0.07,
  render: ({ palette, changed }) => layoutForm(palette, changed).body,
};

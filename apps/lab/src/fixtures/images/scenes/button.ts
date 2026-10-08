import { button, canvas, mix } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";

const width = 320;
const height = 120;
const primaryBox = { x: 118, y: 42, width: 84, height: 36 };

/** Three button states in a row. The primary color shifts toward violet. */
export const buttonScene: SceneDefinition = {
  id: "button",
  title: "Button",
  size: "small",
  width,
  height,
  change: { kind: "color", summary: "The primary button color changed." },
  regions: [primaryBox],
  density: 0.82,
  render({ palette, changed }) {
    const primaryFill = changed ? mix(palette.primary, "#8b3df0", 0.3) : palette.primary;
    return (
      canvas(palette, width, height) +
      button(palette, { x: 22, y: 42, width: 84, label: "Default" }) +
      button(palette, { ...primaryBox, label: "Primary", kind: "primary", fill: primaryFill }) +
      button(palette, { x: 214, y: 42, width: 84, label: "Disabled", disabled: true })
    );
  },
};

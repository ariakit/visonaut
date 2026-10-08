import type { SceneDefinition, SceneId } from "../scene.ts";
import { buttonScene } from "./button.ts";
import { checkboxScene } from "./checkbox.ts";
import { comboboxScene } from "./combobox.ts";
import { dialogScene } from "./dialog.ts";
import { disclosureScene } from "./disclosure.ts";
import { formScene } from "./form.ts";
import { menuScene } from "./menu.ts";
import { pageScene } from "./page.ts";
import { popoverScene } from "./popover.ts";
import { selectScene } from "./select.ts";
import { tableScene } from "./table.ts";
import { tabsScene } from "./tabs.ts";
import { toolbarScene } from "./toolbar.ts";
import { tooltipScene } from "./tooltip.ts";

const definitions: Record<SceneId, SceneDefinition> = {
  button: buttonScene,
  checkbox: checkboxScene,
  combobox: comboboxScene,
  dialog: dialogScene,
  disclosure: disclosureScene,
  form: formScene,
  menu: menuScene,
  page: pageScene,
  popover: popoverScene,
  select: selectScene,
  table: tableScene,
  tabs: tabsScene,
  toolbar: toolbarScene,
  tooltip: tooltipScene,
};

/** Every mock screenshot scene, in alphabetical order. */
export const scenes: SceneDefinition[] = Object.values(definitions);

export function getScene(id: SceneId): SceneDefinition {
  return definitions[id];
}

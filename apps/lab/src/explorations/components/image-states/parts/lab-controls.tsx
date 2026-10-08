// The controls of the lab under a stage. In the review page the bar and the
// keys drive the view. This surface has no bar, so one menu stands in for
// it. The controls are not a part of the stage.

import * as ak from "@ariakit/react";
import { cx } from "clava";
import { ChevronDown, RotateCcw } from "lucide-react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import {
  OptionLabel,
  OptionSlot,
} from "../../../../components/ariakit/components/option.ariakit.react.tsx";
import { option } from "../../../../components/ariakit/styles/option.ts";
import {
  Menu,
  MenuHeading,
  MenuItemCheckbox,
  MenuSeparator,
} from "../../../kits/ariakit/controls.tsx";
import { formatPercent } from "../../../kits/ariakit/stage/geometry.ts";
import { modeNames } from "../../../kits/ariakit/stage/model.ts";
import { zoomSteps } from "../../../kits/ariakit/view-types.ts";
import type { StageView, ViewMode, ZoomLevel } from "../../../kits/ariakit/view-types.ts";
import type { StageReplay } from "./use-simulated-stage.ts";

const modes: readonly ViewMode[] = ["new", "original", "side", "swipe", "overlay"];

interface ZoomPreset {
  id: string;
  label: string;
  level: ZoomLevel | "actual";
}

const zoomPresets: ZoomPreset[][] = [
  [
    { id: "fit", label: "Fit", level: "fit" },
    { id: "width", label: "Fit width", level: "width" },
  ],
  zoomSteps.map((step) => ({ id: String(step), label: formatPercent(step), level: step })),
  [{ id: "actual", label: "Actual pixels", level: "actual" }],
];

function getZoomId(level: ZoomLevel) {
  if (typeof level === "string") return level;
  return zoomSteps.includes(level) ? String(level) : "";
}

interface RadioItemProps {
  name: string;
  value: string;
  children: string;
}

function RadioItem({ name, value, children }: RadioItemProps) {
  return (
    <ak.MenuItemRadio name={name} value={value} hideOnClick={false} {...option.jsx()}>
      <OptionSlot>
        <ak.MenuItemCheck />
      </OptionSlot>
      <OptionLabel className="flex-1 tabular-nums">{children}</OptionLabel>
    </ak.MenuItemRadio>
  );
}

export interface ViewMenuProps {
  /** The selected mode. */
  mode: ViewMode;
  /** The mode on the stage: a variant with one image shows that image. */
  shown: ViewMode;
  mask: boolean;
  view: StageView;
  onModeChange(mode: ViewMode): void;
  onMaskChange(mask: boolean): void;
}

/** The mode, the mask switch, and the zoom level of one stage, as one menu. */
export function ViewMenu({ mode, shown, mask, view, onModeChange, onMaskChange }: ViewMenuProps) {
  const zoom = getZoomId(view.level);
  return (
    <ak.MenuProvider
      placement="bottom-start"
      values={{ mode, mask, zoom }}
      setValues={(values) => {
        const nextMode = modes.find((entry) => entry === values.mode);
        if (nextMode && nextMode !== mode) {
          onModeChange(nextMode);
        }
        const nextMask = values.mask === true;
        if (nextMask !== mask) {
          onMaskChange(nextMask);
        }
        if (values.zoom === zoom) return;
        const preset = zoomPresets.flat().find((entry) => entry.id === values.zoom);
        if (!preset) return;
        view.setLevel(preset.level);
      }}
    >
      <ak.MenuButton render={<Button $size="xs" />}>
        <ButtonLabel className="tabular-nums">
          {modeNames[shown]}
          {view.scale != null && ` · ${formatPercent(view.scale)}`}
        </ButtonLabel>
        <ButtonSlot $size="sm">
          <ChevronDown />
        </ButtonSlot>
      </ak.MenuButton>
      <Menu className="min-w-44">
        <MenuHeading>Mode</MenuHeading>
        {modes.map((entry) => (
          <RadioItem key={entry} name="mode" value={entry}>
            {modeNames[entry]}
          </RadioItem>
        ))}
        <MenuSeparator />
        <MenuItemCheckbox name="mask" hideOnClick={false}>
          Mask
        </MenuItemCheckbox>
        <MenuSeparator />
        <MenuHeading>Zoom</MenuHeading>
        {zoomPresets.map((group, index) => (
          <ak.MenuGroup key={group[0]?.id} className="grid">
            {index > 0 && <MenuSeparator />}
            {group.map((preset) => (
              <RadioItem key={preset.id} name="zoom" value={preset.id}>
                {preset.label}
              </RadioItem>
            ))}
          </ak.MenuGroup>
        ))}
      </Menu>
    </ak.MenuProvider>
  );
}

export interface ReplayProps {
  replay: StageReplay | null;
}

/** Runs the transition of a scenario again. */
export function Replay({ replay }: ReplayProps) {
  if (!replay) return null;
  return (
    <Button
      $size="xs"
      accessibleWhenDisabled
      disabled={replay.status !== "ready"}
      onClick={replay.run}
      className={cx(replay.status === "idle" && "invisible")}
    >
      <ButtonSlot>
        <RotateCcw />
      </ButtonSlot>
      <ButtonLabel>Replay</ButtonLabel>
    </Button>
  );
}

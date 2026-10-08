import * as ak from "@ariakit/react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import {
  OptionLabel,
  OptionSlot,
} from "../../../../components/ariakit/components/option.ariakit.react.tsx";
import { option } from "../../../../components/ariakit/styles/option.ts";
import { IconButton, Menu, MenuSeparator } from "../controls.tsx";
import { iconStroke } from "../tokens.ts";
import { zoomSteps } from "../view-types.ts";
import type { StageView, ZoomLevel } from "../view-types.ts";

interface Preset {
  id: string;
  label: string;
  /** `actual` is one image pixel for each device pixel. */
  level: ZoomLevel | "actual";
}

function formatPercent(scale: number) {
  return `${Math.round(scale * 100)}%`;
}

const presetGroups: Preset[][] = [
  [
    { id: "fit", label: "Fit", level: "fit" },
    { id: "width", label: "Fit width", level: "width" },
  ],
  zoomSteps.map((step) => ({ id: String(step), label: formatPercent(step), level: step })),
  [{ id: "actual", label: "Actual pixels", level: "actual" }],
];

const presets = presetGroups.flat();

interface PresetMenuProps {
  view: StageView;
  onOpenChange?(open: boolean): void;
}

/** The percent on screen. It opens the presets. */
function PresetMenu({ view, onOpenChange }: PresetMenuProps) {
  // The scale of `Actual pixels` on this display, after a person picked it.
  const [actualScale, setActualScale] = useState<number | null>(null);

  const getCheckedId = () => {
    const { level } = view;
    if (typeof level === "string") return level;
    if (level === actualScale) return "actual";
    return zoomSteps.includes(level) ? String(level) : "";
  };
  const menu = ak.useMenuStore({
    placement: "top",
    setOpen: onOpenChange,
    values: { zoom: getCheckedId() },
    setValues: (values) => {
      const preset = presets.find((entry) => entry.id === values.zoom);
      if (!preset) return;
      if (preset.level !== "actual") {
        setActualScale(null);
        view.setLevel(preset.level);
        return;
      }
      // One image pixel for each device pixel. The stage sets the same scale
      // for `actual`, so the menu can check this item afterwards.
      setActualScale(1 / (window.devicePixelRatio || 1));
      view.setLevel("actual");
    },
  });
  const percent = view.scale == null ? "" : formatPercent(view.scale);

  return (
    <ak.MenuProvider store={menu}>
      <ak.MenuButton render={<Button aria-label={percent ? `Zoom, ${percent}` : "Zoom"} />}>
        {/* A little more than the width of `100%`, so the bar does not move
            at each step. */}
        <ButtonLabel className="min-w-[4.75ch] text-center tabular-nums">
          {percent || " "}
        </ButtonLabel>
        <ButtonSlot $size="sm">
          <ChevronDown strokeWidth={iconStroke} />
        </ButtonSlot>
      </ak.MenuButton>
      <Menu aria-label="Zoom" className="min-w-44">
        {presetGroups.map((group, index) => (
          <ak.MenuGroup key={group[0]?.id} className="grid">
            {index > 0 && <MenuSeparator />}
            {group.map((preset) => (
              <ak.MenuItemRadio
                key={preset.id}
                name="zoom"
                value={preset.id}
                hideOnClick
                {...option.jsx()}
              >
                <OptionSlot>
                  <ak.MenuItemCheck />
                </OptionSlot>
                <OptionLabel className="flex-1 tabular-nums">{preset.label}</OptionLabel>
              </ak.MenuItemRadio>
            ))}
          </ak.MenuGroup>
        ))}
      </Menu>
    </ak.MenuProvider>
  );
}

export interface ZoomControlProps {
  view: StageView;
  /** Runs when the preset menu opens and closes. */
  onOpenChange?(open: boolean): void;
  className?: string;
}

/**
 * Zoom out, the percent with the presets, and zoom in. The percent is the
 * real scale, also at Fit. The zoom has no key (D-WORK-03): a pinch and the
 * wheel with Ctrl zoom at the pointer.
 */
export function ZoomControl({ view, onOpenChange, className }: ZoomControlProps) {
  return (
    <ButtonGroup aria-label="Zoom" $p="none" $gap="none" className={className}>
      <IconButton
        label="Zoom out"
        icon={<Minus strokeWidth={iconStroke} />}
        disabled={!view.canZoomOut}
        accessibleWhenDisabled
        onClick={() => view.zoomOut()}
      />
      <PresetMenu view={view} onOpenChange={onOpenChange} />
      <IconButton
        label="Zoom in"
        icon={<Plus strokeWidth={iconStroke} />}
        disabled={!view.canZoomIn}
        accessibleWhenDisabled
        onClick={() => view.zoomIn()}
      />
    </ButtonGroup>
  );
}

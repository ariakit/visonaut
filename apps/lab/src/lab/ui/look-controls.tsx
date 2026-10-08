import * as ak from "@ariakit/react";
import { useRouterState } from "@tanstack/react-router";
import { Moon, Palette, Sun } from "lucide-react";
import {
  Button,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import { Layer } from "../../components/ariakit/components/layer.ariakit.react.tsx";
import {
  Popover,
  PopoverDisclosure,
  PopoverHeading,
  PopoverProvider,
} from "../../components/ariakit/components/popover.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../components/ariakit/components/tooltip.ariakit.react.tsx";
import { resetKnobs, setKnob, useKnobs } from "../knob-store.ts";
import { defaultKnobs, knobDefinitions, resettableKnobNames } from "../knobs.ts";
import type { KnobDefinition } from "../knobs.ts";
import { Segmented } from "./segmented.tsx";

// The routes with cards. The picture of a card is a file with the default
// look in each theme (see `card-pictures.ts`), so the controls of the menu do
// not change it. The menu says so on these routes.
const cardRoutes = new Set(["/", "/directions/", "/directions/$direction"]);

interface KnobRowProps {
  definition: KnobDefinition;
  value: string;
}

/**
 * The brand and the canvas show one swatch per preset. Each swatch carries the
 * preset on itself, so it paints the real token of that preset.
 */
function SwatchRow({ definition, value }: KnobRowProps) {
  const { name } = definition;
  return (
    <ak.RadioProvider value={value} setValue={(next) => setKnob(name, String(next))}>
      <ak.RadioGroup
        aria-label={definition.label}
        render={<ButtonGroup $border $layout="stretch" $gap="none" />}
      >
        {definition.options.map((option) => (
          <TooltipProvider key={option.id} timeout={300}>
            <TooltipAnchor
              // The tooltip is for the pointer only. The menu opens with the
              // focus on a swatch, and an open tooltip would take the first
              // Escape press. The row shows the name of the focused preset.
              onFocusVisible={(event) => event.preventDefault()}
              render={
                <ak.Radio value={option.id} render={<Button aria-label={option.label} $p={1} />} />
              }
            >
              <ButtonSlot $size="xl">
                <Layer
                  render={<span />}
                  $layer={name === "brand" ? "brand" : "canvas"}
                  className="lab-look block size-full rounded-full border border-current/25"
                  data-brand={name === "brand" ? option.id : undefined}
                  data-canvas={name === "canvas" ? option.id : undefined}
                />
              </ButtonSlot>
            </TooltipAnchor>
            <Tooltip>{option.label}</Tooltip>
          </TooltipProvider>
        ))}
        <ButtonGlider $kind="bevel" />
      </ak.RadioGroup>
    </ak.RadioProvider>
  );
}

function KnobRow({ definition, value }: KnobRowProps) {
  const { name } = definition;
  const swatches = name === "brand" || name === "canvas";
  const current = definition.options.find((option) => option.id === value);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <Text className="font-medium">{definition.label}</Text>
        {swatches && <Text className="ak-ink-50">{current?.label}</Text>}
      </div>
      {swatches ? (
        <SwatchRow definition={definition} value={value} />
      ) : (
        <Segmented
          label={definition.label}
          value={value}
          onChange={(next) => setKnob(name, next)}
          options={definition.options.map((option) => ({ value: option.id, label: option.label }))}
          $layout="stretch"
          $size="sm"
          // Each option starts at the width of its label and shares the rest,
          // so the longest label fits on a phone at every density.
          className="[&>.control]:basis-auto!"
        />
      )}
      {definition.description && (
        <Text className="text-xs ak-ink-60">{definition.description}</Text>
      )}
    </div>
  );
}

/**
 * The look menu: brand, canvas, radius, density, and the data mode of the
 * fixtures. The theme has a toggle.
 */
export function LookControls() {
  const knobs = useKnobs();
  const changed = resettableKnobNames.some((name) => knobs[name] !== defaultKnobs[name]);
  const hasCards = useRouterState({
    select: (state) => cardRoutes.has(state.matches.at(-1)?.routeId ?? ""),
  });
  return (
    <PopoverProvider placement="bottom-end">
      <PopoverDisclosure aria-label="Look">
        <ButtonSlot>
          <Palette />
        </ButtonSlot>
        <ButtonLabel className="hidden lab-wide:inline">Look</ButtonLabel>
      </PopoverDisclosure>
      <Popover
        portal
        unmountOnHide
        $p={3}
        // A fixed width in `rem`, so the density control does not resize the
        // menu that holds it.
        className="grid w-[24rem] max-w-[calc(100vw-1.5rem)] grid-cols-[minmax(0,1fr)] gap-3 text-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <PopoverHeading className="text-sm font-semibold">Look</PopoverHeading>
          <Button $size="xs" $ink={60} disabled={!changed} onClick={resetKnobs}>
            Reset
          </Button>
        </div>
        {knobDefinitions.map((definition) => {
          if (definition.name === "theme") return null;
          return (
            <KnobRow key={definition.name} definition={definition} value={knobs[definition.name]} />
          );
        })}
        {hasCards && (
          <Text className="text-xs ak-ink-60">
            The pictures of the cards follow the theme only.
          </Text>
        )}
      </Popover>
    </PopoverProvider>
  );
}

export function ThemeToggle() {
  const { theme } = useKnobs();
  const next = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} theme`;
  return (
    <TooltipProvider timeout={400}>
      <TooltipAnchor render={<Button aria-label={label} onClick={() => setKnob("theme", next)} />}>
        <ButtonSlot>{theme === "dark" ? <Sun /> : <Moon />}</ButtonSlot>
      </TooltipAnchor>
      <Tooltip>{label}</Tooltip>
    </TooltipProvider>
  );
}

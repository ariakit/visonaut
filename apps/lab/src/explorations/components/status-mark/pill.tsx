// The legend of the status vocabulary. Every mark here is a part of the kit
// (`kits/ariakit/status.tsx`), so this page shows what the six pages show.

import {
  Button,
  ButtonGlider,
  ButtonGroup,
  ButtonSlot,
} from "../../../components/ariakit/components/button.ariakit.react.tsx";
import type { VariantProps } from "../../../lab/types.ts";
import { PlaceLink, usePlace } from "../../kits/ariakit/place.tsx";
import { RunRow, RunRowList } from "../../kits/ariakit/run-row.tsx";
import {
  StatusGlyph,
  StatusPill,
  runStatusOrder,
  statusStyles,
  variantStatusOrder,
} from "../../kits/ariakit/status.tsx";
import type { StatusName } from "../../kits/ariakit/status.tsx";
import {
  Caption,
  Cell,
  FormsTable,
  GlyphWords,
  MarkTooltip,
  Stack,
  Surfaces,
} from "./parts/context.tsx";
import { useMarkData, useStripVariants } from "./parts/data.ts";

// What an approval accepted. Only a strip shows these two.
const stripOnly: readonly StatusName[] = ["added", "removed"];

const surfaceStates: readonly StatusName[] = ["needs-review", "failed"];

/**
 * One glyph for each variant of a real screenshot. Each glyph is a link to
 * its variant, and the stock glider marks the selected one.
 */
function GlyphStrip() {
  const variants = useStripVariants();
  const place = usePlace();
  const selectedKey = place?.variantKey ?? variants[0]?.key;
  return (
    <ButtonGroup
      aria-label="Variants"
      $size="sm"
      $p="none"
      $gap="xs"
      className="justify-self-start"
    >
      {variants.map((variant) => {
        const label = `${variant.label}, ${statusStyles[variant.status].label}`;
        return (
          <MarkTooltip key={variant.key} label={label}>
            <Button
              aria-label={label}
              aria-current={variant.key === selectedKey ? "true" : undefined}
              render={<PlaceLink itemKey={variant.itemKey} variantKey={variant.key} />}
            >
              <ButtonSlot>
                <StatusGlyph status={variant.status} decorative />
              </ButtonSlot>
            </Button>
          </MarkTooltip>
        );
      })}
      <ButtonGlider />
      <ButtonGlider $state="hover" />
      <ButtonGlider $state="focus" />
    </ButtonGroup>
  );
}

function Compact() {
  const data = useMarkData();
  return (
    // A run row has its state text at its end only with the width of a page.
    <Cell wide>
      <div role="group" aria-label="Run states" className="flex items-center gap-2">
        {runStatusOrder.map((status) => (
          <MarkTooltip key={status} label={statusStyles[status].label} focusable>
            <StatusPill status={status} compact className="flex-none" />
          </MarkTooltip>
        ))}
      </div>
      <div className="grid gap-1.5">
        <Caption>In a run row</Caption>
        <RunRowList aria-label="Runs">
          {data.rows.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </RunRowList>
      </div>
      <div className="grid gap-1.5">
        <Caption>In a strip</Caption>
        <GlyphStrip />
      </div>
    </Cell>
  );
}

function Counts() {
  const data = useMarkData();
  return (
    <Cell>
      <Stack>
        {data.counts.map((sample) => (
          <span key={sample.key} className="flex flex-wrap gap-1.5">
            {sample.pills.map((pill) => (
              <StatusPill key={pill.status} status={pill.status}>
                {pill.text}
              </StatusPill>
            ))}
          </span>
        ))}
      </Stack>
    </Cell>
  );
}

export default function TintedPill({ scenario }: VariantProps) {
  if (scenario === "variant-states") {
    return (
      <Cell>
        <FormsTable label="Variant states" states={variantStatusOrder} />
        <div className="grid gap-1.5">
          <Caption>Approved, in a strip</Caption>
          <GlyphWords states={stripOnly} />
        </div>
      </Cell>
    );
  }
  if (scenario === "compact") {
    return <Compact />;
  }
  if (scenario === "counts") {
    return <Counts />;
  }
  if (scenario === "surfaces") {
    return (
      <Cell>
        <Surfaces
          states={surfaceStates}
          renderMark={(status, surface) => (
            <StatusPill status={status} invert={surface === "brand"} />
          )}
        />
      </Cell>
    );
  }
  return (
    <Cell>
      <FormsTable label="Run states" states={runStatusOrder} />
    </Cell>
  );
}

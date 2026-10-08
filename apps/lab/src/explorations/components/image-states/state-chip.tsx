// The reference of the image states: the whole review stage of the kit for
// each state that is not one or two loaded images of equal size. Above the
// stage is the end of the variant row (the numbers of the change and the
// Details button), as in the review page.

import { cx } from "clava";
import { useState } from "react";
import { Text } from "../../../components/ariakit/components/text.ariakit.react.tsx";
import { useDataMode } from "../../../fixtures/index.ts";
import type { VariantProps } from "../../../lab/types.ts";
import { DetailsButton } from "../../kits/ariakit/stage/details.tsx";
import { ReviewStage } from "../../kits/ariakit/stage/stage.tsx";
import { ChangeLine } from "../../kits/ariakit/stage/summary.tsx";
import { useStageView } from "../../kits/ariakit/stage/view.ts";
import { pageRoot, tertiary } from "../../kits/ariakit/tokens.ts";
import type { ViewMode } from "../../kits/ariakit/view-types.ts";
import { Replay, ViewMenu } from "./parts/lab-controls.tsx";
import { useStageScenario } from "./parts/scenarios.ts";
import type { StageScenario } from "./parts/scenarios.ts";
import { useSimulatedStage } from "./parts/use-simulated-stage.ts";

interface StateStageProps {
  scenario: StageScenario;
}

function StateStage({ scenario }: StateStageProps) {
  // The reference does not use the stored view of the review page: each
  // state opens in the first view, whatever a person selected there.
  const [mode, setMode] = useState<ViewMode>("new");
  const [mask, setMask] = useState(true);
  const stage = useSimulatedStage(scenario);
  const expired = scenario.review.imagesExpired === true;
  const view = useStageView({ variant: stage.variant, mode, expired, images: stage.images });
  return (
    // The stage is as wide as a card capture of 416 px with its gutters, so
    // that the most common image shows at 100%.
    <div className={cx(pageRoot, "grid w-125 max-w-[calc(100vw-6rem)] gap-2")}>
      <div className="flex h-7 min-w-0 items-center justify-end gap-3">
        <ChangeLine variant={stage.variant} />
        <DetailsButton review={scenario.review} item={scenario.item} variant={stage.variant} />
      </div>
      <ReviewStage
        variant={stage.variant}
        item={scenario.item}
        view={view}
        mode={mode}
        mask={mask}
        className="h-72"
      />
      <div className="flex items-center gap-1">
        <Text className={cx(tertiary, "me-1 text-xs")}>Lab</Text>
        <ViewMenu
          mode={mode}
          shown={view.mode}
          mask={mask}
          view={view}
          onModeChange={setMode}
          onMaskChange={setMask}
        />
        <Replay replay={stage.replay} />
      </div>
    </div>
  );
}

export default function StateChipReference({ scenario }: VariantProps) {
  const data = useStageScenario(scenario);
  // A new scenario or data mode starts the stage again.
  const mode = useDataMode();
  if (!data) return null;
  return <StateStage key={`${scenario}:${mode}`} scenario={data} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Separator } from "../components/ariakit/components/separator.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { catalog } from "../lab/catalog.ts";
import { getLabTitle } from "../lab/surfaces.ts";
import { DirectionView } from "../lab/ui/direction-view.tsx";

export const Route = createFileRoute("/directions/")({
  head: () => ({ meta: [{ title: getLabTitle("Directions") }] }),
  component: Directions,
});

function Directions() {
  return (
    <ShellMain $p={6} $maxWidth="100rem">
      <ShellMainBody className="gap-y-8">
        {!catalog.directions.length && <Text className="ak-ink-50">No directions yet</Text>}
        <HeadingLevel>
          {catalog.directions.map((direction, index) => (
            <div key={direction.id} className="grid gap-8">
              {index > 0 && <Separator $gap={0} />}
              <DirectionView direction={direction} linked />
            </div>
          ))}
        </HeadingLevel>
      </ShellMainBody>
    </ShellMain>
  );
}

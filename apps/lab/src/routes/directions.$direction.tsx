import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";
import { findDirection, getLabTitle } from "../lab/surfaces.ts";
import { DirectionView } from "../lab/ui/direction-view.tsx";
import { SurfaceNotFound } from "../lab/ui/surface-switcher.tsx";

export const Route = createFileRoute("/directions/$direction")({
  head: ({ params }) => ({
    meta: [{ title: getLabTitle(findDirection(params.direction)?.name ?? params.direction) }],
  }),
  component: Direction,
});

function Direction() {
  const params = Route.useParams();
  const direction = findDirection(params.direction);
  return (
    <ShellMain $p={6} $maxWidth="100rem">
      <ShellMainBody className="gap-y-6">
        <Button render={<Link to="/directions" />} $ink={70} className="-ms-2 justify-self-start">
          <ButtonSlot>
            <ArrowLeft />
          </ButtonSlot>
          <ButtonLabel>Directions</ButtonLabel>
        </Button>
        {direction ? (
          <HeadingLevel>
            <DirectionView direction={direction} />
          </HeadingLevel>
        ) : (
          <SurfaceNotFound kind="direction" id={params.direction} />
        )}
      </ShellMainBody>
    </ShellMain>
  );
}

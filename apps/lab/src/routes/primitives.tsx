import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown } from "lucide-react";
import { useMemo } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Code } from "../components/ariakit/components/code.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import {
  Shell,
  ShellMain,
  ShellMainBody,
  ShellMainHeader,
  ShellSidebar,
  ShellSidebarBody,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { controlEntries } from "../lab/primitives/controls.tsx";
import { foundationEntries } from "../lab/primitives/foundations.tsx";
import { ReferenceGroupSection } from "../lab/primitives/kit.tsx";
import type { ReferenceGroup } from "../lab/primitives/kit.tsx";
import { recipeEntries } from "../lab/primitives/recipes.tsx";
import {
  ReferenceIndex,
  ReferenceIndexBar,
  useCurrentSection,
} from "../lab/primitives/reference-index.tsx";
import { structureEntries } from "../lab/primitives/structures.tsx";

export const Route = createFileRoute("/primitives")({
  head: () => ({ meta: [{ title: "Primitives reference · Visonaut design lab" }] }),
  component: PrimitivesReference,
});

const groups: ReferenceGroup[] = [
  { id: "foundations", title: "Foundations", entries: foundationEntries },
  { id: "controls", title: "Controls", entries: controlEntries },
  { id: "structures", title: "Structure and overlays", entries: structureEntries },
  { id: "recipes", title: "Recipes", entries: recipeEntries },
];

/**
 * The live reference for `docs/primitives.md`. The lab shell around this route
 * brings the header, so this shell adds only the sticky index and the main
 * area. Variants render at 16px in the bare preview, so the page resets the
 * smaller text size of the lab shell.
 */
function PrimitivesReference() {
  const ids = useMemo(() => groups.flatMap((group) => group.entries.map((entry) => entry.id)), []);
  const current = useCurrentSection(ids);
  return (
    <HeadingLevel>
      <Shell className="text-base">
        <ShellSidebar $width="sm" aria-label="Primitives index" render={<nav />}>
          <ShellSidebarBody $p={2}>
            <ReferenceIndex groups={groups} current={current} />
          </ShellSidebarBody>
        </ShellSidebar>
        <ShellMain $p="1.5rem" $maxWidth="72rem">
          <ShellMainHeader $show="max-3xl" $height="sm" $blur>
            <div>
              <ReferenceIndexBar groups={groups} current={current} />
            </div>
          </ShellMainHeader>
          <ShellMainBody>
            <div className="grid gap-16 pb-24">
              <header className="grid gap-3">
                <Heading $level={2} className="mt-0 mb-0">
                  Primitives
                </Heading>
                <Text className="ak-ink-70 max-w-[70ch]">
                  Every Ariakit UI primitive in its main variants and states, then recipes for
                  common app needs. Each example is one code block of the guide.
                </Text>
                <div className="flex flex-wrap items-center gap-3">
                  <Code className="text-sm">apps/lab/docs/primitives.md</Code>
                  <Button $lightnessOffset $size="sm" render={<a href="#recipes" />}>
                    <ButtonLabel>Recipes</ButtonLabel>
                    <ButtonSlot>
                      <ArrowDown />
                    </ButtonSlot>
                  </Button>
                </div>
              </header>
              <HeadingLevel>
                {groups.map((group) => (
                  <ReferenceGroupSection key={group.id} group={group} />
                ))}
              </HeadingLevel>
            </div>
          </ShellMainBody>
        </ShellMain>
      </Shell>
    </HeadingLevel>
  );
}

import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../components/ariakit/components/button.ariakit.react.tsx";
import {
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemContent,
  ComboboxItemLabel,
  ComboboxItemSlot,
  ComboboxList,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxSelect,
} from "../../components/ariakit/components/combobox.ariakit.react.tsx";
import type { ComboboxSelectProps } from "../../components/ariakit/components/combobox.ariakit.react.tsx";
import { Heading } from "../../components/ariakit/components/heading.ariakit.react.tsx";
import { getSurfaceGroups } from "../surfaces.ts";
import type { SurfaceEntry } from "../types.ts";

function getSurfaceKey(surface: SurfaceEntry) {
  return `${surface.kind}/${surface.id}`;
}

export interface SurfaceSwitcherProps extends ComboboxSelectProps {
  surface: SurfaceEntry;
}

/** The title of the current surface, as a menu of every surface. */
export function SurfaceSwitcher({ surface, className, ...props }: SurfaceSwitcherProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const words = search.toLowerCase().split(/\s+/);
  const groups = getSurfaceGroups()
    .map((group) => ({
      ...group,
      surfaces: group.surfaces.filter((item) => {
        const text = `${item.title} ${group.name}`.toLowerCase();
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((group) => group.surfaces.length);

  const open = (key: string) => {
    for (const group of groups) {
      const target = group.surfaces.find((item) => getSurfaceKey(item) === key);
      if (!target) continue;
      const to = target.kind === "page" ? "/pages/$surface" : "/components/$surface";
      void router.navigate({ to, params: { surface: target.id } });
      return;
    }
  };

  return (
    <ComboboxProvider
      inputValue={search}
      setInputValue={setSearch}
      resetValueOnHide
      selectedValue={getSurfaceKey(surface)}
      setSelectedValue={(value) => open(String(value))}
    >
      <ComboboxSelect
        $layer="transparent"
        displayValue={surface.title}
        aria-label={`Surface: ${surface.title}`}
        // A long title truncates inside the button instead of pushing it out
        // of its bar.
        className={`min-w-0 font-semibold ${className ?? ""}`}
        {...props}
      />
      <ComboboxPopover
        unmountOnHide
        aria-label="Surfaces"
        className="w-80 max-w-[calc(100vw-1.5rem)] text-sm"
      >
        <ComboboxInput
          autoSelect
          placeholder="Find a surface"
          aria-label="Find a surface"
          $size="sm"
        />
        <ComboboxList>
          {groups.map((group) => (
            <ComboboxGroup key={group.name} label={group.name}>
              {group.surfaces.map((item) => (
                <ComboboxItem key={getSurfaceKey(item)} value={getSurfaceKey(item)}>
                  <ComboboxItemContent>
                    <ComboboxItemLabel>{item.title}</ComboboxItemLabel>
                  </ComboboxItemContent>
                  {/* The number of options of an open surface. A settled
                      surface has one variant, so it shows no number. */}
                  {item.variants.length > 1 && (
                    <ComboboxItemSlot $kind="badge" $p="md">
                      {item.variants.length}
                    </ComboboxItemSlot>
                  )}
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          ))}
        </ComboboxList>
        {!groups.length && <ComboboxEmpty>No surface matches</ComboboxEmpty>}
      </ComboboxPopover>
    </ComboboxProvider>
  );
}

export interface SurfaceNotFoundProps {
  /** The word for the missing thing, for example `page`. */
  kind: string;
  id: string;
}

/** The body of an explorer whose surface is not in the catalog. */
export function SurfaceNotFound({ kind, id }: SurfaceNotFoundProps) {
  return (
    <div className="grid min-h-[50dvh] place-items-center p-6">
      <div className="grid justify-items-center gap-3 text-center">
        <Heading className="text-lg font-semibold">
          No {kind} named “{id}”
        </Heading>
        <Button render={<Link to="/" />} $lightnessOffset>
          Open the gallery
        </Button>
      </div>
    </div>
  );
}

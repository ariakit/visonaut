import { useEffect, useState } from "react";
import {
  Nav,
  NavGroup,
  NavGroupLabel,
  NavLink,
  NavList,
} from "../../components/ariakit/components/nav.ariakit.react.tsx";
import type { ReferenceGroup } from "./kit.tsx";

/**
 * Returns the identifier of the section that is nearest to the top of the
 * viewport, so the index can mark it as the current location.
 */
export function useCurrentSection(ids: readonly string[]) {
  const [current, setCurrent] = useState(ids[0]);
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        }
        const first = ids.find((id) => visible.has(id));
        if (first) {
          setCurrent(first);
        }
      },
      // A band under the sticky header. A section is current while it crosses it.
      { rootMargin: "-80px 0px -60% 0px" },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (!element) continue;
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids]);
  return current;
}

export interface ReferenceIndexProps {
  groups: ReferenceGroup[];
  current?: string;
}

/** The sidebar index: one compact row for each section, in labeled groups. */
export function ReferenceIndex({ groups, current }: ReferenceIndexProps) {
  return (
    <Nav
      list={false}
      $gap={0}
      $groupGap={3}
      glider={[{ $state: "hover" }, {}]}
      render={<div aria-label="Primitives" />}
      // The nav publishes its row padding as --nav-py with a class. The
      // important flag replaces it, so the labels and the rows stay aligned.
      className="text-sm [--nav-py:--spacing(1)]!"
    >
      {groups.map((group) => (
        <NavGroup key={group.id}>
          <NavGroupLabel>{group.title}</NavGroupLabel>
          <NavList>
            {group.entries.map((entry) => (
              <NavLink
                key={entry.id}
                href={`#${entry.id}`}
                aria-current={current === entry.id ? "location" : undefined}
                $p="var(--nav-py)"
              >
                {entry.title}
              </NavLink>
            ))}
          </NavList>
        </NavGroup>
      ))}
    </Nav>
  );
}

/** The same index as one scrolling row, for a bar on narrow screens. */
export function ReferenceIndexBar({ groups, current }: ReferenceIndexProps) {
  return (
    <Nav
      $layout="horizontal"
      $gap={0}
      glider={{ $kind: "bar", $barOffset: 1 }}
      render={<div aria-label="Primitives" />}
      className="text-sm"
    >
      {groups.flatMap((group) =>
        group.entries.map((entry) => (
          <NavLink
            key={entry.id}
            href={`#${entry.id}`}
            aria-current={current === entry.id ? "location" : undefined}
            $p={1.5}
          >
            {entry.title}
          </NavLink>
        )),
      )}
    </Nav>
  );
}

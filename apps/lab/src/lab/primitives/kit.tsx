import { cx } from "clava";
import type { ReactNode } from "react";
import { Code } from "../../components/ariakit/components/code.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Heading,
  HeadingLevel,
} from "../../components/ariakit/components/heading.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";

export interface ReferenceEntry {
  /** The fragment identifier of the section. */
  id: string;
  title: string;
  /** The primitive file under `components/ariakit/components`. */
  file?: string;
  /** One sentence at most. */
  note?: string;
  render: () => ReactNode;
}

export interface ReferenceGroup {
  id: string;
  title: string;
  entries: ReferenceEntry[];
}

export interface ExampleProps {
  /** A caption of one to three words. */
  title: string;
  /** Spans every column of the section grid. */
  wide?: boolean;
  /** Stacks the content with a gap. The default is a wrapping row. */
  stack?: boolean;
  /** Gives the content the whole cell, with no row or stack layout. */
  bare?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * One cell of a reference section. Its padding is 1rem, so the frames inside it
 * keep the radius that they declare.
 */
export function Example({ title, wide, stack, bare, className, children }: ExampleProps) {
  const layout = bare ? "" : stack ? "grid gap-3" : "flex flex-wrap items-center gap-2";
  return (
    <Frame
      $border
      $rounded="xl"
      $p="1rem"
      className={cx("grid min-w-0 content-start gap-3", wide && "col-span-full")}
    >
      <Text className="ak-ink-60 text-xs font-medium">{title}</Text>
      <div className={cx("min-w-0", layout, className)}>{children}</div>
    </Frame>
  );
}

export interface ReferenceSectionProps {
  entry: ReferenceEntry;
}

export function ReferenceSection({ entry }: ReferenceSectionProps) {
  const titleId = `${entry.id}-title`;
  return (
    <section id={entry.id} aria-labelledby={titleId} className="grid gap-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading id={titleId} $level={4} className="mt-0 mb-0">
          {entry.title}
        </Heading>
        {entry.file && (
          <Code $layer="transparent" className="ak-ink-60 text-xs">
            {entry.file}
          </Code>
        )}
      </header>
      {entry.note && <Text className="ak-ink-70 max-w-[70ch] text-sm">{entry.note}</Text>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
        {entry.render()}
      </div>
    </section>
  );
}

export interface ReferenceGroupSectionProps {
  group: ReferenceGroup;
}

export function ReferenceGroupSection({ group }: ReferenceGroupSectionProps) {
  const titleId = `${group.id}-title`;
  return (
    <section id={group.id} aria-labelledby={titleId} className="grid gap-10">
      <Heading id={titleId} $level={2} className="mt-0 mb-0">
        {group.title}
      </Heading>
      <HeadingLevel>
        {group.entries.map((entry) => (
          <ReferenceSection key={entry.id} entry={entry} />
        ))}
      </HeadingLevel>
    </section>
  );
}

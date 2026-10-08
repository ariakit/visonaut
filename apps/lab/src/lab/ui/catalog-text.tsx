import { Code } from "../../components/ariakit/components/code.ariakit.react.tsx";
import { List, ListItem } from "../../components/ariakit/components/list.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import type { VariantEntry } from "../types.ts";

export interface CatalogTextProps {
  children: string;
}

// A literal of this length or less stays on one line, so an identifier such
// as `UI-ROW-PICTURE` does not break at a hyphen. A longer one may break, so
// that it cannot make a narrow column wider.
const maxWholeLength = 24;

/**
 * Catalog text marks a literal with backticks, for example a key or a field
 * name. This component renders each marked part as code and leaves the other
 * text as it is.
 */
export function CatalogText({ children }: CatalogTextProps) {
  const parts = children.split("`");
  // An even number of parts means a backtick without its pair, so the text
  // stays as it is.
  if (parts.length < 3) return children;
  if (parts.length % 2 === 0) return children;
  // The parts at odd positions are the texts between two backticks.
  return parts.map((part, index) => {
    if (index % 2 === 0) return part;
    const whole = part.length <= maxWholeLength;
    return (
      <Code key={index} className={whole ? "whitespace-nowrap" : undefined}>
        {part}
      </Code>
    );
  });
}

interface CatalogListProps {
  title: string;
  items: string[];
}

function CatalogList({ title, items }: CatalogListProps) {
  return (
    <div className="grid gap-1">
      <Text className="text-xs font-medium tracking-wide uppercase ak-ink-50">{title}</Text>
      <List $gap={2}>
        {items.map((item) => (
          <ListItem key={item}>
            <CatalogText>{item}</CatalogText>
          </ListItem>
        ))}
      </List>
    </div>
  );
}

export interface VariantIdeasProps {
  variant: VariantEntry;
  /**
   * The variant is one option of an open decision. Its ideas are then the
   * reasons for the option, and its tradeoffs are the reasons against it.
   */
  option?: boolean;
}

/** The ideas and the tradeoffs of a variant, each as a short list. */
export function VariantIdeas({ variant, option = false }: VariantIdeasProps) {
  const tradeoffs = variant.tradeoffs ?? [];
  return (
    <>
      {variant.ideas.length > 0 && (
        <CatalogList title={option ? "For" : "Ideas"} items={variant.ideas} />
      )}
      {tradeoffs.length > 0 && (
        <CatalogList title={option ? "Against" : "Tradeoffs"} items={tradeoffs} />
      )}
    </>
  );
}

import { useLayoutEffect, useState } from "react";
import type { ImageSize } from "../../../../fixtures/index.ts";

/**
 * The content size of an element, or null before the first measure. The
 * server does not know the size, so a part that needs it renders its
 * placeholder until the browser measures.
 */
export function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<ImageSize | null>(null);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((current) => {
        if (current?.width === width && current.height === height) return current;
        return { width, height };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, element ? size : null] as const;
}

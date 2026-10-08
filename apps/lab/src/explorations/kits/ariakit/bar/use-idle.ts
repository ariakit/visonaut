import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

// The pill fades after this time without a pointer move, a focus, or a key.
const idleDelay = 3000;

const inputEvents = ["pointermove", "pointerdown", "keydown", "focusin"] as const;

/**
 * Tells when the reviewer only looks: true after 3 s without input in the
 * document of the element. The clock starts with the first input, so a page
 * that nobody touched never fades. While `enabled` is false the result is
 * false and no clock runs.
 */
export function useIdle(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [idle, setIdle] = useState(false);
  const touched = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const target = ref.current?.ownerDocument;
    if (!target) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const rest = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => setIdle(true), idleDelay);
    };
    const wake = () => {
      touched.current = true;
      setIdle(false);
      rest();
    };
    // A save or an open menu stopped the clock. It starts again without a
    // new input, or the pill would stay after a decision by key.
    if (touched.current) {
      rest();
    }
    for (const type of inputEvents) {
      target.addEventListener(type, wake);
    }
    return () => {
      clearTimeout(timeout);
      for (const type of inputEvents) {
        target.removeEventListener(type, wake);
      }
    };
  }, [ref, enabled]);
  return enabled && idle;
}

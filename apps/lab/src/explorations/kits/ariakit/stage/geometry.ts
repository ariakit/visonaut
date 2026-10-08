// The plain geometry of the review stage. Every function is pure.

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Box extends Point, Size {}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getBoxCenter(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** `416 × 136`. */
export function formatSize({ width, height }: Size) {
  return `${width} × ${height}`;
}

/** `200%`. */
export function formatPercent(scale: number) {
  return `${Math.round(scale * 100)}%`;
}

/** The box around several boxes, or null for none. */
export function getUnion(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

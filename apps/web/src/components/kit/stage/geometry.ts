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

/** `600 × 400`. */
export function formatSize({ width, height }: Size) {
  return `${width} × ${height}`;
}

import { expect, test } from "vitest";
import { getMarkRects, toShare } from "../stage/marks.ts";

const image = { width: 100, height: 100 };

test("a box is at least 24 screen pixels and stays inside the image", () => {
  const rects = getMarkRects([{ x: 50, y: 98, width: 1, height: 1 }], image, { scale: 1 });
  expect(rects).toEqual([{ x: 38.5, y: 76, width: 24, height: 24 }]);
  // At 200% the same box is 12 image pixels.
  expect(getMarkRects([{ x: 50, y: 50, width: 1, height: 1 }], image, { scale: 2 })).toEqual([
    { x: 44.5, y: 44.5, width: 12, height: 12 },
  ]);
});

test("two boxes that would cross give way on the axis where their regions lie farther apart", () => {
  const rects = getMarkRects(
    [
      { x: 10, y: 10, width: 2, height: 2 },
      { x: 20, y: 10, width: 2, height: 2 },
    ],
    image,
    { scale: 1 },
  );
  // The line between them is at 16, with one screen pixel free at each side.
  expect(rects).toEqual([
    { x: 0, y: 0, width: 15, height: 24 },
    { x: 17, y: 0, width: 16, height: 24 },
  ]);
});

test("a box as a share of the image", () => {
  expect(toShare({ x: 25, y: 10, width: 50, height: 5 }, image)).toEqual({
    left: "25%",
    top: "10%",
    width: "50%",
    height: "5%",
  });
});

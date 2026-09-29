import { expect, it } from "vitest";
import { compareImages, imageLimits, selectedComparisonPolicy } from "../src/index.ts";

const strict = { id: "mask-exact", channelThreshold: 0, maxChangedRatio: 0 };

it("returns no review mask for equal maximum-size images", () => {
  const reference = {
    width: 1000,
    height: imageLimits.maxPixels / 1000,
    data: new Uint8ClampedArray(imageLimits.maxPixels * 4),
  };
  reference.data.fill(255);
  const candidate = { ...reference, data: reference.data.slice() };
  const result = compareImages(reference, candidate, strict);
  expect(result).toMatchObject({ outcome: "unchanged", changedPixels: 0, ratio: 0 });
  expect(result.mask === null).toBe(true);
  expect(candidate.data.at(-1)).toBe(255);
});

it("counts tolerated visible differences without allocating a review mask", () => {
  const reference = { width: 100, height: 100, data: new Uint8ClampedArray(40_000) };
  reference.data.fill(255);
  const candidate = { ...reference, data: reference.data.slice() };
  candidate.data[0] = 0;
  const result = compareImages(reference, candidate, selectedComparisonPolicy);
  expect(result).toMatchObject({
    outcome: "unchanged",
    changedPixels: 1,
    ratio: 1 / 10_000,
  });
  expect(result.mask === null).toBe(true);
});

it("keeps exact red mask bytes for visible color and alpha changes", () => {
  const reference = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 0, 0, 255, 10, 20, 30, 128, 50, 60, 70, 0, 255, 255, 255, 255,
    ]),
  };
  const candidate = {
    ...reference,
    data: new Uint8ClampedArray([
      254, 0, 0, 255, 10, 20, 30, 129, 200, 210, 220, 0, 255, 255, 255, 255,
    ]),
  };
  const result = compareImages(reference, candidate, strict);
  expect(result).toMatchObject({ outcome: "changed", changedPixels: 2, ratio: 0.5 });
  expect(result.mask?.data).toEqual(
    new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]),
  );
  expect(compareImages(reference, candidate, strict)).toEqual(result);
});

it("keeps a solid candidate-sized mask when dimensions change", () => {
  const reference = { width: 1, height: 2, data: new Uint8ClampedArray(8) };
  const candidate = { width: 2, height: 1, data: new Uint8ClampedArray(8) };
  const result = compareImages(reference, candidate, { ...strict, maxChangedRatio: 1 });
  expect(result).toMatchObject({
    outcome: "changed",
    sizeChanged: true,
    changedPixels: 2,
    ratio: 1,
    width: 2,
    height: 1,
  });
  expect(result.mask?.data).toEqual(new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]));
});

/**
 * The bounds of the Submit image check, which the CLI applies to each capture.
 * A test compares them with imageLimits of @visonaut/compare, which this
 * published package does not bundle.
 */
export const submitBounds = {
  maxEncodedBytes: 2 * 1024 * 1024,
  maxPixels: 2_100_000,
  maxDimension: 8192,
};

export interface SubmitBoundsParams {
  item: string;
  variantKey: string;
  width: number;
  height: number;
  bytes: number;
}

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

/**
 * Fail at capture time, with the name of the item, for an image that Submit
 * would refuse. Both keys passed validateKey, so they are safe to print.
 */
export function assertSubmitBounds({ item, variantKey, width, height, bytes }: SubmitBoundsParams) {
  const name = `${item} (${variantKey})`;
  const pixels = width * height;
  if (pixels > submitBounds.maxPixels) {
    throw new Error(
      `${name}: ${width}x${height} is ${formatCount(pixels)} pixels. The limit is ${formatCount(submitBounds.maxPixels)}.`,
    );
  }
  if (width > submitBounds.maxDimension || height > submitBounds.maxDimension) {
    throw new Error(
      `${name}: ${width}x${height} has a side above ${formatCount(submitBounds.maxDimension)} pixels.`,
    );
  }
  if (bytes > submitBounds.maxEncodedBytes) {
    throw new Error(
      `${name}: ${formatCount(bytes)} bytes is above the limit of ${formatCount(submitBounds.maxEncodedBytes)} bytes.`,
    );
  }
}

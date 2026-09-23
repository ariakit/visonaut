import { sha256 } from "./binary.ts";
import { invalid } from "./types.ts";

// This exact sRGB profile occurs in Ariakit's Chromium screenshot corpus.
export const supportedProfileDigest =
  "12afb4d9953adee0607d347daee5b78b18d6b3cab2d572b88970703f5edb37bc";

export async function validateProfile(profile: Uint8Array<ArrayBuffer>) {
  if ((await sha256(profile)) !== supportedProfileDigest) {
    invalid("unsupported-profile", "Only the verified Chromium sRGB ICC profile is supported.");
  }
  return "srgb-chromium-icc-v1" as const;
}

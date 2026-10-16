import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getStageSubject } from "../components/kit/stage/model.ts";
import type { ReviewVariant } from "./model.ts";

export type EvidenceRole = "reference" | "candidate" | "diff";

export type ImageEvidence =
  | { status: "ready" }
  | { status: "error"; error: string; reason: "load" | "decode" | "dimensions" };

// A side whose image has no bytes still shows the other side, so it says only
// the first sentence of the closed summary.
const historyAvailable = "Review results and capture identity remain available.";

/** The text of a closed summary, which shows no image. */
export const noImageBytes = `${historyAvailable} This view does not contain image bytes.`;

type EvidenceFailure = "comparison" | "missing" | "expired" | "load" | "decode" | "dimensions";

interface EvidenceState {
  key: string;
  generation: number;
  images: Partial<Record<EvidenceRole, ImageEvidence>>;
}

export function evidenceKey(
  comparisonId: string,
  variant: ReviewVariant | undefined,
  retry: number,
) {
  return JSON.stringify([
    comparisonId,
    variant?.id,
    variant?.reference,
    variant?.candidate,
    variant?.diff,
    retry,
  ]);
}

interface UseEvidenceParams {
  comparisonId: string;
  variant: ReviewVariant | undefined;
  retry: number;
}

/**
 * The state of the images of the variant on the stage. A decision waits for
 * `ready`: each image that the stage shows loaded, passed `decode()`, and has
 * its stored size. The mask of a changed variant is one of them, also while
 * the mask switch is off.
 */
export function useEvidence({ comparisonId, variant, retry }: UseEvidenceParams) {
  const identity = evidenceKey(comparisonId, variant, retry);
  const [state, setState] = useState<EvidenceState>({ key: identity, generation: 0, images: {} });
  if (state.key !== identity) {
    setState({ key: identity, generation: state.generation + 1, images: {} });
  }
  const generation = `${state.generation}:${identity}`;
  const activeGeneration = useRef<string | null>(generation);
  useLayoutEffect(() => {
    activeGeneration.current = generation;
    return () => {
      activeGeneration.current = null;
    };
  }, [generation]);
  const report = useCallback(
    (role: EvidenceRole, result: ImageEvidence) => {
      // A decode can complete after another selection or retry is displayed.
      if (activeGeneration.current !== generation) return;
      setState((previous) => {
        // Two panes show one image in two elements. A later element that
        // loads does not clear the error of another one: only a retry does.
        if (result.status === "ready" && previous.images[role]?.status === "error") {
          return previous;
        }
        return { ...previous, images: { ...previous.images, [role]: result } };
      });
    },
    [generation],
  );
  const images = state.key === identity ? state.images : {};
  if (variant?.kind === "pending") {
    return {
      status: "loading" as const,
      error: undefined,
      failure: undefined,
      images,
      identity: generation,
      report,
    };
  }
  const required: EvidenceRole[] = [];
  let error = variant?.error;
  let failure: EvidenceFailure | undefined = error ? "comparison" : undefined;
  if (variant) {
    if (variant.reference) {
      required.push("reference");
    } else if (variant.kind !== "added") {
      error ??= "Required reference evidence is unavailable in this comparison.";
      failure ??= "missing";
    }
    if (variant.candidate) {
      required.push("candidate");
    } else if (
      variant.kind !== "removed" &&
      !(variant.kind === "unchanged" && variant.candidateOmitted)
    ) {
      error ??= "Required candidate evidence is unavailable in this comparison.";
      failure ??= "missing";
    }
    // The stage puts a mask only on two images of one size. Without a flag
    // of the service, only a changed variant with changed pixels needs one.
    const subject = getStageSubject(variant);
    const maskExpected =
      variant.maskExpected ?? (variant.kind === "changed" && variant.changedPixels !== 0);
    if (subject.mask) {
      required.push("diff");
    } else if (subject.kind === "pair" && !subject.resize && maskExpected) {
      error ??= "Required diff evidence is unavailable in this comparison.";
      failure ??= "missing";
    }
  }
  // An image with no bytes cannot load, so a retry cannot help.
  if (variant && required.some((role) => variant[role]?.expired)) {
    error ??= historyAvailable;
    failure ??= "expired";
  }
  let status: "loading" | "ready" | "error" = "loading";
  if (state.key === identity && variant) {
    const results = required.map((role) => images[role]);
    const failed = results.find((result) => result?.status === "error");
    if (failed?.status === "error" && !error) {
      error = failed.error;
      failure = failed.reason;
    }
    if (results.every((result) => result?.status === "ready")) {
      status = "ready";
    }
  }
  if (error) {
    status = "error";
  }
  return { status, error, failure, images, identity: generation, report };
}

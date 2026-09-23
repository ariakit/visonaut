import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReviewMode, ReviewVariant } from "./model.ts";

export type EvidenceRole = "reference" | "candidate" | "diff";

export type ImageEvidence = { status: "ready" } | { status: "error"; error: string };

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
  mode: ReviewMode;
  retry: number;
}

export function useEvidence({ comparisonId, variant, mode, retry }: UseEvidenceParams) {
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
      setState((previous) => ({
        ...previous,
        images: { ...previous.images, [role]: result },
      }));
    },
    [generation],
  );
  const required: EvidenceRole[] = [];
  let error = variant?.error;
  if (variant) {
    if (variant.reference) {
      required.push("reference");
    } else if (variant.kind !== "added") {
      error ??= "Required reference evidence is unavailable. Refresh this comparison to retry.";
    }
    if (variant.candidate) {
      required.push("candidate");
    } else if (variant.kind !== "removed") {
      error ??= "Required candidate evidence is unavailable. Refresh this comparison to retry.";
    }
    if (mode === "diff") {
      if (variant.diff) {
        required.push("diff");
      } else if (variant.maskExpected ?? variant.changedPixels !== 0) {
        error ??= "Required diff evidence is unavailable. Refresh this comparison to retry.";
      }
    }
  }
  let status: "loading" | "ready" | "error" = "loading";
  if (state.key === identity && variant) {
    const results = required.map((role) => state.images[role]);
    const failed = results.find((result) => result?.status === "error");
    if (failed?.status === "error") {
      error ??= failed.error;
    }
    if (results.every((result) => result?.status === "ready")) {
      status = "ready";
    }
  }
  if (error) {
    status = "error";
  }
  return { status, error, identity: generation, report };
}

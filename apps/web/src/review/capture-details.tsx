import type { ReviewModel, ReviewVariant } from "./model.ts";
import { verdictLabel } from "./navigation.ts";

export interface CaptureDetailsProps {
  model: ReviewModel;
  variant: ReviewVariant;
  /** The state of the run, in words. */
  runStatus: string;
}

/**
 * The facts of the selected capture and the comparisons of the run. The page
 * shows them in a side panel, or in a dialog in a narrow window.
 */
export function CaptureDetails({ model, variant, runStatus }: CaptureDetailsProps) {
  return (
    <div className="grid gap-3 text-xs">
      <p className="text-xs wrap-anywhere">
        {variant.label} · {verdictLabel(variant)}
        {variant.reviewer ? ` · ${variant.reviewer}` : ""}
      </p>
      <p className="text-xs">{runStatus}</p>
      <p className="review-run-identity text-xs">
        Run {model.run.id} · Attempt {model.run.attempt} · Commit{" "}
        <code>{model.run.testedSha.slice(0, 12)}</code> ·{" "}
        <span>Comparison {model.comparisonRevision}</span>
      </p>
      <nav aria-label="Comparison history" className="flex flex-wrap gap-3 text-xs">
        <a href={`/runs/${encodeURIComponent(model.run.id)}`}>Original comparison</a>
        {model.historicalComparisons?.map((comparison) => (
          <a
            key={comparison.id}
            href={`/runs/${encodeURIComponent(model.run.id)}?comparison=${encodeURIComponent(comparison.id)}`}
            aria-current={comparison.id === model.comparisonId ? "page" : undefined}
          >
            Historical comparison {comparison.ordinal} ·{" "}
            {comparison.state === "ready"
              ? "Complete"
              : comparison.state === "invalidated"
                ? "Failed"
                : "Comparing"}
          </a>
        ))}
      </nav>
      <dl className="grid grid-cols-1 gap-2 my-5 [&>dt]:mt-2 [&>dt]:ak-ink-50 [&>dd]:wrap-anywhere">
        <dt>Changed pixels</dt>
        <dd>
          {variant.changedPixels?.toLocaleString() ?? "—"}
          {variant.ratio != null ? ` (${(variant.ratio * 100).toFixed(4)}%)` : ""}
        </dd>
        <dt>Dimensions</dt>
        <dd>
          {variant.reference
            ? `${variant.reference.width} × ${variant.reference.height}`
            : "Absent"}{" "}
          →{" "}
          {variant.candidate
            ? `${variant.candidate.width} × ${variant.candidate.height}`
            : "Absent"}
        </dd>
        <dt>CLI version</dt>
        <dd>{variant.cli ?? "—"}</dd>
        <dt>Policy / threshold</dt>
        <dd>
          {variant.policy ?? "—"} / {variant.threshold ?? "—"}
        </dd>
        <dt>Capture profiles</dt>
        <dd>
          {variant.referenceProfile ?? "Absent"} → {variant.candidateProfile ?? "Absent"}
        </dd>
        <dt>Comparison</dt>
        <dd>
          {model.comparisonId} · {variant.id} · decision revision {variant.revision}
        </dd>
      </dl>
    </div>
  );
}

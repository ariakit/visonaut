import * as React from "react";
import { Frame } from "@ui/components/frame.ariakit.react.tsx";
import { Layer } from "@ui/components/layer.ariakit.react.tsx";
import { Button } from "@ui/components/button.ariakit.react.tsx";

interface PrototypeProps {
  decisionId: string;
  optionId: string;
  Text: React.ComponentType<{ children: string }>;
}

export function hasQuantitativePrototype(id: string) {
  return ["C01", "C02", "C05", "C06", "S02", "S05", "A05"].includes(id);
}

export function QuantitativePrototype({ decisionId, optionId, Text }: PrototypeProps) {
  const [size, setSize] = React.useState(1000);
  const [pixels, setPixels] = React.useState(100);
  const [cap, setCap] = React.useState(20);
  const [promoted, setPromoted] = React.useState(false);
  const [reversed, setReversed] = React.useState(false);
  const [expired, setExpired] = React.useState(false);
  const [restored, setRestored] = React.useState(false);
  const [revoked, setRevoked] = React.useState(false);
  const [count, setCount] = React.useState(80);
  const reset = () => {
    setSize(1000);
    setPixels(100);
    setCap(20);
    setPromoted(false);
    setReversed(false);
    setExpired(false);
    setRestored(false);
    setRevoked(false);
    setCount(80);
  };
  let content: React.ReactNode;
  if (decisionId === "C05") {
    const area = size * size;
    const ratioLimit = Math.floor(area * 0.0005);
    const allowed =
      optionId === "exact" ? 0 : optionId === "cap" ? Math.min(ratioLimit, cap) : ratioLimit;
    content = (
      <>
        <label>
          Square image width: {size} pixels
          <input
            type="range"
            min="100"
            max="1400"
            step="100"
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </label>
        <label>
          Changed pixels: {pixels}
          <input
            type="range"
            min="0"
            max="1100"
            step="1"
            value={pixels}
            onChange={(event) => setPixels(Number(event.target.value))}
          />
        </label>
        {optionId === "cap" ? (
          <label>
            Proposed absolute limit: {cap}
            <input
              type="range"
              min="0"
              max="500"
              value={cap}
              onChange={(event) => setCap(Number(event.target.value))}
            />
          </label>
        ) : null}
        <Layer $layer className="model-result" aria-live="polite">
          <strong>
            {pixels <= allowed
              ? "Passes this modeled rule"
              : "Needs review under this modeled rule"}
          </strong>
          <p>
            {area.toLocaleString()} pixels × 0.05% = {ratioLimit.toLocaleString()} pixels. This
            option allows {allowed.toLocaleString()}.
          </p>
        </Layer>
        <p>
          <Text>
            Only the count rule is modeled. Actual comparison first decides whether each visible
            pixel changed. No defect detection or noise rate is predicted here.
          </Text>
        </p>
      </>
    );
  } else if (decisionId === "C06") {
    const total = size * size;
    const allocation =
      optionId === "bits"
        ? Math.ceil(total / 8)
        : optionId === "two-pass" && !expired
          ? 0
          : total * 4;
    content = (
      <>
        <label>
          Square image width: {size} pixels
          <input
            type="range"
            min="100"
            max="1400"
            step="100"
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={expired}
            onChange={(event) => setExpired(event.target.checked)}
          />{" "}
          Pair needs review after counting
        </label>
        <Layer $layer className="model-result" aria-live="polite">
          <strong>
            {allocation.toLocaleString()} bytes for the{" "}
            {optionId === "bits" ? "compact difference map" : "red output map"}
          </strong>
          <p>
            <Text>
              {optionId === "bits"
                ? "A changed pair still needs an output map for its image. The number above is only the compact map."
                : "This excludes both decoded source images and the encoded file. It is an allocation model, not a speed estimate."}
            </Text>
          </p>
        </Layer>
      </>
    );
  } else if (decisionId === "S05") {
    const captures = count * 100;
    const passes = Math.ceil((2 * captures) / 50);
    content = (
      <>
        <label>
          New captures: {captures.toLocaleString()}
          <input
            type="range"
            min="1"
            max="359"
            step="1"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <Layer $layer className="model-result" aria-live="polite">
          <strong>
            {optionId === "keep-copies"
              ? `At least ${passes} full maintenance passes`
              : "No second image copy in this proposed model"}
          </strong>
          <p>
            <Text>
              {optionId === "keep-copies"
                ? "Current rule: each new capture uses one copy step and one verification step, with 50 steps per pass. This is a lower bound on steps, not time."
                : "The source files must stay immutable and protected from deletion. Ownership and recovery checks still run. Zero copies does not mean zero work."}
            </Text>
          </p>
        </Layer>
      </>
    );
  } else if (decisionId === "S02") {
    const recoverable = !expired || optionId === "combined-recovery";
    content = (
      <>
        <div className="row">
          <Button $border onClick={() => setExpired(true)} disabled={expired}>
            Expire an old image
          </Button>
          <Button $border onClick={() => setRestored(true)}>
            Restore earlier records
          </Button>
        </div>
        <Layer $layer className="model-result" aria-live="polite">
          <strong>
            {restored
              ? recoverable
                ? "Records and image can agree"
                : "The restored row has no image bytes"
              : "Current records are active"}
          </strong>
          <p>
            <Text>
              {expired
                ? "The example image was deleted after the selected restore point."
                : "The example image is still retained."}
            </Text>
          </p>
          <p>
            <Text>
              {optionId === "combined-recovery"
                ? "This assumes a complete, verified combined copy existed before the failure. A policy choice alone does not create that copy."
                : "Restoring database records does not restore deleted image files. Offline legacy tools can restore only an existing complete set."}
            </Text>
          </p>
        </Layer>
      </>
    );
  } else if (decisionId === "C01") {
    const canUndo = promoted && (optionId === "current" || optionId === "recovery");
    content = (
      <>
        <div className="row">
          <Button
            $border
            onClick={() => {
              setPromoted(true);
              setReversed(false);
            }}
          >
            Approve and promote blue
          </Button>
          <Button $border disabled={!canUndo || reversed} onClick={() => setReversed(true)}>
            {optionId === "recovery" ? "Explicit recovery" : "Undo promotion"}
          </Button>
          <Button
            $border
            onClick={() => {
              setPromoted(true);
              setReversed(false);
            }}
          >
            Capture a blue correction
          </Button>
        </div>
        <Frame $border $rounded="lg" $p={4} className="model-result" aria-live="polite">
          <strong>
            <Text>
              {promoted && !reversed ? "Current baseline: blue" : "Current baseline: gray"}
            </Text>
          </strong>
          <p>
            <Text>
              {optionId === "forward"
                ? "After promotion, ordinary Undo is closed. Another complete run corrects the result."
                : optionId === "recovery"
                  ? "Routine review stays closed. A separate recovery action can change the current baseline."
                  : "The current guarded Undo can change the baseline and invalidate dependent comparisons."}
            </Text>
          </p>
        </Frame>
      </>
    );
  } else if (decisionId === "C02") {
    content = (
      <>
        <Button $border onClick={() => setRevoked((value) => !value)}>
          {revoked ? "Restore source approval" : "Revoke source approval"}
        </Button>
        <Layer $layer className="model-result" aria-live="polite">
          <strong>
            {optionId === "fresh"
              ? "The new run needs its own review"
              : revoked && optionId === "linked"
                ? "The new run loses borrowed approval"
                : "The new run keeps verified approval"}
          </strong>
          <p>
            <Text>
              {optionId === "copy"
                ? "A copied approval has independent ownership after exact eligibility checks. Revoking the older approval does not revoke this one."
                : optionId === "linked"
                  ? "The new run depends on the source approval for as long as that link remains active."
                  : "No approval is borrowed. This creates more repeated review work."}
            </Text>
          </p>
        </Layer>
      </>
    );
  } else {
    const inMemory = optionId === "bodies";
    const streaming = optionId === "stream";
    content = (
      <>
        <label>
          Attached images: {count}
          <input
            type="range"
            min="1"
            max="160"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <Layer $layer className="model-result" aria-live="polite">
          <strong>
            {streaming
              ? "Payload lifetime depends on result cleanup"
              : `${inMemory ? (count * 1048576).toLocaleString() : "0"} attachment-body bytes`}
          </strong>
          <p>
            <Text>
              {streaming
                ? "Early processing needs a new result-lifetime rule. The current probe does not establish a retained-byte bound for that proposed design."
                : inMemory
                  ? "Model: each test keeps a 1 MiB body until the reporter ends. This matches the 80-image synthetic probe."
                  : "Model: each test stores a file reference. File bytes still exist on disk and temporary processing still needs memory."}
            </Text>
          </p>
        </Layer>
        <p>
          <Text>This is retained payload size, not total process memory or production speed.</Text>
        </p>
      </>
    );
  }
  return (
    <Frame $rounded="xl" $border $p={4} className="quantitative-prototype">
      <p className="eyebrow">CONTROLLED EXAMPLE · PROPOSED RULE</p>
      {content}
      <Button $border onClick={reset}>
        Reset example
      </Button>
    </Frame>
  );
}

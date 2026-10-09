import * as React from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import * as ak from "@ariakit/react";
import {
  Shell,
  ShellHeader,
  ShellHeaderEnd,
  ShellMain,
  ShellMainBody,
} from "@ui/components/shell.ariakit.react.tsx";
import { Frame } from "@ui/components/frame.ariakit.react.tsx";
import { Layer } from "@ui/components/layer.ariakit.react.tsx";
import { Button } from "@ui/components/button.ariakit.react.tsx";
import type { AuditRecord, AuditDecision, AuditOption, Feedback } from "./schema";
import rawRecord from "../audit-data.json";
import { UiPrototype } from "./ui-prototypes";
import { QuantitativePrototype, hasQuantitativePrototype } from "./quantitative-prototypes";
import "./style.css";

const record = rawRecord as AuditRecord;
const storageKey = `${record.id}:feedback:v1`;
const empty = (): Feedback => ({ optionId: null, notes: "" });
const fingerprint = ({ id, label, description, consequence, version }: AuditOption) =>
  JSON.stringify({ id, label, description, consequence, version });
type Saved = {
  values: Record<string, Feedback>;
  baseline: Record<string, Feedback>;
  fingerprints: Record<string, Record<string, string>>;
  forcedOpen: Record<string, boolean>;
  mergedRevision?: string;
};
const same = (a: Feedback | undefined, b: Feedback | undefined) =>
  (a?.optionId ?? null) === (b?.optionId ?? null) && (a?.notes ?? "") === (b?.notes ?? "");
function loadFeedback(): Saved {
  let saved: Partial<Saved> = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {}
  const baseline = { ...saved.baseline };
  const values = { ...saved.values };
  const forcedOpen = { ...saved.forcedOpen };
  const fingerprints: Record<string, Record<string, string>> = {};
  const newMerge =
    record.feedbackMergedRevision && saved.mergedRevision !== record.feedbackMergedRevision;
  for (const d of record.decisions) {
    const incorporated =
      record.feedbackBaseline?.[d.id] ??
      (d.settled ? { optionId: d.settled.optionId, notes: d.settled.notes ?? "" } : empty());
    // Adopt incorporated feedback when the browser still holds the submitted
    // answer or its old unchanged baseline. Keep later local edits.
    if (
      newMerge &&
      (same(values[d.id], record.feedbackMergedInput?.[d.id]) ||
        same(values[d.id], saved.baseline?.[d.id]))
    ) {
      values[d.id] = incorporated;
    }
    if (!baseline[d.id] || newMerge) baseline[d.id] = incorporated;
    if (!values[d.id]) values[d.id] = incorporated;
    const selected = d.options.find((o) => o.id === values[d.id].optionId);
    const oldMeaning = selected ? saved.fingerprints?.[d.id]?.[selected.id] : undefined;
    const changedMeaning = selected && oldMeaning && oldMeaning !== fingerprint(selected);
    if (
      values[d.id].optionId &&
      (!selected || (changedMeaning && !(newMerge && same(values[d.id], incorporated))))
    ) {
      values[d.id] = { ...values[d.id], optionId: null };
      forcedOpen[d.id] = true;
    }
    if (newMerge && same(values[d.id], incorporated)) delete forcedOpen[d.id];
    fingerprints[d.id] = Object.fromEntries(
      d.options.map((option) => [option.id, fingerprint(option)]),
    );
  }
  return {
    values,
    baseline,
    forcedOpen,
    fingerprints,
    mergedRevision: record.feedbackMergedRevision ?? saved.mergedRevision,
  };
}

function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="m9 12 7 9 7-9M9 10l7 9 7-9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function Term({ children, definition }: { children: string; definition: string }) {
  const id = React.useId();
  const anchor = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ left: 0, top: 0 });
  function show() {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        left: Math.min(Math.max(12, rect.left), window.innerWidth - 292),
        top: Math.min(rect.bottom + 8, window.innerHeight - 125),
      });
      setOpen(true);
    }
  }
  React.useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) hide();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  return (
    <>
      <span
        ref={anchor}
        className="term"
        role="button"
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        aria-label={children}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            show();
          }
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <span id={id} role="tooltip" className="term-popup" style={pos}>
            {definition}
          </span>,
          document.body,
        )}
    </>
  );
}
const termNames = Object.keys(record.terms).sort((a, b) => b.length - a.length);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termPattern = termNames.length
  ? new RegExp(`(?<![\\w])(${termNames.map(escapeRegex).join("|")})(?![\\w])`, "gi")
  : null;
function findTerm(text: string) {
  return termNames.find((name) => {
    if (["Shell", "Frame", "Layer", "Container"].includes(name)) {
      return name === text;
    }
    return name.toLowerCase() === text.toLowerCase();
  });
}
function T({ children }: { children: string | undefined }) {
  if (!children) return null;
  if (!termPattern) return <>{children}</>;
  return (
    <>
      {children.split(termPattern).map((part, i) => {
        const name = findTerm(part);
        return name ? (
          <Term key={i} definition={record.terms[name]}>
            {part}
          </Term>
        ) : (
          part
        );
      })}
    </>
  );
}
function LabelTerms({ text }: { text: string }) {
  const matches = termPattern ? (text.match(termPattern) ?? []) : [];
  const terms = [...new Set(matches.map(findTerm).filter((term): term is string => Boolean(term)))];
  return terms.length ? (
    <span className="label-terms">
      Terms:{" "}
      {terms.map((t, i) => (
        <React.Fragment key={t}>
          {i > 0 ? ", " : ""}
          <Term definition={record.terms[t]}>{t}</Term>
        </React.Fragment>
      ))}
    </span>
  ) : null;
}
function Status({ answered }: { answered: boolean }) {
  return (
    <span className={`status ${answered ? "answered" : ""}`}>
      <span aria-hidden="true">{answered ? "✓" : "○"}</span> {answered ? "ANSWERED" : "OPEN"}
    </span>
  );
}
function Code({ source, language }: { source: string; language: string }) {
  // Token text is never rewritten. The DOM preserves the exact source on copy.
  const tokenPattern =
    language === "sql"
      ? /(--[^\n]*|'(?:[^'\\]|\\.)*'|\b(?:SELECT|FROM|WHERE|AND|OR|INSERT|INTO|VALUES|CREATE|TABLE|INDEX|ON|LIMIT|ORDER|BY|UPDATE|SET|DELETE|JOIN|AS|NOT|NULL|PRIMARY|KEY|UNIQUE)\b|\b\d+(?:\.\d+)?\b)/gi
      : /((?:\/\/|#)[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:const|let|return|await|async|function|export|import|from|if|else|true|false|null|type|interface|new|throw|try|catch)\b|\b\d+(?:\.\d+)?\b|\b[A-Z][A-Za-z0-9]+\b)/g;
  return (
    <Frame $rounded="xl" $border className="code-frame">
      <div className="code-heading">
        <span>{language}</span>
        <span>Selectable source</span>
      </div>
      <pre>
        <code>
          {source.split(tokenPattern).map((part, i) => {
            let kind = "";
            if (i % 2) {
              kind = /^(\/\/|#|--)/.test(part)
                ? "comment"
                : /^["'`]/.test(part)
                  ? "string"
                  : /^\d/.test(part)
                    ? "number"
                    : /^[A-Z][a-z]/.test(part)
                      ? "type"
                      : "keyword";
            }
            return (
              <span key={i} className={kind ? `syntax-${kind}` : undefined}>
                <T>{part}</T>
              </span>
            );
          })}
        </code>
      </pre>
    </Frame>
  );
}

function Demo({ decision }: { decision: AuditDecision }) {
  const [choice, setChoice] = React.useState(
    decision.demo?.initialOption ?? decision.options[0]?.id,
  );
  const [resetKey, setResetKey] = React.useState(0);
  const option = decision.options.find((o) => o.id === choice)!;
  const state = decision.demo?.states?.[choice];
  const steps = state?.steps ?? ["Input", option.label, "Result"];
  return (
    <Frame $rounded="2xl" $border className="demo-panel">
      <div className="row between">
        <span className="eyebrow">EXPLORE · DOES NOT SELECT YOUR ANSWER</span>
        <Button
          className="reset"
          onClick={() => {
            setChoice(decision.demo?.initialOption ?? decision.options[0].id);
            setResetKey((prev) => prev + 1);
          }}
        >
          Reset
        </Button>
      </div>
      <h3>
        <T>{decision.demo?.title ?? "Try the tradeoff"}</T>
      </h3>
      <p className="small subtle">
        <T>
          {decision.demo?.description ??
            "Concept model. These states describe a possible design. They do not measure the live app."}
        </T>
      </p>
      <label className="demo-select">
        <span>Model option</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {decision.options.map((o) => (
            <option value={o.id} key={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <LabelTerms text={decision.options.map((o) => o.label).join(" ")} />
      {/^U0[1-6]$/.test(decision.id) ? (
        <UiPrototype key={resetKey} decisionId={decision.id} optionId={choice} />
      ) : (
        <>
          <div className="flow" aria-label="Model steps">
            {steps.map((step, i) => (
              <React.Fragment key={`${choice}-${i}`}>
                <Frame $rounded="lg" $p={3} $layer $border className="flow-step">
                  <span className="flow-count">{String(i + 1).padStart(2, "0")}</span>
                  <T>{step}</T>
                </Frame>
                {i < steps.length - 1 ? <Arrow className="flow-arrow" /> : null}
              </React.Fragment>
            ))}
          </div>
          <Layer $layer className="model-result" aria-live="polite">
            <strong>
              <T>{state?.title ?? option.label}</T>
            </strong>
            <p>
              <T>{state?.detail ?? option.consequence}</T>
            </p>
          </Layer>
          {decision.demo?.metrics?.length ? (
            <div className="metric-grid">
              {decision.demo.metrics.map((metric) => (
                <Frame $rounded="lg" $p={3} key={metric.label}>
                  <span className="small subtle">
                    <T>{metric.label}</T>
                  </span>
                  <strong>
                    <T>{metric.values[choice] ?? "Not measured"}</T>
                  </strong>
                </Frame>
              ))}
            </div>
          ) : null}
          {hasQuantitativePrototype(decision.id) ? (
            <QuantitativePrototype
              key={resetKey}
              decisionId={decision.id}
              optionId={choice}
              Text={T}
            />
          ) : null}
        </>
      )}
    </Frame>
  );
}

function DecisionPanel({
  decision: d,
  value,
  onChange,
  invalidated,
}: {
  decision: AuditDecision;
  value: Feedback;
  onChange: (v: Feedback) => void;
  invalidated?: boolean;
}) {
  return (
    <section id={`section-${d.id}`} className="decision-section" aria-labelledby={`${d.id}-title`}>
      <div className="section-kicker">
        <span className="decision-number">{d.id}</span>
        <span>
          <T>{d.category}</T>
        </span>
        {d.priority ? (
          <span className="priority">
            <T>{d.priority}</T>
          </span>
        ) : null}
      </div>
      <h2 id={`${d.id}-title`}>
        <T>{d.question}</T>
      </h2>
      <p className="decision-summary">
        <T>{d.summary}</T>
      </p>
      {d.reopens?.length ? (
        <p className="reopens">
          Reopens prior decisions:{" "}
          {d.reopens.map((id, i) => (
            <React.Fragment key={id}>
              {i ? ", " : ""}
              <a href="#prior-record">{id}</a>
            </React.Fragment>
          ))}
          . Their old choices are preserved as history. The current issue contract remains
          unchanged until a separate issue update is authorized.
        </p>
      ) : null}
      <div className="research-grid">
        <div className="evidence-column">
          <h3>What the evidence shows</h3>
          <ul className="fact-list">
            {d.current.map((fact, i) => (
              <li key={i}>
                <span className="fact-mark" aria-hidden="true">
                  ↳
                </span>
                <p>
                  <T>{fact}</T>
                </p>
              </li>
            ))}
          </ul>
          <div className="sources">
            {d.evidence.map((item, i) => (
              <div key={i}>
                <a
                  href={item.url}
                  target={item.url.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer"
                >
                  {item.label}
                  <span aria-hidden="true"> ↗</span>
                </a>
                <LabelTerms text={item.label} />
                {item.detail ? (
                  <p>
                    <T>{item.detail}</T>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          {d.settled ? (
            <Frame $rounded="xl" $p={4} $border className="recommendation">
              <span className="eyebrow">RECORDED CHOICE · REVISION {record.revision}</span>
              <p>
                <strong><T>{d.options.find((o) => o.id === d.settled?.optionId)?.label}</T></strong>
                {" · "}
                <T>{d.settled.reason}</T>
              </p>
              {!same(value, { optionId: d.settled.optionId, notes: d.settled.notes ?? "" }) ? (
                <p className="small subtle">Your current browser feedback differs from this record.</p>
              ) : null}
            </Frame>
          ) : d.recommendation ? (
            <Frame $rounded="xl" $p={4} $border className="recommendation">
              <span className="eyebrow">RECOMMENDATION · YOUR CHOICE IS STILL OPEN</span>
              <p>
                <T>{d.recommendation}</T>
              </p>
              {d.invalidates ? (
                <p className="small subtle">
                  <strong>Change this view if: </strong>
                  <T>{d.invalidates}</T>
                </p>
              ) : null}
            </Frame>
          ) : null}
        </div>
        <Demo decision={d} />
      </div>
      <Frame id={d.id} $rounded="2xl" $border $p={5} className="decision-panel" tabIndex={-1}>
        <div className="row between decision-label">
          <span className="eyebrow">DECISION {d.id}</span>
          <Status answered={Boolean(value.optionId)} />
        </div>
        <fieldset>
          <legend>
            <T>{d.question}</T>
          </legend>
          {invalidated ? (
            <p className="invalidated">
              The option meanings changed. Your old selection was cleared. Your notes are preserved.
            </p>
          ) : null}
          <div className="option-grid">
            {d.options.map((option, i) => (
              <Frame
                key={option.id}
                $rounded="xl"
                $border
                className={`option ${value.optionId === option.id ? "selected" : ""}`}
              >
                <label>
                  <input
                    type="radio"
                    name={d.id}
                    value={option.id}
                    checked={value.optionId === option.id}
                    onChange={() => onChange({ ...value, optionId: option.id })}
                  />
                  <span className="option-label">{option.label}</span>
                </label>
                {option.recommended ? <span className="recommended-label">Recommended</span> : null}
                <LabelTerms text={option.label} />
                <p>
                  <T>{option.description}</T>
                </p>
                <p className="option-consequence">
                  <T>{option.consequence}</T>
                </p>
              </Frame>
            ))}
          </div>
        </fieldset>
        <div className="notes-row">
          <label htmlFor={`notes-${d.id}`}>
            Notes{" "}
            <span className="subtle">Optional. You can add notes while the decision is open.</span>
          </label>
          <Button onClick={() => onChange({ ...value, optionId: null })} disabled={!value.optionId}>
            Clear choice
          </Button>
        </div>
        <textarea
          id={`notes-${d.id}`}
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="Add a constraint, concern, or another option…"
          rows={3}
        />
      </Frame>
      <details className="implementation-details">
        <summary>
          Compatibility, risks, and proof needed <span aria-hidden="true">＋</span>
        </summary>
        <div className="detail-grid">
          {d.migration ? (
            <div>
              <h3>Migration and reversal</h3>
              <p>
                <T>{d.migration}</T>
              </p>
            </div>
          ) : null}
          {d.risks ? (
            <div>
              <h3>Limits and failure cases</h3>
              <p>
                <T>{d.risks}</T>
              </p>
            </div>
          ) : null}
          {d.tests?.length ? (
            <div>
              <h3>Proof before a change</h3>
              <ul>
                {d.tests.map((test, i) => (
                  <li key={i}>
                    <T>{test}</T>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {d.code ? <Code {...d.code} /> : null}
      </details>
    </section>
  );
}

function App() {
  const [saved, setSaved] = React.useState(loadFeedback);
  const [copyStatus, setCopyStatus] = React.useState("");
  const [saveError, setSaveError] = React.useState(false);
  const preview = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [saved]);
  const answered = record.decisions.filter((d) =>
    d.options.some((o) => o.id === saved.values[d.id]?.optionId),
  ).length;
  const changed = record.decisions.filter(
    (d) => saved.forcedOpen[d.id] || !same(saved.values[d.id], saved.baseline[d.id]),
  );
  const prompt = [
    `Continue the living record “${record.title}” (${record.revision}).`,
    `Load the complete record and design document at: ${record.artifactPath}`,
    `Read audit-data.json beside the design source if needed. Merge only the updates below and preserve every unchanged decision.`,
    `Treat only explicit current option selections as decisions. Keep OPEN items open. If notes conflict with a selected answer, ask me to resolve the conflict. Compare new alternatives from notes.`,
    `After merging this feedback, refresh the living record, examples, shared term definitions, and feedback baseline in a new revision. Continue the audit/design within the authorized scope. Product implementation, production changes, and GitHub publication require separate authorization.`,
    "",
    changed.length
      ? "Updates in this feedback round:"
      : "No decisions changed in this feedback round.",
    ...changed.flatMap((d) => {
      const v = saved.values[d.id] ?? empty();
      const option = d.options.find((o) => o.id === v.optionId);
      return [
        "",
        `${d.id} — ${d.question}`,
        `Answer: ${option ? `${option.id} — ${option.label}` : "OPEN"}`,
        `Notes: ${v.notes || "(none)"}`,
      ];
    }),
  ].join("\n");
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyStatus("Prompt copied. Your feedback round is unchanged.");
    } catch {
      preview.current?.scrollIntoView({ block: "center" });
      preview.current?.focus();
      preview.current?.select();
      setCopyStatus("Select and copy the prompt below.");
    }
  }
  function update(id: string, value: Feedback) {
    setSaved((prev) => ({
      ...prev,
      values: { ...prev.values, [id]: value },
      forcedOpen: { ...prev.forcedOpen, [id]: value.optionId ? false : prev.forcedOpen[id] },
    }));
  }
  return (
    <Layer $layer="canvas" className="audit-root">
      <Shell className="audit-shell">
        <a className="skip-link" href="#content">
          Skip to decisions
        </a>
        <ShellHeader
          $height="lg"
          $blur
          className="audit-header"
          start={
            <a className="wordmark" href="#top">
              <Mark />
              <span>
                visonaut<span className="wordmark-divider"> / </span>
                <span className="wordmark-sub">audit</span>
              </span>
            </a>
          }
          end={
            <ShellHeaderEnd className="header-actions">
              <span className="progress-label" aria-live="polite">
                <strong>{answered}</strong> / {record.decisions.length} answered
              </span>
              <Button $layer="brand" onClick={copyPrompt} className="copy-button">
                Copy continuation prompt <Arrow />
              </Button>
              <ak.MenuProvider>
                <ak.MenuButton render={<Button $border />} className="index-button">
                  Decisions <span aria-hidden="true">☰</span>
                </ak.MenuButton>
                <ak.Menu portal gutter={10} className="decision-menu">
                  <p className="eyebrow">
                    DECISION INDEX · {answered}/{record.decisions.length}
                  </p>
                  {record.decisions.map((d) => (
                    <ak.MenuItem key={d.id} render={<a href={`#${d.id}`} />} className="index-item">
                      <span className="index-id">{d.id}</span>
                      <span>{d.question}</span>
                      <span className={saved.values[d.id]?.optionId ? "index-done" : "index-open"}>
                        {saved.values[d.id]?.optionId ? "Answered" : "Open"}
                      </span>
                    </ak.MenuItem>
                  ))}
                </ak.Menu>
              </ak.MenuProvider>
            </ShellHeaderEnd>
          }
        />
        <ShellMain $p="clamp(1rem,4vw,3.5rem)" $maxWidth="1240px">
          <ShellMainBody>
            <section className="hero" id="top">
              <div className="eyebrow hero-eyebrow">
                <span className="live-dot" /> REPOSITORY AUDIT <span> / </span> {record.date}
              </div>
              <h1>
                <T>{record.title}</T>
              </h1>
              <p className="hero-summary">
                <T>{record.summary}</T>
              </p>
              {record.references?.length ? (
                <nav className="record-links" aria-label="Record sources">
                  {record.references.map((link) => (
                    <div key={link.url}>
                      <a href={link.url}>{link.label} ↗</a>
                      <LabelTerms text={link.label} />
                    </div>
                  ))}
                </nav>
              ) : null}
              <div className="hero-foot">
                <span className="record-revision">{record.revision} · Local decision record</span>
                <a
                  className="begin-link"
                  href={record.decisions.length ? `#${record.decisions[0].id}` : "#content"}
                >
                  Start with the decisions <Arrow />
                </a>
              </div>
            </section>
            <Frame $rounded="2xl" $border className="scope-panel">
              <div>
                <span className="eyebrow">THE BRIEF</span>
                <h2>Make less do more.</h2>
                <p className="subtle">
                  Use the evidence to remove work. Your recorded choices remain editable.
                </p>
              </div>
              <div>
                <h3>Goals</h3>
                <ul>
                  {record.goals.map((g, i) => (
                    <li key={i}>
                      <T>{g}</T>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Supported work</h3>
                <ul>
                  {record.useCases.map((g, i) => (
                    <li key={i}>
                      <T>{g}</T>
                    </li>
                  ))}
                </ul>
              </div>
            </Frame>
            <details className="scope-details">
              <summary>
                Scope, constraints, and prior decisions <span aria-hidden="true">＋</span>
              </summary>
              <div className="detail-grid">
                <div>
                  <h3>Outside this draft</h3>
                  <ul>
                    {record.nonGoals.map((g, i) => (
                      <li key={i}>
                        <T>{g}</T>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Constraints</h3>
                  <ul>
                    {record.constraints.map((g, i) => (
                      <li key={i}>
                        <T>{g}</T>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {record.priorDecisions?.length ? (
                <details id="prior-record" className="prior-record">
                  <summary>
                    Prior decision record · {record.priorDecisions.length} preserved choices
                  </summary>
                  <p>
                    This is preserved history from revision 9. Later work may have replaced these
                    choices. GitHub issue #1 still holds its earlier implementation contract. This
                    local record now includes your newer design choices. Updating the issue requires
                    separate authorization. Prior choices are not counted as new answers.
                  </p>
                  <div>
                    {record.priorDecisions.map((d) => (
                      <Frame key={d.id} $rounded="lg" $border $p={3}>
                        <span className="eyebrow">{d.id} · PRIOR RECORD</span>
                        <h4>
                          <T>{d.question}</T>
                        </h4>
                        <p>
                          <strong>Recorded choice: </strong>
                          <T>{d.answer}</T>
                        </p>
                        {d.notes ? (
                          <p className="small subtle">
                            <T>{d.notes}</T>
                          </p>
                        ) : null}
                      </Frame>
                    ))}
                  </div>
                </details>
              ) : null}
            </details>
            <nav className="category-index" aria-label="Audit categories">
              {[...new Set(record.decisions.map((d) => d.category))].map((category) => {
                const first = record.decisions.find((d) => d.category === category)!;
                return (
                  <a key={category} href={`#section-${first.id}`}>
                    {category}{" "}
                    <span>{record.decisions.filter((d) => d.category === category).length}</span>
                  </a>
                );
              })}
            </nav>
            <div className="document-rule">
              <span>{record.decisions.length} decisions</span>
              <span>Evidence → model → your choice</span>
            </div>
            <div id="content" className="decisions" aria-label="Audit decisions">
              {record.decisions.map((d) => (
                <DecisionPanel
                  key={d.id}
                  decision={d}
                  value={saved.values[d.id] ?? empty()}
                  onChange={(value) => update(d.id, value)}
                  invalidated={saved.forcedOpen[d.id]}
                />
              ))}
            </div>
            <Frame $rounded="2xl" $border $p={6} className="handoff" id="handoff">
              <span className="eyebrow">CONTINUE THE WORK</span>
              <h2>Your choices, ready to carry forward.</h2>
              <p>
                Your selections and notes are saved in this browser, for this document. They reach
                the agent only when you share the continuation prompt. Copying does not clear your
                notes or start a new feedback round.
              </p>
              <div className="row between handoff-count">
                <span>
                  <strong>{changed.length}</strong> changed decisions in this round
                </span>
                <Button $layer="brand" onClick={copyPrompt}>
                  Copy continuation prompt <Arrow />
                </Button>
              </div>
              <label htmlFor="continuation">
                Continuation prompt preview · you can select and copy this text
              </label>
              <textarea id="continuation" ref={preview} readOnly value={prompt} rows={12} />
              <p role="status" className="copy-status">
                {copyStatus ||
                  "The preview includes only choices and notes changed since the last agent merge."}
              </p>
              {saveError ? (
                <p role="alert">
                  Browser storage is unavailable. Keep a copy of the prompt before closing this
                  page.
                </p>
              ) : null}
            </Frame>
            {record.verification?.length ? (
              <details className="verification">
                <summary>Verification and limits of this draft</summary>
                <ul>
                  {record.verification.map((v, i) => (
                    <li key={i}>
                      <T>{v}</T>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <footer className="audit-footer">
              <span>
                <Mark /> Visonaut simplification audit
              </span>
              <span>
                Built with <T>Ariakit UI</T> · {record.revision}
              </span>
            </footer>
          </ShellMainBody>
        </ShellMain>
      </Shell>
    </Layer>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

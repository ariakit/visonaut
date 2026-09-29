export type Feedback = { optionId: string | null; notes: string };
export type AuditOption = {
  id: string;
  label: string;
  description: string;
  consequence: string;
  recommended?: boolean;
  version?: string;
};
export type AuditDecision = {
  reopens?: string[];
  id: string;
  category: string;
  question: string;
  summary: string;
  priority?: string;
  current: string[];
  evidence: { label: string; url: string; detail?: string }[];
  options: AuditOption[];
  recommendation?: string;
  invalidates?: string;
  migration?: string;
  risks?: string;
  tests?: string[];
  code?: { language: string; source: string };
  demo?: {
    kind: "model" | "workflow" | "review" | "storage";
    title?: string;
    description?: string;
    initialOption?: string;
    metrics?: { label: string; values: Record<string, string> }[];
    states?: Partial<Record<string, { title: string; detail: string; steps?: string[] }>>;
  };
  settled?: { optionId: string; notes?: string; reason: string };
};
export type AuditRecord = {
  id: string;
  title: string;
  revision: string;
  date: string;
  artifactPath: string;
  summary: string;
  goals: string[];
  useCases: string[];
  nonGoals: string[];
  constraints: string[];
  references?: { label: string; url: string }[];
  priorDecisions?: { id: string; question: string; answer: string; notes?: string }[];
  terms: Record<string, string>;
  decisions: AuditDecision[];
  verification?: string[];
  // Set only after the agent merges this feedback into the complete living record.
  feedbackBaseline?: Record<string, Feedback>;
  feedbackMergedRevision?: string;
  feedbackMergedInput?: Record<string, Feedback>;
};

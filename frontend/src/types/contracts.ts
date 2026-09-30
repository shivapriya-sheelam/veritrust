export type ClaimStatus = "SUPPORTED" | "CONTRADICTED" | "UNSUPPORTED";
export type FinalStatus = "DELIVERED" | "CORRECTED" | "ABSTAINED";
export type CheckedBy = "deterministic" | "llm";
export type AbstainReason = "UNSUPPORTED" | "RETRY_CAP" | "SYSTEM_ERROR";

export const ABSTAIN_MESSAGE = "I couldn't verify this from VeriCorp's policies. Please contact support.";

export interface Evidence {
  source: string;
  version: string;
  text: string;
  chunk_id: string;
}

export interface ClaimSpan {
  id: number;
  text: string;
  start: number;
  end: number;
}

export interface Claim extends ClaimSpan {
  status: ClaimStatus;
  checked_by: CheckedBy;
  reason: string;
  evidence: Evidence[];
}

export interface JudgeOutput {
  status: ClaimStatus;
  reason: string;
  evidence_ids: string[];
}

export interface RunResult {
  run_id: string;
  question: string;
  chaos: boolean;
  draft: string;
  claims: Claim[];
  final_draft: string;
  final_claims: Claim[];
  final_answer: string;
  final_status: FinalStatus;
  abstain_reason: AbstainReason | null;
  retries: number;
  latency_ms: {
    retrieve: number;
    maker: number;
    check: number;
    judge: number;
    correct: number;
    total: number;
    [key: string]: number;
  };
  tokens: {
    maker: number;
    judge: number;
    [key: string]: number;
  };
  policy_versions: Record<string, string>;
  created_at: string;
}

export type SSEEventName =
  | "run_started"
  | "retrieved"
  | "draft"
  | "claims"
  | "claim_checked"
  | "correcting"
  | "corrected_draft"
  | "final"
  | "run_finished"
  | "error";

export interface EventRunStarted {
  run_id: string;
  question: string;
  chaos: boolean;
}

export interface EventRetrieved {
  evidence: Evidence[];
}

export interface EventDraft {
  text: string;
}

export interface EventClaims {
  attempt: number;
  claims: ClaimSpan[];
}

export interface EventClaimChecked {
  attempt: number;
  claim: Claim;
}

export interface EventCorrecting {
  attempt: number;
  feedback: string;
}

export interface EventCorrectedDraft {
  attempt: number;
  text: string;
}

export interface EventFinal {
  answer: string;
  status: FinalStatus;
  abstain_reason: AbstainReason | null;
}

export interface EventRunFinished {
  result: RunResult;
}

export interface EventError {
  code: "BUSY" | "OLLAMA_DOWN" | "TIMEOUT" | "INTERNAL";
  message: string;
}

export type ServerEvent =
  | { event: "run_started"; data: EventRunStarted }
  | { event: "retrieved"; data: EventRetrieved }
  | { event: "draft"; data: EventDraft }
  | { event: "claims"; data: EventClaims }
  | { event: "claim_checked"; data: EventClaimChecked }
  | { event: "correcting"; data: EventCorrecting }
  | { event: "corrected_draft"; data: EventCorrectedDraft }
  | { event: "final"; data: EventFinal }
  | { event: "run_finished"; data: EventRunFinished }
  | { event: "error"; data: EventError };

export interface MockScenarios {
  scenarios: {
    corrected: ServerEvent[];
    delivered: ServerEvent[];
    abstained: ServerEvent[];
  };
}

// Phase 11 Endpoint Contract Types

export interface RunRow {
  run_id: string;
  question: string;
  final_status: FinalStatus;
  chaos: boolean;
  source: "live" | "benchmark";
  created_at: string;
  total_ms: number;
  stale: boolean;
}

export interface MetricsDriftPoint {
  window_end: string;
  first_pass_clean_rate: number;
  runs: number;
}

export interface PolicyChangeMarker {
  name: string;
  from: string;
  to: string;
  at: string;
}

export interface MetricsResult {
  answers_checked: number;
  wrong_drafts: number;
  delivered_clean: number;
  corrected: number;
  abstained: number;
  chaos_runs: number;
  grounding_rate: number | null;
  first_pass_clean_rate: number | null;
  drift: MetricsDriftPoint[];
  policy_changes: PolicyChangeMarker[];
  latency_ms: {
    retrieve: number;
    maker: number;
    check: number;
    judge: number;
    correct: number;
    total: number;
  };
  tokens: {
    maker: number;
    judge: number;
  };
}

export interface PolicySummary {
  name: string;
  version: string;
  effective_date: string;
  updated_at: string;
}

export interface PolicyDetail {
  name: string;
  version: string;
  text: string;
}

export interface PolicyUpdateResult {
  name: string;
  version: string;
  stale_run_ids: string[];
}

// Phase 11 Step 3: Benchmark & Gauntlet Contracts (PRD Sections 10, 12, 13)

export type BenchmarkCategory =
  | "direct"
  | "paraphrased"
  | "multi_part"
  | "false_premise"
  | "unanswerable"
  | string;

export type BenchmarkExpectedBehavior = "ANSWER" | "ABSTAIN";

export interface BenchmarkCaseResult {
  case_id: string;
  category: BenchmarkCategory;
  question: string;
  expected_behavior: BenchmarkExpectedBehavior;
  expected_facts?: string[];
  forbidden_facts?: string[];
  actual_status?: FinalStatus;
  actual_answer?: string;
  pass: boolean;
  latency_ms?: number;
  run_id?: string;
  mode?: "normal" | "chaos";
  draft?: string;
  final_draft?: string;
  retries?: number;
  outcome?: string;
}

export interface BenchmarkSummary {
  id?: number | string;
  started_at: string;
  finished_at?: string;
  modes: ("normal" | "chaos" | string)[];
  total_cases: number;
  completed_cases: number;
  passed_cases: number;
  failed_cases: number;
  detection_rate: number | null;
  false_approval_rate: number | null;
  correct_abstention_rate: number | null;
  correction_success_rate: number | null;
  over_abstention_rate?: number | null;
  baseline_accuracy?: number | null;
  veritrust_accuracy?: number | null;
  cases?: BenchmarkCaseResult[];
}

export type BenchmarkStreamEvent =
  | {
      event: "benchmark_started";
      data: {
        total_cases?: number;
        mode?: string;
        modes?: string[];
        started_at?: string;
      };
    }
  | {
      event: "benchmark_case";
      data: BenchmarkCaseResult;
    }
  | {
      event: "benchmark_summary";
      data: BenchmarkSummary;
    }
  | {
      event: "error";
      data: {
        code: string;
        message: string;
      };
    };



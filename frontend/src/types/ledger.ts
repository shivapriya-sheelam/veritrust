// Types for the Verification Ledger (Audit Trail)
export type LedgerStatusType = "CORRECTED" | "PASSED" | "REFUSED";

export interface LedgerRunRecord {
  id: string; // e.g. "#VC-9042"
  question: string;
  timestamp: string; // e.g. "14:22:08 IST"
  status: LedgerStatusType;
  statusLabel: string; // e.g. "Corrected", "Passed (1st pass)", "Refused (Abstain)"
  isSimulated?: boolean;
  actionLabel: string; // e.g. "Inspect redline", "Open run"
  actionScenario?: "corrected" | "delivered" | "abstained";
  rawProposition?: {
    text: string;
    highlightText?: string;
    failedAssertion?: string;
  };
  reconciledRedline?: {
    text: string;
    highlightText?: string;
    groundedChunk?: string;
    matchScore?: number;
    policySource?: string;
  };
}

export interface LedgerSummary {
  isMockData: true;
  totalChecked: number;
  wrongDrafts: number;
  fixedCount: number;
  refusedCount: number;
  caption: string;
}

export interface TrendPoint {
  runLabel: string;
  ratePercent: number;
  cx: number;
  cy: number;
  highlight?: "error" | "normal" | "current";
}

export type {
  RunRow,
  MetricsResult,
  MetricsDriftPoint,
  PolicyChangeMarker,
} from "./contracts";


// Types for Policies Workspace (Frontend Demo/Mock Model)

export interface PolicyChunk {
  id: string; // e.g. "Chunk #1", "Chunk #3"
  sectionLabel: string; // e.g. "§1. General Return Window"
  title: string; // e.g. "1. General Return Window & Conditions"
  content: string;
  isGroundTruthAnchor?: boolean;
  anchorRunRef?: string; // e.g. "Referenced by Run #9042"
  anchorClaimRef?: string; // e.g. "Target: Claim #ref_01"
  highlightText?: string; // e.g. "can be returned within 15 days of purchase"
  ineligibleText?: string; // e.g. "strictly ineligible for refund"
  footnote?: string; // e.g. "Ground truth for redline correction (15 days vs model hallucination of 30 days)"
}

export interface PolicyDocument {
  id: string; // e.g. "refund_policy.md"
  name: string; // e.g. "refund_policy.md"
  version: string; // e.g. "v1.4"
  updatedAt: string; // e.g. "2025-02-14 09:30 UTC"
  summary: string; // e.g. "Returns, store credits & electronics return SLA"
  subtitle: string;
  reviewsGroundedCount: number;
  chunksCount: number;
  markdownContent: string;
  chunks: PolicyChunk[];
  staleRunsCount?: number;
}

export type {
  PolicySummary,
  PolicyDetail,
  PolicyUpdateResult,
} from "./contracts";


// Word-level and semantic diff utility using diff-match-patch for Tracked Changes
import DiffMatchPatch from "diff-match-patch";
import { Claim, ClaimStatus, Evidence, FinalStatus } from "@/types/contracts";

export type DiffType = "equal" | "delete" | "insert";

export interface DiffSegment {
  type: DiffType;
  text: string;
}

export interface TrackedDiffSegment {
  type: DiffType;
  text: string;
  claimId?: number;
  claimKey?: string;
  claimStatus?: ClaimStatus;
  reason?: string;
  evidence?: Evidence[];
  draftStart?: number;
  draftEnd?: number;
  finalStart?: number;
  finalEnd?: number;
}

export function computeTrackedDiff(oldText: string, newText: string): DiffSegment[] {
  if (!oldText && !newText) return [];
  if (!oldText) return [{ type: "insert", text: newText }];
  if (!newText) return [{ type: "delete", text: oldText }];
  if (oldText === newText) return [{ type: "equal", text: oldText }];

  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  return diffs.map(([op, text]) => {
    let type: DiffType = "equal";
    if (op === -1) type = "delete";
    else if (op === 1) type = "insert";
    return { type, text };
  });
}

/**
 * Computes word-level and semantic diff between draft and final_answer,
 * correlating every deleted, inserted, or equal segment with corresponding
 * Claim and final_claims metadata from contracts.
 */
export function computeTrackedSegmentsWithClaims(
  draft: string,
  finalAnswer: string,
  claims: Claim[],
  finalClaims: Claim[],
  finalStatus: FinalStatus
): TrackedDiffSegment[] {
  if (!draft && !finalAnswer) return [];

  // In an ABSTAINED run, PRD specifies:
  // "ABSTAINED: the whole draft is struck through in the refusal accent, with the refusal message below it."
  if (finalStatus === "ABSTAINED") {
    // If we have claims in draft, split the draft by claims so clicking any claim highlights its reason/rail card
    if (!claims || claims.length === 0) {
      return [{ type: "delete", text: draft, draftStart: 0, draftEnd: draft.length }];
    }

    const segments: TrackedDiffSegment[] = [];
    let currentPos = 0;
    // Sort claims by start offset
    const sortedClaims = [...claims].sort((a, b) => a.start - b.start);

    for (const c of sortedClaims) {
      if (c.start > currentPos) {
        segments.push({
          type: "delete",
          text: draft.slice(currentPos, c.start),
          draftStart: currentPos,
          draftEnd: c.start,
        });
      }
      segments.push({
        type: "delete",
        text: draft.slice(c.start, c.end),
        claimId: c.id,
        claimKey: `claim-${c.id}`,
        claimStatus: c.status,
        reason: c.reason,
        evidence: c.evidence,
        draftStart: c.start,
        draftEnd: c.end,
      });
      currentPos = c.end;
    }

    if (currentPos < draft.length) {
      segments.push({
        type: "delete",
        text: draft.slice(currentPos),
        draftStart: currentPos,
        draftEnd: draft.length,
      });
    }

    return segments;
  }

  // For CORRECTED or DELIVERED runs:
  // Run diff-match-patch between draft and final_answer
  const dmp = new DiffMatchPatch();
  const rawDiffs = dmp.diff_main(draft, finalAnswer);
  dmp.diff_cleanupSemantic(rawDiffs);

  const result: TrackedDiffSegment[] = [];
  let draftPos = 0;
  let finalPos = 0;

  for (const [op, text] of rawDiffs) {
    if (op === -1) {
      // Deletion: text is from draft
      const segStart = draftPos;
      const segEnd = draftPos + text.length;
      draftPos = segEnd;

      // Find any claim boundary that cuts through this deleted segment
      const subSegments = splitRangeByClaims(segStart, segEnd, claims);
      for (const sub of subSegments) {
        const subText = draft.slice(sub.start, sub.end);
        const matchedClaim = claims.find(
          (c) => Math.max(sub.start, c.start) < Math.min(sub.end, c.end)
        );
        result.push({
          type: "delete",
          text: subText,
          claimId: matchedClaim?.id,
          claimKey: matchedClaim !== undefined ? `claim-${matchedClaim.id}` : undefined,
          claimStatus: matchedClaim?.status,
          reason: matchedClaim?.reason,
          evidence: matchedClaim?.evidence,
          draftStart: sub.start,
          draftEnd: sub.end,
        });
      }
    } else if (op === 1) {
      // Insertion: text is from final_answer
      const segStart = finalPos;
      const segEnd = finalPos + text.length;
      finalPos = segEnd;

      const subSegments = splitRangeByClaims(segStart, segEnd, finalClaims);
      for (const sub of subSegments) {
        const subText = finalAnswer.slice(sub.start, sub.end);
        const matchedFinalClaim = finalClaims.find(
          (c) => Math.max(sub.start, c.start) < Math.min(sub.end, c.end)
        );
        result.push({
          type: "insert",
          text: subText,
          claimId: matchedFinalClaim?.id,
          claimKey: matchedFinalClaim !== undefined ? `final-claim-${matchedFinalClaim.id}` : undefined,
          claimStatus: matchedFinalClaim?.status,
          reason: matchedFinalClaim?.reason,
          evidence: matchedFinalClaim?.evidence,
          finalStart: sub.start,
          finalEnd: sub.end,
        });
      }
    } else {
      // Equal: text is common to draft and final_answer
      const segDraftStart = draftPos;
      const segDraftEnd = draftPos + text.length;
      draftPos = segDraftEnd;
      finalPos += text.length;

      const subSegments = splitRangeByClaims(segDraftStart, segDraftEnd, claims);
      for (const sub of subSegments) {
        const subText = draft.slice(sub.start, sub.end);
        const matchedClaim = claims.find(
          (c) => Math.max(sub.start, c.start) < Math.min(sub.end, c.end)
        );
        result.push({
          type: "equal",
          text: subText,
          claimId: matchedClaim?.id,
          claimKey: matchedClaim !== undefined ? `claim-${matchedClaim.id}` : undefined,
          claimStatus: matchedClaim?.status,
          reason: matchedClaim?.reason,
          evidence: matchedClaim?.evidence,
          draftStart: sub.start,
          draftEnd: sub.end,
        });
      }
    }
  }

  return result;
}

/**
 * Splits a range [start, end] into subranges that respect claim boundaries.
 */
function splitRangeByClaims(
  start: number,
  end: number,
  claims: Claim[]
): Array<{ start: number; end: number }> {
  const boundaries = new Set<number>([start, end]);

  for (const c of claims) {
    if (c.start > start && c.start < end) {
      boundaries.add(c.start);
    }
    if (c.end > start && c.end < end) {
      boundaries.add(c.end);
    }
  }

  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const ranges: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    ranges.push({ start: sorted[i], end: sorted[i + 1] });
  }

  return ranges;
}

// Verification script for Phase 8 implementation
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import DiffMatchPatch from "diff-match-patch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load mock scenarios
const mockPath = path.resolve(__dirname, "../mocks/events.json");
const mockData = JSON.parse(fs.readFileSync(mockPath, "utf-8"));
const scenarios = mockData.scenarios;

console.log("=== VeriTrust Phase 8 Automated Verification ===");

// 1. Verify mock scenarios exist
console.log("\n[Test 1] Verify mock scenario structures:");
for (const key of ["corrected", "delivered", "abstained"]) {
  const events = scenarios[key];
  if (!events || !Array.isArray(events)) {
    throw new Error(`Scenario ${key} missing from mocks/events.json`);
  }
  const finishedEvent = events.find((e) => e.event === "run_finished");
  if (!finishedEvent || !finishedEvent.data || !finishedEvent.data.result) {
    throw new Error(`Scenario ${key} missing run_finished result`);
  }
  const res = finishedEvent.data.result;
  console.log(`  ✓ Scenario '${key}': final_status=${res.final_status}, retries=${res.retries}, claims=${res.claims.length}, final_claims=${res.final_claims.length}`);
}

// 2. Test tracked diff logic with claim correlation
function splitRangeByClaims(start, end, claims) {
  const boundaries = new Set([start, end]);
  for (const c of claims) {
    if (c.start > start && c.start < end) boundaries.add(c.start);
    if (c.end > start && c.end < end) boundaries.add(c.end);
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    ranges.push({ start: sorted[i], end: sorted[i + 1] });
  }
  return ranges;
}

function computeTrackedSegmentsWithClaims(draft, finalAnswer, claims, finalClaims, finalStatus) {
  if (finalStatus === "ABSTAINED") {
    const segments = [];
    let currentPos = 0;
    const sortedClaims = [...claims].sort((a, b) => a.start - b.start);
    for (const c of sortedClaims) {
      if (c.start > currentPos) {
        segments.push({ type: "delete", text: draft.slice(currentPos, c.start) });
      }
      segments.push({
        type: "delete",
        text: draft.slice(c.start, c.end),
        claimId: c.id,
        claimKey: `claim-${c.id}`,
        claimStatus: c.status,
        reason: c.reason,
        evidence: c.evidence,
      });
      currentPos = c.end;
    }
    if (currentPos < draft.length) {
      segments.push({ type: "delete", text: draft.slice(currentPos) });
    }
    return segments;
  }

  const dmp = new DiffMatchPatch();
  const rawDiffs = dmp.diff_main(draft, finalAnswer);
  dmp.diff_cleanupSemantic(rawDiffs);

  const result = [];
  let draftPos = 0;
  let finalPos = 0;

  for (const [op, text] of rawDiffs) {
    if (op === -1) {
      const segStart = draftPos;
      const segEnd = draftPos + text.length;
      draftPos = segEnd;
      const subSegments = splitRangeByClaims(segStart, segEnd, claims);
      for (const sub of subSegments) {
        const subText = draft.slice(sub.start, sub.end);
        const matchedClaim = claims.find((c) => Math.max(sub.start, c.start) < Math.min(sub.end, c.end));
        result.push({
          type: "delete",
          text: subText,
          claimId: matchedClaim?.id,
          claimKey: matchedClaim !== undefined ? `claim-${matchedClaim.id}` : undefined,
          claimStatus: matchedClaim?.status,
          reason: matchedClaim?.reason,
          evidence: matchedClaim?.evidence,
        });
      }
    } else if (op === 1) {
      const segStart = finalPos;
      const segEnd = finalPos + text.length;
      finalPos = segEnd;
      const subSegments = splitRangeByClaims(segStart, segEnd, finalClaims);
      for (const sub of subSegments) {
        const subText = finalAnswer.slice(sub.start, sub.end);
        const matchedFinalClaim = finalClaims.find((c) => Math.max(sub.start, c.start) < Math.min(sub.end, c.end));
        result.push({
          type: "insert",
          text: subText,
          claimId: matchedFinalClaim?.id,
          claimKey: matchedFinalClaim !== undefined ? `final-claim-${matchedFinalClaim.id}` : undefined,
          claimStatus: matchedFinalClaim?.status,
          reason: matchedFinalClaim?.reason,
          evidence: matchedFinalClaim?.evidence,
        });
      }
    } else {
      const segDraftStart = draftPos;
      const segDraftEnd = draftPos + text.length;
      draftPos = segDraftEnd;
      finalPos += text.length;
      const subSegments = splitRangeByClaims(segDraftStart, segDraftEnd, claims);
      for (const sub of subSegments) {
        const subText = draft.slice(sub.start, sub.end);
        const matchedClaim = claims.find((c) => Math.max(sub.start, c.start) < Math.min(sub.end, c.end));
        result.push({
          type: "equal",
          text: subText,
          claimId: matchedClaim?.id,
          claimKey: matchedClaim !== undefined ? `claim-${matchedClaim.id}` : undefined,
          claimStatus: matchedClaim?.status,
          reason: matchedClaim?.reason,
          evidence: matchedClaim?.evidence,
        });
      }
    }
  }
  return result;
}

console.log("\n[Test 2] Verify diff + claim mapping on 'corrected' scenario:");
const correctedResult = scenarios.corrected.find((e) => e.event === "run_finished").data.result;
const correctedSegments = computeTrackedSegmentsWithClaims(
  correctedResult.draft,
  correctedResult.final_answer,
  correctedResult.claims,
  correctedResult.final_claims,
  correctedResult.final_status
);

console.log("  Diff segments produced:", correctedSegments.length);
const deletions = correctedSegments.filter((s) => s.type === "delete");
const insertions = correctedSegments.filter((s) => s.type === "insert");
console.log("  Deletions:", deletions.map((d) => `"${d.text}" [${d.claimStatus || 'none'}, key=${d.claimKey}]`).join(", "));
console.log("  Insertions:", insertions.map((i) => `"${i.text}" [${i.claimStatus || 'none'}, key=${i.claimKey}]`).join(", "));

if (deletions.length === 0 || !deletions[0].claimKey || deletions[0].claimStatus !== "CONTRADICTED") {
  throw new Error("Deletions not properly mapped to CONTRADICTED claim");
}
if (insertions.length === 0 || !insertions[0].claimKey || insertions[0].claimStatus !== "SUPPORTED") {
  throw new Error("Insertions not properly mapped to final_claims SUPPORTED claim");
}
console.log("  ✓ Corrected diff properly tagged: draft deleted text linked to CONTRADICTED claim, insert text linked to SUPPORTED final claim.");

console.log("\n[Test 3] Verify abstained scenario handling:");
const abstainedResult = scenarios.abstained.find((e) => e.event === "run_finished").data.result;
const abstainedSegments = computeTrackedSegmentsWithClaims(
  abstainedResult.draft,
  abstainedResult.final_answer,
  abstainedResult.claims,
  abstainedResult.final_claims,
  abstainedResult.final_status
);
console.log("  Abstained segments:", abstainedSegments.map((s) => `"${s.text}" [${s.claimStatus}, key=${s.claimKey}]`).join(", "));
if (abstainedSegments.length === 0 || abstainedSegments[0].claimStatus !== "UNSUPPORTED") {
  throw new Error("Abstained draft not properly mapped to UNSUPPORTED claim");
}
console.log("  ✓ Abstained scenario properly strikes through draft assertion and links to UNSUPPORTED claim.");

console.log("\n[Test 4] Verify delivered scenario handling:");
const deliveredResult = scenarios.delivered.find((e) => e.event === "run_finished").data.result;
const deliveredSegments = computeTrackedSegmentsWithClaims(
  deliveredResult.draft,
  deliveredResult.final_answer,
  deliveredResult.claims,
  deliveredResult.final_claims,
  deliveredResult.final_status
);
console.log("  Delivered segments:", deliveredSegments.map((s) => `"${s.text}" [${s.claimStatus}, key=${s.claimKey}]`).join(", "));
if (deliveredSegments.length === 0 || deliveredSegments[0].claimStatus !== "SUPPORTED") {
  throw new Error("Delivered draft not properly mapped to SUPPORTED claim");
}
console.log("  ✓ Delivered scenario cleanly maps equal text to SUPPORTED claim.");

console.log("\n=== ALL PHASE 8 VERIFICATIONS PASSED ===");

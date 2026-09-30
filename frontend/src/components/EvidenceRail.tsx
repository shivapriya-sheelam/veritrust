"use client";

import React, { useEffect } from "react";
import { RunResult, Evidence, Claim } from "@/types/contracts";

interface CommentItem {
  key: string;
  type: "contradicted" | "unsupported" | "inserted" | "supported";
  claimId: number;
  label: string;
  claimText: string;
  reason: string;
  evidence: Evidence[];
}

interface EvidenceRailProps {
  runResult: RunResult | null;
  selectedClaimId: string | null;
  onCardClick?: (key: string, source: "document" | "rail") => void;
}

export const EvidenceRail: React.FC<EvidenceRailProps> = ({
  runResult,
  selectedClaimId,
  onCardClick,
}) => {
  // Build data-driven list of comments per PRD Section 14:
  // "Right margin: one comment per marked claim. Contradicted or unsupported claims show the reason
  // and the cited evidence (quote, source, version). Inserts show the evidence from final_claims."
  const comments: CommentItem[] = React.useMemo(() => {
    if (!runResult) return [];

    const items: CommentItem[] = [];

    // 1. First-draft marked claims (CONTRADICTED or UNSUPPORTED)
    if (runResult.claims && runResult.claims.length > 0) {
      runResult.claims.forEach((c) => {
        if (c.status === "CONTRADICTED") {
          items.push({
            key: `claim-${c.id}`,
            type: "contradicted",
            claimId: c.id,
            label: `Contradicted Claim #${String(c.id + 1).padStart(2, "0")}`,
            claimText: c.text,
            reason: c.reason,
            evidence: c.evidence || [],
          });
        } else if (c.status === "UNSUPPORTED") {
          items.push({
            key: `claim-${c.id}`,
            type: "unsupported",
            claimId: c.id,
            label: `Unsupported Claim #${String(c.id + 1).padStart(2, "0")}`,
            claimText: c.text,
            reason: c.reason,
            evidence: c.evidence || [],
          });
        }
      });
    }

    // 2. Inserts from final_claims (when run was corrected)
    if (runResult.final_status === "CORRECTED" && runResult.final_claims) {
      runResult.final_claims.forEach((fc) => {
        items.push({
          key: `final-claim-${fc.id}`,
          type: "inserted",
          claimId: fc.id,
          label: `Verified Correction #${String(fc.id + 1).padStart(2, "0")}`,
          claimText: fc.text,
          reason: fc.reason,
          evidence: fc.evidence || [],
        });
      });
    }

    // 3. For clean delivered runs, display supported claims so evidence is inspectable
    if (runResult.final_status === "DELIVERED" && runResult.claims && items.length === 0) {
      runResult.claims.forEach((c) => {
        items.push({
          key: `claim-${c.id}`,
          type: "supported",
          claimId: c.id,
          label: `Supported Claim #${String(c.id + 1).padStart(2, "0")}`,
          claimText: c.text,
          reason: c.reason,
          evidence: c.evidence || [],
        });
      });
    }

    return items;
  }, [runResult]);

  // Smooth scroll to selected comment card when selectedClaimId changes
  useEffect(() => {
    if (selectedClaimId) {
      const el = document.getElementById(`comment-${selectedClaimId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [selectedClaimId]);

  // Primary policy version summary
  const policyVersions = runResult?.policy_versions || {};
  const policyNames = Object.keys(policyVersions);
  const primaryPolicy = policyNames.length > 0 ? policyNames[0] : null;

  return (
    <aside className="w-[340px] shrink-0 border-l border-outline-dim bg-[#faf8f0] p-5 overflow-y-auto flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-outline-dim pb-2.5">
        <span className="font-mono text-[10px] tracking-widest uppercase text-outline font-semibold">
          Evidence &amp; Comments
        </span>
        {primaryPolicy && (
          <span className="font-mono text-[10px] text-outline truncate max-w-[150px]" title={primaryPolicy}>
            {primaryPolicy} ({policyVersions[primaryPolicy]})
          </span>
        )}
      </div>

      {/* Render list of data-driven comment cards */}
      {comments.length > 0 ? (
        <div className="flex flex-col gap-4">
          {comments.map((comment) => {
            const isSelected = selectedClaimId === comment.key;

            // Border and background coloring based on claim type
            let borderStyle = "border-outline-dim hover:border-outline-mid";
            let badgeBg = "bg-surface-muted text-on-surface-variant border-outline-dim";
            let quoteBorder = "border-outline-mid";

            if (comment.type === "contradicted") {
              borderStyle = isSelected
                ? "border-accent-rose ring-2 ring-accent-rose/30 shadow-sm"
                : "border-accent-rose-border hover:border-accent-rose";
              badgeBg = "bg-accent-rose-bg text-accent-rose border-accent-rose-border";
              quoteBorder = "border-accent-rose";
            } else if (comment.type === "unsupported") {
              borderStyle = isSelected
                ? "border-amber-400 ring-2 ring-amber-400/30 shadow-sm"
                : "border-amber-200 hover:border-amber-400";
              badgeBg = "bg-amber-50 text-amber-800 border-amber-300";
              quoteBorder = "border-amber-400";
            } else if (comment.type === "inserted" || comment.type === "supported") {
              borderStyle = isSelected
                ? "border-emerald-500 ring-2 ring-emerald-500/30 shadow-sm"
                : "border-emerald-200 hover:border-emerald-400";
              badgeBg = "bg-emerald-50 text-emerald-800 border-emerald-300";
              quoteBorder = "border-emerald-500";
            }

            return (
              <div
                key={comment.key}
                id={`comment-${comment.key}`}
                data-claim-id={comment.claimId}
                onClick={() => onCardClick?.(comment.key, "rail")}
                className={`bg-white p-4 rounded border-2 shadow-xs flex flex-col gap-3 transition-all cursor-pointer text-left ${borderStyle}`}
              >
                {/* Header with Type Badge and Claim ID */}
                <div className="flex items-center justify-between">
                  <span
                    className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeBg}`}
                  >
                    {comment.label}
                  </span>
                  <span className="font-mono text-[10px] text-outline font-medium">
                    ID: {comment.key}
                  </span>
                </div>

                {/* Claim Text */}
                <div>
                  <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-1">
                    Draft Assertion:
                  </span>
                  <p
                    className={`font-mono text-[11px] p-2 rounded border leading-relaxed ${
                      comment.type === "contradicted"
                        ? "text-accent-rose bg-rose-50 border-rose-200 line-through"
                        : comment.type === "unsupported"
                        ? "text-amber-900 bg-amber-50/70 border-amber-200 underline decoration-amber-500"
                        : "text-emerald-900 bg-emerald-50/50 border-emerald-200"
                    }`}
                  >
                    &ldquo;{comment.claimText}&rdquo;
                  </p>
                </div>

                {/* Reason Explanation */}
                {comment.reason && (
                  <div>
                    <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-0.5">
                      Verdict Reason:
                    </span>
                    <p className="font-sans text-[12px] text-on-surface leading-normal">
                      {comment.reason}
                    </p>
                  </div>
                )}

                {/* Cited Evidence Quotes */}
                {comment.evidence.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[10px] text-outline uppercase tracking-wider block">
                      Cited Evidence ({comment.evidence.length}):
                    </span>
                    {comment.evidence.map((ev, evIdx) => (
                      <div key={evIdx} className="flex flex-col gap-1.5">
                        <blockquote
                          className={`font-editorial text-[13px] italic text-on-surface bg-[#faf8f0] p-2.5 rounded border-l-2 ${quoteBorder} border-y border-r border-outline-dim leading-snug`}
                        >
                          &ldquo;{ev.text}&rdquo;
                        </blockquote>
                        <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant px-0.5">
                          <span>
                            Source:{" "}
                            <strong className="text-on-surface font-semibold">{ev.source}</strong>
                          </span>
                          <span>
                            {ev.version} · #{ev.chunk_id.includes("#") ? ev.chunk_id.split("#")[1] : ev.chunk_id}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-1">
                      Cited Evidence:
                    </span>
                    <div className="font-sans text-[11px] text-on-surface-variant bg-[#faf8f0] p-2 rounded border border-outline-dim">
                      No policy citations found. Claim could not be grounded in company manuals.
                    </div>
                  </div>
                )}

                {/* Abstained / Safe Refusal Flag if applicable */}
                {runResult?.final_status === "ABSTAINED" && comment.type === "unsupported" && (
                  <div className="pt-2 border-t border-outline-dim flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
                    <span>
                      Result: <strong className="text-accent-rose">ABSTAINED</strong>
                    </span>
                    <span>Reason: {runResult?.abstain_reason || "UNSUPPORTED"}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-8 px-4 text-center font-mono text-[11px] text-outline bg-white rounded border border-outline-dim">
          <span>No marked claims flagged for review.</span>
        </div>
      )}
    </aside>
  );
};

"use client";

import React, { useState } from "react";
import { RunResult, Evidence } from "@/types/contracts";
import { computeTrackedSegmentsWithClaims, TrackedDiffSegment } from "@/lib/diff";

interface DocumentReviewProps {
  runResult: RunResult | null;
  viewMode: "reviewer" | "customer";
  onSelectClaim: (claimKey: string, source: "document" | "rail") => void;
  selectedClaimId: string | null;
}

export const DocumentReview: React.FC<DocumentReviewProps> = ({
  runResult,
  viewMode,
  onSelectClaim,
  selectedClaimId,
}) => {
  const [isCitationModalOpen, setIsCitationModalOpen] = useState(false);

  if (!runResult) {
    return (
      <div className="w-full bg-white p-12 rounded border border-outline-dim shadow-xs text-center font-mono text-[12px] text-outline">
        Awaiting question submission to generate and verify document...
      </div>
    );
  }

  const isCorrected = runResult.final_status === "CORRECTED";
  const isAbstained = runResult.final_status === "ABSTAINED";
  const isDelivered = runResult.final_status === "DELIVERED";

  // Dedicated evidence selection for Customer verification badge:
  // - CORRECTED: prefer final_claims evidence
  // - DELIVERED: prefer supported claim evidence
  // - ABSTAINED: no customer badge
  const customerEvidence: Evidence[] = React.useMemo(() => {
    if (!runResult || runResult.final_status === "ABSTAINED") return [];

    if (runResult.final_status === "CORRECTED" && runResult.final_claims && runResult.final_claims.length > 0) {
      const evs: Evidence[] = [];
      for (const fc of runResult.final_claims) {
        if (fc.evidence && fc.evidence.length > 0) {
          for (const ev of fc.evidence) evs.push(ev);
        }
      }
      if (evs.length > 0) return evs;
    }

    if (runResult.final_status === "DELIVERED") {
      const evs: Evidence[] = [];
      const sourceClaims =
        runResult.final_claims && runResult.final_claims.length > 0
          ? runResult.final_claims
          : runResult.claims;
      for (const c of sourceClaims || []) {
        if (c.status === "SUPPORTED" && c.evidence && c.evidence.length > 0) {
          for (const ev of c.evidence) evs.push(ev);
        }
      }
      if (evs.length > 0) return evs;
    }

    const fallbackEvs: Evidence[] = [];
    for (const c of runResult.claims || []) {
      if (c.evidence && c.evidence.length > 0) {
        for (const ev of c.evidence) fallbackEvs.push(ev);
      }
    }
    return fallbackEvs;
  }, [runResult]);

  const primaryEvidence = customerEvidence.length > 0 ? customerEvidence[0] : null;
  const primarySource =
    primaryEvidence?.source || Object.keys(runResult.policy_versions || {})[0] || "policy.md";
  const primaryVersion =
    primaryEvidence?.version || Object.values(runResult.policy_versions || {})[0] || "v1";

  // Compute word-level and claim-correlated diff from draft -> final_answer
  // (per PRD Section 14: "A word-level diff (diff-match-patch) from draft to final_answer produces struck text and green inserts")
  const trackedSegments: TrackedDiffSegment[] = React.useMemo(() => {
    return computeTrackedSegmentsWithClaims(
      runResult.draft,
      runResult.final_answer,
      runResult.claims || [],
      runResult.final_claims || [],
      runResult.final_status
    );
  }, [
    runResult.draft,
    runResult.final_answer,
    runResult.claims,
    runResult.final_claims,
    runResult.final_status,
  ]);

  const handleBadgeClick = () => {
    if (viewMode === "customer") {
      setIsCitationModalOpen(true);
    } else {
      if (runResult.final_status === "CORRECTED" && runResult.final_claims?.length) {
        onSelectClaim(`final-claim-${runResult.final_claims[0].id}`, "document");
      } else if (runResult.claims?.length) {
        onSelectClaim(`claim-${runResult.claims[0].id}`, "document");
      }
    }
  };

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Central document page */}
      <article className="bg-white p-9 sm:p-11 rounded border border-outline-dim shadow-xs relative transition-all">
        {/* Document Header */}
        <div className="flex items-center justify-between border-b border-outline-dim pb-3.5 mb-6 text-[11px] font-mono text-outline">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] leading-none">article</span>
            <span className="uppercase tracking-wider font-semibold text-on-surface-variant">
              {viewMode === "customer" ? "Response" : "Track Changes · Response Draft"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Persistent Chaos Tag (PRD Section 14 & 7.2) */}
            {runResult.chaos && (
              <span
                className="text-accent-rose bg-accent-rose-bg px-2 py-0.5 rounded font-mono text-[10px] font-bold border border-accent-rose-border tracking-wider uppercase"
                title="Run executed in Chaos mode (simulated failure)"
              >
                Chaos
              </span>
            )}

            {viewMode === "reviewer" && (
              <>
                {isCorrected && (
                  <span className="text-accent-ochre bg-accent-ochre-bg px-2 py-0.5 rounded font-mono text-[10px] font-semibold border border-accent-ochre-border">
                    {runResult.retries} CORRECTION{runResult.retries > 1 ? "S" : ""} APPLIED
                  </span>
                )}
                {isDelivered && (
                  <span className="text-accent-green bg-emerald-50 px-2 py-0.5 rounded font-mono text-[10px] font-semibold border border-emerald-200">
                    VERIFIED CLEAN
                  </span>
                )}
                {isAbstained && (
                  <span className="text-accent-rose bg-accent-rose-bg px-2 py-0.5 rounded font-mono text-[10px] font-semibold border border-accent-rose-border">
                    ABSTAINED ({runResult.abstain_reason || "REFUSAL"})
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Document Text Area */}
        <div className="font-editorial text-[1.15rem] text-on-surface leading-[1.9]">
          {viewMode === "customer" ? (
            /* Customer View: Clean, verified final text or clean refusal message */
            <div className="space-y-4">
              <p className="select-text">{runResult.final_answer}</p>
            </div>
          ) : (
            /* Reviewer View: Tracked redline changes and claim-level visual indicators */
            <div className="space-y-4">
              {isAbstained ? (
                /* PRD: "ABSTAINED: the whole draft is struck through in the refusal accent, with the refusal message below it." */
                <div className="space-y-4">
                  <div className="line-through text-rose-800 bg-rose-50/70 p-3 rounded border border-rose-200 leading-relaxed cursor-pointer transition-colors hover:bg-rose-100/70 animate-strike-through">
                    {trackedSegments.map((segment, idx) => {
                      const isSelected = segment.claimKey && selectedClaimId === segment.claimKey;
                      return (
                        <span
                          key={idx}
                          id={segment.claimKey ? `doc-${segment.claimKey}` : undefined}
                          onClick={() => segment.claimKey && onSelectClaim(segment.claimKey, "document")}
                          className={`${
                            isSelected
                              ? "bg-rose-200 ring-2 ring-rose-500 rounded px-0.5"
                              : ""
                          }`}
                          title={segment.reason || "Abstained draft assertion"}
                        >
                          {segment.text}
                        </span>
                      );
                    })}
                  </div>

                  <div className="font-sans text-[13px] bg-surface-muted p-4 rounded border border-outline-dim text-on-surface-variant">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase text-accent-rose mb-1">
                      <span className="material-symbols-outlined text-[15px]">block</span>
                      <span>Safe Refusal Enforced ({runResult.abstain_reason || "UNSUPPORTED"}):</span>
                    </div>
                    <p className="font-editorial text-[1rem] text-on-surface italic">
                      &ldquo;{runResult.final_answer}&rdquo;
                    </p>
                    {runResult.abstain_reason === "RETRY_CAP" && (
                      <div className="mt-2 text-[11px] font-mono text-outline">
                        Pipeline reached retry cap (max 2 correction attempts) without resolving all contradictions.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* CORRECTED or DELIVERED View: Word-level diff with claim span linking */
                <p className="leading-[1.9]">
                  {trackedSegments.map((segment, idx) => {
                    const isSelected = segment.claimKey && selectedClaimId === segment.claimKey;

                    if (segment.type === "delete") {
                      // Deleted draft text: struck through in redline/rose accent with signature strike animation
                      return (
                        <del
                          key={idx}
                          id={segment.claimKey ? `doc-${segment.claimKey}` : undefined}
                          onClick={() => segment.claimKey && onSelectClaim(segment.claimKey, "document")}
                          className={`line-through text-rose-700 bg-rose-50 px-1 py-0.5 rounded border border-rose-200 cursor-pointer mx-0.5 transition-all inline animate-strike-through ${
                            isSelected ? "ring-2 ring-accent-rose bg-rose-100" : "hover:bg-rose-100"
                          }`}
                          title={`Contradicted: ${segment.reason || "Click to inspect evidence"}`}
                        >
                          {segment.text}
                        </del>
                      );
                    }

                    if (segment.type === "insert") {
                      // Inserted final text: green insert styling with progressive reveal animation per PRD Section 14
                      return (
                        <ins
                          key={idx}
                          id={segment.claimKey ? `doc-${segment.claimKey}` : undefined}
                          onClick={() => segment.claimKey && onSelectClaim(segment.claimKey, "document")}
                          className={`no-underline text-emerald-900 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-medium mx-0.5 cursor-pointer transition-all inline animate-insert-reveal ${
                            isSelected
                              ? "ring-2 ring-emerald-600 bg-emerald-100"
                              : "hover:bg-emerald-100"
                          }`}
                          title={`Verified insertion: ${segment.reason || "Click to inspect evidence"}`}
                        >
                          {segment.text}
                        </ins>
                      );
                    }

                    // Equal text: normal document text, or yellow underline if claim is UNSUPPORTED
                    const isUnsupported = segment.claimStatus === "UNSUPPORTED";
                    const isSupported = segment.claimStatus === "SUPPORTED";

                    if (isUnsupported) {
                      return (
                        <span
                          key={idx}
                          id={segment.claimKey ? `doc-${segment.claimKey}` : undefined}
                          onClick={() => segment.claimKey && onSelectClaim(segment.claimKey, "document")}
                          className={`underline decoration-amber-500 decoration-2 underline-offset-4 bg-amber-50/70 text-amber-950 px-0.5 rounded cursor-pointer mx-0.5 transition-all ${
                            isSelected ? "ring-2 ring-amber-500 bg-amber-100" : "hover:bg-amber-100"
                          }`}
                          title={`Unsupported claim: ${segment.reason || "No policy match"}`}
                        >
                          {segment.text}
                        </span>
                      );
                    }

                    if (segment.claimKey) {
                      return (
                        <span
                          key={idx}
                          id={`doc-${segment.claimKey}`}
                          onClick={() => segment.claimKey && onSelectClaim(segment.claimKey, "document")}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-accent-ochre-bg ring-1 ring-accent-ochre rounded px-0.5"
                              : isSupported && isDelivered
                              ? "hover:bg-emerald-50/50 rounded px-0.5"
                              : ""
                          }`}
                          title={segment.reason || "Verified text"}
                        >
                          {segment.text}
                        </span>
                      );
                    }

                    return <span key={idx}>{segment.text}</span>;
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </article>

      {/* Verification Badge below document */}
      {!isAbstained && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleBadgeClick}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-muted hover:bg-surface-dim border border-outline-dim font-mono text-[11px] text-on-surface-variant hover:text-on-surface transition-all cursor-pointer shadow-2xs"
            title={viewMode === "customer" ? "Click to inspect verified source chunk" : "Inspect cited policy"}
          >
            <span className="text-accent-green font-bold">✓</span>
            <span>
              Verified against <code className="text-on-surface font-semibold">{primarySource}</code> ·{" "}
              {primaryVersion}
            </span>
            <span className="material-symbols-outlined text-[13px] text-outline">
              {viewMode === "customer" ? "open_in_new" : "chevron_right"}
            </span>
          </button>
        </div>
      )}

      {/* Customer View Exact Evidence Chunk Modal / Dialog (PRD Section 14) */}
      {isCitationModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsCitationModalOpen(false)}
        >
          <div
            className="bg-[#faf8f0] border border-outline-dim rounded-lg shadow-lg max-w-lg w-full p-6 flex flex-col gap-4 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-outline-dim pb-3">
              <div className="flex items-center gap-2">
                <span className="text-accent-green font-bold">✓</span>
                <span className="font-mono text-[12px] font-bold uppercase tracking-wider text-on-surface">
                  Verified Corporate Policy Chunk
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsCitationModalOpen(false)}
                className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-dim transition-colors"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {customerEvidence.length > 0 ? (
                customerEvidence.map((ev, idx) => (
                  <div key={idx} className="flex flex-col gap-2 p-3 bg-white rounded border border-outline-dim">
                    <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                      <span>Source: <strong className="text-on-surface">{ev.source}</strong></span>
                      <span>Version: {ev.version} · Chunk: #{ev.chunk_id.includes("#") ? ev.chunk_id.split("#")[1] : ev.chunk_id}</span>
                    </div>
                    <blockquote className="font-editorial text-[14px] italic text-on-surface border-l-2 border-accent-green pl-3 py-1 bg-[#faf8f0] rounded-r">
                      &ldquo;{ev.text}&rdquo;
                    </blockquote>
                  </div>
                ))
              ) : (
                <div className="p-3 bg-white rounded border border-outline-dim text-on-surface font-editorial text-[13px]">
                  Verified against {primarySource} ({primaryVersion}).
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-outline-dim flex justify-between items-center text-[10px] font-mono text-outline">
              <span>Ground truth policy from VeriCorp knowledge store.</span>
              <button
                type="button"
                onClick={() => setIsCitationModalOpen(false)}
                className="px-3 py-1 rounded bg-on-surface text-surface text-[11px] font-medium hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

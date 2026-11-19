"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { LedgerRunRecord } from "@/types/ledger";
import { fetchRunById } from "@/lib/api";
import { RunResult } from "@/types/contracts";

interface RunLogTableProps {
  runs: LedgerRunRecord[];
  currentPage?: number;
  totalRuns?: number;
  onPageChange?: (page: number) => void;
}

export const RunLogTable: React.FC<RunLogTableProps> = ({ 
  runs,
  currentPage = 1,
  totalRuns = 0,
  onPageChange
}) => {
  const [inspectedRun, setInspectedRun] = useState<LedgerRunRecord | null>(null);
  const [runDetails, setRunDetails] = useState<RunResult | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const handleOpenDrawer = async (run: LedgerRunRecord) => {
    setInspectedRun(run);
    setRunDetails(null);
    setIsLoadingDetails(true);
    try {
      const details = await fetchRunById(run.id);
      if (details) {
        setRunDetails(details);
      }
    } catch (err) {
      console.error("Failed to fetch full run details", err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleCloseDrawer = () => {
    setInspectedRun(null);
    setRunDetails(null);
  };

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCloseDrawer();
      }
    };
    if (inspectedRun) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inspectedRun]);

  const question = runDetails?.question || inspectedRun?.question;
  const finalStatus = runDetails?.final_status || (inspectedRun?.status === "PASSED" ? "DELIVERED" : (inspectedRun?.status === "REFUSED" ? "ABSTAINED" : inspectedRun?.status));
  const isChaos = runDetails?.chaos ?? inspectedRun?.isSimulated;
  const timestamp = runDetails?.created_at || inspectedRun?.timestamp;
  const abstainReason = runDetails?.abstain_reason;
  const retries = runDetails?.retries;
  const rawDraft = runDetails?.draft || inspectedRun?.rawProposition?.text;
  const finalText = runDetails?.final_answer || runDetails?.final_draft || inspectedRun?.reconciledRedline?.text;
  const claims = (runDetails?.claims && runDetails.claims.length > 0) ? runDetails.claims : runDetails?.final_claims;
  const latencyMs = runDetails?.latency_ms;
  const tokens = runDetails?.tokens;
  const policyVersions = runDetails?.policy_versions;

  return (
    <div className="w-full flex flex-col">
      {/* Log Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-2 border-b border-surface-dim gap-2">
        <div className="flex items-center gap-3">
          <h3 className="font-mono text-[11px] text-outline uppercase tracking-widest font-semibold">
            Chronological Log
          </h3>
          <span className="text-outline-dim">·</span>
          <span className="font-sans text-[13px] text-on-surface-variant">
            Recent verification runs
          </span>
        </div>
      </div>

      {/* Table Container */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b border-surface-dim text-outline font-mono text-[11px] uppercase tracking-wider">
              <th className="py-3 px-3 font-normal w-32">Run Identifier</th>
              <th className="py-3 px-3 font-normal">Customer Query &amp; Context</th>
              <th className="py-3 px-3 font-normal w-36">Timestamp</th>
              <th className="py-3 px-3 font-normal w-44">Status Result</th>
              <th className="py-3 px-3 font-normal w-36 text-right">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-dim/70 font-sans">
            {runs.map((run) => {
              const isSelected = inspectedRun?.id === run.id;
              return (
                <tr
                  key={run.id}
                  onClick={() => handleOpenDrawer(run)}
                  className={`transition-colors group cursor-pointer ${
                    isSelected ? "bg-surface-muted/50" : "hover:bg-white"
                  }`}
                >
                  {/* Identifier */}
                  <td className="py-4 px-3 font-mono text-[12px] text-on-surface font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span>{run.id}</span>
                      {run.isSimulated && (
                        <span className="px-1.5 py-0.5 rounded bg-accent-rose-bg text-accent-rose font-mono text-[9px] uppercase tracking-wider font-semibold border border-accent-rose-border">
                          Simulated
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Query */}
                  <td className="py-4 px-3">
                    <div className="font-editorial text-[14px] text-on-surface group-hover:text-black leading-snug">
                      &ldquo;{run.question}&rdquo;
                    </div>
                  </td>

                  {/* Timestamp */}
                  <td className="py-4 px-3 font-mono text-[11px] text-on-surface-variant whitespace-nowrap">
                    {run.timestamp}
                  </td>

                  {/* Status Result Badge */}
                  <td className="py-4 px-3 whitespace-nowrap">
                    {run.status === "CORRECTED" && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-accent-ochre-border bg-accent-ochre-bg/50 text-accent-ochre font-mono text-[11px] font-semibold uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-ochre"></span>
                        Corrected
                      </span>
                    )}
                    {run.status === "PASSED" && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-outline-dim bg-white text-on-surface font-mono text-[11px] font-medium uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                        Passed (1st pass)
                      </span>
                    )}
                    {run.status === "REFUSED" && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-accent-rose-border bg-accent-rose-bg/50 text-accent-rose font-mono text-[11px] font-semibold uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-rose"></span>
                        Refused (Abstain)
                      </span>
                    )}
                  </td>

                  {/* Action link */}
                  <td className="py-4 px-3 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-on-surface group-hover:text-accent-ochre group-hover:translate-x-0.5 transition-all">
                      <span>{isSelected ? "Inspecting" : run.actionLabel}</span>
                      <span className="material-symbols-outlined text-[15px] leading-none">
                        arrow_forward
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Table Pagination / Audit Footnote */}
      <div className="w-full pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-[11px] text-on-surface-variant">
        <div>
          Showing <span className="text-on-surface font-semibold">{(currentPage - 1) * 20 + (runs.length > 0 ? 1 : 0)} - {Math.min(currentPage * 20, totalRuns)}</span> of {totalRuns} logged
          transactions
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`px-2.5 py-1 rounded border border-outline-dim ${currentPage === 1 ? 'text-outline cursor-not-allowed' : 'text-on-surface hover:bg-surface-dim transition-colors'}`}
            disabled={currentPage === 1}
            onClick={() => onPageChange && onPageChange(currentPage - 1)}
          >
            Previous
          </button>
          
          <button
            type="button"
            className="px-2.5 py-1 rounded bg-black text-white font-medium shadow-xs"
          >
            {currentPage}
          </button>
          
          <button
            type="button"
            className={`px-2.5 py-1 rounded border border-outline-dim ${currentPage * 20 >= totalRuns ? 'text-outline cursor-not-allowed' : 'text-on-surface hover:bg-surface-dim transition-colors'}`}
            disabled={currentPage * 20 >= totalRuns}
            onClick={() => onPageChange && onPageChange(currentPage + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {/* Inspect Run Slide-over Drawer */}
      {inspectedRun && (
        <div 
          className="fixed inset-0 z-50 overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
        >
          {/* Backdrop (clicking outside closes drawer) */}
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
            onClick={handleCloseDrawer}
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10 pointer-events-none">
            <div 
              className="w-screen max-w-xl pointer-events-auto bg-[#faf8f0] border-l border-outline-dim shadow-2xl flex flex-col h-full"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div className="p-5 border-b border-outline-dim bg-white flex items-center justify-between shrink-0">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
                      find_in_page
                    </span>
                    <h3 id="drawer-title" className="font-mono text-[13px] font-semibold text-on-surface uppercase tracking-wider">
                      Run Details · {inspectedRun.id}
                    </h3>
                  </div>
                  {timestamp && (
                    <span className="font-mono text-[10px] text-outline">
                      Logged at {timestamp}
                    </span>
                  )}
                </div>

                {/* X Button */}
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="p-1.5 rounded text-outline hover:text-on-surface hover:bg-surface-dim transition-colors"
                  aria-label="Close drawer"
                >
                  <span className="material-symbols-outlined text-[20px] leading-none">close</span>
                </button>
              </div>

              {/* Drawer Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
                {isLoadingDetails && (
                  <div className="flex items-center gap-2 text-outline font-mono text-[11px] p-2 bg-surface-muted/40 rounded border border-outline-dim">
                    <span className="material-symbols-outlined animate-spin text-[14px]">refresh</span>
                    <span>Retrieving complete verification telemetry...</span>
                  </div>
                )}

                {/* Status Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  {finalStatus === "CORRECTED" && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-accent-ochre-border bg-accent-ochre-bg/50 text-accent-ochre font-mono text-[11px] font-semibold uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-ochre"></span>
                      Corrected
                    </span>
                  )}
                  {finalStatus === "DELIVERED" && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-outline-dim bg-white text-on-surface font-mono text-[11px] font-medium uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                      Passed (1st pass)
                    </span>
                  )}
                  {finalStatus === "ABSTAINED" && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-accent-rose-border bg-accent-rose-bg/50 text-accent-rose font-mono text-[11px] font-semibold uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-rose"></span>
                      Refused (Abstain)
                    </span>
                  )}

                  {isChaos && (
                    <span className="px-2 py-0.5 rounded bg-accent-rose-bg text-accent-rose font-mono text-[10px] uppercase tracking-wider font-semibold border border-accent-rose-border">
                      Simulated Chaos
                    </span>
                  )}

                  {retries !== undefined && retries > 0 && (
                    <span className="font-mono text-[11px] text-on-surface-variant bg-surface-muted px-2 py-0.5 rounded border border-outline-dim">
                      Retries: {retries}
                    </span>
                  )}
                </div>

                {/* Abstain Reason (if present) */}
                {abstainReason && (
                  <div className="bg-accent-rose-bg/50 border border-accent-rose-border p-3.5 rounded flex items-center gap-2.5 text-accent-rose font-mono text-[11px]">
                    <span className="material-symbols-outlined text-[16px]">error</span>
                    <span>Abstain Reason: <strong>{abstainReason}</strong></span>
                  </div>
                )}

                {/* Customer Query */}
                {question && (
                  <div className="flex flex-col gap-1.5 bg-white p-4 rounded-lg border border-outline-dim shadow-xs">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                      Customer Query
                    </span>
                    <p className="font-editorial text-[15px] text-on-surface leading-snug">
                      &ldquo;{question}&rdquo;
                    </p>
                  </div>
                )}

                {/* Initial Proposition / Draft */}
                {rawDraft && (
                  <div className="flex flex-col gap-2 bg-surface-dim/40 p-4 rounded-lg border border-outline-dim">
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-outline">
                      <span className="font-semibold">Initial LLM Draft</span>
                      {finalStatus === "CORRECTED" && (
                        <span className="text-accent-rose font-semibold">Contradiction Detected</span>
                      )}
                    </div>
                    <p className="font-editorial text-[14px] text-on-surface leading-relaxed">
                      {rawDraft}
                    </p>
                  </div>
                )}

                {/* Final / Reconciled Answer */}
                {finalText && (
                  <div className="flex flex-col gap-2 bg-white p-4 rounded-lg border border-accent-ochre-border shadow-xs">
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-accent-ochre font-semibold">
                      <span>Final Delivered Answer</span>
                      <span>{finalStatus === "CORRECTED" ? "Reconciled with Policy" : "Verified Clean"}</span>
                    </div>
                    <p className="font-editorial text-[14px] text-on-surface leading-relaxed">
                      {finalText}
                    </p>
                  </div>
                )}

                {/* Claims & Verification Rationale */}
                {claims && claims.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                      Verified Policy Assertions ({claims.length})
                    </span>
                    <div className="flex flex-col gap-2.5">
                      {claims.map((claim, idx) => (
                        <div key={claim.id ?? idx} className="bg-white p-3.5 rounded border border-outline-dim flex flex-col gap-2 text-[13px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] text-outline uppercase tracking-wider">
                              Claim #{claim.id} · {claim.checked_by}
                            </span>
                            <span className={`font-mono text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                              claim.status === "SUPPORTED"
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : claim.status === "CONTRADICTED"
                                ? "bg-accent-rose-bg text-accent-rose border border-accent-rose-border"
                                : "bg-amber-50 text-amber-800 border border-amber-200"
                            }`}>
                              {claim.status}
                            </span>
                          </div>
                          <p className="font-sans text-on-surface">
                            {claim.text}
                          </p>
                          {claim.reason && (
                            <p className="font-mono text-[11px] text-on-surface-variant bg-surface-muted/50 p-2 rounded">
                              {claim.reason}
                            </p>
                          )}
                          {claim.evidence && claim.evidence.length > 0 && (
                            <div className="flex flex-col gap-1 pt-1.5 border-t border-surface-dim">
                              <span className="font-mono text-[9px] uppercase tracking-wider text-outline">
                                Policy Citations:
                              </span>
                              {claim.evidence.map((ev, evIdx) => (
                                <div key={evIdx} className="font-mono text-[10px] text-on-surface-variant bg-surface-dim/40 p-2 rounded">
                                  <span className="font-semibold text-on-surface">{ev.source}</span> ({ev.chunk_id}): {ev.text}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pipeline Latency (if present) */}
                {latencyMs && Object.keys(latencyMs).length > 0 && (
                  <div className="flex flex-col gap-2 bg-white p-4 rounded-lg border border-outline-dim">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                      Pipeline Latency
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                      {Object.entries(latencyMs).map(([stage, ms]) => (
                        <div key={stage} className="bg-surface-dim/40 p-2 rounded flex justify-between items-center">
                          <span className="text-on-surface-variant capitalize">{stage}:</span>
                          <span className="font-semibold text-on-surface">{ms} ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Token Usage (if present) */}
                {tokens && Object.keys(tokens).length > 0 && (
                  <div className="flex flex-col gap-2 bg-white p-4 rounded-lg border border-outline-dim">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                      Token Consumption
                    </span>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                      {Object.entries(tokens).map(([model, count]) => (
                        <div key={model} className="bg-surface-dim/40 p-2 rounded flex justify-between items-center">
                          <span className="text-on-surface-variant capitalize">{model}:</span>
                          <span className="font-semibold text-on-surface">{count} tokens</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active Policy Versions (if present) */}
                {policyVersions && Object.keys(policyVersions).length > 0 && (
                  <div className="flex flex-col gap-2 bg-white p-4 rounded-lg border border-outline-dim">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                      Grounded Policy Versions
                    </span>
                    <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                      {Object.entries(policyVersions).map(([name, ver]) => (
                        <span key={name} className="px-2 py-0.5 rounded bg-surface-muted text-on-surface border border-outline-dim">
                          {name}: <strong className="font-semibold">{ver}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-outline-dim bg-white flex items-center justify-between shrink-0">
                <Link
                  href="/"
                  className="font-mono text-[11px] text-on-surface hover:text-accent-ochre underline font-medium"
                >
                  Open in Live Studio →
                </Link>
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="px-3 py-1.5 rounded bg-on-surface text-surface font-mono text-[11px] font-medium hover:bg-black transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

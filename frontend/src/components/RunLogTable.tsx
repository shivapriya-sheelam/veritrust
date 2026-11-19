"use client";

import React, { useState } from "react";
import Link from "next/link";
import { LedgerRunRecord } from "@/types/ledger";

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
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const toggleRow = (id: string) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

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
              const isExpanded = expandedRowId === run.id;
              return (
                <React.Fragment key={run.id}>
                  <tr
                    onClick={() => toggleRow(run.id)}
                    className={`transition-colors group cursor-pointer ${
                      isExpanded ? "bg-surface-muted/40" : "hover:bg-white"
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
                        <span>{isExpanded ? "Close drawer" : run.actionLabel}</span>
                        <span className="material-symbols-outlined text-[15px] leading-none">
                          {isExpanded ? "expand_less" : "arrow_forward"}
                        </span>
                      </span>
                    </td>
                  </tr>

                  {/* Inline Diff Inspection Drawer Modal */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} className="p-0 border-b border-surface-dim">
                        <div className="bg-white border-y border-outline-dim p-6 shadow-xs transition-all">
                          <div className="flex items-center justify-between pb-3 border-b border-surface-dim mb-5">
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-[15px] text-on-surface-variant">
                                find_in_page
                              </span>
                              <h4 className="font-mono text-[11px] text-on-surface font-semibold uppercase tracking-wider">
                                Inspection Drawer · Run Details {run.id}
                              </h4>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRow(run.id);
                              }}
                              className="font-mono text-[11px] text-outline hover:text-on-surface px-2 py-0.5 rounded hover:bg-surface-muted transition-colors"
                            >
                              ✕ Close
                            </button>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Raw Proposition */}
                            <div className="bg-surface-dim/40 rounded p-4 border border-outline-dim">
                              <div className="font-mono text-[10px] text-outline uppercase tracking-wider mb-2 flex items-center justify-between">
                                <span>Raw LLM Proposition</span>
                                <span className="text-accent-rose font-semibold">
                                  {run.status === "CORRECTED"
                                    ? "Contradiction Detected"
                                    : run.status === "REFUSED"
                                    ? "Unsupported Assertion"
                                    : "Clean Assertion"}
                                </span>
                              </div>
                              <p className="font-editorial text-[14px] text-on-surface leading-relaxed">
                                {run.rawProposition?.highlightText ? (
                                  <>
                                    &ldquo;
                                    {run.rawProposition.text.replace(
                                      run.rawProposition.highlightText,
                                      ""
                                    )}
                                    <span className="line-through text-accent-rose bg-accent-rose-bg/80 px-1 py-0.5 rounded border border-accent-rose-border mx-0.5">
                                      {run.rawProposition.highlightText}
                                    </span>
                                    &rdquo;
                                  </>
                                ) : (
                                  <>&ldquo;{run.rawProposition?.text}&rdquo;</>
                                )}
                              </p>
                              {run.rawProposition?.failedAssertion && (
                                <div className="mt-4 pt-3 border-t border-outline-dim font-mono text-[10px] text-on-surface-variant">
                                  Failed Assertion: {run.rawProposition.failedAssertion}
                                </div>
                              )}
                            </div>

                            {/* Reconciled & Redlined Statement */}
                            <div className="bg-white rounded p-4 border border-accent-ochre-border">
                              <div className="font-mono text-[10px] text-accent-ochre uppercase tracking-wider mb-2 flex items-center justify-between font-semibold">
                                <span>Reconciled Policy Redline</span>
                                <span>{run.id}</span>
                              </div>
                              <p className="font-editorial text-[14px] text-on-surface leading-relaxed">
                                {run.reconciledRedline?.highlightText ? (
                                  <>
                                    &ldquo;
                                    {run.reconciledRedline.text.replace(
                                      run.reconciledRedline.highlightText,
                                      ""
                                    )}
                                    <span className="no-underline text-emerald-800 bg-amber-50 px-1 py-0.5 rounded border border-amber-300 font-medium mx-0.5">
                                      {run.reconciledRedline.highlightText}
                                    </span>
                                    &rdquo;
                                  </>
                                ) : (
                                  <>&ldquo;{run.reconciledRedline?.text}&rdquo;</>
                                )}
                              </p>
                              <div className="mt-4 pt-3 border-t border-outline-dim font-mono text-[10px] text-on-surface-variant flex items-center justify-between">
                                <span>
                                  Grounded Chunk:{" "}
                                  <strong className="text-on-surface">
                                    {run.reconciledRedline?.groundedChunk || "refund_policy.md#2"}
                                  </strong>{" "}
                                  {run.reconciledRedline?.matchScore
                                    ? `(Match: ${run.reconciledRedline.matchScore})`
                                    : ""}
                                </span>
                                <Link
                                  href="/"
                                  className="text-on-surface hover:text-accent-ochre underline font-medium"
                                >
                                  Open in Review →
                                </Link>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
    </div>
  );
};

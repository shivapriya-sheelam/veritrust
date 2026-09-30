"use client";

import React, { useState } from "react";
import Link from "next/link";
import { RunRow, RunResult, Claim } from "@/types/contracts";
import { getRun } from "@/lib/api";

interface RunLogTableProps {
  runs: RunRow[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  page: number;
  pageSize: number;
  totalCount?: number | null;
  onPageChange: (newPage: number) => void;
}

interface RunDetailState {
  loading: boolean;
  error: string | null;
  data: RunResult | null;
}

export const RunLogTable: React.FC<RunLogTableProps> = ({
  runs,
  loading = false,
  error = null,
  onRetry,
  page,
  pageSize,
  totalCount = null,
  onPageChange,
}) => {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [runDetailsCache, setRunDetailsCache] = useState<Record<string, RunDetailState>>({});

  const toggleRow = async (id: string) => {
    if (expandedRowId === id) {
      setExpandedRowId(null);
      return;
    }

    setExpandedRowId(id);

    // If not already fetched or previously failed, fetch full RunResult
    if (!runDetailsCache[id] || runDetailsCache[id].error) {
      setRunDetailsCache((prev) => ({
        ...prev,
        [id]: { loading: true, error: null, data: null },
      }));

      try {
        const result = await getRun(id);
        setRunDetailsCache((prev) => ({
          ...prev,
          [id]: { loading: false, error: null, data: result },
        }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Failed to load run details";
        setRunDetailsCache((prev) => ({
          ...prev,
          [id]: { loading: false, error: errorMsg, data: null },
        }));
      }
    }
  };

  const formatTimestamp = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return isoStr;
    }
  };

  const renderDraftWithClaims = (draft: string, claims: Claim[]) => {
    if (!claims || claims.length === 0) {
      return <span>&ldquo;{draft}&rdquo;</span>;
    }

    const sortedClaims = [...claims].sort((a, b) => a.start - b.start);
    const elements: React.ReactNode[] = [];
    let lastIdx = 0;

    sortedClaims.forEach((claim, idx) => {
      if (claim.start > lastIdx) {
        elements.push(draft.substring(lastIdx, claim.start));
      }

      if (claim.status === "CONTRADICTED") {
        elements.push(
          <span
            key={`claim-${idx}`}
            className="line-through text-accent-rose bg-accent-rose-bg/80 px-1 py-0.5 rounded border border-accent-rose-border mx-0.5 font-medium"
            title={`Contradicted: ${claim.reason}`}
          >
            {claim.text}
          </span>
        );
      } else if (claim.status === "UNSUPPORTED") {
        elements.push(
          <span
            key={`claim-${idx}`}
            className="underline decoration-amber-500 decoration-wavy text-amber-900 bg-amber-50 px-1 py-0.5 rounded border border-amber-300 mx-0.5 font-medium"
            title={`Unsupported: ${claim.reason}`}
          >
            {claim.text}
          </span>
        );
      } else {
        elements.push(
          <span key={`claim-${idx}`} className="text-on-surface font-medium">
            {claim.text}
          </span>
        );
      }

      lastIdx = claim.end;
    });

    if (lastIdx < draft.length) {
      elements.push(draft.substring(lastIdx));
    }

    return <>&ldquo;{elements}&rdquo;</>;
  };

  const hasNextPage =
    !loading &&
    runs.length === pageSize &&
    (totalCount === null || page * pageSize < totalCount);

  const hasPrevPage = !loading && page > 1;

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
            Live verification runs
          </span>
        </div>
        {loading && (
          <div className="font-mono text-[11px] text-outline flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-ochre animate-pulse"></span>
            Syncing runs...
          </div>
        )}
      </div>

      {/* Backend Error State */}
      {error && (
        <div className="my-4 p-4 rounded bg-red-50/70 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-[12px] text-accent-rose">
          <div className="flex items-center gap-2">
            <span className="font-bold">Error:</span>
            <span>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1 bg-white border border-red-300 rounded hover:bg-red-50 font-mono text-[11px] font-semibold text-accent-rose self-start sm:self-auto cursor-pointer"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {/* Table Container */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b border-surface-dim text-outline font-mono text-[11px] uppercase tracking-wider">
              <th className="py-3 px-3 font-normal w-36">Run Identifier</th>
              <th className="py-3 px-3 font-normal">Customer Query &amp; Context</th>
              <th className="py-3 px-3 font-normal w-32">Timestamp</th>
              <th className="py-3 px-3 font-normal w-24">Latency</th>
              <th className="py-3 px-3 font-normal w-40">Status Result</th>
              <th className="py-3 px-3 font-normal w-32 text-right">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-dim/70 font-sans">
            {loading && runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <div className="font-mono text-[12px] text-on-surface-variant flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-accent-ochre animate-pulse"></span>
                    Loading verification runs from database...
                  </div>
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <div className="font-mono text-[12px] text-on-surface-variant">
                    No live verification runs recorded yet.
                  </div>
                  <div className="font-mono text-[10px] text-outline mt-1">
                    Ask a question in Review view to record live audit trails.
                  </div>
                </td>
              </tr>
            ) : (
              runs.map((run) => {
                const isExpanded = expandedRowId === run.run_id;
                const detail = runDetailsCache[run.run_id];

                return (
                  <React.Fragment key={run.run_id}>
                    <tr
                      onClick={() => toggleRow(run.run_id)}
                      className={`transition-colors group cursor-pointer ${
                        isExpanded ? "bg-surface-muted/40" : "hover:bg-white"
                      }`}
                    >
                      {/* Identifier */}
                      <td className="py-4 px-3 font-mono text-[12px] text-on-surface font-medium whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>#{run.run_id}</span>
                          {run.chaos && (
                            <span className="px-1.5 py-0.5 rounded bg-accent-rose-bg text-accent-rose font-mono text-[9px] uppercase tracking-wider font-semibold border border-accent-rose-border">
                              Chaos
                            </span>
                          )}
                          {run.stale && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono text-[9px] uppercase tracking-wider font-semibold border border-purple-200">
                              Stale
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
                        {formatTimestamp(run.created_at)}
                      </td>

                      {/* Latency */}
                      <td className="py-4 px-3 font-mono text-[11px] text-on-surface-variant whitespace-nowrap">
                        {run.total_ms > 0 ? `${run.total_ms.toLocaleString()}ms` : "—"}
                      </td>

                      {/* Status Result Badge */}
                      <td className="py-4 px-3 whitespace-nowrap">
                        {run.final_status === "CORRECTED" && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-accent-ochre-border bg-accent-ochre-bg/50 text-accent-ochre font-mono text-[11px] font-semibold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent-ochre"></span>
                            Corrected
                          </span>
                        )}
                        {run.final_status === "DELIVERED" && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-outline-dim bg-white text-on-surface font-mono text-[11px] font-medium uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                            Passed
                          </span>
                        )}
                        {run.final_status === "ABSTAINED" && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-accent-rose-border bg-accent-rose-bg/50 text-accent-rose font-mono text-[11px] font-semibold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent-rose"></span>
                            Refused
                          </span>
                        )}
                      </td>

                      {/* Action link */}
                      <td className="py-4 px-3 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-on-surface group-hover:text-accent-ochre group-hover:translate-x-0.5 transition-all">
                          <span>{isExpanded ? "Close drawer" : "Inspect run"}</span>
                          <span className="material-symbols-outlined text-[15px] leading-none">
                            {isExpanded ? "expand_less" : "arrow_forward"}
                          </span>
                        </span>
                      </td>
                    </tr>

                    {/* Inline Inspection & Replay Drawer */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="p-0 border-b border-surface-dim">
                          <div className="bg-white border-y border-outline-dim p-6 shadow-xs transition-all">
                            {/* Drawer Header */}
                            <div className="flex items-center justify-between pb-3 border-b border-surface-dim mb-5">
                              <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                                  find_in_page
                                </span>
                                <h4 className="font-mono text-[11px] text-on-surface font-semibold uppercase tracking-wider">
                                  Inspection Drawer · Run #{run.run_id}
                                </h4>
                              </div>
                              <div className="flex items-center gap-3">
                                <Link
                                  href={`/?run_id=${encodeURIComponent(run.run_id)}`}
                                  className="font-mono text-[11px] text-black hover:text-accent-ochre underline font-medium flex items-center gap-1"
                                >
                                  <span>Open in Full Review</span>
                                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                </Link>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRow(run.run_id);
                                  }}
                                  className="font-mono text-[11px] text-outline hover:text-on-surface px-2 py-0.5 rounded hover:bg-surface-muted transition-colors cursor-pointer"
                                >
                                  ✕ Close
                                </button>
                              </div>
                            </div>

                            {/* Drawer Body State Handling */}
                            {detail?.loading ? (
                              <div className="py-8 text-center font-mono text-[12px] text-on-surface-variant flex items-center justify-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-accent-ochre animate-pulse"></span>
                                Fetching verification details for run #{run.run_id}...
                              </div>
                            ) : detail?.error ? (
                              <div className="p-4 rounded bg-red-50/70 border border-red-200 flex items-center justify-between font-mono text-[12px] text-accent-rose">
                                <span>Failed to fetch run details: {detail.error}</span>
                                <button
                                  type="button"
                                  onClick={() => toggleRow(run.run_id)}
                                  className="px-2 py-1 bg-white border border-red-300 rounded hover:bg-red-50 font-mono text-[11px]"
                                >
                                  Retry
                                </button>
                              </div>
                            ) : detail?.data ? (
                              <div className="flex flex-col gap-6">
                                {/* Columns: First Maker Draft vs Final Verified Output */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                  {/* Maker Draft */}
                                  <div className="bg-surface-dim/40 rounded p-4 border border-outline-dim">
                                    <div className="font-mono text-[10px] text-outline uppercase tracking-wider mb-2 flex items-center justify-between font-semibold">
                                      <span>First Maker Draft</span>
                                      <span className={detail.data.final_status === "CORRECTED" ? "text-accent-ochre" : "text-on-surface"}>
                                        {detail.data.retries > 0 ? `${detail.data.retries} Correction ${detail.data.retries === 1 ? "Retry" : "Retries"}` : "0 Retries (1st Pass)"}
                                      </span>
                                    </div>
                                    <p className="font-editorial text-[14px] text-on-surface leading-relaxed">
                                      {renderDraftWithClaims(detail.data.draft, detail.data.claims)}
                                    </p>
                                  </div>

                                  {/* Final Answer */}
                                  <div className="bg-white rounded p-4 border border-outline-dim">
                                    <div className="font-mono text-[10px] text-on-surface uppercase tracking-wider mb-2 flex items-center justify-between font-semibold">
                                      <span>Final Verified Output</span>
                                      <span className={
                                        detail.data.final_status === "CORRECTED"
                                          ? "text-accent-ochre"
                                          : detail.data.final_status === "ABSTAINED"
                                          ? "text-accent-rose"
                                          : "text-emerald-800"
                                      }>
                                        {detail.data.final_status}
                                        {detail.data.abstain_reason && ` (${detail.data.abstain_reason})`}
                                      </span>
                                    </div>
                                    <p className="font-editorial text-[14px] text-on-surface leading-relaxed">
                                      &ldquo;{detail.data.final_answer}&rdquo;
                                    </p>
                                  </div>
                                </div>

                                {/* Claims Entailment & Citations */}
                                {detail.data.claims && detail.data.claims.length > 0 && (
                                  <div className="pt-2">
                                    <h5 className="font-mono text-[11px] text-on-surface uppercase tracking-wider font-semibold mb-3">
                                      Evaluated Claims &amp; Policy Citations ({detail.data.claims.length})
                                    </h5>
                                    <div className="space-y-2.5">
                                      {detail.data.claims.map((claim) => (
                                        <div
                                          key={claim.id}
                                          className="p-3.5 rounded bg-surface-muted/40 border border-outline-dim text-[12px]"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                            <div className="flex items-center gap-2">
                                              <span
                                                className={`font-mono text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider border ${
                                                  claim.status === "SUPPORTED"
                                                    ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                                    : claim.status === "CONTRADICTED"
                                                    ? "bg-accent-rose-bg text-accent-rose border-accent-rose-border"
                                                    : "bg-amber-50 text-amber-800 border-amber-300"
                                                }`}
                                              >
                                                {claim.status}
                                              </span>
                                              <span className="font-mono text-[10px] text-on-surface-variant">
                                                Verified by: <strong>{claim.checked_by}</strong>
                                              </span>
                                            </div>
                                            <span className="font-mono text-[10px] text-outline">
                                              Claim #{claim.id} [{claim.start}:{claim.end}]
                                            </span>
                                          </div>
                                          <p className="font-editorial text-[13.5px] text-on-surface mb-1.5 leading-snug">
                                            &ldquo;{claim.text}&rdquo;
                                          </p>
                                          <p className="font-mono text-[11px] text-on-surface-variant">
                                            Reason: {claim.reason}
                                          </p>

                                          {/* Citations */}
                                          {claim.evidence && claim.evidence.length > 0 && (
                                            <div className="mt-2.5 pl-3 border-l-2 border-outline-dim space-y-1">
                                              {claim.evidence.map((ev, evIdx) => (
                                                <div key={evIdx} className="font-mono text-[11px] text-on-surface-variant">
                                                  <span className="font-semibold text-on-surface">
                                                    [{ev.source} {ev.version} · {ev.chunk_id}]
                                                  </span>
                                                  : &ldquo;{ev.text}&rdquo;
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Telemetry & Metadata Footer */}
                                <div className="pt-3 border-t border-surface-dim flex flex-wrap items-center justify-between gap-4 font-mono text-[11px] text-on-surface-variant">
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span>Latencies:</span>
                                    <span className="text-on-surface">Retrieve: <strong>{detail.data.latency_ms.retrieve ?? 0}ms</strong></span>
                                    <span>·</span>
                                    <span className="text-on-surface">Maker: <strong>{detail.data.latency_ms.maker ?? 0}ms</strong></span>
                                    <span>·</span>
                                    <span className="text-on-surface">Check: <strong>{detail.data.latency_ms.check ?? 0}ms</strong></span>
                                    <span>·</span>
                                    <span className="text-on-surface">Judge: <strong>{detail.data.latency_ms.judge ?? 0}ms</strong></span>
                                    {detail.data.retries > 0 && (
                                      <>
                                        <span>·</span>
                                        <span className="text-on-surface">Correct: <strong>{detail.data.latency_ms.correct ?? 0}ms</strong></span>
                                      </>
                                    )}
                                    <span>·</span>
                                    <span className="font-semibold text-on-surface">Total: {detail.data.latency_ms.total ?? 0}ms</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span>Tokens: Maker {detail.data.tokens.maker ?? 0} / Judge {detail.data.tokens.judge ?? 0}</span>
                                    {Object.keys(detail.data.policy_versions || {}).length > 0 && (
                                      <>
                                        <span>·</span>
                                        <span>
                                          Policies: {Object.entries(detail.data.policy_versions).map(([k, v]) => `${k} (${v})`).join(", ")}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="w-full pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-[11px] text-on-surface-variant">
        <div>
          {totalCount !== null && totalCount !== undefined ? (
            runs.length > 0 ? (
              <>
                Showing{" "}
                <span className="text-on-surface font-semibold">
                  {(page - 1) * pageSize + 1} - {(page - 1) * pageSize + runs.length}
                </span>{" "}
                of {totalCount} logged verification runs
              </>
            ) : (
              <span>0 logged runs</span>
            )
          ) : (
            <span>
              Showing {runs.length} recent verification runs (Page {page})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrevPage}
            className="px-3 py-1 rounded border border-outline-dim text-on-surface hover:bg-surface-dim transition-colors disabled:text-outline disabled:cursor-not-allowed cursor-pointer"
          >
            Previous
          </button>
          <span className="px-2.5 py-1 rounded bg-black text-white font-medium shadow-xs">
            {page}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNextPage}
            className="px-3 py-1 rounded border border-outline-dim text-on-surface hover:bg-surface-dim transition-colors disabled:text-outline disabled:cursor-not-allowed cursor-pointer"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

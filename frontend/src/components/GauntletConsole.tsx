"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  BenchmarkCaseResult,
  BenchmarkSummary,
  BenchmarkStreamEvent,
} from "@/types/contracts";
import { runBenchmarkStream, getLatestBenchmark } from "@/lib/api";

export interface GauntletConsoleProps {
  onRunStateChange?: (isRunning: boolean) => void;
  runTrigger?: number;
}

export const GauntletConsole: React.FC<GauntletConsoleProps> = ({
  onRunStateChange,
  runTrigger = 0,
}) => {
  const [chaos, setChaos] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [streamCases, setStreamCases] = useState<BenchmarkCaseResult[]>([]);
  const [summary, setSummary] = useState<BenchmarkSummary | null>(null);
  const [totalCases, setTotalCases] = useState<number>(40);
  const [error, setError] = useState<string | null>(null);
  const [latestLoading, setLatestLoading] = useState<boolean>(true);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<BenchmarkCaseResult | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const prevRunTriggerRef = useRef<number>(runTrigger);

  // Load latest stored benchmark on mount
  const loadLatest = useCallback(async () => {
    setLatestLoading(true);
    setLatestError(null);
    try {
      const latest = await getLatestBenchmark();
      if (latest) {
        setSummary(latest);
        if (latest.cases && latest.cases.length > 0) {
          setStreamCases(latest.cases);
          setTotalCases(latest.total_cases || latest.cases.length);
        }
        if (latest.modes && latest.modes.includes("chaos")) {
          setChaos(true);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load latest benchmark";
      setLatestError(msg);
    } finally {
      setLatestLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  // Clean up abort controller on unmount to avoid leaks
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Execution handler
  const handleStartBenchmark = useCallback(
    async (chaosMode: boolean) => {
      if (isRunning) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsRunning(true);
      setError(null);
      setLatestError(null);
      setSummary(null);
      setStreamCases([]);
      setSelectedCase(null);
      onRunStateChange?.(true);

      try {
        const stream = runBenchmarkStream(chaosMode, controller.signal);

        for await (const event of stream) {
          if (controller.signal.aborted) break;

          if (event.event === "benchmark_started") {
            if (event.data.total_cases) {
              setTotalCases(event.data.total_cases);
            }
          } else if (event.event === "benchmark_case") {
            setStreamCases((prev) => [...prev, event.data]);
          } else if (event.event === "benchmark_summary") {
            setSummary(event.data);
            if (event.data.cases && event.data.cases.length > 0) {
              setStreamCases(event.data.cases);
            }
          } else if (event.event === "error") {
            setError(event.data.message || "Benchmark stream encountered an error");
          }
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          setError("Benchmark evaluation was cancelled.");
        } else {
          const msg = err instanceof Error ? err.message : "Benchmark stream interrupted";
          setError(msg);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsRunning(false);
          onRunStateChange?.(false);
          abortControllerRef.current = null;
        }
      }
    },
    [isRunning, onRunStateChange]
  );

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsRunning(false);
    onRunStateChange?.(false);
    setError("Benchmark run cancelled by user.");
  };

  // Support parent-driven trigger (e.g. from top button or ⌘G)
  useEffect(() => {
    if (runTrigger > prevRunTriggerRef.current) {
      prevRunTriggerRef.current = runTrigger;
      handleStartBenchmark(chaos);
    }
  }, [runTrigger, chaos, handleStartBenchmark]);

  const formatRate = (rate: number | null | undefined): string => {
    if (rate === null || rate === undefined || isNaN(rate)) return "—";
    return `${(rate * 100).toFixed(1)}%`;
  };

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case "direct":
        return "bg-stone-100 text-stone-700 border-stone-300";
      case "paraphrased":
        return "bg-blue-50 text-blue-800 border-blue-200";
      case "multi_part":
        return "bg-purple-50 text-purple-800 border-purple-200";
      case "false_premise":
        return "bg-amber-50 text-amber-900 border-amber-300";
      case "unanswerable":
        return "bg-rose-50 text-rose-800 border-rose-200";
      default:
        return "bg-stone-100 text-stone-700 border-stone-300";
    }
  };

  const completedCount = streamCases.length;
  const progressRatio = Math.min(100, Math.round((completedCount / (totalCases || 40)) * 100));

  return (
    <div className="w-full bg-[#fff8f0] border border-outline-dim rounded-lg shadow-xs overflow-hidden mb-12">
      {/* Console Header Bar */}
      <div className="p-5 sm:p-6 border-b border-outline-dim bg-white/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-editorial text-[1.4rem] font-semibold text-on-surface">
              The Gauntlet
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-surface-muted text-on-surface-variant border border-outline-dim">
              Benchmark Suite (PRD §13)
            </span>
            {isRunning && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                Evaluating Stream
              </span>
            )}
          </div>
          <p className="font-mono text-[12px] text-on-surface-variant mt-1">
            40-case empirical evaluation against VeriCorp policies (Direct, Paraphrased, Multi-part, False-premise, Unanswerable).
          </p>
        </div>

        {/* Console Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Normal vs Chaos Toggle */}
          <div className="flex items-center bg-surface-muted/90 p-1 rounded border border-outline-dim">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setChaos(false)}
              className={`px-2.5 py-1 rounded font-mono text-[11px] font-medium transition-all ${
                !chaos
                  ? "bg-white text-on-surface shadow-xs border border-outline-dim"
                  : "text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              }`}
            >
              Normal
            </button>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setChaos(true)}
              className={`px-2.5 py-1 rounded font-mono text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                chaos
                  ? "bg-amber-100/90 text-amber-950 shadow-xs border border-amber-300 font-semibold"
                  : "text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              }`}
              title="Chaos mode simulates Maker hallucinations with wrong numbers to test detection and correction"
            >
              <span>Chaos</span>
              <span className="text-[9px] px-1 py-0.2 rounded bg-amber-200/80 text-amber-900 uppercase">
                Simulated
              </span>
            </button>
          </div>

          {/* Action Button: Run or Cancel */}
          {isRunning ? (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-red-50 text-accent-rose border border-red-200 font-mono text-[12px] font-semibold hover:bg-red-100 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">stop_circle</span>
              <span>Cancel Run</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleStartBenchmark(chaos)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-black text-white font-sans text-[13px] font-medium hover:bg-zinc-800 active:scale-[0.99] transition-all shadow-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">play_arrow</span>
              <span>Run the gauntlet</span>
              <span className="font-mono text-[10px] text-white/60 pl-1 border-l border-white/20">
                ⌘G
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Progress & Stream Status Banner */}
      {isRunning && (
        <div className="bg-amber-50/50 border-b border-amber-200/60 px-6 py-3">
          <div className="flex items-center justify-between text-[12px] font-mono text-amber-950 mb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent-ochre animate-pulse"></span>
              <span>
                Evaluating benchmark cases in {chaos ? "Chaos" : "Normal"} mode...
              </span>
            </div>
            <span className="font-semibold">
              {completedCount} / {totalCases} cases received
            </span>
          </div>
          {/* Minimal Editorial Progress Bar */}
          <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-on-surface transition-all duration-300 ease-out"
              style={{ width: `${progressRatio}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Error or Interruption Alert */}
      {(error || latestError) && (
        <div className="p-4 bg-red-50/80 border-b border-red-200 text-[12px] font-mono text-accent-rose flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>
              <strong>Benchmark Service Error:</strong> {error || latestError}
            </span>
          </div>
          <button
            type="button"
            onClick={() => (error ? handleStartBenchmark(chaos) : loadLatest())}
            className="px-3 py-1 bg-white border border-red-300 rounded hover:bg-red-50 font-semibold cursor-pointer self-start sm:self-auto"
          >
            Retry Benchmark
          </button>
        </div>
      )}

      {/* Authoritative Four Benchmark Metrics Banner (PRD §12, §13, §14) */}
      {summary && (
        <div className="p-5 sm:p-6 bg-[#faf8f0] border-b border-outline-dim">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
              Authoritative Benchmark Rates · Evaluated by Code (PRD §13)
            </div>
            <div className="font-mono text-[11px] text-outline">
              Mode: <span className="font-semibold text-on-surface">{summary.modes.join(", ")}</span> · Cases: {summary.completed_cases}/{summary.total_cases}
            </div>
          </div>

          {/* Primary 4 Metrics Specified by PRD */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-3 border-y border-outline-dim/70">
            <div>
              <div className="font-mono text-[11px] text-on-surface-variant">Detection Rate</div>
              <div className="font-editorial text-[1.6rem] font-semibold text-on-surface tracking-tight mt-0.5">
                {formatRate(summary.detection_rate)}
              </div>
              <div className="font-mono text-[10px] text-outline mt-0.5">
                Bad first drafts caught & fixed
              </div>
            </div>

            <div>
              <div className="font-mono text-[11px] text-on-surface-variant">False-Approval Rate</div>
              <div className="font-editorial text-[1.6rem] font-semibold text-accent-rose tracking-tight mt-0.5">
                {formatRate(summary.false_approval_rate)}
              </div>
              <div className="font-mono text-[10px] text-outline mt-0.5">
                Bad first drafts delivered (safety floor)
              </div>
            </div>

            <div>
              <div className="font-mono text-[11px] text-on-surface-variant">Correct-Abstention Rate</div>
              <div className="font-editorial text-[1.6rem] font-semibold text-on-surface tracking-tight mt-0.5">
                {formatRate(summary.correct_abstention_rate)}
              </div>
              <div className="font-mono text-[10px] text-outline mt-0.5">
                Unanswerable cases safely refused
              </div>
            </div>

            <div>
              <div className="font-mono text-[11px] text-on-surface-variant">Correction Success Rate</div>
              <div className="font-editorial text-[1.6rem] font-semibold text-accent-ochre tracking-tight mt-0.5">
                {formatRate(summary.correction_success_rate)}
              </div>
              <div className="font-mono text-[10px] text-outline mt-0.5">
                Bad answer drafts repaired to truth
              </div>
            </div>
          </div>

          {/* Secondary Accuracy and Over-Abstention Metrics */}
          <div className="mt-3 pt-1 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-mono text-on-surface-variant">
            {summary.veritrust_accuracy !== undefined && (
              <div>
                VeriTrust Accuracy:{" "}
                <span className="font-semibold text-on-surface">
                  {formatRate(summary.veritrust_accuracy)}
                </span>
              </div>
            )}
            {summary.baseline_accuracy !== undefined && (
              <div>
                Baseline Accuracy (Without VeriTrust):{" "}
                <span className="font-semibold text-on-surface">
                  {formatRate(summary.baseline_accuracy)}
                </span>
              </div>
            )}
            {summary.over_abstention_rate !== undefined && (
              <div>
                Over-abstention:{" "}
                <span className="font-semibold text-on-surface">
                  {formatRate(summary.over_abstention_rate)}
                </span>{" "}
                <span className="text-outline">(price of safety)</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Benchmark Cases Table */}
      <div className="relative">
        {latestLoading && streamCases.length === 0 ? (
          <div className="p-12 text-center font-mono text-[12px] text-on-surface-variant">
            <span className="inline-block w-4 h-4 border-2 border-on-surface/30 border-t-on-surface rounded-full animate-spin mr-2"></span>
            Loading latest benchmark run...
          </div>
        ) : streamCases.length === 0 && !isRunning ? (
          /* Empty State */
          <div className="p-12 text-center">
            <div className="font-editorial text-[1.3rem] text-on-surface font-medium">
              No benchmark run recorded yet
            </div>
            <p className="font-mono text-[12px] text-on-surface-variant mt-2 max-w-md mx-auto">
              Execute &ldquo;Run the gauntlet&rdquo; to stream the 40 ground-truth evaluation cases and compute live detection, false-approval, and safety abstention rates.
            </p>
            <div className="mt-5">
              <button
                type="button"
                onClick={() => handleStartBenchmark(chaos)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-black text-white font-sans text-[12px] font-medium hover:bg-zinc-800 transition-all cursor-pointer shadow-xs"
              >
                <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                <span>Run the gauntlet (Normal mode)</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-dim bg-surface-muted/50 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
                  <th className="py-2.5 px-4 font-medium w-16">Case</th>
                  <th className="py-2.5 px-4 font-medium w-28">Category</th>
                  <th className="py-2.5 px-4 font-medium">Question</th>
                  <th className="py-2.5 px-4 font-medium w-28">Expected</th>
                  <th className="py-2.5 px-4 font-medium w-32">Actual Status</th>
                  <th className="py-2.5 px-4 font-medium w-24">Result</th>
                  <th className="py-2.5 px-4 font-medium w-20 text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-dim/50 text-[12px]">
                {streamCases.map((c) => {
                  const isSelected = selectedCase?.case_id === c.case_id;
                  return (
                    <tr
                      key={c.case_id}
                      onClick={() => setSelectedCase(c)}
                      className={`hover:bg-white/80 transition-colors cursor-pointer ${
                        isSelected ? "bg-stone-100/90 font-medium" : ""
                      }`}
                    >
                      {/* Case ID */}
                      <td className="py-3 px-4 font-mono font-semibold text-on-surface">
                        {c.case_id}
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono border ${getCategoryBadgeClass(
                            c.category
                          )}`}
                        >
                          {c.category}
                        </span>
                      </td>

                      {/* Question */}
                      <td className="py-3 px-4 text-on-surface font-serif line-clamp-1 max-w-md">
                        {c.question}
                      </td>

                      {/* Expected Behavior */}
                      <td className="py-3 px-4 font-mono text-[11px] text-on-surface-variant">
                        {c.expected_behavior}
                      </td>

                      {/* Actual Final Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 font-mono text-[11px] ${
                            c.actual_status === "CORRECTED"
                              ? "text-accent-ochre"
                              : c.actual_status === "ABSTAINED"
                              ? "text-accent-rose"
                              : "text-on-surface"
                          }`}
                        >
                          {c.actual_status === "CORRECTED"
                            ? "✎ CORRECTED"
                            : c.actual_status === "ABSTAINED"
                            ? "⊘ ABSTAINED"
                            : c.actual_status === "DELIVERED"
                            ? "✓ DELIVERED"
                            : "—"}
                        </span>
                      </td>

                      {/* Pass / Fail */}
                      <td className="py-3 px-4">
                        {c.pass ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-semibold">
                            ✓ PASS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 text-red-800 border border-red-200 font-mono text-[10px] font-semibold">
                            ✕ FAIL
                          </span>
                        )}
                      </td>

                      {/* Latency */}
                      <td className="py-3 px-4 font-mono text-[11px] text-outline text-right">
                        {c.latency_ms ? `${c.latency_ms}ms` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Case Inspection Drawer (when a row is clicked) */}
        {selectedCase && (
          <div className="p-5 bg-white border-t border-outline-dim shadow-xs">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold text-on-surface">
                    Case {selectedCase.case_id} Detail Inspection
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getCategoryBadgeClass(
                      selectedCase.category
                    )}`}
                  >
                    {selectedCase.category}
                  </span>
                  {selectedCase.pass ? (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-semibold">
                      ✓ PASS
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-800 border border-red-200 font-mono text-[10px] font-semibold">
                      ✕ FAIL
                    </span>
                  )}
                </div>
                <div className="font-editorial text-[1.1rem] text-on-surface mt-1">
                  &ldquo;{selectedCase.question}&rdquo;
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCase(null)}
                className="p-1 rounded text-outline hover:text-on-surface hover:bg-stone-100 transition-colors"
                title="Close case inspection"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-[11px]">
              <div className="p-3 bg-stone-50 rounded border border-outline-dim/60">
                <div className="text-on-surface-variant font-semibold uppercase tracking-wider mb-1">
                  Ground Truth Contract (PRD §13)
                </div>
                <div className="space-y-1 text-on-surface">
                  <div>
                    <span className="text-outline">Expected Behavior:</span>{" "}
                    <strong>{selectedCase.expected_behavior}</strong>
                  </div>
                  {selectedCase.expected_facts && selectedCase.expected_facts.length > 0 && (
                    <div>
                      <span className="text-outline">Required Facts:</span>{" "}
                      {selectedCase.expected_facts.join(", ")}
                    </div>
                  )}
                  {selectedCase.forbidden_facts && selectedCase.forbidden_facts.length > 0 && (
                    <div>
                      <span className="text-outline">Forbidden Facts:</span>{" "}
                      <span className="text-accent-rose">{selectedCase.forbidden_facts.join(", ")}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-3 bg-stone-50 rounded border border-outline-dim/60">
                <div className="text-on-surface-variant font-semibold uppercase tracking-wider mb-1">
                  Actual Guardrail Output
                </div>
                <div className="space-y-1 text-on-surface">
                  <div>
                    <span className="text-outline">Final Status:</span>{" "}
                    <strong>{selectedCase.actual_status || "—"}</strong>
                  </div>
                  <div>
                    <span className="text-outline">Answer:</span>{" "}
                    <span className="font-serif text-[12px]">
                      {selectedCase.actual_answer ? `"${selectedCase.actual_answer}"` : "—"}
                    </span>
                  </div>
                  {selectedCase.latency_ms && (
                    <div>
                      <span className="text-outline">Execution Latency:</span> {selectedCase.latency_ms}ms
                    </div>
                  )}
                  {selectedCase.run_id && (
                    <div>
                      <span className="text-outline">Run ID:</span> {selectedCase.run_id}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/Header";
import { CleanRateChart } from "@/components/CleanRateChart";
import { RunLogTable } from "@/components/RunLogTable";
import { GauntletConsole } from "@/components/GauntletConsole";
import { getMetrics, getRuns } from "@/lib/api";
import { MetricsResult, RunRow } from "@/types/contracts";

export default function LedgerPage() {
  const [isGauntletRunning, setIsGauntletRunning] = useState<boolean>(false);
  const [runTrigger, setRunTrigger] = useState<number>(0);

  // Live state for metrics and runs
  const [metrics, setMetrics] = useState<MetricsResult | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState<boolean>(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const pageSize = 10;

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const data = await getMetrics();
      setMetrics(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load metrics";
      setMetricsError(msg);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (pageNum: number) => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const offset = (pageNum - 1) * pageSize;
      const data = await getRuns({ limit: pageSize, offset, source: "live" });
      setRuns(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load runs";
      setRunsError(msg);
    } finally {
      setRunsLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    loadRuns(page);
  }, [page, loadRuns]);

  // Real action handler for top "Run the gauntlet" button & ⌘G shortcut
  const handleRunGauntlet = () => {
    if (isGauntletRunning) return;
    setRunTrigger((prev) => prev + 1);
    const consoleEl = document.getElementById("gauntlet-console");
    if (consoleEl) {
      consoleEl.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Support ⌘G / Ctrl+G keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        handleRunGauntlet();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isGauntletRunning]);

  return (
    <div className="bg-[#faf8f0] text-on-surface antialiased font-sans min-h-screen flex flex-col">
      {/* Reusable Header with Ledger active */}
      <Header activeTab="ledger" />

      {/* Main Content Workspace */}
      <main className="w-full flex-1 bg-[#fff8f0] overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Editorial Summary Header */}
          <div className="w-full flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-12">
            <div className="max-w-3xl">
              {metricsLoading ? (
                <div className="animate-pulse">
                  <div className="h-10 bg-surface-dim/70 rounded w-4/5 mb-3"></div>
                  <div className="h-4 bg-surface-dim/50 rounded w-1/3"></div>
                </div>
              ) : metricsError ? (
                <div className="p-4 rounded bg-red-50/70 border border-red-200 font-mono text-[12px] text-accent-rose flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="font-bold">Backend connection failed:</span> {metricsError}
                  </div>
                  <button
                    type="button"
                    onClick={loadMetrics}
                    className="px-3 py-1 bg-white border border-red-300 rounded hover:bg-red-50 font-mono text-[11px] font-semibold text-accent-rose self-start sm:self-auto cursor-pointer"
                  >
                    Retry Metrics
                  </button>
                </div>
              ) : metrics && metrics.answers_checked === 0 ? (
                <div>
                  <h1 className="font-editorial text-[2.25rem] text-on-surface leading-tight tracking-tight font-medium">
                    0 answers checked so far.
                  </h1>
                  <p className="font-mono text-[12px] text-on-surface-variant mt-3 tracking-tight">
                    No live verification runs recorded yet. Verification metrics will be computed from live runs as questions are evaluated.
                  </p>
                </div>
              ) : metrics ? (
                <div>
                  <h1 className="font-editorial text-[2.25rem] text-on-surface leading-tight tracking-tight font-medium">
                    {metrics.answers_checked} answers checked. {metrics.wrong_drafts} were wrong.{" "}
                    <span className="inline-block text-[#ac3400] underline decoration-[#ac3400]/30 decoration-2 underline-offset-4">
                      {metrics.corrected} were fixed
                    </span>
                    ,{" "}
                    <span className="inline-block text-[#ba1a1a] underline decoration-[#ba1a1a]/30 decoration-2 underline-offset-4">
                      {metrics.abstained} were refused
                    </span>
                    .
                  </h1>
                  <p className="font-mono text-[12px] text-on-surface-variant mt-3 tracking-tight">
                    Measured on live runs (computed from verified transactions in database).
                    {metrics.chaos_runs > 0 && ` (${metrics.chaos_runs} of these used Chaos mode).`}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Run the Gauntlet Action Button */}
            <div className="flex items-center lg:pt-1 self-start">
              <button
                type="button"
                onClick={handleRunGauntlet}
                disabled={isGauntletRunning}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded bg-black text-white font-sans text-[13px] font-medium hover:bg-zinc-800 active:scale-[0.99] transition-all shadow-sm cursor-pointer disabled:opacity-70"
                title="Run benchmark gauntlet test suite (⌘G)"
              >
                <span className="material-symbols-outlined text-[17px] leading-none">
                  {isGauntletRunning ? "hourglass_top" : "terminal"}
                </span>
                <span>{isGauntletRunning ? "Evaluating Stream..." : "Run the gauntlet"}</span>
                <span className="font-mono text-[10px] text-white/60 pl-1 border-l border-white/20">
                  ⌘G
                </span>
              </button>
            </div>
          </div>

          {/* First-Pass Clean Rate Rolling Line Chart */}
          <CleanRateChart
            drift={metrics?.drift || []}
            policyChanges={metrics?.policy_changes || []}
            loading={metricsLoading}
          />

          {/* The Gauntlet · Live Benchmark Suite Console (PRD §13, §14) */}
          <div id="gauntlet-console" className="mt-10">
            <GauntletConsole
              onRunStateChange={setIsGauntletRunning}
              runTrigger={runTrigger}
            />
          </div>

          {/* Chronological Run Log Section */}
          <RunLogTable
            runs={runs}
            loading={runsLoading}
            error={runsError}
            onRetry={() => loadRuns(page)}
            page={page}
            pageSize={pageSize}
            totalCount={metrics?.answers_checked}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full bg-[#faf8f0] border-t border-outline-dim py-5">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <p className="font-mono text-[11px] text-on-surface-variant">
            VeriTrust · Automated AI Verification Ledger · Verified against policy specifications
          </p>
          <div className="font-mono text-[10px] text-outline">
            Audit Ledger v1.0
          </div>
        </div>
      </footer>
    </div>
  );
}

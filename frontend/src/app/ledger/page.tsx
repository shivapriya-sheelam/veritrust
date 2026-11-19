"use client";

import React, { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { CleanRateChart } from "@/components/CleanRateChart";
import { RunLogTable } from "@/components/RunLogTable";
import { fetchMetrics, fetchRuns, benchmarkStream, fetchBenchmarkLatest } from "@/lib/api";
import { LedgerSummary, LedgerRunRecord } from "@/types/ledger";

export default function LedgerPage() {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [runs, setRuns] = useState<LedgerRunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const limit = 20;

  const [isGauntletRunning, setIsGauntletRunning] = useState<boolean>(false);
  const [gauntletStatus, setGauntletStatus] = useState<string | null>(null);

  const loadData = async (page: number = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const [m, r] = await Promise.all([fetchMetrics(), fetchRuns(limit, (page - 1) * limit)]);
      
      const isRaw = m.answers_checked !== undefined;
      const summaryMapped: any = isRaw ? {
        isMockData: false,
        totalChecked: m.answers_checked,
        wrongDrafts: m.wrong_drafts,
        fixedCount: m.corrected,
        refusedCount: m.abstained,
        caption: `Measured on ${m.answers_checked} verified runs.`,
        drift: m.drift,
        chaos_runs: m.chaos_runs
      } : m;

      setSummary(summaryMapped);
      
      const runsMapped: LedgerRunRecord[] = (r && r.length > 0 && r[0].run_id) ? r.map((run: any) => ({
        id: run.run_id,
        question: run.question,
        timestamp: run.created_at,
        status: run.final_status === "DELIVERED" ? "PASSED" : (run.final_status === "ABSTAINED" ? "REFUSED" : run.final_status),
        statusLabel: run.final_status === "CORRECTED" ? "Corrected" : run.final_status === "DELIVERED" ? "Passed (1st pass)" : "Refused (Abstain)",
        isSimulated: run.chaos,
        actionLabel: "Inspect run",
        rawProposition: { text: "Raw text not available in summary view. Open full run." },
        reconciledRedline: { text: "Redline not available in summary view." }
      })) : r;

      setRuns(runsMapped);
      setCurrentPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ledger data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(1);
  }, []);

  const handleRunGauntlet = async () => {
    if (isGauntletRunning) return;
    setIsGauntletRunning(true);
    setGauntletStatus("Streaming benchmark evaluation: 40 cases across normal & chaos modes...");
    
    try {
      const stream = benchmarkStream(["normal", "chaos"]);
      let casesCompleted = 0;
      for await (const msg of stream) {
        if (msg.event === "case_result") {
          casesCompleted++;
          setGauntletStatus(`Evaluating policy assertions and numeric boundaries (${casesCompleted}/40)...`);
        } else if (msg.event === "summary") {
          const s = msg.data;
          setGauntletStatus(`Gauntlet complete: ${s.passed}/${s.total} passed. Detection: ${s.detection}% · False-approval: ${s.false_approval}% · Accuracy: ${s.accuracy}%`);
        }
      }
      // Reload runs after benchmark
      loadData();
    } catch (err) {
      setGauntletStatus(`Benchmark failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsGauntletRunning(false);
    }
  };

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
      <Header activeTab="ledger" />

      <main className="w-full flex-1 bg-[#fff8f0] overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {isLoading && !summary ? (
            <div className="p-12 text-center text-outline font-mono text-[13px]">
              Loading ledger...
            </div>
          ) : error ? (
            <div className="p-6 bg-rose-50 text-rose-700 border border-rose-200 rounded">
              {error}
              <div className="mt-2">
                <button onClick={() => loadData(1)} className="underline text-[13px]">Retry</button>
              </div>
            </div>
          ) : !summary ? (
            <div className="p-12 text-center text-outline font-mono text-[13px]">
              No ledger data available.
            </div>
          ) : (
            <>
              <div className="w-full flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-12">
                <div className="max-w-3xl">
                  <h1 className="font-editorial text-[2.25rem] text-on-surface leading-tight tracking-tight font-medium">
                    {summary.totalChecked} answers checked. {summary.wrongDrafts} were wrong.{" "}
                    <span className="inline-block text-[#ac3400] underline decoration-[#ac3400]/30 decoration-2 underline-offset-4">
                      {summary.fixedCount} were fixed
                    </span>
                    ,{" "}
                    <span className="inline-block text-[#ba1a1a] underline decoration-[#ba1a1a]/30 decoration-2 underline-offset-4">
                      {summary.refusedCount} were refused
                    </span>
                    .
                  </h1>
                  <p className="font-mono text-[12px] text-on-surface-variant mt-3 tracking-tight">
                    {summary.caption || "Measured on verified runs."}
                  </p>

                  {gauntletStatus && (
                    <div className="mt-4 p-3 rounded bg-surface-muted border border-outline-dim font-mono text-[11px] text-on-surface flex items-center justify-between transition-all">
                      <div className="flex items-center gap-2">
                        {isGauntletRunning ? (
                          <span className="w-2 h-2 rounded-full bg-accent-ochre animate-pulse"></span>
                        ) : (
                          <span className="text-accent-green font-bold">✓</span>
                        )}
                        <span>{gauntletStatus}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setGauntletStatus(null)}
                        className="text-outline hover:text-on-surface text-[10px] ml-3 px-1.5 py-0.5 rounded hover:bg-surface-dim"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>

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
                    <span>{isGauntletRunning ? "Evaluating..." : "Run the gauntlet"}</span>
                    <span className="font-mono text-[10px] text-white/60 pl-1 border-l border-white/20">
                      ⌘G
                    </span>
                  </button>
                </div>
              </div>

              <CleanRateChart />

              {runs.length === 0 ? (
                <div className="p-12 text-center text-outline font-mono text-[13px] border border-outline-dim rounded mt-8">
                  No runs found in ledger.
                </div>
              ) : (
                <RunLogTable 
                  runs={runs} 
                  currentPage={currentPage}
                  totalRuns={summary.totalChecked + ((summary as any).chaos_runs || 0)}
                  onPageChange={loadData}
                />
              )}
            </>
          )}
        </div>
      </main>

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

"use client";

import React from "react";
import { RunResult } from "@/types/contracts";
import { PipelineStage, StageStatus } from "@/hooks/useAsk";

interface TimelineProps {
  runResult: RunResult | null;
  currentStage?: PipelineStage | null;
  stageStatuses?: Record<PipelineStage, StageStatus>;
  isLive?: boolean;
}

export const Timeline: React.FC<TimelineProps> = ({
  runResult,
  currentStage,
  stageStatuses,
  isLive = false,
}) => {
  // If no live statuses provided, derive fallback completion state from runResult
  const hasResult = !!runResult;
  const contradictedCount = runResult?.claims?.filter((c) => c.status === "CONTRADICTED").length || 0;
  const unsupportedCount = runResult?.claims?.filter((c) => c.status === "UNSUPPORTED").length || 0;
  const isAbstained = runResult?.final_status === "ABSTAINED";
  const wasCorrected = (runResult?.retries || 0) > 0;

  // Policies cited
  const policyNames = runResult ? Object.keys(runResult.policy_versions) : [];
  const primaryPolicy = policyNames.length > 0 ? policyNames[0] : (hasResult ? "Policies retrieved" : "Waiting...");

  // Determine stage status
  const getStatus = (stage: PipelineStage): StageStatus => {
    if (stageStatuses) {
      return stageStatuses[stage];
    }
    if (!hasResult) return "pending";
    if (stage === "correct" && !wasCorrected && !isAbstained) return "skipped";
    return "completed";
  };

  const retrieveStatus = getStatus("retrieve");
  const makerStatus = getStatus("maker");
  const checkStatus = getStatus("check");
  const correctStatus = getStatus("correct");
  const verifiedStatus = getStatus("verified");

  const checkLatency = (runResult?.latency_ms?.check || 0) + (runResult?.latency_ms?.judge || 0);

  return (
    <aside className="w-[220px] shrink-0 border-r border-outline-dim bg-[#faf8f0] p-5 flex flex-col justify-between overflow-y-auto">
      <div className="space-y-6">
        <div>
          <span className="font-mono text-[10px] tracking-widest uppercase text-outline font-semibold block">
            Pipeline
          </span>
          <span className="font-mono text-[11px] text-on-surface-variant mt-0.5 block">
            Verification Loop
          </span>
        </div>

        <ol className="relative border-l border-outline-dim ml-2.5 space-y-6 text-left">
          {/* Stage 1: Retrieve */}
          <li className="ml-4 relative">
            <span
              className={`absolute -left-[23px] mt-1 h-3 w-3 rounded-full ring-3 ring-[#faf8f0] flex items-center justify-center transition-colors ${
                retrieveStatus === "active"
                  ? "bg-accent-ochre animate-pulse"
                  : retrieveStatus === "completed"
                  ? "bg-on-surface"
                  : "bg-outline-dim"
              }`}
            ></span>
            <div className="font-mono text-[11px] font-semibold text-on-surface flex items-center gap-1.5">
              <span>1. Retrieve</span>
              {retrieveStatus === "active" && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent-ochre animate-ping"></span>
              )}
            </div>
            <div className="font-mono text-[10px] text-on-surface-variant mt-0.5 truncate max-w-[140px]">
              {primaryPolicy}
            </div>
            {runResult?.latency_ms?.retrieve ? (
              <div className="font-mono text-[9px] text-outline mt-0.5">
                {runResult.latency_ms.retrieve}ms
              </div>
            ) : null}
          </li>

          {/* Stage 2: Draft */}
          <li className="ml-4 relative">
            <span
              className={`absolute -left-[23px] mt-1 h-3 w-3 rounded-full ring-3 ring-[#faf8f0] flex items-center justify-center transition-colors ${
                makerStatus === "active"
                  ? "bg-accent-ochre animate-pulse"
                  : makerStatus === "completed"
                  ? "bg-on-surface"
                  : "bg-outline-dim"
              }`}
            ></span>
            <div className="font-mono text-[11px] font-semibold text-on-surface flex items-center gap-1.5">
              <span>2. Draft</span>
              {makerStatus === "active" && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent-ochre animate-ping"></span>
              )}
            </div>
            <div className="font-mono text-[10px] text-on-surface-variant mt-0.5">
              {makerStatus === "active"
                ? "Maker drafting..."
                : makerStatus === "completed"
                ? "First draft ready"
                : "Awaiting retrieve"}
            </div>
            {runResult?.latency_ms?.maker ? (
              <div className="font-mono text-[9px] text-outline mt-0.5">
                {runResult.latency_ms.maker}ms
              </div>
            ) : null}
          </li>

          {/* Stage 3: Check claims */}
          <li className="ml-4 relative">
            <span
              className={`absolute -left-[23px] mt-1 h-3 w-3 rounded-full ring-3 ring-[#faf8f0] transition-colors ${
                checkStatus === "active"
                  ? "bg-accent-ochre animate-pulse"
                  : checkStatus === "completed"
                  ? contradictedCount > 0
                    ? "bg-accent-rose"
                    : unsupportedCount > 0
                    ? "bg-accent-ochre"
                    : "bg-accent-green"
                  : "bg-outline-dim"
              }`}
            ></span>
            <div
              className={`font-mono text-[11px] font-semibold ${
                checkStatus === "completed"
                  ? contradictedCount > 0
                    ? "text-accent-rose"
                    : unsupportedCount > 0
                    ? "text-accent-ochre"
                    : "text-on-surface"
                  : "text-on-surface"
              }`}
            >
              3. Check claims
            </div>
            <div
              className={`font-mono text-[10px] mt-0.5 ${
                checkStatus === "completed"
                  ? contradictedCount > 0
                    ? "text-accent-rose"
                    : unsupportedCount > 0
                    ? "text-accent-ochre"
                    : "text-accent-green"
                  : "text-on-surface-variant"
              }`}
            >
              {checkStatus === "active"
                ? "Deterministic & LLM..."
                : checkStatus === "completed"
                ? contradictedCount > 0
                  ? `${contradictedCount} contradiction${contradictedCount > 1 ? "s" : ""}`
                  : unsupportedCount > 0
                  ? `${unsupportedCount} unsupported`
                  : "All claims verified"
                : "Pending checks"}
            </div>
            {checkLatency > 0 ? (
              <div className="font-mono text-[9px] text-outline mt-0.5">
                {checkLatency}ms
              </div>
            ) : null}
          </li>

          {/* Stage 4: Correct */}
          <li className="ml-4 relative">
            <span
              className={`absolute -left-[23px] mt-1 h-3 w-3 rounded-full ring-3 ring-[#faf8f0] transition-colors ${
                correctStatus === "active"
                  ? "bg-accent-ochre animate-pulse"
                  : correctStatus === "completed"
                  ? wasCorrected
                    ? "bg-accent-ochre"
                    : isAbstained
                    ? "bg-accent-rose"
                    : "bg-accent-green"
                  : correctStatus === "skipped"
                  ? "bg-outline-dim ring-1 ring-outline"
                  : "bg-outline-dim"
              }`}
            ></span>
            <div
              className={`font-mono text-[11px] font-semibold ${
                correctStatus === "completed"
                  ? wasCorrected
                    ? "text-accent-ochre"
                    : isAbstained
                    ? "text-accent-rose"
                    : "text-outline"
                  : "text-outline"
              }`}
            >
              4. Correct
            </div>
            <div className="font-mono text-[10px] text-on-surface-variant mt-0.5">
              {correctStatus === "active"
                ? "Rewriting draft..."
                : wasCorrected
                ? `${runResult?.retries || 1} retry applied`
                : isAbstained
                ? runResult?.abstain_reason === "RETRY_CAP"
                  ? "Retry cap (2) exceeded"
                  : "Abstained"
                : "Not needed (Clean)"}
            </div>
            {runResult?.latency_ms?.correct ? (
              <div className="font-mono text-[9px] text-outline mt-0.5">
                {runResult.latency_ms.correct}ms
              </div>
            ) : null}
          </li>

          {/* Stage 5: Verified / Abstained */}
          <li className="ml-4 relative">
            <span
              className={`absolute -left-[23px] mt-1 h-3 w-3 rounded-full ring-3 ring-[#faf8f0] transition-colors ${
                verifiedStatus === "completed"
                  ? isAbstained
                    ? "bg-accent-rose"
                    : "bg-accent-green"
                  : verifiedStatus === "active"
                  ? "bg-accent-ochre animate-pulse"
                  : "bg-outline-dim"
              }`}
            ></span>
            <div className="font-mono text-[11px] font-semibold text-on-surface">
              {isAbstained ? "5. Abstained" : "5. Verified"}
            </div>
            <div
              className={`font-mono text-[10px] mt-0.5 ${
                verifiedStatus === "completed"
                  ? isAbstained
                    ? "text-accent-rose"
                    : "text-accent-green"
                  : "text-outline"
              }`}
            >
              {verifiedStatus === "completed"
                ? isAbstained
                  ? "Safe refusal message"
                  : "Approved for customer"
                : "Awaiting pipeline"}
            </div>
          </li>
        </ol>
      </div>

      {/* Latency summary at bottom */}
      <div className="pt-4 border-t border-outline-dim font-mono text-[10px] text-outline">
        <div>
          Total latency:{" "}
          <strong className="text-on-surface font-semibold">
            {runResult?.latency_ms?.total !== undefined && runResult.latency_ms.total > 0
              ? `${runResult.latency_ms.total}ms`
              : isLive
              ? "measuring..."
              : "—"}
          </strong>
        </div>
        <div className="mt-0.5 text-[9px] text-on-surface-variant">
          Retries: {runResult?.retries ?? 0} / 2
        </div>
      </div>
    </aside>
  );
};

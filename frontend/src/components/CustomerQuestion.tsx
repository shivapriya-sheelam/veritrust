"use client";

import React from "react";

interface CustomerQuestionProps {
  question: string;
  isChaos: boolean;
}

export const CustomerQuestion: React.FC<CustomerQuestionProps> = ({ question, isChaos }) => {
  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Customer question card */}
      <div className="p-4 rounded bg-white border border-outline-dim shadow-xs">
        <div className="flex items-center gap-2 mb-1.5 font-mono text-[10px] uppercase tracking-wider text-outline">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px] leading-none">help_outline</span>
            <span>Customer Question</span>
          </div>
          {isChaos && (
            <span className="px-2 py-0.5 rounded bg-accent-rose-bg text-accent-rose border border-accent-rose-border text-[9px] font-bold tracking-widest uppercase ml-auto font-mono">
              Chaos Mode · Simulated Failure
            </span>
          )}
        </div>
        <p className="font-sans text-[14px] text-on-surface font-medium leading-relaxed pl-3 border-l-2 border-outline-mid">
          &ldquo;{question}&rdquo;
        </p>
      </div>

      {/* Simulated failure alert banner (PRD Section 7.2 & 14) */}
      {isChaos && (
        <div className="p-3 rounded bg-accent-rose-bg/60 border border-accent-rose-border text-[12px] text-accent-rose font-mono transition-all">
          <div className="font-semibold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] leading-none">warning</span>
            <span>
              Simulated failure: Chaos mode instructs the Maker to hallucinate plausible incorrect numbers to verify guardrail enforcement.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

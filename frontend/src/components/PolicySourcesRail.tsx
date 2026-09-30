"use client";

import React, { useState } from "react";
import { PolicySummary } from "@/types/contracts";

interface PolicySourcesRailProps {
  policies: PolicySummary[];
  selectedPolicyName: string | null;
  onSelectPolicy: (name: string) => void;
  loading?: boolean;
}

export const PolicySourcesRail: React.FC<PolicySourcesRailProps> = ({
  policies,
  selectedPolicyName,
  onSelectPolicy,
  loading = false,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredPolicies = policies.filter((p) => {
    const term = searchTerm.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      p.version.toLowerCase().includes(term) ||
      (p.effective_date && p.effective_date.toLowerCase().includes(term))
    );
  });

  return (
    <aside className="lg:col-span-4 flex flex-col gap-4 bg-white p-4 rounded-lg border border-outline-dim shadow-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
          Policy Sources
        </span>
        <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface-muted text-on-surface-variant font-medium">
          {loading ? "Loading..." : `${policies.length} Registered`}
        </span>
      </div>

      {/* Filter Search Bar */}
      <div className="relative w-full">
        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[16px]">
          search
        </span>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter policy specifications..."
          className="w-full pl-8 pr-3 py-1.5 bg-surface-muted/60 font-mono text-[11px] text-on-surface rounded placeholder:text-outline focus:outline-none focus:bg-white border border-outline-dim transition-colors"
        />
      </div>

      {/* Documents List */}
      <div className="flex flex-col gap-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={`skeleton-${i}`}
              className="p-3 rounded border border-outline-dim/60 bg-surface-muted/30 animate-pulse flex flex-col gap-2"
            >
              <div className="h-4 bg-surface-dim rounded w-3/4"></div>
              <div className="h-3 bg-surface-dim/60 rounded w-1/2"></div>
            </div>
          ))
        ) : filteredPolicies.length === 0 ? (
          <div className="p-6 text-center font-mono text-[11px] text-outline border border-dashed border-outline-dim rounded">
            {policies.length === 0 ? "No policies available." : "No matching policies found."}
          </div>
        ) : (
          filteredPolicies.map((policy) => {
            const isSelected = selectedPolicyName === policy.name;
            return (
              <div
                key={policy.name}
                onClick={() => onSelectPolicy(policy.name)}
                className={`group cursor-pointer p-3 rounded transition-all flex flex-col gap-1 border ${
                  isSelected
                    ? "bg-surface-muted/70 text-on-surface border-l-2 border-l-accent-ochre border-outline-dim shadow-xs"
                    : "bg-white hover:bg-surface-muted/30 text-on-surface border-transparent"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] font-semibold text-on-surface flex items-center gap-1.5">
                    <span
                      className={`material-symbols-outlined text-[15px] ${
                        isSelected ? "text-accent-ochre" : "text-outline"
                      }`}
                    >
                      description
                    </span>
                    {policy.name}
                  </span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      isSelected
                        ? "bg-accent-ochre-bg text-accent-ochre border border-accent-ochre-border"
                        : "bg-surface-muted text-on-surface-variant"
                    }`}
                  >
                    {policy.version}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-surface-dim font-mono text-[10px] text-outline">
                  <span>Effective: {policy.effective_date || "—"}</span>
                  <span className={isSelected ? "text-accent-ochre font-medium" : "text-outline"}>
                    {isSelected ? "Active in Editor" : "View"}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rail Footer Details */}
      <div className="pt-2 flex flex-col gap-1 bg-surface-muted/50 p-3 rounded border border-outline-dim/70">
        <div className="flex items-center justify-between text-on-surface-variant">
          <span className="font-mono text-[10px] font-semibold uppercase">
            Grounding Knowledge Base
          </span>
          <span className="font-mono text-[10px] text-accent-ochre font-medium">
            Runtime Authoritative
          </span>
        </div>
        <p className="font-sans text-[11px] text-on-surface-variant leading-relaxed">
          All Maker and Judge verification checks reference these active policy specifications as ground truth.
        </p>
      </div>
    </aside>
  );
};

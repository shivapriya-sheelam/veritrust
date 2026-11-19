"use client";

import React, { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { PolicySourcesRail } from "@/components/PolicySourcesRail";
import { PolicyReader } from "@/components/PolicyReader";
import { PolicyEditor } from "@/components/PolicyEditor";
import { fetchPolicies, updatePolicy } from "@/lib/api";
import { PolicyDocument } from "@/types/policy";

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicyDocument[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [stalePolicies, setStalePolicies] = useState<Record<string, boolean>>({});
  const [previousVersions, setPreviousVersions] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isReindexing, setIsReindexing] = useState<boolean>(false);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    fetchPolicies()
      .then(async (data) => {
        if (!mounted) return;
        const mapped: PolicyDocument[] = data.map((d: any) => ({
          id: d.name,
          name: d.name,
          title: d.name.replace(".md", "").replace("_", " "),
          version: d.version,
          updatedAt: d.updated_at || new Date().toISOString(),
          summary: d.summary || "Policy specifications",
          subtitle: "Active",
          reviewsGroundedCount: 0,
          chunksCount: 0,
          chunks: [],
          markdownContent: d.text || "Loading content..."
        }));
        setPolicies(mapped);
        if (mapped.length > 0) {
          setSelectedPolicyId(mapped[0].id);
          // Fetch the full content for the first policy
          try {
             const { fetchPolicyByName } = await import("@/lib/api");
             const fullPolicy = await fetchPolicyByName(mapped[0].id);
             setPolicies(prev => prev.map(p => p.id === mapped[0].id ? { ...p, markdownContent: fullPolicy.text } : p));
          } catch (err) {
             console.error("Failed to fetch initial policy content", err);
          }
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const selectedPolicy = policies.find((p) => p.id === selectedPolicyId) || policies[0];

  const handleSelectPolicy = async (id: string) => {
    setSelectedPolicyId(id);
    setMode("view");
    
    const pol = policies.find(p => p.id === id);
    if (pol && pol.markdownContent === "Loading content...") {
      try {
        const { fetchPolicyByName } = await import("@/lib/api");
        const fullPol = await fetchPolicyByName(id);
        setPolicies(prev => prev.map(p => p.id === id ? { ...p, markdownContent: fullPol.text } : p));
      } catch (err) {
        console.error("Failed to load policy content", err);
      }
    }
  };

  const handleSaveDraft = async (newContent: string) => {
    setIsSaving(true);
    try {
      setPreviousVersions((prev) => ({
        ...prev,
        [selectedPolicy.id]: selectedPolicy.version,
      }));

      const result = await updatePolicy(selectedPolicy.id, newContent);
      
      setPolicies((prev) =>
        prev.map((p) =>
          p.id === selectedPolicy.id
            ? {
                ...p,
                version: result.version,
                updatedAt: new Date().toISOString().replace("T", " ").substring(0, 16) + " UTC",
                markdownContent: newContent,
                staleRunsCount: result.stale_run_ids?.length || 0,
              }
            : p
        )
      );

      setStalePolicies((prev) => ({
        ...prev,
        [selectedPolicy.id]: true,
      }));
      setMode("view");
    } catch (err) {
      alert("Failed to save policy: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReindex = () => {
    if (isReindexing) return;
    setIsReindexing(true);
    setTimeout(() => {
      setIsReindexing(false);
    }, 700);
  };

  return (
    <div className="bg-[#faf8f0] text-on-surface antialiased font-sans min-h-screen flex flex-col">
      <Header activeTab="policies" />

      <main className="w-full flex-1 bg-[#fff8f0] overflow-y-auto">
        <div className="w-full px-6 py-6 max-w-[1440px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-surface-dim">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="uppercase tracking-wider text-accent-ochre font-semibold">
                Grounding Engine
              </span>
              <span className="text-outline">/</span>
              <span className="uppercase tracking-wider text-on-surface font-semibold">
                Policies
              </span>
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px] text-on-surface-variant">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-ochre animate-pulse"></span>
                Authoritative Policy Runtime · {policies.length} policies active
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-outline font-mono text-[13px]">
              Loading policies...
            </div>
          ) : error ? (
            <div className="p-6 bg-rose-50 text-rose-700 border border-rose-200 rounded">
              {error}
            </div>
          ) : policies.length === 0 ? (
            <div className="p-12 text-center text-outline font-mono text-[13px]">
              No policies found.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <PolicySourcesRail
                policies={policies}
                selectedPolicyId={selectedPolicyId}
                onSelectPolicy={handleSelectPolicy}
              />

              <section className="lg:col-span-8 flex flex-col gap-6">
                {mode === "view" ? (
                  <PolicyReader
                    policy={selectedPolicy}
                    isStale={!!stalePolicies[selectedPolicy.id]}
                    previousVersion={previousVersions[selectedPolicy.id] || "v1.0"}
                    mode={mode}
                    onModeChange={setMode}
                    onReindex={handleReindex}
                    isReindexing={isReindexing}
                  />
                ) : (
                  <div className="flex flex-col gap-6">
                    <PolicyReader
                      policy={selectedPolicy}
                      isStale={!!stalePolicies[selectedPolicy.id]}
                      previousVersion={previousVersions[selectedPolicy.id] || "v1.0"}
                      mode={mode}
                      onModeChange={setMode}
                      onReindex={handleReindex}
                      isReindexing={isReindexing}
                    />
                    <PolicyEditor
                      policy={selectedPolicy}
                      onSaveDraft={handleSaveDraft}
                      onCancel={() => setMode("view")}
                      isSaving={isSaving}
                    />
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>

      <footer className="w-full bg-[#faf8f0] border-t border-outline-dim py-5">
        <div className="max-w-[1440px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left font-mono text-[11px] text-on-surface-variant">
          <p>VeriTrust · Automated AI Verification Ledger · Verified against policy specifications</p>
          <div className="text-outline text-[10px]">
            Policy Runtime Engine v1.0
          </div>
        </div>
      </footer>
    </div>
  );
}

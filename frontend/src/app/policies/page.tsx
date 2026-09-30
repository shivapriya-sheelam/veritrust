"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/Header";
import { PolicySourcesRail } from "@/components/PolicySourcesRail";
import { PolicyReader } from "@/components/PolicyReader";
import { PolicyEditor } from "@/components/PolicyEditor";
import { getPolicies, getPolicy, updatePolicy } from "@/lib/api";
import { PolicySummary, PolicyDetail } from "@/types/contracts";

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState<boolean>(true);
  const [policiesError, setPoliciesError] = useState<string | null>(null);

  const [selectedPolicyName, setSelectedPolicyName] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PolicyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editorText, setEditorText] = useState<string>("");
  const [isDirty, setIsDirty] = useState<boolean>(false);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const [showStaleBanner, setShowStaleBanner] = useState<boolean>(false);
  const [staleRunCount, setStaleRunCount] = useState<number>(0);

  // Fetch list of registered policies
  const loadPolicies = useCallback(async (selectDefault = true) => {
    setPoliciesLoading(true);
    setPoliciesError(null);
    try {
      const data = await getPolicies();
      setPolicies(data);
      if (selectDefault && data.length > 0 && !selectedPolicyName) {
        setSelectedPolicyName(data[0].name);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load policies";
      setPoliciesError(msg);
    } finally {
      setPoliciesLoading(false);
    }
  }, [selectedPolicyName]);

  // Fetch specific policy details when selected
  const loadPolicyDetail = useCallback(async (name: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const detail = await getPolicy(name);
      setSelectedDetail(detail);
      setEditorText(detail.text);
      setIsDirty(false);
      setSaveError(null);
      setSaveSuccess(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Failed to load policy ${name}`;
      setDetailError(msg);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  useEffect(() => {
    if (selectedPolicyName) {
      loadPolicyDetail(selectedPolicyName);
    }
  }, [selectedPolicyName, loadPolicyDetail]);

  const handleSelectPolicy = (name: string) => {
    if (name === selectedPolicyName) return;

    if (isDirty) {
      const confirmed = window.confirm("You have unsaved changes. Discard them?");
      if (!confirmed) return;
    }

    setIsDirty(false);
    setMode("view");
    setShowStaleBanner(false);
    setSelectedPolicyName(name);
  };

  const handleEditorTextChange = (text: string) => {
    setEditorText(text);
    setIsDirty(text !== (selectedDetail?.text ?? ""));
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleDiscard = () => {
    if (selectedDetail) {
      setEditorText(selectedDetail.text);
      setIsDirty(false);
      setSaveError(null);
      setSaveSuccess(false);
    }
  };

  const handleSave = async () => {
    if (!selectedPolicyName || isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const result = await updatePolicy(selectedPolicyName, editorText);

      // Update current policy detail with returned version
      setSelectedDetail((prev) =>
        prev
          ? {
              ...prev,
              version: result.version,
              text: editorText,
            }
          : null
      );

      // Update policy summary in the sidebar list
      setPolicies((prev) =>
        prev.map((p) =>
          p.name === selectedPolicyName ? { ...p, version: result.version } : p
        )
      );

      // Stale run banner handling: only show if stale_run_ids.length > 0
      const staleCount = result.stale_run_ids ? result.stale_run_ids.length : 0;
      setStaleRunCount(staleCount);
      setShowStaleBanner(staleCount > 0);

      setIsDirty(false);
      setSaveSuccess(true);
      setMode("view");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update policy";
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedPolicySummary = policies.find((p) => p.name === selectedPolicyName);

  return (
    <div className="bg-[#faf8f0] text-on-surface antialiased font-sans min-h-screen flex flex-col">
      {/* Reusable Header with Policies active */}
      <Header activeTab="policies" />

      {/* Main Workspace */}
      <main className="w-full flex-1 bg-[#fff8f0] overflow-y-auto">
        <div className="w-full px-6 py-6 max-w-[1440px] mx-auto flex flex-col gap-6">
          {/* Breadcrumb Context Bar */}
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
                Authoritative Policy Runtime · {policies.length} policies registered
              </span>
            </div>
          </div>

          {/* Backend Error Notification if list fails */}
          {policiesError && (
            <div className="p-4 rounded bg-red-50/70 border border-red-200 font-mono text-[12px] text-accent-rose flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="font-bold">Backend connection failed:</span> {policiesError}
              </div>
              <button
                type="button"
                onClick={() => loadPolicies()}
                className="px-3 py-1 bg-white border border-red-300 rounded hover:bg-red-50 font-mono text-[11px] font-semibold text-accent-rose self-start sm:self-auto cursor-pointer"
              >
                Retry Policies
              </button>
            </div>
          )}

          {/* Main Two-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: Policy Sources Rail (col-span-4 on lg) */}
            <PolicySourcesRail
              policies={policies}
              selectedPolicyName={selectedPolicyName}
              onSelectPolicy={handleSelectPolicy}
              loading={policiesLoading}
            />

            {/* RIGHT COLUMN: Authoritative Policy Reader & Editor (col-span-8 on lg) */}
            <section className="lg:col-span-8 flex flex-col gap-6">
              {selectedPolicyName ? (
                <>
                  <PolicyReader
                    policyName={selectedPolicyName}
                    version={selectedDetail?.version ?? selectedPolicySummary?.version ?? "v1"}
                    effectiveDate={selectedPolicySummary?.effective_date}
                    updatedAt={selectedPolicySummary?.updated_at}
                    text={selectedDetail?.text ?? ""}
                    mode={mode}
                    onModeChange={setMode}
                    showStaleBanner={showStaleBanner}
                    staleRunCount={staleRunCount}
                    loading={detailLoading}
                    error={detailError}
                    onRetry={() => loadPolicyDetail(selectedPolicyName)}
                  />

                  {mode === "edit" && selectedDetail && (
                    <PolicyEditor
                      policyName={selectedPolicyName}
                      version={selectedDetail.version}
                      content={editorText}
                      onChangeContent={handleEditorTextChange}
                      onSave={handleSave}
                      onCancel={handleDiscard}
                      isSaving={isSaving}
                      isDirty={isDirty}
                      saveError={saveError}
                      saveSuccess={saveSuccess}
                    />
                  )}
                </>
              ) : (
                <div className="bg-white p-12 rounded-lg border border-outline-dim shadow-xs text-center font-mono text-[12px] text-outline">
                  {policiesLoading
                    ? "Loading policies..."
                    : "No policy selected. Choose a policy specification from the left rail."}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
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

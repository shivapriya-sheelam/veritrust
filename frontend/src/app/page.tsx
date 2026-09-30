"use client";

import React, { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { Timeline } from "@/components/Timeline";
import { CustomerQuestion } from "@/components/CustomerQuestion";
import { DocumentReview } from "@/components/DocumentReview";
import { EvidenceRail } from "@/components/EvidenceRail";
import { getScenarioRunResult, ScenarioKey } from "@/lib/mockEvents";
import { useAsk } from "@/hooks/useAsk";
import { AskBar } from "@/components/AskBar";

export default function ReviewPage() {
  const [currentScenario, setCurrentScenario] = useState<ScenarioKey>("corrected");
  const [viewMode, setViewMode] = useState<"reviewer" | "customer">("reviewer");
  const [chaosActive, setChaosActive] = useState<boolean>(true);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>("claim-0");

  const { run, status, error, ask, currentStage, stageStatuses, resetToResult } = useAsk();

  // Load the initial scenario run result on mount or when scenario changes
  useEffect(() => {
    const mock = getScenarioRunResult(currentScenario);
    resetToResult(mock);
    if (currentScenario === "corrected") {
      setChaosActive(true);
      setSelectedClaimId("claim-0");
    } else if (currentScenario === "abstained") {
      setChaosActive(false);
      setSelectedClaimId("claim-0");
    } else {
      setChaosActive(false);
      setSelectedClaimId("claim-0");
    }
  }, [currentScenario]);

  const initialMock = React.useMemo(() => getScenarioRunResult(currentScenario), [currentScenario]);
  const runResult = run || initialMock;

  const handleScenarioChange = (scenario: ScenarioKey) => {
    setCurrentScenario(scenario);
  };

  const handleChaosToggle = () => {
    setChaosActive((prev) => !prev);
  };

  const handleSelectClaim = (id: string, source: "document" | "rail" = "document") => {
    setSelectedClaimId(id);

    if (source === "document") {
      // Triggered from document: scroll only the corresponding right-margin comment
      const commentEl = document.getElementById(`comment-${id}`);
      if (commentEl) {
        commentEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } else {
      // Triggered from rail: scroll only the corresponding document segment
      const docEl = document.getElementById(`doc-${id}`);
      if (docEl) {
        docEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  };

  return (
    <div className="bg-[#faf8f0] text-on-surface antialiased font-sans h-screen flex flex-col overflow-hidden">
      {/* Top minimal navigation bar */}
      <Header
        activeTab="review"
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        chaosActive={chaosActive}
        onChaosToggle={handleChaosToggle}
        currentScenario={currentScenario}
        onScenarioChange={handleScenarioChange}
      />

      {/* Main workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Column 1: Left live timeline (Reviewer view only) */}
        {viewMode === "reviewer" && (
          <Timeline
            runResult={runResult}
            currentStage={currentStage}
            stageStatuses={stageStatuses}
            isLive={status === "running"}
          />
        )}

        {/* Column 2: Central document */}
        <section
          className={`flex-1 overflow-y-auto px-6 sm:px-10 py-8 flex flex-col items-center bg-[#fff8f0] ${
            viewMode === "customer" ? "max-w-3xl mx-auto w-full" : ""
          }`}
        >
          <div className="w-full max-w-[720px] flex flex-col gap-6">
            <AskBar
              status={status}
              error={error}
              onAsk={(q) => ask(q, chaosActive, currentScenario)}
            />

            {runResult && (
              <>
                <CustomerQuestion
                  question={runResult.question}
                  isChaos={runResult.chaos}
                />

                <DocumentReview
                  runResult={runResult}
                  viewMode={viewMode}
                  onSelectClaim={handleSelectClaim}
                  selectedClaimId={selectedClaimId}
                />
              </>
            )}
          </div>
        </section>

        {/* Column 3: Right evidence & comments rail (Reviewer view only) */}
        {viewMode === "reviewer" && (
          <EvidenceRail
            runResult={runResult}
            selectedClaimId={selectedClaimId}
            onCardClick={handleSelectClaim}
          />
        )}
      </main>
    </div>
  );
}

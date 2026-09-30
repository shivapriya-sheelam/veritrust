import { useState } from 'react';
import { askStream } from '@/lib/api';
import { RunResult, Claim, ClaimSpan, ServerEvent } from '@/types/contracts';
import { ScenarioKey } from '@/lib/mockEvents';

export type PipelineStage = "retrieve" | "maker" | "check" | "correct" | "verified";
export type StageStatus = "pending" | "active" | "completed" | "error" | "skipped";

export function useAsk() {
  const [run, setRun] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<PipelineStage | null>(null);
  const [stageStatuses, setStageStatuses] = useState<Record<PipelineStage, StageStatus>>({
    retrieve: "pending",
    maker: "pending",
    check: "pending",
    correct: "pending",
    verified: "pending",
  });

  const resetToResult = (result: RunResult) => {
    setRun(result);
    setStatus("done");
    setError(null);
    setCurrentStage(null);
    setStageStatuses({
      retrieve: "completed",
      maker: "completed",
      check: "completed",
      correct: result.retries > 0 ? "completed" : "skipped",
      verified: "completed",
    });
  };

  const ask = async (question: string, chaos: boolean, scenario: ScenarioKey = "corrected") => {
    if (status === "running") return;
    setStatus("running");
    setError(null);
    setCurrentStage("retrieve");
    setStageStatuses({
      retrieve: "active",
      maker: "pending",
      check: "pending",
      correct: "pending",
      verified: "pending",
    });

    setRun({
      run_id: "",
      question,
      chaos,
      draft: "",
      claims: [],
      final_draft: "",
      final_claims: [],
      final_answer: "",
      final_status: "DELIVERED",
      abstain_reason: null,
      retries: 0,
      latency_ms: { retrieve: 0, maker: 0, check: 0, judge: 0, correct: 0, total: 0 },
      tokens: { maker: 0, judge: 0 },
      policy_versions: {},
      created_at: new Date().toISOString(),
    } as RunResult);

    try {
      const stream = askStream(question, chaos, scenario);
      for await (const msg of stream) {
        // Update stage tracking
        switch (msg.event) {
          case "run_started":
            setCurrentStage("retrieve");
            setStageStatuses((prev) => ({ ...prev, retrieve: "active" }));
            break;
          case "retrieved":
            setCurrentStage("maker");
            setStageStatuses((prev) => ({ ...prev, retrieve: "completed", maker: "active" }));
            break;
          case "draft":
            setCurrentStage("check");
            setStageStatuses((prev) => ({ ...prev, maker: "completed", check: "active" }));
            break;
          case "claims":
          case "claim_checked":
            setStageStatuses((prev) => ({ ...prev, check: "active" }));
            break;
          case "correcting":
            setCurrentStage("correct");
            setStageStatuses((prev) => ({ ...prev, check: "completed", correct: "active" }));
            break;
          case "corrected_draft":
            setStageStatuses((prev) => ({ ...prev, correct: "active" }));
            break;
          case "final":
            setCurrentStage("verified");
            setStageStatuses((prev) => ({
              ...prev,
              correct: prev.correct === "active" ? "completed" : prev.correct === "pending" ? "skipped" : prev.correct,
              verified: "completed",
            }));
            break;
          case "run_finished":
            setCurrentStage(null);
            setStatus("done");
            break;
          case "error":
            setStatus("error");
            setError(`Error ${msg.data.code}: ${msg.data.message}`);
            setStageStatuses((prev) => ({
              ...prev,
              [currentStage || "retrieve"]: "error",
            }));
            break;
        }

        // Update run state
        setRun((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          switch (msg.event) {
            case "run_started":
              next.run_id = msg.data.run_id;
              next.question = msg.data.question;
              next.chaos = msg.data.chaos;
              break;
            case "retrieved":
              // Extract policy versions from retrieved evidence
              if (msg.data.evidence && msg.data.evidence.length > 0) {
                const versions: Record<string, string> = { ...next.policy_versions };
                for (const ev of msg.data.evidence) {
                  versions[ev.source] = ev.version;
                }
                next.policy_versions = versions;
              }
              break;
            case "draft":
              next.draft = msg.data.text;
              next.final_draft = msg.data.text;
              break;
            case "claims":
              if (msg.data.attempt === 0) {
                next.claims = (msg.data.claims as ClaimSpan[]).map(
                  (c) =>
                    ({
                      ...c,
                      status: "UNSUPPORTED",
                      checked_by: "llm",
                      reason: "Checking claim...",
                      evidence: [],
                    } as Claim)
                );
              } else {
                next.final_claims = (msg.data.claims as ClaimSpan[]).map(
                  (c) =>
                    ({
                      ...c,
                      status: "UNSUPPORTED",
                      checked_by: "llm",
                      reason: "Checking claim...",
                      evidence: [],
                    } as Claim)
                );
              }
              break;
            case "claim_checked":
              if (msg.data.attempt === 0) {
                const idx = next.claims.findIndex((c) => c.id === msg.data.claim.id);
                if (idx !== -1) {
                  const newClaims = [...next.claims];
                  newClaims[idx] = msg.data.claim;
                  next.claims = newClaims;
                  next.final_claims = newClaims;
                }
              } else {
                const idx = next.final_claims.findIndex((c) => c.id === msg.data.claim.id);
                if (idx !== -1) {
                  const newClaims = [...next.final_claims];
                  newClaims[idx] = msg.data.claim;
                  next.final_claims = newClaims;
                }
              }
              break;
            case "correcting":
              next.retries = msg.data.attempt;
              break;
            case "corrected_draft":
              next.final_draft = msg.data.text;
              break;
            case "final":
              next.final_answer = msg.data.answer;
              next.final_status = msg.data.status;
              next.abstain_reason = msg.data.abstain_reason;
              break;
            case "run_finished":
              return msg.data.result;
            case "error":
              setError(`Error ${msg.data.code}: ${msg.data.message}`);
              setStatus("error");
              break;
          }
          return next;
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`Failed to connect: ${err.message}`);
      } else {
        setError("An unknown error occurred");
      }
      setStatus("error");
      setStageStatuses((prev) => ({
        ...prev,
        [currentStage || "retrieve"]: "error",
      }));
    }
  };

  return { run, status, error, ask, currentStage, stageStatuses, resetToResult, setRun };
}

import {
  ServerEvent,
  RunResult,
  RunRow,
  MetricsResult,
  PolicySummary,
  PolicyDetail,
  PolicyUpdateResult,
  BenchmarkCaseResult,
  BenchmarkSummary,
  BenchmarkStreamEvent,
} from "../types/contracts";

export interface GetRunsParams {
  limit?: number;
  offset?: number;
  source?: "live" | "benchmark";
}

export async function* askStream(
  question: string,
  chaos: boolean,
  mockScenario: "corrected" | "delivered" | "abstained" = "corrected"
): AsyncGenerator<ServerEvent, void, unknown> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const rawEvents = (await import("../../mocks/events.json")).default;
    const scenarios = rawEvents.scenarios;
    const events = scenarios[mockScenario] as ServerEvent[];

    for (const event of events) {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 200));
      yield event;
    }
    return;
  }

  const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/ask`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, chaos }),
  });

  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    
    // Parse SSE format
    while (true) {
      const doubleNewlineIdx = buffer.indexOf("\n\n");
      if (doubleNewlineIdx === -1) break; // incomplete chunk

      const chunk = buffer.slice(0, doubleNewlineIdx);
      buffer = buffer.slice(doubleNewlineIdx + 2);

      let currentEvent = "";
      let currentData = "";

      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData += line.slice(6).trim();
        }
      }

      if (currentEvent && currentData) {
        try {
          const parsedData = JSON.parse(currentData);
          yield { event: currentEvent, data: parsedData } as ServerEvent;
        } catch (err) {
          console.error("Failed to parse event data", currentData, err);
        }
      }
    }
  }
}

export function getMockRunResult(scenario: "corrected" | "delivered" | "abstained"): RunResult {
  if (process.env.NEXT_PUBLIC_USE_MOCKS === "true") {
    const rawEvents = require("../../mocks/events.json");
    const events = rawEvents.scenarios[scenario] as ServerEvent[];
    const finished = events?.find((e): e is Extract<ServerEvent, { event: "run_finished" }> => e.event === "run_finished");
    if (finished) return finished.data.result;
  }
  return {
    run_id: "run-fallback",
    question: "Can I return opened headphones after 20 days?",
    chaos: true,
    draft: "Opened electronics can be returned within 30 days.",
    claims: [],
    final_draft: "Opened electronics can be returned within 15 days.",
    final_claims: [],
    final_answer: "Opened electronics can be returned within 15 days.",
    final_status: "CORRECTED",
    abstain_reason: null,
    retries: 1,
    latency_ms: { retrieve: 100, maker: 500, check: 50, judge: 0, correct: 600, total: 1250 },
    tokens: { maker: 100, judge: 0 },
    policy_versions: { "refund_policy.md": "v2" },
    created_at: new Date().toISOString()
  };
}

/**
 * Fetch verification runs for the Ledger.
 * Supports limit, offset, and source filtering.
 */
export async function getRuns(params?: GetRunsParams): Promise<RunRow[]> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const { MOCK_LEDGER_RUNS } = await import("./mockLedger");
    const limit = params?.limit ?? 10;
    const offset = params?.offset ?? 0;
    const mapped: RunRow[] = MOCK_LEDGER_RUNS.map((r, idx) => ({
      run_id: r.id.replace(/^#/, ""),
      question: r.question,
      final_status: r.status === "PASSED" ? "DELIVERED" : r.status === "REFUSED" ? "ABSTAINED" : "CORRECTED",
      chaos: !!r.isSimulated,
      source: "live",
      created_at: new Date(Date.now() - (idx * 1800000)).toISOString(),
      total_ms: 1250,
      stale: false,
    }));
    return mapped.slice(offset, offset + limit);
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const url = new URL("/api/runs", baseUrl);
  if (params?.limit !== undefined) url.searchParams.set("limit", params.limit.toString());
  if (params?.offset !== undefined) url.searchParams.set("offset", params.offset.toString());
  if (params?.source !== undefined) url.searchParams.set("source", params.source);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch runs (${response.status}: ${response.statusText})`);
  }

  return response.json();
}

/**
 * Fetch full RunResult for a specific run ID for replay and inspection.
 */
export async function getRun(id: string): Promise<RunResult> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const { MOCK_LEDGER_RUNS } = await import("./mockLedger");
    const found = MOCK_LEDGER_RUNS.find((r) => r.id === id || r.id.replace(/^#/, "") === id);
    const scenario = found?.actionScenario || (id.toLowerCase().includes("abstain") ? "abstained" : id.toLowerCase().includes("deliver") ? "delivered" : "corrected");
    const mockRes = getMockRunResult(scenario);
    return {
      ...mockRes,
      run_id: id,
      question: found?.question || mockRes.question,
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch run ${id} (${response.status}: ${response.statusText})`);
  }

  return response.json();
}

/**
 * Fetch aggregate verification metrics computed from database.
 */
export async function getMetrics(): Promise<MetricsResult> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const { MOCK_LEDGER_SUMMARY } = await import("./mockLedger");
    return {
      answers_checked: MOCK_LEDGER_SUMMARY.totalChecked,
      wrong_drafts: MOCK_LEDGER_SUMMARY.wrongDrafts,
      delivered_clean: MOCK_LEDGER_SUMMARY.totalChecked - MOCK_LEDGER_SUMMARY.wrongDrafts,
      corrected: MOCK_LEDGER_SUMMARY.fixedCount,
      abstained: MOCK_LEDGER_SUMMARY.refusedCount,
      chaos_runs: 5,
      grounding_rate: 0.94,
      first_pass_clean_rate: 0.84,
      drift: [
        { window_end: "2026-09-20T10:00:00Z", first_pass_clean_rate: 0.78, runs: 10 },
        { window_end: "2026-09-22T12:00:00Z", first_pass_clean_rate: 0.54, runs: 10 },
        { window_end: "2026-09-25T14:00:00Z", first_pass_clean_rate: 0.36, runs: 10 },
        { window_end: "2026-09-27T16:00:00Z", first_pass_clean_rate: 0.82, runs: 10 },
        { window_end: "2026-09-28T18:00:00Z", first_pass_clean_rate: 0.80, runs: 10 },
        { window_end: "2026-09-29T20:00:00Z", first_pass_clean_rate: 0.86, runs: 10 },
        { window_end: "2026-09-30T14:22:00Z", first_pass_clean_rate: 0.87, runs: 10 },
      ],
      policy_changes: [
        { name: "refund_policy.md", from: "v1", to: "v2", at: "2026-09-25T14:30:00Z" }
      ],
      latency_ms: { retrieve: 120, maker: 450, check: 35, judge: 210, correct: 510, total: 1325 },
      tokens: { maker: 180, judge: 85 }
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${baseUrl}/api/metrics`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch metrics (${response.status}: ${response.statusText})`);
  }

  return response.json();
}

/**
 * Fetch list of registered policy files (GET /api/policies)
 */
export async function getPolicies(): Promise<PolicySummary[]> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const { MOCK_POLICIES } = await import("./mockPolicies");
    return MOCK_POLICIES.map((p) => ({
      name: p.id,
      version: p.version,
      effective_date: "2026-09-01",
      updated_at: p.updatedAt,
    }));
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${baseUrl}/api/policies`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch policies (${response.status}: ${response.statusText})`);
  }

  return response.json();
}

/**
 * Fetch full policy document text and version (GET /api/policies/{name})
 */
export async function getPolicy(name: string): Promise<PolicyDetail> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const { MOCK_POLICIES } = await import("./mockPolicies");
    const found = MOCK_POLICIES.find((p) => p.id === name || p.name === name) || MOCK_POLICIES[0];
    return {
      name: found.id,
      version: found.version,
      text: found.markdownContent,
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${baseUrl}/api/policies/${encodeURIComponent(name)}`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch policy ${name} (${response.status}: ${response.statusText})`);
  }

  return response.json();
}

/**
 * Update policy content, bumping runtime version and retrieving stale run IDs (PUT /api/policies/{name})
 */
export async function updatePolicy(name: string, text: string): Promise<PolicyUpdateResult> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const { MOCK_POLICIES } = await import("./mockPolicies");
    const found = MOCK_POLICIES.find((p) => p.id === name || p.name === name);
    const currentVersion = found?.version || "v1";
    const num = parseInt(currentVersion.replace(/[^0-9]/g, "") || "1", 10);
    const nextVersion = `v${num + 1}`;
    if (found) {
      found.version = nextVersion;
      found.markdownContent = text;
    }
    return {
      name,
      version: nextVersion,
      stale_run_ids: ["run-stale-001", "run-stale-002"],
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${baseUrl}/api/policies/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update policy ${name} (${response.status}: ${response.statusText})`);
  }

  return response.json();
}

/**
 * Run the benchmark gauntlet (POST /api/benchmark/run) returning an SSE stream.
 * In live mode, reads real SSE chunks incrementally from the backend.
 * In mock mode, simulates the PRD 40-case stream.
 */
export async function* runBenchmarkStream(
  chaosOrModes: boolean | ("normal" | "chaos")[] = false,
  signal?: AbortSignal
): AsyncGenerator<BenchmarkStreamEvent, void, unknown> {
  const modes: ("normal" | "chaos")[] = Array.isArray(chaosOrModes)
    ? chaosOrModes
    : [chaosOrModes ? "chaos" : "normal"];
  const isChaos = modes.includes("chaos");
  const modeLabel = isChaos ? "chaos" : "normal";

  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const { MOCK_BENCHMARK_CASES, MOCK_LATEST_BENCHMARK } = await import("./mockLedger");

    // 1. Initial started event
    yield {
      event: "benchmark_started",
      data: {
        total_cases: MOCK_BENCHMARK_CASES.length,
        mode: modeLabel,
        modes,
        started_at: new Date().toISOString(),
      },
    };

    // 2. Stream individual case results incrementally
    for (const item of MOCK_BENCHMARK_CASES) {
      if (signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal?.aborted) return;

      yield {
        event: "benchmark_case",
        data: {
          ...item,
          mode: modeLabel,
        },
      };
    }

    if (signal?.aborted) return;

    // 3. Final authoritative summary event
    yield {
      event: "benchmark_summary",
      data: {
        ...MOCK_LATEST_BENCHMARK,
        modes,
        finished_at: new Date().toISOString(),
      },
    };
    return;
  }

  // Live SSE stream strictly conforming to PRD §10: body {modes: ["normal","chaos"]}
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const url = `${baseUrl}/api/benchmark/run`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      modes,
    }),
    signal,
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      if (errJson && errJson.message) {
        errorDetail = `: ${errJson.message}`;
      } else if (errJson && errJson.detail) {
        errorDetail = `: ${typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail)}`;
      }
    } catch {
      // Body not JSON
    }
    throw new Error(`Benchmark run failed (${response.status}: ${response.statusText}${errorDetail})`);
  }

  if (!response.body) {
    throw new Error("No response body received from benchmark run stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const doubleNewlineIdx = buffer.indexOf("\n\n");
        if (doubleNewlineIdx === -1) break;

        const rawEventChunk = buffer.slice(0, doubleNewlineIdx);
        buffer = buffer.slice(doubleNewlineIdx + 2);

        let eventType = "";
        const dataLines: string[] = [];

        for (const line of rawEventChunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;

          if (trimmed.startsWith("event:")) {
            eventType = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("data:")) {
            dataLines.push(trimmed.slice(5).trim());
          }
        }

        if (dataLines.length > 0) {
          const joinedData = dataLines.join("\n");
          try {
            const parsed = JSON.parse(joinedData);

            if (
              eventType === "benchmark_started" ||
              eventType === "started" ||
              (parsed.total_cases !== undefined && !parsed.case_id && parsed.detection_rate === undefined)
            ) {
              yield {
                event: "benchmark_started",
                data: parsed,
              };
            } else if (
              eventType === "benchmark_case" ||
              eventType === "case_result" ||
              eventType === "case" ||
              parsed.case_id !== undefined
            ) {
              yield {
                event: "benchmark_case",
                data: parsed as BenchmarkCaseResult,
              };
            } else if (
              eventType === "benchmark_summary" ||
              eventType === "summary" ||
              eventType === "run_finished" ||
              parsed.detection_rate !== undefined
            ) {
              yield {
                event: "benchmark_summary",
                data: parsed as BenchmarkSummary,
              };
            } else if (eventType === "error" || parsed.code !== undefined) {
              yield {
                event: "error",
                data: parsed,
              };
            }
          } catch (jsonErr) {
            console.warn("Failed to parse SSE JSON chunk:", joinedData, jsonErr);
          }
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      return;
    }
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore if lock already released or stream aborted
    }
  }
}

/**
 * Fetch latest completed benchmark run summary (GET /api/benchmark/latest)
 * Returns null if 404 (no benchmark recorded yet).
 */
export async function getLatestBenchmark(): Promise<BenchmarkSummary | null> {
  const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  if (useMocks) {
    const { MOCK_LATEST_BENCHMARK } = await import("./mockLedger");
    return MOCK_LATEST_BENCHMARK;
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${baseUrl}/api/benchmark/latest`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch latest benchmark (${response.status}: ${response.statusText})`);
  }

  return response.json();
}

